import { parseSemanticProposal, semanticRequestSchema, type SemanticProposal, type SemanticRequest } from './semanticProtocol';
import type { AgentPageLease } from '../agent/pageLease';

export const VISUAL_SEMANTIC_PORT_PATH = '/v1/visual-bindings';
const MAX_IMAGE_BYTES = 8_388_608;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface LocalRedactedPng {
  readonly mime: 'image/png';
  readonly redacted: true;
  readonly bytes: Uint8Array;
}

export type VisualSemanticPortResult =
  | Readonly<{ state: 'ready'; proposal: SemanticProposal }>
  | Readonly<{ state: 'manual'; reason: 'disabled' | 'invalid-input' | 'owner-ended' | 'unavailable' | 'cancelled' | 'invalid-output' }>;
type ManualReason = 'disabled' | 'invalid-input' | 'owner-ended' | 'unavailable' | 'cancelled' | 'invalid-output';

export interface VisualSemanticPortOptions {
  readonly lease: AgentPageLease;
  readonly token: string;
  readonly request: SemanticRequest;
  readonly image: LocalRedactedPng;
  readonly userConfirmed: boolean;
  readonly serviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly serviceOrigin?: string;
}

const manual = (reason: ManualReason): VisualSemanticPortResult => Object.freeze({ state: 'manual', reason });
const isHexToken = (value: string): boolean => /^[a-f\d]{64}$/u.test(value);
const isPng = (bytes: Uint8Array): boolean => PNG_SIGNATURE.every((value, index) => bytes[index] === value);
const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

function parsePortResult(value: unknown, request: SemanticRequest): VisualSemanticPortResult {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2) return manual('invalid-output');
  const result = value as { state?: unknown; proposal?: unknown };
  if (result.state !== 'ready') return result.state === 'cancelled' ? manual('cancelled') : manual('unavailable');
  const proposal = parseSemanticProposal(result.proposal, request);
  return proposal ? Object.freeze({ state: 'ready', proposal }) : manual('invalid-output');
}

/**
 * Sends one already-redacted local image with semantic field meanings. The lease is
 * checked before dispatch, linked to AbortController, and checked again after the
 * response so a late result cannot be applied to a new page owner.
 */
export async function requestVisualSemanticBinding(options: VisualSemanticPortOptions): Promise<VisualSemanticPortResult> {
  if (!options.userConfirmed || !isHexToken(options.serviceToken) || !options.lease.mayWrite(options.token)
    || !semanticRequestSchema.safeParse(options.request).success || options.image.redacted !== true
    || options.image.mime !== 'image/png' || !(options.image.bytes instanceof Uint8Array)
    || options.image.bytes.length < 16 || options.image.bytes.length > MAX_IMAGE_BYTES || !isPng(options.image.bytes)) return manual('invalid-input');
  const controller = new AbortController();
  const removeEnd = options.lease.onEnd(() => controller.abort());
  const origin = options.serviceOrigin ?? 'http://127.0.0.1:43127';
  if (origin !== 'http://127.0.0.1:43127') { removeEnd(); return manual('invalid-input'); }
  const body = JSON.stringify({ request: options.request, image: { mime: 'image/png', redacted: true, data: `data:image/png;base64,${toBase64(options.image.bytes)}` } });
  try {
    if (!options.lease.mayWrite(options.token)) return manual('owner-ended');
    const response = await (options.fetchImpl ?? fetch)(`${origin}${VISUAL_SEMANTIC_PORT_PATH}`, {
      method: 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': options.serviceToken }, body,
    });
    if (controller.signal.aborted || !options.lease.mayWrite(options.token)) return manual('owner-ended');
    if (!response.ok) return manual('unavailable');
    const output = await response.json() as unknown;
    if (controller.signal.aborted || !options.lease.mayWrite(options.token)) return manual('owner-ended');
    return parsePortResult(output, options.request);
  } catch {
    return manual(controller.signal.aborted ? 'owner-ended' : 'unavailable');
  } finally { removeEnd(); }
}
