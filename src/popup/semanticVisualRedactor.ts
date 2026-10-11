import { encodeRedactedImage, type LocalImageEncoder } from '../visual/localImageEncoder';
import type { PixelRedactionResult } from '../visual/localPixelRedaction';
import type { RedactionImage } from '../visual/semanticRedactionPipeline';
import type { SemanticCropPlan, SemanticCropProof } from '../visual/semanticCropAdmission';
import { decodeLocalPng } from '../visual/localPngDecoder';
import { inspectLocalPng } from '../visual/localPngDecoder';
import type { AgentPageOwner } from './agentOwnerClient';
import type { LocalRedactedPngData } from '../content/visualSemanticClient';

const MAX_DATA_URL_LENGTH = 11_184_812;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z\d+/]+={0,2})$/u;

export interface SemanticVisualRedactorDependencies {
  readonly owner: AgentPageOwner;
  readonly fieldId: string;
  readonly decode?: (dataUrl: string, signal: AbortSignal) => Promise<RedactionImage | undefined>;
  readonly admission: {
    issue(token: string, fieldId: string): SemanticCropProof | undefined;
    plan(proof: SemanticCropProof, image: { width: number; height: number }): SemanticCropPlan;
  };
  readonly pipeline: { redact(plan: SemanticCropPlan, image: RedactionImage): PixelRedactionResult };
  readonly encoder: LocalImageEncoder;
}

export type SemanticVisualRedactor = (source: string, signal?: AbortSignal) => Promise<LocalRedactedPngData | undefined>;

const validSource = (value: string): boolean => {
  if (value.length > MAX_DATA_URL_LENGTH) return false;
  const match = PNG_DATA_URL.exec(value);
  const payload = match?.[1];
  if (!payload || payload.length < 24) return false;
  try {
    const bytes = atob(payload);
    return bytes.length >= 16 && bytes.charCodeAt(0) === 137 && bytes.charCodeAt(1) === 80
      && bytes.charCodeAt(2) === 78 && bytes.charCodeAt(3) === 71 && bytes.charCodeAt(4) === 13
      && bytes.charCodeAt(5) === 10 && bytes.charCodeAt(6) === 26 && bytes.charCodeAt(7) === 10;
  } catch { return false; }
};

const base64 = (bytes: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!; const b = i + 1 < bytes.length ? bytes[i + 1]! : 0; const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    output += alphabet[a >>> 2]! + alphabet[((a & 3) << 4) | (b >>> 4)]!;
    output += i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >>> 6)]! : '=';
    output += i + 2 < bytes.length ? alphabet[c & 63]! : '=';
  }
  return output;
};

/**
 * Turns a captured PNG into a model-safe image only after the existing local
 * semantic crop proof has been consumed. The raw capture never leaves this
 * function and the returned bytes are freshly encoded PNG data.
 */
export async function redactCapturedPngWithSemanticProof(
  source: string,
  options: SemanticVisualRedactorDependencies,
  signal: AbortSignal = options.owner.signal,
): Promise<LocalRedactedPngData | undefined> {
  if (!validSource(source) || !options.fieldId || signal.aborted || options.owner.signal.aborted || !options.owner.token) return undefined;
  const proof = options.admission.issue(options.owner.token, options.fieldId);
  if (!proof || signal.aborted || options.owner.signal.aborted) return undefined;
  return redactWithIssuedProof(source, options, signal, proof);
}

async function redactWithIssuedProof(source: string, options: SemanticVisualRedactorDependencies,
  signal: AbortSignal, proof: SemanticCropProof): Promise<LocalRedactedPngData | undefined> {
  if (!validSource(source) || signal.aborted || options.owner.signal.aborted) return undefined;
  let image: RedactionImage | undefined;
  try { image = await (options.decode ?? decodeLocalPng)(source, signal); } catch { return undefined; }
  if (!image || signal.aborted || options.owner.signal.aborted) return undefined;
  const plan = options.admission.plan(proof, { width: image.width, height: image.height });
  if (plan.state !== 'planned' || signal.aborted || options.owner.signal.aborted) return undefined;
  const redacted = options.pipeline.redact(plan, image);
  const encoded = await encodeRedactedImage(redacted, options.encoder, signal);
  if ('state' in encoded || signal.aborted || options.owner.signal.aborted) return undefined;
  const data = `data:image/png;base64,${base64(encoded.bytes)}`;
  const inspected = inspectLocalPng(data);
  if (!inspected || redacted.state !== 'redacted' || inspected.width !== redacted.width || inspected.height !== redacted.height) return undefined;
  return Object.freeze({ mime: 'image/png' as const, redacted: true as const, data });
}

/** Issue BEFORE capture starts. One callback cannot reuse a proof for another image. */
export function createSemanticVisualRedactor(
  options: SemanticVisualRedactorDependencies,
): SemanticVisualRedactor {
  return prepareSemanticVisualRedactor(options) ?? (async () => undefined);
}

export function prepareSemanticVisualRedactor(options: SemanticVisualRedactorDependencies): SemanticVisualRedactor | undefined {
  let used = false;
  const proof = options.owner.signal.aborted ? undefined : options.admission.issue(options.owner.token, options.fieldId);
  if (!proof) return undefined;
  return async (source, signal = options.owner.signal) => {
    if (used) return undefined;
    used = true;
    try { return await redactWithIssuedProof(source, options, signal, proof); }
    catch { return undefined; }
  };
}
