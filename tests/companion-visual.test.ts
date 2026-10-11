// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { SEMANTIC_BINDING_PATHS, semanticRequestSchema } from '../src/ai/semanticProtocol';
import { createLocalPngEncoder } from '../src/visual/localPngEncoder';
import { visualRequestSchema } from '../src/companion/visualRequest';
import { createVisualChatCompletionsProvider } from '../src/companion/chatCompletionsProvider';
import { createSemanticServer } from '../src/companion/server';
import { request as httpRequest } from 'node:http';
import { MAX_VISUAL_BODY_BYTES } from '../src/companion/visualRequest';

async function fixture() {
  const bytes = await createLocalPngEncoder().encode({ width: 1, height: 1, rgba: new Uint8ClampedArray([0, 0, 0, 255]) }, new AbortController().signal);
  return { request: semanticRequestSchema.parse({ protocol: 1, requestId: '11111111-1111-4111-8111-111111111111',
    allowedPaths: [...SEMANTIC_BINDING_PATHS], fields: [{ ref: 'field-0', fingerprint: '0123456789abcdef', kind: 'input', type: 'text',
      section: 'basic', record: 'none', label: '陌生问题甲', ariaLabel: '', tableHeader: '', title: '', placeholder: '', options: [] }] }),
    image: { mime: 'image/png' as const, redacted: true as const, data: 'data:image/png;base64,' + Buffer.from(bytes).toString('base64') } };
}
const proposal = { requestId: '11111111-1111-4111-8111-111111111111', status: 'mapped', bindings: [
  { ref: 'field-0', fingerprint: '0123456789abcdef', path: 'basic.name', certainty: 'certain', evidence: 'label' }] };

it('admits an ordinary large local crop without recursive base64 matching', async () => {
  const input = await fixture();
  const bytes = await createLocalPngEncoder().encode({ width: 256, height: 256,
    rgba: new Uint8ClampedArray(256 * 256 * 4) }, new AbortController().signal);
  expect(visualRequestSchema.safeParse({ ...input, image: { ...input.image,
    data: 'data:image/png;base64,' + Buffer.from(bytes).toString('base64') } }).success).toBe(true);
});

it('rejects corrupt PNG, trailing bytes, unredacted pixels and extra profile data', async () => {
  const input = await fixture(); expect(visualRequestSchema.safeParse(input).success).toBe(true);
  expect(visualRequestSchema.safeParse({ ...input, profile: {} }).success).toBe(false);
  expect(visualRequestSchema.safeParse({ ...input, image: { ...input.image, redacted: false } }).success).toBe(false);
  for (const mode of ['crc', 'trailing', 'truncated']) {
    let bytes = Buffer.from(input.image.data.split(',')[1]!, 'base64');
    if (mode === 'crc') bytes[32] = bytes[32]! ^ 1;
    if (mode === 'trailing') bytes = Buffer.concat([bytes, Buffer.from([0])]);
    if (mode === 'truncated') bytes = bytes.subarray(0, 33);
    expect(visualRequestSchema.safeParse({ ...input, image: { ...input.image, data: 'data:image/png;base64,' + bytes.toString('base64') } }).success).toBe(false);
  }
});

it('compatible vision request carries bounded pixels and meanings, and validates the proposal', async () => {
  const input = await fixture();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify(proposal) } }] })));
  const provider = createVisualChatCompletionsProvider({ baseUrl: 'https://fixture.invalid/v1', apiKey: 'fictional', model: 'vision-fixture', fetcher })!;
  expect(await provider(input, new AbortController().signal)).toMatchObject({ state: 'ready', proposal });
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
  expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: input.image.data, detail: 'low' } });
  expect(body.tools).toBeUndefined(); expect(body.messages[1].content[0].text).toBe(JSON.stringify(input.request));
});

it('actual companion admits authenticated visual route and rejects web origins and malformed envelopes', async () => {
  const input = await fixture(), token = 'a'.repeat(64);
  const provider = vi.fn().mockResolvedValue({ state: 'ready', proposal });
  const server = createSemanticServer({ token, visualProvider: provider });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('address');
    const call = (body: unknown, origin = `chrome-extension://${'a'.repeat(32)}`, supplied = token) => fetch(`http://127.0.0.1:${address.port}/v1/visual-bindings`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': supplied }, body: JSON.stringify(body) });
    expect((await call(input, 'https://fixture.invalid')).status).toBe(403);
    expect((await call(input, undefined, 'b'.repeat(64))).status).toBe(401);
    expect((await call({ ...input, profile: {} })).status).toBe(400);
    const response = await call(input); expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: 'ready', proposal });
    expect(provider).toHaveBeenCalledTimes(1);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});

it('visual requests share the busy gate, time out upstream and allow the next request', async () => {
  const input = await fixture(), token = 'a'.repeat(64);
  let upstreamSignal: AbortSignal | undefined;
  const provider = vi.fn((_input, signal: AbortSignal) => {
    upstreamSignal = signal;
    return new Promise<never>(() => {});
  });
  const server = createSemanticServer({ token, visualProvider: provider, deadlineMs: 100 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('address');
    const call = () => fetch(`http://127.0.0.1:${address.port}/v1/visual-bindings`, { method: 'POST',
      headers: { Origin: `chrome-extension://${'a'.repeat(32)}`, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': token }, body: JSON.stringify(input) });
    const first = call();
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    expect((await call()).status).toBe(429);
    expect(await (await first).json()).toEqual({ state: 'timeout', proposal: null });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(await (await call()).json()).toEqual({ state: 'timeout', proposal: null });
    expect(provider).toHaveBeenCalledTimes(2);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});

it('refuses oversized transport and invalid model output before producing a candidate', async () => {
  const input = await fixture(), token = 'a'.repeat(64);
  const provider = vi.fn().mockResolvedValue({ state: 'ready', proposal: { ...proposal, requestId: crypto.randomUUID() } });
  const server = createSemanticServer({ token, visualProvider: provider });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('address');
    const url = `http://127.0.0.1:${address.port}/v1/visual-bindings`;
    const headers = { Origin: `chrome-extension://${'a'.repeat(32)}`, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': token };
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(url, { method: 'POST', headers: { ...headers, 'Content-Length': MAX_VISUAL_BODY_BYTES + 1 } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.end();
    });
    expect(status).toBe(413); expect(provider).not.toHaveBeenCalled();
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ state: 'invalid-output', proposal: null });
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});
