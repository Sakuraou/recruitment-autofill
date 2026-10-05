import { expect, it, vi } from 'vitest';
import { createAgentLoopbackProvider } from '../src/ai/agentLoopbackProvider';
import type { AgentStepRequest } from '../src/agent/nextStepProtocol';
const connection = { protocol: 1, token: '1'.repeat(64) };
const request = (): AgentStepRequest => ({ protocol: 1, requestId: crypto.randomUUID(), pending: { fields: 1, records: 0, blockers: 0 },
  tasks: [{ ref: 'task-0', kind: 'fill-visible', count: 1 }], canComplete: false });
const proposal = (r: AgentStepRequest) => ({ requestId: r.requestId, status: 'act', ref: 'task-0', reason: 'available-task' });
it('uses only the fixed authenticated next-step endpoint', async () => {
  const r = request(); const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(JSON.parse(init!.body as string)).toEqual(r); expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
    expect(init?.headers).toMatchObject({ 'X-Resume-Semantic-Token': connection.token });
    return new Response(JSON.stringify({ state: 'ready', proposal: proposal(r) }));
  });
  expect(await createAgentLoopbackProvider(connection, fetcher).propose(r, new AbortController().signal)).toEqual(proposal(r));
  expect(fetcher.mock.calls[0]?.[0]).toBe('http://127.0.0.1:43127/v1/next-step');
});
it.each(['disabled', 'refused', 'timeout', 'busy', 'invalid-output', 'unavailable'])('does not interpret %s as an executable step', async state => {
  const r = request(); const fetcher = vi.fn(async () => new Response(JSON.stringify({ state, proposal: proposal(r) })));
  await expect(createAgentLoopbackProvider(connection, fetcher).propose(r, new AbortController().signal)).rejects.toThrow('未返回可用结果');
});
it('rejects an unoffered action even if a compromised service says ready', async () => {
  const r = request(); const fetcher = vi.fn(async () => new Response(JSON.stringify({ state: 'ready', proposal: { ...proposal(r), ref: 'task-9' } })));
  await expect(createAgentLoopbackProvider(connection, fetcher).propose(r, new AbortController().signal)).rejects.toThrow('未通过核验');
});
it('rejects unsafe connection fields before any HTTP', () => {
  const fetcher = vi.fn(); expect(() => createAgentLoopbackProvider({ ...connection, endpoint: 'https://other.test' }, fetcher)).toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('cannot send extra private data through the action protocol', async () => {
  const fetcher = vi.fn(); await expect(createAgentLoopbackProvider(connection, fetcher).propose({ ...request(), profile: {} } as AgentStepRequest, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not accept a late response after Stop', async () => {
  const r = request(); const stop = new AbortController(); const fetcher = vi.fn(async () => { stop.abort(); return new Response(JSON.stringify({ state: 'ready', proposal: proposal(r) })); });
  await expect(createAgentLoopbackProvider(connection, fetcher).propose(r, stop.signal)).rejects.toThrow();
});
it('cancels oversized response bodies before decoding', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ state: 'ready', proposal: 'x'.repeat(16000) })));
  await expect(createAgentLoopbackProvider(connection, fetcher).propose(request(), new AbortController().signal)).rejects.toThrow('过大');
});
