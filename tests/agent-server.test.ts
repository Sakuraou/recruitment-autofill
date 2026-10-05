// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { createSemanticServer } from '../src/companion/server';
import { createAgentProvider, type AgentProvider } from '../src/companion/agentProvider';
import type { AgentStepRequest } from '../src/agent/nextStepProtocol';
const token = '1'.repeat(64); const origin = `chrome-extension://${'a'.repeat(32)}`;
const request = (): AgentStepRequest => ({ protocol: 1, requestId: crypto.randomUUID(), pending: { fields: 1, records: 0, blockers: 0 },
  tasks: [{ ref: 'task-0', kind: 'fill-visible', count: 1 }], canComplete: false });
const proposal = (r: AgentStepRequest) => ({ requestId: r.requestId, status: 'act' as const, ref: 'task-0', reason: 'available-task' as const });
const ready: AgentProvider = async r => ({ state: 'ready', proposal: proposal(r) });
const servers: Server[] = [];
async function listen(server: Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address'); return `http://127.0.0.1:${address.port}`; }
async function start(agentProvider?: AgentProvider) {
  const url = await listen(createSemanticServer({ token, agentProvider, deadlineMs: 100 }));
  return { url, call: (body: unknown = request(), headers: Record<string, string> = {}) => fetch(url + '/v1/next-step', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': token, ...headers }, body: JSON.stringify(body) }) };
}
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
}))); });
it('serves only the next-step protocol on its dedicated authenticated route', async () => {
  const { call } = await start(ready); const r = request(); const response = await call(r);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: 'ready', proposal: proposal(r) });
});
it.each(['https://recruitment.example', '', 'null'])('refuses website origin %s before calling the model', async Origin => {
  const provider = vi.fn(ready); const { call } = await start(provider); expect((await call(request(), { Origin })).status).toBe(403); expect(provider).not.toHaveBeenCalled();
});
it('rejects a wrong pairing token', async () => {
  const provider = vi.fn(ready); const { call } = await start(provider); expect((await call(request(), { 'X-Resume-Semantic-Token': '2'.repeat(64) })).status).toBe(401); expect(provider).not.toHaveBeenCalled();
});
it.each([{ private: 'personal data' }, { tasks: [{ ref: 'task-0', kind: 'submit', count: 1 }] }, { canComplete: true }])('rejects unissued request authority %j', extra => {
  return start(vi.fn(ready)).then(async ({ call }) => { expect((await call({ ...request(), ...extra })).status).toBe(400); });
});
it('rejects the field-binding protocol on the action route', async () => {
  const { call } = await start(ready); expect((await call({ protocol: 1, requestId: crypto.randomUUID(), fields: [], allowedPaths: [] })).status).toBe(400);
});
it('does not reinterpret an action request as field binding', async () => {
  const { url } = await start(ready); const response = await fetch(url + '/v1/bindings', { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': token }, body: JSON.stringify(request()) });
  expect(response.status).toBe(400);
});
it('returns disabled when only a semantic provider is configured', async () => {
  const { call } = await start(); const response = await call(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ state: 'disabled', proposal: null });
});
it('revalidates provider output against current capabilities', async () => {
  const { call } = await start(async r => ({ state: 'ready', proposal: { ...proposal(r), ref: 'task-9' } }));
  const response = await call(); expect(response.status).toBe(503); expect(await response.json()).toEqual({ state: 'invalid-output', proposal: null });
});
it('never reports model completion if a required field remains', async () => {
  const { call } = await start(async r => ({ state: 'ready', proposal: { requestId: r.requestId, status: 'complete', ref: null, reason: 'no-pending-work' } }));
  expect(await (await call()).json()).toEqual({ state: 'invalid-output', proposal: null });
});
it('enforces the shared model deadline and cancels the provider', async () => {
  let aborted = false;
  const { call } = await start(async (_r, signal) => new Promise(resolve => { signal.addEventListener('abort', () => { aborted = true; resolve({ state: 'cancelled', proposal: null }); }); }));
  expect(await (await call()).json()).toEqual({ state: 'timeout', proposal: null }); expect(aborted).toBe(true);
});
it('bounds both endpoints to one active model operation', async () => {
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const { call } = await start(async (_r, signal) => new Promise(resolve => { entered(); signal.addEventListener('abort', () => resolve({ state: 'cancelled', proposal: null })); }));
  const held = call(); await started; const second = await call(); expect(second.status).toBe(429); expect(await second.json()).toEqual({ state: 'busy', proposal: null }); await held;
});
it('allows only the fixed preflight headers', async () => {
  const { url } = await start(ready);
  const response = await fetch(url + '/v1/next-step', { method: 'OPTIONS', headers: { Origin: origin,
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-resume-semantic-token' } });
  expect(response.status).toBe(204); expect(response.headers.get('access-control-allow-origin')).toBe(origin);
});
it('connects the companion to an actual compatible HTTP upstream with fictional credentials', async () => {
  const sent: unknown[] = [];
  const upstream = createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); sent.push(body);
    const r = JSON.parse(body.messages[1].content) as AgentStepRequest;
    if (req.url !== '/v1/chat/completions' || req.headers.authorization !== 'Bearer fictional-agent-key') { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(proposal(r)) } }] }));
  }); });
  const apiUrl = await listen(upstream); const provider = createAgentProvider({ baseUrl: apiUrl + '/v1', model: 'fictional-agent-model', apiKey: 'fictional-agent-key' })!;
  const { call } = await start(provider); const r = request(); expect(await (await call(r)).json()).toEqual({ state: 'ready', proposal: proposal(r) });
  expect(sent).toHaveLength(1); expect(JSON.stringify(sent)).not.toContain('fictional-agent-key');
});
