// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkVisualCapability } from '../src/ai/visualCapabilities';
import { createSemanticServer } from '../src/companion/server';
import type { Server } from 'node:http';

const connection = { protocol: 1, token: 'a'.repeat(64) };
const reply = (visualBindings = true) => new Response(JSON.stringify({ protocol: 1, visualBindings }));
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve()); server.closeAllConnections();
  })));
});

describe('local visual capability client', () => {
  it('uses only the authenticated fixed local GET and distinguishes interface presence, without a model call', async () => {
    for (const available of [true, false]) {
      const fetcher = vi.fn().mockResolvedValue(reply(available));
      expect(await checkVisualCapability(connection, new AbortController().signal, fetcher)).toBe(available ? 'available' : 'unsupported');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]).toEqual(['http://127.0.0.1:43127/v1/capabilities', expect.objectContaining({
        method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { 'X-Resume-Semantic-Token': connection.token },
      })]);
      expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('body');
    }
  });
  it('does not request anything for an invalid connection or already cancelled check', async () => {
    const fetcher = vi.fn(); const cancelled = new AbortController(); cancelled.abort();
    for (const invalid of [undefined, { ...connection, url: 'https://other.invalid' }, { ...connection, token: 'bad' }]) {
      expect(await checkVisualCapability(invalid, new AbortController().signal, fetcher)).toBe('unknown');
    }
    expect(await checkVisualCapability(connection, cancelled.signal, fetcher)).toBe('unknown');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps old services, failed responses and invalid capability declarations unknown', async () => {
    const redirected = reply(); Object.defineProperty(redirected, 'redirected', { value: true });
    for (const response of [new Response('{}', { status: 404 }), new Response('{}', { status: 401 }),
      new Response('{'), new Response(JSON.stringify({ protocol: 1, visualBindings: 'yes' })),
      new Response(JSON.stringify({ protocol: 2, visualBindings: true })),
      new Response(JSON.stringify({ protocol: 1, visualBindings: true, modelReady: true })),
      new Response('x'.repeat(1025)), new Response(new Uint8Array([0xff])), new Response(null), redirected]) {
      expect(await checkVisualCapability(connection, new AbortController().signal, vi.fn().mockResolvedValue(response))).toBe('unknown');
    }
    expect(await checkVisualCapability(connection, new AbortController().signal, vi.fn().mockRejectedValue(Error('network')))).toBe('unknown');
  });
  it('returns within the deadline even when a transport ignores abort, and ignores its late ready response', async () => {
    vi.useFakeTimers(); let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const pending = checkVisualCapability(connection, new AbortController().signal, fetcher);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('unknown'); expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
    resolve(reply()); await Promise.resolve();
    expect(await pending).toBe('unknown');
  });
  it('cancels a hanging response body on external revocation', async () => {
    const cancel = vi.fn(); const controller = new AbortController();
    const response = new Response(new ReadableStream({ cancel }));
    const pending = checkVisualCapability(connection, controller.signal, vi.fn().mockResolvedValue(response));
    await vi.waitFor(() => expect(response.body!.locked).toBe(true));
    controller.abort(); expect(await pending).toBe('unknown'); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('bounds a hanging body by the same total deadline', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const pending = checkVisualCapability(connection, new AbortController().signal,
      vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('unknown'); expect(cancel).toHaveBeenCalledTimes(1);
  });
});

async function start(visual = false) {
  const provider = vi.fn().mockResolvedValue({ state: 'unavailable', proposal: null });
  const server = createSemanticServer({ token: connection.token, provider, agentProvider: provider, visualProvider: visual ? provider : undefined });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('address');
  const headers = { Origin: `chrome-extension://${'a'.repeat(32)}`, 'X-Resume-Semantic-Token': connection.token };
  const call = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, { headers, ...init });
  return { provider, call, headers };
}
describe('real companion capability HTTP', () => {
  it('declares configured interfaces without invoking providers, and preserves strict old text health', async () => {
    for (const visual of [false, true]) {
      const { call, provider } = await start(visual);
      const result = await call('/v1/capabilities'); expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ protocol: 1, visualBindings: visual });
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(await (await call('/v1/health')).json()).toEqual({ protocol: 1, ready: true });
      expect(provider).not.toHaveBeenCalled();
    }
  });
  it('enforces origin, token and GET and permits only the matching preflight', async () => {
    const { call, provider, headers } = await start(true);
    expect((await call('/v1/capabilities', { headers: { ...headers, Origin: 'https://job.invalid' } })).status).toBe(403);
    expect((await call('/v1/capabilities', { headers: { ...headers, 'X-Resume-Semantic-Token': 'b'.repeat(64) } })).status).toBe(401);
    expect((await call('/v1/capabilities', { method: 'POST' })).status).toBe(405);
    expect((await call('/v1/capabilities', { method: 'OPTIONS', headers: { ...headers,
      'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-resume-semantic-token' } })).status).toBe(204);
    expect((await call('/v1/capabilities', { method: 'OPTIONS', headers: { ...headers,
      'Access-Control-Request-Method': 'POST' } })).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
});
