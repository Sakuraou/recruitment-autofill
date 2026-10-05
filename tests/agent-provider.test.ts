import { expect, it, vi } from 'vitest';
import { createAgentProvider } from '../src/companion/agentProvider';
import type { AgentStepRequest } from '../src/agent/nextStepProtocol';
const r = (): AgentStepRequest => ({ protocol: 1, requestId: crypto.randomUUID(), pending: { fields: 0, records: 2, blockers: 1 },
  tasks: [{ ref: 'task-0', kind: 'education-records', count: 2 }], canComplete: false });
const reply = (request: AgentStepRequest) => ({ requestId: request.requestId, status: 'act', ref: 'task-0', reason: 'available-task' });
const envelope = (content: unknown) => ({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }] });
const config = { baseUrl: 'http://127.0.0.1:5000/v1', apiKey: 'fictional-key', model: 'fictional-model' };
function withOutput(value: unknown) { const fetcher = vi.fn(async () => new Response(JSON.stringify(value))); return { fetcher, provider: createAgentProvider({ ...config, fetcher })! }; }
it('uses configured compatible HTTP with counts and canonical task types only', async () => {
  const request = r(); const { provider, fetcher } = withOutput(envelope(reply(request)));
  expect((await provider(request, new AbortController().signal)).state).toBe('ready');
  const [url, options] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
  expect(url).toBe('http://127.0.0.1:5000/v1/chat/completions'); expect(options.redirect).toBe('error');
  expect(options.headers).toMatchObject({ Authorization: 'Bearer fictional-key' });
  const body = JSON.parse(options.body as string); expect(body.response_format).toEqual({ type: 'json_object' });
  expect(body.tools).toBeUndefined(); expect(body.max_tokens).toBe(1000); expect(JSON.parse(body.messages[1].content)).toEqual(request);
  expect(JSON.stringify(body)).not.toContain('fictional-key');
});
it('uses strict schema only when explicitly configured', async () => {
  const request = r(); const fetcher = vi.fn(async () => new Response(JSON.stringify(envelope(reply(request)))));
  await createAgentProvider({ ...config, fetcher, outputFormat: 'json_schema', enableThinking: false })!(request, new AbortController().signal);
  const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.response_format.type).toBe('json_schema'); expect(body.response_format.json_schema.name).toBe('resume_next_step'); expect(body.enable_thinking).toBe(false);
});
it.each(['length', 'tool_calls', null])('rejects unfinished choice %s', finish_reason => {
  const request = r(); const output = envelope(reply(request)); const changed = { choices: [{ ...output.choices[0], finish_reason }] };
  return withOutput(changed).provider(request, new AbortController().signal).then(result => expect(result.state).toBe('invalid-output'));
});
it.each([{ tool_calls: [{ id: 'fake' }] }, { tool_calls: {} }, { function_call: { name: 'click' } }])('rejects remote executable tool instructions %j', injected => {
  const request = r(); const output = envelope(reply(request)); const changed = { choices: [{ ...output.choices[0], message: { ...output.choices[0]!.message, ...injected } }] };
  return withOutput(changed).provider(request, new AbortController().signal).then(result => expect(result.state).toBe('invalid-output'));
});
it.each([{ status: 'complete', ref: null, reason: 'no-pending-work' }, { ref: 'task-9' }, { selector: '#add' }, { value: 'invented answer' }])('rejects invalid next action %j', changed => {
  const request = r(); return withOutput(envelope({ ...reply(request), ...changed })).provider(request, new AbortController().signal)
    .then(result => expect(result.state).toBe('invalid-output'));
});
it('rejects a response from a previous page observation', async () => {
  const { provider } = withOutput(envelope(reply(r()))); expect((await provider(r(), new AbortController().signal)).state).toBe('invalid-output');
});
it('rejects an oversized body without logging it', async () => {
  const { provider } = withOutput({ padding: 'private'.repeat(6000) }); const result = await provider(r(), new AbortController().signal);
  expect(result).toEqual({ state: 'invalid-output', proposal: null });
});
it('returns unavailable without supplier error content', async () => {
  const fetcher = vi.fn(async () => new Response('secret customer billing error', { status: 401 }));
  expect(await createAgentProvider({ ...config, fetcher })!(r(), new AbortController().signal)).toEqual({ state: 'unavailable', proposal: null });
});
it('does not transmit a malformed or private request', async () => {
  const { provider, fetcher } = withOutput({}); expect((await provider({ ...r(), private: 'identity' } as AgentStepRequest, new AbortController().signal)).state).toBe('invalid-output');
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not call an API after Stop', async () => { const { provider, fetcher } = withOutput({}); const stop = new AbortController(); stop.abort();
  expect((await provider(r(), stop.signal)).state).toBe('cancelled'); expect(fetcher).not.toHaveBeenCalled();
});
it('cannot redirect credentials to a second host', async () => {
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => { expect(init?.redirect).toBe('error'); throw new Error('redirect'); });
  expect((await createAgentProvider({ ...config, fetcher })!(r(), new AbortController().signal)).state).toBe('unavailable'); expect(fetcher).toHaveBeenCalledTimes(1);
});
