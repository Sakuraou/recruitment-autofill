import { MV3_CAPTURE_PORT, type CapturePort } from '../visual/mv3CaptureBackgroundPort';
import type { AgentPageOwner } from './agentOwnerClient';
import type { LocalRedactedPngData } from '../content/visualSemanticClient';

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z\d+/]+={0,2}$/u;
const REQUEST_ID = /^[A-Za-z\d_-]{8,80}$/u;

export interface VisualCaptureTarget { readonly tabId: number; readonly windowId: number; readonly url: string }
export interface VisualCaptureDependencies {
  readonly owner: AgentPageOwner;
  readonly target: VisualCaptureTarget;
  readonly connect?: (name: string) => CapturePort;
  /** Decodes and redacts locally; it must never return the original PNG. */
  readonly redact: (dataUrl: string, signal: AbortSignal) => Promise<LocalRedactedPngData | undefined>;
  readonly requestId?: string;
  readonly deadlineMs?: number;
}
export type VisualCaptureResult = Readonly<{ state: 'ready'; image: LocalRedactedPngData }> | Readonly<{ state: 'manual'; reason: 'invalid-input' | 'owner-ended' | 'unavailable' | 'cancelled' | 'timeout' }>;
const manual = (reason: Exclude<VisualCaptureResult, { state: 'ready' }>['reason']): VisualCaptureResult => Object.freeze({ state: 'manual', reason });

/** Popup capture seam: raw PNG stays in the background/content boundary until local redaction succeeds. */
export async function captureRedactedVisualRegion(options: VisualCaptureDependencies): Promise<VisualCaptureResult> {
  if (options.owner.signal.aborted) return manual('owner-ended');
  const requestId = options.requestId ?? `visual-${crypto.randomUUID()}`;
  if (!REQUEST_ID.test(requestId) || !Number.isSafeInteger(options.target.tabId) || options.target.tabId <= 0
    || !Number.isSafeInteger(options.target.windowId) || options.target.windowId < 0 || !/^https?:\/\//u.test(options.target.url)) return manual('invalid-input');
  let port: CapturePort;
  try { port = (options.connect ?? (name => chrome.runtime.connect({ name })))(MV3_CAPTURE_PORT); }
  catch { return manual('unavailable'); }
  const controller = new AbortController(); let settled = false; let used = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let messageListener: (message: unknown) => void = () => undefined; let disconnectListener: () => void = () => undefined;
  let onOwnerAbort: () => void = () => undefined;
  const removeOwner = () => options.owner.signal.removeEventListener('abort', onOwnerAbort);
  const finish = (result: VisualCaptureResult): VisualCaptureResult => {
    if (settled) return result; settled = true; controller.abort(); if (timer !== undefined) clearTimeout(timer); removeOwner();
    port.onMessage.removeListener?.(messageListener); port.onDisconnect.removeListener?.(disconnectListener);
    try { port.disconnect(); } catch { /* already closed */ } return result;
  };
  const task = new Promise<VisualCaptureResult>(resolve => {
    onOwnerAbort = () => { controller.abort(); if (!settled) resolve(finish(manual('owner-ended'))); };
    messageListener = (message: unknown) => {
      if (settled) return;
      if (used) { resolve(finish(manual('unavailable'))); return; }
      used = true;
      if (controller.signal.aborted || options.owner.signal.aborted) { resolve(finish(manual('owner-ended'))); return; }
      if (!message || typeof message !== 'object') { resolve(finish(manual('unavailable'))); return; }
      const value = message as { ok?: unknown; data?: { requestId?: unknown; dataUrl?: unknown }; error?: unknown };
      if (value.ok !== true || value.data?.requestId !== requestId || typeof value.data.dataUrl !== 'string' || !PNG_DATA_URL.test(value.data.dataUrl)) { resolve(finish(manual('unavailable'))); return; }
      void options.redact(value.data.dataUrl, controller.signal).then(image => {
        if (controller.signal.aborted || options.owner.signal.aborted) { resolve(finish(manual('owner-ended'))); return; }
        if (!image || image.redacted !== true || image.mime !== 'image/png') { resolve(finish(manual('unavailable'))); return; }
        resolve(finish(Object.freeze({ state: 'ready', image })));
      }).catch(() => resolve(finish(manual('unavailable'))));
    };
    disconnectListener = () => { if (!settled) resolve(finish(manual(options.owner.signal.aborted ? 'owner-ended' : 'unavailable'))); };
    timer = setTimeout(() => resolve(finish(manual(options.owner.signal.aborted ? 'owner-ended' : 'timeout'))), options.deadlineMs ?? 10_000);
    options.owner.signal.addEventListener('abort', onOwnerAbort, { once: true });
    port.onMessage.addListener(messageListener); port.onDisconnect.addListener(disconnectListener);
    if (options.owner.signal.aborted) { resolve(finish(manual('owner-ended'))); return; }
    try { port.postMessage({ type: 'capture', requestId, target: options.target }); }
    catch { resolve(finish(manual('unavailable'))); }
  });
  return task;
}
