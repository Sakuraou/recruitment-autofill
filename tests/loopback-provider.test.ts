import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoopbackProvider, checkAiConnection } from '../src/ai/loopbackProvider';
import { AI_CONNECTION_KEY, connectionFileSchema, disableAiConnection, enableAiConnection, loadAiConnection } from '../src/ai/connection';
import { createEmptyProfile } from '../src/profile/schema';
import { scanDocument } from '../src/content/scanner';
import { createSemanticBindingSession } from '../src/ai/semanticBinding';

const connection = { protocol: 1 as const, token: 'a'.repeat(64) };
function request() {
  document.body.innerHTML = '<section><h2>个人信息</h2><label>如何称呼您<input></label></section>';
  const result = createSemanticBindingSession(scanDocument().result, createEmptyProfile());
  if (!result.ok) throw new Error(result.reason);
  return result.session.request;
}
function proposal(value: ReturnType<typeof request>) {
  return { requestId: value.requestId, status: 'mapped', bindings: value.fields.map(field => ({ ref: field.ref, fingerprint: field.fingerprint,
    path: 'basic.name', certainty: 'certain', evidence: 'label' })) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('production loopback semantic transport', () => {
  it('uses only the fixed endpoint, token header and bounded semantic request', async () => {
    const value = request(); const output = proposal(value);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ state: 'ready', proposal: output })));
    expect(await createLoopbackProvider(connection, fetcher).propose(value, new AbortController().signal)).toEqual(output);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:43127/v1/bindings');
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'X-Resume-Semantic-Token': connection.token } });
    expect(JSON.parse(init.body as string)).toEqual(value);
  });
  it.each(['endpoint', 'apiKey', 'profile'])('rejects extra connection property %s before any fetch', key => {
    expect(() => createLoopbackProvider({ ...connection, [key]: 'forbidden' })).toThrow();
    expect(connectionFileSchema.safeParse({ ...connection, [key]: 'forbidden' }).success).toBe(false);
  });
  it.each(['extra-envelope', 'wrong-request', 'invalid-reference', 'oversize', 'malformed', 'http-error', 'refused'])('rejects %s without returning partial proposals', async mode => {
    const value = request(); const output = proposal(value);
    let body = JSON.stringify({ state: 'ready', proposal: output });
    if (mode === 'extra-envelope') body = JSON.stringify({ state: 'ready', proposal: output, explanation: 'private' });
    if (mode === 'wrong-request') body = JSON.stringify({ state: 'ready', proposal: { ...output, requestId: crypto.randomUUID() } });
    if (mode === 'invalid-reference') body = JSON.stringify({ state: 'ready', proposal: { ...output, bindings: [...output.bindings, { ...output.bindings[0], ref: 'field-29' }] } });
    if (mode === 'oversize') body = ' '.repeat(128001);
    if (mode === 'malformed') body = '{';
    if (mode === 'refused') body = JSON.stringify({ state: 'refused', proposal: null });
    const fetcher = vi.fn(async () => new Response(body, { status: mode === 'http-error' ? 401 : 200 }));
    await expect(createLoopbackProvider(connection, fetcher).propose(value, new AbortController().signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('checks an exact authenticated health envelope and does not retry offline', async () => {
    const good = vi.fn(async () => new Response(JSON.stringify({ protocol: 1, ready: true })));
    expect(await checkAiConnection(connection, undefined, good)).toBe(true);
    const bad = vi.fn(async () => new Response(JSON.stringify({ protocol: 1, ready: true, token: connection.token })));
    expect(await checkAiConnection(connection, undefined, bad)).toBe(false);
    const offline = vi.fn(async () => { throw new Error('private server detail'); });
    expect(await checkAiConnection(connection, undefined, offline)).toBe(false); expect(offline).toHaveBeenCalledTimes(1);
  });
  it('aborts a slow health connection', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const result = checkAiConnection(connection, undefined, fetcher);
    await vi.advanceTimersByTimeAsync(5001); expect(await result).toBe(false);
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it('stores connection separately in trusted extension storage, defaults off and removes its token on disable', async () => {
    const data: Record<string, unknown> = {};
    const local = { setAccessLevel: vi.fn(async () => {}), get: vi.fn(async () => data),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, value); }),
      remove: vi.fn(async (key: string) => { delete data[key]; }) };
    vi.stubGlobal('chrome', { runtime: { id: 'fixture' }, storage: { local } });
    expect(await loadAiConnection()).toBeUndefined();
    await enableAiConnection(connection); expect(await loadAiConnection()).toEqual({ ...connection, enabled: true, cacheRevision: expect.any(String) });
    const first = (await loadAiConnection())!.cacheRevision;
    await enableAiConnection(connection); expect((await loadAiConnection())!.cacheRevision).not.toBe(first);
    expect(connectionFileSchema.safeParse({ ...connection, cacheRevision: first }).success).toBe(false);
    expect(Object.keys(data)).toEqual([AI_CONNECTION_KEY]);
    expect(local.setAccessLevel).toHaveBeenLastCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    await disableAiConnection(); expect(await loadAiConnection()).toBeUndefined(); expect(data).toEqual({});
  });
  it('loads a legacy enabled connection without enabling cross-popup cache, and refuses a malformed cache revision', async () => {
    const data: Record<string, unknown> = { [AI_CONNECTION_KEY]: { ...connection, enabled: true } };
    vi.stubGlobal('chrome', { runtime: { id: 'fixture' }, storage: { local: { setAccessLevel: vi.fn(async () => {}), get: vi.fn(async () => data) } } });
    expect(await loadAiConnection()).toEqual({ ...connection, enabled: true });
    data[AI_CONNECTION_KEY] = { ...connection, enabled: true, cacheRevision: 'untrusted-override' };
    expect(await loadAiConnection()).toBeUndefined();
  });
});
