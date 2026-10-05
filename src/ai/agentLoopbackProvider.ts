import { z } from 'zod';
import { connectionFileSchema } from './connection';
import { agentStepRequestSchema, parseAgentStepProposal, type AgentStepProposal, type AgentStepRequest } from '../agent/nextStepProtocol';
const SERVICE = 'http://127.0.0.1:43127/v1/next-step';
const envelope = z.object({ state: z.enum(['ready', 'disabled', 'refused', 'invalid-output', 'unavailable', 'cancelled', 'timeout', 'busy']), proposal: z.unknown() }).strict();
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || response.redirected) throw new Error('Agent 服务响应无效');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 16_000) { await reader.cancel(); throw new Error('Agent 服务响应过大'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
/** Fixed loopback transport: no supplier key or endpoint can come from a page. */
export function createAgentLoopbackProvider(connection: unknown, fetcher: typeof fetch = fetch) {
  const config = connectionFileSchema.parse(connection);
  return { async propose(value: AgentStepRequest, signal: AbortSignal): Promise<AgentStepProposal> {
    signal.throwIfAborted(); const request = agentStepRequestSchema.parse(value);
    const response = await fetcher(SERVICE, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': config.token }, body: JSON.stringify(request) });
    signal.throwIfAborted(); const result = envelope.parse(await boundedJson(response)); signal.throwIfAborted();
    if (!response.ok || result.state !== 'ready') throw new Error('Agent 服务未返回可用结果');
    const proposal = parseAgentStepProposal(result.proposal, request);
    if (!proposal) throw new Error('Agent 下一步结果未通过核验');
    return proposal;
  } };
}
