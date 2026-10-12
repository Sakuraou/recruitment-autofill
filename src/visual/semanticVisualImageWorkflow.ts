import { prepareSemanticVisualRedactor } from '../popup/semanticVisualRedactor';
import type { LocalRedactedPngData } from '../content/visualSemanticClient';
import type { AgentPageLease } from '../agent/pageLease';
import { verifyScanObservation } from '../content/scanFreshness';
import type { ScanState } from '../content/scanner';
import type { SemanticCropAdmission } from './semanticCropAdmission';
import type { SemanticRedactionPipeline } from './semanticRedactionPipeline';
import type { LocalImageEncoder } from './localImageEncoder';
import type { VisualManualReason } from '../shared/visualReason';

export interface SemanticVisualImageOptions {
  lease: AgentPageLease; token: string; fieldId: string;
  getScan(): ScanState | undefined;
  admission: SemanticCropAdmission;
  pipeline: SemanticRedactionPipeline;
  encoder: LocalImageEncoder;
  enabled: boolean;
  userConfirmed: boolean;
  capture(signal: AbortSignal): Promise<string | undefined>;
  signal: AbortSignal;
  timeoutMs?: number;
}
export type SemanticVisualImageResult = { state: 'ready'; image: LocalRedactedPngData }
  | { state: 'manual'; reason: VisualManualReason };

function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('owner-ended'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error('owner-ended');
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Content-local pixels only. No profile, model request, candidate answer or DOM writes. Caller must bind trusted label permission before invoking. */
export async function runSemanticVisualImage(options: SemanticVisualImageOptions): Promise<SemanticVisualImageResult> {
  const manual = (reason: Exclude<SemanticVisualImageResult, { state: 'ready' }>['reason']): SemanticVisualImageResult => ({ state: 'manual', reason });
  if (options.signal.aborted || !options.enabled || !options.userConfirmed) return manual('disabled');
  const scan = options.getScan();
  if (!scan || !options.lease.mayWrite(options.token) || !verifyScanObservation(scan)) return manual('stale-page');
  const controller = new AbortController();
  const removeEnd = options.lease.onEnd(() => controller.abort());
  const cancel = () => controller.abort(); options.signal.addEventListener('abort', cancel, { once: true });
  let dirty = false;
  const invalidate = () => { dirty = true; controller.abort(); };
  const observer = new MutationObserver(invalidate);
  observer.observe(scan.document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
  scan.document.addEventListener('input', invalidate, true);
  scan.document.addEventListener('change', invalidate, true);
  const current = () => !controller.signal.aborted && !dirty && !observer.takeRecords().length
    && options.lease.mayWrite(options.token) && options.getScan() === scan
    && !options.signal.aborted && !!verifyScanObservation(scan);
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  let succeeded = false;
  try {
    if(!current())return manual('stale-page');
    const admission=options.admission.inspect(options.token,options.fieldId);
    if(admission!=='eligible')return manual(admission);
    const redact = prepareSemanticVisualRedactor({ owner: { token: options.token, signal: controller.signal,
      close: () => options.lease.end(options.token) }, fieldId: options.fieldId,
      admission: options.admission, pipeline: options.pipeline, encoder: options.encoder });
    if (!redact || !current()) return manual('unavailable');
    // A proof issued here observes all changes while capture/decode are pending.
    const source = await abortable(() => options.capture(controller.signal), controller.signal);
    if (!source || !current()) return manual('stale-page');
    const image = await abortable(() => redact(source, controller.signal), controller.signal);
    if (!image || !current()) return manual('unavailable');
    succeeded = true;
    // Freshly encoded label pixels only; full screenshot stays local.
    return { state: 'ready', image };
  } catch { return manual('unavailable'); }
  finally {
    clearTimeout(timer); observer.disconnect(); removeEnd(); options.signal.removeEventListener('abort', cancel);
    scan.document.removeEventListener('input', invalidate, true); scan.document.removeEventListener('change', invalidate, true);
    if (!succeeded) options.admission.stop(options.token);
    controller.abort();
  }
}
