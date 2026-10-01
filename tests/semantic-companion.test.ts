// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as rawRequest, type Server } from 'node:http';
import { SEMANTIC_BINDING_PATHS, SEMANTIC_BINDING_FORMAT, semanticRequestSchema } from '../src/ai/semanticProtocol';
import { createResponsesProvider, type CompanionProvider, type CompanionResult } from '../src/companion/responsesProvider';
import { createSemanticServer } from '../src/companion/server';

const token = '1'.repeat(64); const origin = `chrome-extension://${'a'.repeat(32)}`;
const request = () => ({ protocol: 1, requestId: '11111111-1111-4111-8111-111111111111', allowedPaths: [...SEMANTIC_BINDING_PATHS], fields: [
  { ref: 'field-0', fingerprint: '0123456789abcdef', kind: 'input', type: 'text', section: 'basic', record: 'none',
    label: '如何称呼您', ariaLabel: '', tableHeader: '', title: '', placeholder: '', options: [] },
] });
const proposal = () => ({ requestId: request().requestId, status: 'mapped', bindings: [
  { ref: 'field-0', fingerprint: '0123456789abcdef', path: 'basic.name', certainty: 'certain', evidence: 'label' },
] });
const completed = (body = proposal()) => ({ status: 'completed', output: [
  { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(body) }] },
] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const servers: Server[] = [];
async function start(provider?: ReturnType<typeof createResponsesProvider>) {
  const server = createSemanticServer({ token, provider, deadlineMs: 100 }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address');
  const url = `http://127.0.0.1:${address.port}`;
  const call = (path = '/v1/bindings', body: unknown = request(), custom: RequestInit = {}) => fetch(url + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': token },
    body: JSON.stringify(body), ...custom,
  });
  return { url, call };
}
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
}))); });

describe('shared minimal semantic request', () => {
  it('accepts only the same fixed catalogue and bounded, contiguous references as the extension', () => {
    expect(semanticRequestSchema.safeParse(request()).success).toBe(true);
    for (const change of ['extra', 'catalogue', 'reference', 'options', 'type', 'owner']) {
      const body = request();
      if (change === 'extra') Object.assign(body, { profile: { name: 'private' } });
      if (change === 'catalogue') body.allowedPaths.pop();
      if (change === 'reference') body.fields[0]!.ref = 'action-0';
      if (change === 'options') Object.assign(body.fields[0]!, { options: [{ ref: 'option-0', label: 'visible', value: 'private' }] });
      if (change === 'type') body.fields[0]!.type = 'password';
      if (change === 'owner') body.fields[0]!.record = 'creating';
      expect(semanticRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('fixed Responses provider using fictional fetch only', () => {
  it('has no fallback credential/model and sends the fixed schema and minimal request without tools or a caller endpoint', async () => {
    expect(createResponsesProvider({ apiKey: '', model: '' })).toBeUndefined();
    const fetcher = vi.fn().mockResolvedValue(response(completed()));
    const provider = createResponsesProvider({ apiKey: 'fictional-test-key', model: 'fictional-test-model', fetcher })!;
    expect(await provider(semanticRequestSchema.parse(request()), new AbortController().signal)).toEqual({ state: 'ready', proposal: proposal() });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body); expect(body.text.format).toEqual(SEMANTIC_BINDING_FORMAT);
    expect(body.store).toBe(false); expect(body.input[0].role).toBe('user'); expect(body.tools).toBeUndefined();
    expect(JSON.parse(body.input[0].content)).toEqual(request());
    expect(body.model).toBe('fictional-test-model'); expect(body.instructions).toContain('untrusted');
  });
  it.each(['incomplete', 'failed', 'in_progress', 'queued'])('does not treat %s API status as a complete binding', async status => {
    const fetcher = vi.fn().mockResolvedValue(response({ ...completed(), status }));
    const provider = createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher })!;
    expect(await provider(semanticRequestSchema.parse(request()), new AbortController().signal)).toEqual({ state: 'invalid-output', proposal: null });
  });
  it('handles API refusals without relaying refusal prose or unrelated output_text', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ status: 'completed', output: [
      { type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'refusal', refusal: 'private prose' }] },
    ], output_text: JSON.stringify(proposal()) }));
    expect(await createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher })!(semanticRequestSchema.parse(request()), new AbortController().signal))
      .toEqual({ state: 'refused', proposal: null });
  });
  it.each(['multiple', 'malformed', 'wrong-owner', 'wrong-ref', 'extra-value', 'oversized', 'unfinished-message'])('rejects %s output rather than partially accepting it', async mode => {
    const body = completed();
    if (mode === 'multiple') body.output[0]!.content.push({ type: 'output_text', text: JSON.stringify(proposal()) });
    if (mode === 'malformed') body.output[0]!.content[0]!.text = '{';
    if (mode === 'wrong-owner') { const p = proposal(); p.bindings[0]!.path = 'projects.name'; body.output[0]!.content[0]!.text = JSON.stringify(p); }
    if (mode === 'wrong-ref') { const p = proposal(); p.bindings[0]!.ref = 'field-99'; body.output[0]!.content[0]!.text = JSON.stringify(p); }
    if (mode === 'extra-value') body.output[0]!.content[0]!.text = JSON.stringify({ ...proposal(), value: 'private' });
    if (mode === 'oversized') body.output[0]!.content[0]!.text = 'x'.repeat(300_000);
    if (mode === 'unfinished-message') body.output[0]!.status = 'incomplete';
    const fetcher = vi.fn().mockResolvedValue(response(body));
    expect(await createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher })!(semanticRequestSchema.parse(request()), new AbortController().signal))
      .toEqual({ state: 'invalid-output', proposal: null });
  });
  it('returns generic failures on HTTP errors, network errors, redirects and cancelled signals without retrying', async () => {
    for (const mode of ['http', 'network', 'redirect', 'cancel']) {
      const signal = new AbortController(); if (mode === 'cancel') signal.abort();
      const fetcher = mode === 'network' ? vi.fn().mockRejectedValue(new Error('private error')) : vi.fn().mockResolvedValue(response({ private: 'key' }, mode === 'redirect' ? 302 : 401));
      const result = await createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher })!(semanticRequestSchema.parse(request()), signal.signal);
      expect(result).toEqual({ state: mode === 'cancel' ? 'cancelled' : 'unavailable', proposal: null });
      expect(fetcher.mock.calls.length).toBe(mode === 'cancel' ? 0 : 1);
    }
  });
  it('rejects successful HTTP with malformed JSON or a convenience output_text lacking a complete message', async () => {
    for (const body of [new Response('{'), response({ status: 'completed', output_text: JSON.stringify(proposal()), output: [] })]) {
      const fetcher = vi.fn().mockResolvedValue(body);
      expect(await createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher })!(semanticRequestSchema.parse(request()), new AbortController().signal))
        .toEqual({ state: 'invalid-output', proposal: null });
    }
  });
  it('rejects partial valid output when another binding has a forbidden reference or fingerprint', async () => {
    const p = proposal(); p.bindings.push({ ...p.bindings[0]!, ref: 'field-99' });
    const fetcher = vi.fn().mockResolvedValue(response(completed(p)));
    expect(await createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher })!(semanticRequestSchema.parse(request()), new AbortController().signal))
      .toEqual({ state: 'invalid-output', proposal: null });
  });
});

describe('authenticated loopback HTTP', () => {
  it('calls the fictional provider through real HTTP and returns a strictly normalized binding', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(completed()));
    const server = await start(createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher }));
    const result = await server.call(); expect(result.status).toBe(200); expect(await result.json()).toEqual({ state: 'ready', proposal: proposal() });
    expect(result.headers.get('access-control-allow-origin')).toBe(origin);
    expect(result.headers.get('cache-control')).toBe('no-store'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['https://recruit.example.test', 'null', 'chrome-extension://bad', ''])('does not give an ordinary/untrusted origin model access: %s', async source => {
    const fetcher = vi.fn(); const server = await start(createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher }));
    const result = await server.call(undefined, undefined, { headers: { Origin: source, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': token } });
    expect(result.status).toBe(403); expect(result.headers.get('access-control-allow-origin')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires the private pairing token and does not disclose API credentials in authenticated health', async () => {
    const server = await start();
    const bad = await server.call(undefined, undefined, { headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': 'bad' } });
    expect(bad.status).toBe(401);
    const health = await server.call('/v1/health', undefined, { method: 'GET', body: undefined });
    expect(await health.json()).toEqual({ protocol: 1, ready: false });
    const disabled = await server.call(); expect(disabled.status).toBe(503); expect(await disabled.json()).toEqual({ state: 'disabled', proposal: null });
  });
  it('answers only valid extension preflights and never grants wildcard CORS', async () => {
    const server = await start();
    const result = await server.call(undefined, undefined, { method: 'OPTIONS', body: undefined, headers: { Origin: origin,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-resume-semantic-token' } });
    expect(result.status).toBe(204); expect(result.headers.get('access-control-allow-origin')).toBe(origin);
    const wrong = await server.call(undefined, undefined, { method: 'OPTIONS', body: undefined, headers: { Origin: origin,
      'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'x-arbitrary-header' } });
    expect(wrong.status).toBe(403);
  });
  it('rejects wrong paths/methods/content types, extra profiles and oversized bodies before any API call', async () => {
    const fetcher = vi.fn(); const server = await start(createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher }));
    expect((await server.call('/arbitrary-endpoint')).status).toBe(404);
    expect((await server.call(undefined, undefined, { method: 'DELETE', body: undefined })).status).toBe(405);
    expect((await server.call(undefined, undefined, { headers: { Origin: origin, 'Content-Type': 'text/plain', 'X-Resume-Semantic-Token': token } })).status).toBe(415);
    expect((await server.call(undefined, { ...request(), profile: { secret: 'private' } })).status).toBe(400);
    expect((await server.call(undefined, undefined, { body: 'x'.repeat(128_001) })).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects non-loopback Host even when an authenticated client reaches the loopback listener', async () => {
    const server = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const call = rawRequest(`${server.url}/v1/bindings`, { method: 'POST', headers: { Host: 'evil.example.test', Origin: origin,
        'Content-Type': 'application/json', 'X-Resume-Semantic-Token': token } }, result => { result.resume(); resolve(result.statusCode); });
      call.on('error', reject); call.end(JSON.stringify(request()));
    });
    expect(status).toBe(403);
  });
  it('limits concurrency, aborts timed-out requests and restores capacity without relaying private errors', async () => {
    let entered: (() => void) | undefined; const started = new Promise<void>(resolve => { entered = resolve; });
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_: string | URL | Request, options: RequestInit = {}) => { signal = options.signal as AbortSignal; entered!(); return new Promise<Response>(() => {}); });
    const server = await start(createResponsesProvider({ apiKey: 'fixture', model: 'fixture', fetcher }));
    const first = server.call(); await started;
    expect((await server.call()).status).toBe(429);
    const result = await first; expect(await result.json()).toEqual({ state: 'timeout', proposal: null }); expect(signal!.aborted).toBe(true);
    fetcher.mockResolvedValue(response(completed()));
    expect((await server.call()).status).toBe(200);
  });
  it('revalidates the provider envelope instead of sending arbitrary exception fields to the extension', async () => {
    const provider: CompanionProvider = async () => ({ state: 'ready', proposal: proposal(), leakedError: 'private' } as unknown as CompanionResult);
    const server = await start(provider); const result = await server.call();
    expect(result.status).toBe(503); expect(await result.json()).toEqual({ state: 'invalid-output', proposal: null });
  });
  it('aborts a model request when its authenticated client disconnects', async () => {
    let entered: (() => void) | undefined; const started = new Promise<void>(resolve => { entered = resolve; });
    let aborted: (() => void) | undefined; const ended = new Promise<void>(resolve => { aborted = resolve; });
    const provider: CompanionProvider = async (_, signal) => {
      entered!(); signal.addEventListener('abort', () => aborted!(), { once: true });
      return new Promise(() => {});
    };
    const server = await start(provider); const controller = new AbortController();
    const pending = server.call(undefined, undefined, { signal: controller.signal }).catch(() => undefined);
    await started; controller.abort(); await pending; await ended;
  });
});
