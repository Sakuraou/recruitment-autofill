// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  SEMANTIC_BINDING_PATHS, EDUCATION_SEMANTIC_BINDING_PATHS, INTERNSHIP_SEMANTIC_BINDING_PATHS,
  semanticRequestSchema, type SemanticRequest,
} from '../src/ai/semanticProtocol';
import { chatCompletionsEndpoint, createChatCompletionsProvider } from '../src/companion/chatCompletionsProvider';
import { resolveCompanionModel } from '../src/companion/modelConfig';
import { createSemanticServer } from '../src/companion/server';

const fixtureKey = 'fictional-api-key';
const request = (protocol: 1 | 2 | 3 = 1): SemanticRequest => semanticRequestSchema.parse({
  protocol, requestId: '11111111-1111-4111-8111-111111111111',
  allowedPaths: protocol === 3 ? [...INTERNSHIP_SEMANTIC_BINDING_PATHS]
    : protocol === 2 ? [...EDUCATION_SEMANTIC_BINDING_PATHS] : [...SEMANTIC_BINDING_PATHS],
  fields: [{ ref: 'field-0', fingerprint: '0123456789abcdef', kind: 'input', type: 'text',
    section: protocol === 3 ? 'internship' : protocol === 2 ? 'education' : 'basic',
    record: protocol === 1 ? 'none' : 'creating', label: '这一栏的含义',
    ariaLabel: '', tableHeader: '', title: '', placeholder: '', options: [] }],
});
const proposal = (protocol: 1 | 2 | 3 = 1) => ({ requestId: request(protocol).requestId, status: 'mapped', bindings: [
  { ref: 'field-0', fingerprint: '0123456789abcdef', path: protocol === 3 ? 'internships.organization'
    : protocol === 2 ? 'education.school' : 'basic.name', certainty: 'certain', evidence: 'label' },
] });
const completion = (protocol: 1 | 2 | 3 = 1) => ({ choices: [{ index: 0, finish_reason: 'stop',
  message: { role: 'assistant', content: JSON.stringify(proposal(protocol)) } }] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const config = { apiKey: fixtureKey, model: 'fictional/model-v1', baseUrl: 'https://fictional-api.example.test/v1' };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(done => {
  server.close(() => done()); server.closeAllConnections();
}))); });

it.each([
  ['https://api.deepseek.com', 'https://api.deepseek.com/chat/completions'],
  ['https://api.deepseek.com/v1/', 'https://api.deepseek.com/v1/chat/completions'],
  ['https://workspace.example.test/compatible-mode/v1', 'https://workspace.example.test/compatible-mode/v1/chat/completions'],
  ['https://api.example.test/v1/chat/completions', 'https://api.example.test/v1/chat/completions'],
  ['http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234/v1/chat/completions'],
] as const)('operators configure %s without double-appending an endpoint', (baseUrl, expected) => {
  expect(chatCompletionsEndpoint(baseUrl)).toBe(expected);
});
it.each(['http://remote.example.test/v1', 'ftp://example.test/v1', 'https://user:secret@example.test/v1',
  'https://example.test/v1?token=secret', 'https://example.test/v1#secret', 'not a URL', ''])('rejects invalid operator URL %s', base => {
  expect(chatCompletionsEndpoint(base)).toBeUndefined();
});
it.each([1, 2, 3] as const)('protocol %s uses compatible chat JSON and the original independent path catalogue', async protocol => {
  const fetcher = vi.fn().mockResolvedValue(response(completion(protocol)));
  const result = await createChatCompletionsProvider({ ...config, fetcher })!(request(protocol), new AbortController().signal);
  expect(result).toEqual({ state: 'ready', proposal: proposal(protocol) });
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe(config.baseUrl + '/chat/completions'); expect(options.redirect).toBe('error');
  expect(options.credentials).toBe('omit'); expect(options.headers.Authorization).toBe('Bearer ' + fixtureKey);
  const body = JSON.parse(options.body);
  expect(body.model).toBe(config.model); expect(body.stream).toBe(false); expect(body.response_format).toEqual({ type: 'json_object' });
  expect(body.messages[0].content).toContain('untrusted'); expect(body.messages[0].content).toContain('JSON');
  expect(JSON.parse(body.messages[1].content)).toEqual(request(protocol));
  expect(body.tools).toBeUndefined(); expect(JSON.stringify(body)).not.toContain(fixtureKey);
});
it('optional strict schema and thinking mode are explicitly configured, not guessed from the model name', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(completion(3)));
  await createChatCompletionsProvider({ ...config, outputFormat: 'json_schema', enableThinking: false, fetcher })!(request(3), new AbortController().signal);
  const body = JSON.parse(fetcher.mock.calls[0]![1].body);
  expect(body.enable_thinking).toBe(false); expect(body.response_format.type).toBe('json_schema');
  expect(body.response_format.json_schema.strict).toBe(true);
  expect(body.response_format.json_schema.schema.properties.bindings.items.properties.path.enum).toEqual([...INTERNSHIP_SEMANTIC_BINDING_PATHS]);
});
it.each(['length', 'tool_calls', 'null'])('unfinished response %s produces no binding', async reason => {
  const body = completion(); body.choices[0]!.finish_reason = reason;
  const fetcher = vi.fn().mockResolvedValue(response(body));
  expect(await createChatCompletionsProvider({ ...config, fetcher })!(request(), new AbortController().signal))
    .toEqual({ state: 'invalid-output', proposal: null });
});
it.each(['empty', 'markdown', 'multiple', 'extra-answer', 'wrong-owner', 'wrong-ref', 'tool', 'tool-object', 'oversized'])('rejects %s output without partial acceptance', async mode => {
  const body = completion();
  if (mode === 'empty') body.choices[0]!.message.content = '';
  if (mode === 'markdown') body.choices[0]!.message.content = '```json\n' + JSON.stringify(proposal()) + '\n```';
  if (mode === 'multiple') body.choices.push(body.choices[0]!);
  if (mode === 'extra-answer') body.choices[0]!.message.content = JSON.stringify({ ...proposal(), value: 'fabricated answer' });
  if (mode === 'wrong-owner') { const p = proposal(); p.bindings[0]!.path = 'projects.name'; body.choices[0]!.message.content = JSON.stringify(p); }
  if (mode === 'wrong-ref') { const p = proposal(); p.bindings[0]!.ref = 'field-99'; body.choices[0]!.message.content = JSON.stringify(p); }
  if (mode === 'tool') Object.assign(body.choices[0]!.message, { tool_calls: [{ function: { name: 'click' } }] });
  if (mode === 'tool-object') Object.assign(body.choices[0]!.message, { tool_calls: { function: { name: 'click' } } });
  if (mode === 'oversized') body.choices[0]!.message.content = 'x'.repeat(300_000);
  const fetcher = vi.fn().mockResolvedValue(response(body));
  expect(await createChatCompletionsProvider({ ...config, fetcher })!(request(), new AbortController().signal))
    .toEqual({ state: 'invalid-output', proposal: null });
});
it('refusal and content filtering are finite states without relaying vendor prose', async () => {
  for (const mode of ['refusal', 'filter']) {
    const body = completion(); if (mode === 'refusal') Object.assign(body.choices[0]!.message, { refusal: 'private vendor message' });
    else body.choices[0]!.finish_reason = 'content_filter';
    const fetcher = vi.fn().mockResolvedValue(response(body));
    expect(await createChatCompletionsProvider({ ...config, fetcher })!(request(), new AbortController().signal))
      .toEqual({ state: 'refused', proposal: null });
  }
});
it('HTTP, redirects, network failure and cancellation never retry or leak upstream errors', async () => {
  for (const mode of ['http', 'redirect', 'network', 'cancel']) {
    const cancel = new AbortController(); if (mode === 'cancel') cancel.abort();
    const fetcher = mode === 'network' ? vi.fn().mockRejectedValue(new Error(fixtureKey))
      : vi.fn().mockResolvedValue(response({ secret: fixtureKey }, mode === 'redirect' ? 302 : 401));
    expect(await createChatCompletionsProvider({ ...config, fetcher })!(request(), cancel.signal))
      .toEqual({ state: mode === 'cancel' ? 'cancelled' : 'unavailable', proposal: null });
    expect(fetcher).toHaveBeenCalledTimes(mode === 'cancel' ? 0 : 1);
  }
});
it('local config selects a compatible provider, with credentials outside model messages', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(completion()));
  const model = resolveCompanionModel({ RA_MODEL_API_KEY: fixtureKey }, { provider: 'openai-compatible',
    baseUrl: config.baseUrl, model: config.model, apiKeyEnv: 'RA_MODEL_API_KEY' }, fetcher);
  expect(model.kind).toBe('openai-compatible'); expect(await model.provider!(request(), new AbortController().signal)).toMatchObject({ state: 'ready' });
  expect(JSON.stringify(JSON.parse(fetcher.mock.calls[0]![1].body))).not.toContain(fixtureKey);
});
it('environment compatible settings preserve endpoint, JSON format and explicit non-thinking mode', () => {
  const model = resolveCompanionModel({ RA_MODEL_PROVIDER: 'openai-compatible', RA_MODEL_BASE_URL: config.baseUrl,
    RA_MODEL_NAME: config.model, RA_MODEL_API_KEY: fixtureKey, RA_MODEL_ENABLE_THINKING: 'false' });
  expect(model.kind).toBe('openai-compatible'); expect(model.provider).toBeTypeOf('function');
});
it.each(['missing-key', 'both-keys', 'wrong-provider', 'extra', 'invalid-url', 'template'])('invalid local %s config cannot silently fall back to another credential', mode => {
  const value = { provider: 'openai-compatible', baseUrl: config.baseUrl, model: config.model, apiKey: fixtureKey };
  if (mode === 'missing-key') value.apiKey = '';
  if (mode === 'both-keys') Object.assign(value, { apiKeyEnv: 'RA_MODEL_API_KEY' });
  if (mode === 'wrong-provider') value.provider = 'other';
  if (mode === 'extra') Object.assign(value, { profile: 'unexpected' });
  if (mode === 'invalid-url') value.baseUrl = 'http://other.example.test';
  if (mode === 'template') value.model = 'YOUR_MODEL_NAME';
  expect(() => resolveCompanionModel({ OPENAI_API_KEY: fixtureKey, RA_OPENAI_MODEL: 'fictional' }, value)).toThrow();
});
it('default disabled and previous Responses environment configuration keep their original behavior', () => {
  expect(resolveCompanionModel({})).toMatchObject({ kind: 'none', provider: undefined });
  expect(resolveCompanionModel({ OPENAI_API_KEY: fixtureKey, RA_OPENAI_MODEL: 'fictional' })).toMatchObject({ kind: 'openai-responses' });
});
it('authenticated companion uses a real compatible HTTP upstream, not a fake provider bypass', async () => {
  const calls: { url?: string; auth?: string; body: unknown }[] = [];
  const upstream = createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(completion())); }); });
  servers.push(upstream); await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done));
  const address = upstream.address(); if (!address || typeof address === 'string') throw new Error('fixture port');
  const provider = createChatCompletionsProvider({ ...config, baseUrl: 'http://127.0.0.1:' + address.port + '/v1' });
  const token = '1'.repeat(64), origin = 'chrome-extension://' + 'a'.repeat(32);
  const service = createSemanticServer({ token, provider }); servers.push(service);
  await new Promise<void>(done => service.listen(0, '127.0.0.1', done)); const endpoint = service.address();
  if (!endpoint || typeof endpoint === 'string') throw new Error('fixture service');
  const result = await fetch('http://127.0.0.1:' + endpoint.port + '/v1/bindings', {
    method: 'POST', headers: { Origin: origin, 'X-Resume-Semantic-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(request()),
  });
  expect(result.status).toBe(200); expect(await result.json()).toEqual({ state: 'ready', proposal: proposal() });
  expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ url: '/v1/chat/completions', auth: 'Bearer ' + fixtureKey });
  expect(JSON.stringify(calls[0]!.body)).not.toContain(fixtureKey);
});
