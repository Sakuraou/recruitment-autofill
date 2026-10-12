import { parseSemanticProposal, semanticRequestSchema, type SemanticProposal, type SemanticRequest } from '../ai/semanticProtocol';
import { AgentPageLease } from '../agent/pageLease';
import { VISUAL_SEMANTIC_PORT } from '../background/visualSemanticPort';

const MAX_DATA_URL_LENGTH = 11_184_812;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z\d+/]+={0,2})$/u;

export interface LocalRedactedPngData {
  readonly mime: 'image/png';
  readonly redacted: true;
  readonly data: string;
}

export interface VisualContentPort {
  readonly onMessage: { addListener(listener: (message: unknown) => void): void; removeListener?(listener: (message: unknown) => void): void };
  readonly onDisconnect: { addListener(listener: () => void): void; removeListener?(listener: () => void): void };
  postMessage(message: unknown): void;
  disconnect(): void;
}

export type VisualContentResult =
  | Readonly<{ state: 'ready'; proposal: SemanticProposal }>
  | Readonly<{ state: 'manual'; reason: 'disabled' | 'invalid-input' | 'owner-ended' | 'unavailable' | 'cancelled' | 'invalid-output' }>;

export interface VisualContentOptions {
  readonly lease: AgentPageLease;
  readonly token: string;
  readonly request: SemanticRequest;
  readonly image: LocalRedactedPngData;
  readonly userConfirmed: boolean;
  readonly connect?: (name: string) => VisualContentPort;
  readonly deadlineMs?: number;
}

const manual = (reason: Exclude<VisualContentResult, { state: 'ready' }>['reason']): VisualContentResult => Object.freeze({ state: 'manual', reason });

function validImage(image: LocalRedactedPngData): boolean {
  if (image.mime !== 'image/png' || image.redacted !== true || typeof image.data !== 'string' || image.data.length > MAX_DATA_URL_LENGTH) return false;
  const match = PNG_DATA_URL.exec(image.data);
  if (!match || match[1]!.length < 24) return false;
  try {
    const bytes = atob(match[1]!);
    return bytes.length >= 16 && bytes.charCodeAt(0) === 137 && bytes.charCodeAt(1) === 80 && bytes.charCodeAt(2) === 78
      && bytes.charCodeAt(3) === 71 && bytes.charCodeAt(4) === 13 && bytes.charCodeAt(5) === 10 && bytes.charCodeAt(6) === 26 && bytes.charCodeAt(7) === 10;
  } catch { return false; }
}

function parseResult(value: unknown, request: SemanticRequest): VisualContentResult {
  if (!value || typeof value !== 'object') return manual('invalid-output');
  const result = value as { state?: unknown; proposal?: unknown };
  if (result.state !== 'ready') {
    if (result.state === 'disabled') return manual('disabled');
    if (result.state === 'cancelled') return manual('cancelled');
    if (result.state === 'rejected') return manual('invalid-output');
    return manual('unavailable');
  }
  const proposal = parseSemanticProposal(result.proposal, request);
  return proposal ? Object.freeze({ state: 'ready', proposal }) : manual('invalid-output');
}

/**
 * Content-side bridge for one already-redacted local PNG. It owns no DOM
 * selectors and never applies a model proposal; the caller must re-check the
 * lease before handing the proposal to a local executor.
 */
export async function requestVisualSemanticFromContent(options: VisualContentOptions): Promise<VisualContentResult> {
  if (!options.userConfirmed || !options.lease.mayWrite(options.token)
    || !semanticRequestSchema.safeParse(options.request).success || !validImage(options.image)) return manual('invalid-input');

  let port: VisualContentPort;
  try { port = (options.connect ?? (name => chrome.runtime.connect({ name })))(VISUAL_SEMANTIC_PORT); }
  catch { return manual('unavailable'); }

  const controller = new AbortController();
  const removeEnd = options.lease.onEnd(() => controller.abort());
  const deadline = options.deadlineMs ?? 15_000;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onMessage: (message: unknown) => void = () => undefined;
  let onDisconnect: () => void = () => undefined;
  const finish = (value: VisualContentResult): VisualContentResult => {
    if (settled) return value;
    settled = true; if (timer !== undefined) clearTimeout(timer); removeEnd();
    port.onMessage.removeListener?.(onMessage); port.onDisconnect.removeListener?.(onDisconnect);
    try { port.disconnect(); } catch { /* the background port may already be gone */ }
    return value;
  };
  const task = new Promise<VisualContentResult>(resolve => {
    onMessage = (message: unknown) => {
      if (settled) return;
      if (controller.signal.aborted || !options.lease.mayWrite(options.token)) { resolve(finish(manual('owner-ended'))); return; }
      resolve(finish(parseResult(message, options.request)));
    };
    onDisconnect = () => { if (!settled) resolve(finish(manual(controller.signal.aborted ? 'owner-ended' : 'unavailable'))); };
    timer = setTimeout(() => resolve(finish(manual(controller.signal.aborted ? 'owner-ended' : 'unavailable'))), deadline);
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
    controller.signal.addEventListener('abort', () => resolve(finish(manual('owner-ended'))), { once: true });
    if (controller.signal.aborted || !options.lease.mayWrite(options.token)) { resolve(finish(manual('owner-ended'))); return; }
    try { port.postMessage({ type: 'infer', request: options.request, image: options.image }); }
    catch { resolve(finish(manual('unavailable'))); }
  });
  return task;
}
