import { parseSemanticProposal, semanticRequestSchema, type SemanticProposal, type SemanticRequest } from '../ai/semanticProtocol';
import type { AgentPageOwner } from './agentOwnerClient';
import { VISUAL_SEMANTIC_MESSAGE } from '../content/visualSemanticMessage';
import type { LocalRedactedPngData } from '../content/visualSemanticClient';

const MAX_DATA_URL_LENGTH = 11_184_812;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z\d+/]+={0,2})$/u;

export type PopupVisualResult =
  | Readonly<{ state: 'ready'; proposal: SemanticProposal }>
  | Readonly<{ state: 'manual'; reason: 'disabled' | 'invalid-input' | 'owner-ended' | 'unavailable' | 'cancelled' | 'invalid-output' }>;
type ManualReason = Exclude<PopupVisualResult, { state: 'ready' }>['reason'];

export interface PopupVisualOptions {
  readonly tabId: number;
  readonly owner: AgentPageOwner;
  readonly request: SemanticRequest;
  readonly image: LocalRedactedPngData;
  readonly userConfirmed: boolean;
  readonly sendMessage?: (tabId: number, message: unknown) => Promise<unknown>;
  readonly deadlineMs?: number;
}

const manual = (reason: Exclude<PopupVisualResult, { state: 'ready' }>['reason']): PopupVisualResult => Object.freeze({ state: 'manual', reason });
const MANUAL_REASONS = new Set<ManualReason>(['disabled', 'invalid-input', 'owner-ended', 'unavailable', 'cancelled', 'invalid-output']);

function validImage(image: LocalRedactedPngData): boolean {
  if (image.mime !== 'image/png' || image.redacted !== true || typeof image.data !== 'string' || image.data.length > MAX_DATA_URL_LENGTH) return false;
  const match = PNG_DATA_URL.exec(image.data);
  if (!match || match[1]!.length < 24) return false;
  try { const bytes = atob(match[1]!); return bytes.length >= 16 && bytes.startsWith(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10)); }
  catch { return false; }
}

function parseResponse(value: unknown, request: SemanticRequest): PopupVisualResult {
  if (!value || typeof value !== 'object') return manual('invalid-output');
  const response = value as { ok?: unknown; data?: unknown };
  if (response.ok !== true || !response.data || typeof response.data !== 'object') return manual('unavailable');
  const data = response.data as { state?: unknown; reason?: unknown; proposal?: unknown };
  if (data.state === 'manual' && typeof data.reason === 'string' && MANUAL_REASONS.has(data.reason as ManualReason)) return manual(data.reason as ManualReason);
  if (data.state !== 'ready') return manual('invalid-output');
  const proposal = parseSemanticProposal(data.proposal, request);
  return proposal ? Object.freeze({ state: 'ready', proposal }) : manual('invalid-output');
}

/** Popup-side one-shot bridge. It supplies an owner token to content and never receives selectors or profile values. */
export async function requestVisualSemanticFromPopup(options: PopupVisualOptions): Promise<PopupVisualResult> {
  if (!options.userConfirmed || !Number.isSafeInteger(options.tabId) || options.tabId <= 0 || options.owner.signal.aborted
    || !semanticRequestSchema.safeParse(options.request).success || !validImage(options.image)) return manual('invalid-input');
  const send = options.sendMessage ?? (async (tabId, message) => chrome.tabs.sendMessage(tabId, message));
  const message = { type: VISUAL_SEMANTIC_MESSAGE, token: options.owner.token, userConfirmed: true as const, request: options.request, image: options.image };
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: PopupVisualResult) => {
      if (settled) return; settled = true; clearTimeout(timer);
      options.owner.signal.removeEventListener('abort', abort); resolve(result);
    };
    const abort = () => finish(manual('owner-ended'));
    const timer = setTimeout(() => { finish(manual('unavailable')); options.owner.close(); }, options.deadlineMs ?? 15_000);
    options.owner.signal.addEventListener('abort', abort, { once: true });
    if (options.owner.signal.aborted) { abort(); return; }
    void Promise.resolve().then(() => {
      if (settled || options.owner.signal.aborted) return undefined;
      return send(options.tabId, message);
    }).then(response => {
      if (settled) return;
      finish(options.owner.signal.aborted ? manual('owner-ended') : parseResponse(response, options.request));
    }).catch(() => finish(manual(options.owner.signal.aborted ? 'owner-ended' : 'unavailable')));
  });
}
