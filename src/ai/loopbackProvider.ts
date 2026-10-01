import { z } from 'zod';
import { connectionFileSchema } from './connection';
import { parseSemanticProposal, semanticRequestSchema } from './semanticProtocol';
import type { SemanticProvider } from './semanticCandidates';

const SERVICE = 'http://127.0.0.1:43127';
const healthSchema = z.object({ protocol: z.literal(1), ready: z.boolean() }).strict();
const envelopeSchema = z.object({ state: z.enum(['ready', 'disabled', 'refused', 'invalid-output', 'unavailable', 'cancelled', 'timeout', 'busy']),
  proposal: z.unknown() }).strict();

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || response.redirected) throw new Error('AI 服务响应无效');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 128_000) { await reader.cancel(); throw new Error('AI 服务响应过大'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}

/** The extension cannot choose another endpoint or pass API credentials. */
export function createLoopbackProvider(connection: unknown, fetcher: typeof fetch = fetch): SemanticProvider {
  const config = connectionFileSchema.parse(connection);
  return { async propose(value, signal) {
    const request = semanticRequestSchema.parse(value);
    const response = await fetcher(`${SERVICE}/v1/bindings`, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': config.token }, body: JSON.stringify(request) });
    const envelope = envelopeSchema.parse(await boundedJson(response));
    if (!response.ok || envelope.state !== 'ready') throw new Error('AI 服务未返回可用结果');
    const proposal = parseSemanticProposal(envelope.proposal, request);
    if (!proposal) throw new Error('AI 服务返回的字段绑定无效');
    return proposal;
  } };
}

export async function checkAiConnection(connection: unknown, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<boolean> {
  const config = connectionFileSchema.parse(connection); const controller = new AbortController();
  const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, 5000);
  try {
    const response = await fetcher(`${SERVICE}/v1/health`, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { 'X-Resume-Semantic-Token': config.token } });
    const parsed = healthSchema.safeParse(await boundedJson(response));
    return !controller.signal.aborted && response.ok && parsed.success && parsed.data.ready;
  } catch { return false; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
