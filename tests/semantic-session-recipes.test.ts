import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { createEmptyProfile } from '../src/profile/schema';
import { createSemanticBindingSession, validateSemanticBindings } from '../src/ai/semanticBinding';
import { inferSemanticCandidates, type SemanticProvider } from '../src/ai/semanticCandidates';
import { SESSION_RECIPE_KEY, SESSION_RECIPE_SECRET, SessionSemanticRecipes, clearSessionSemanticRecipes } from '../src/ai/sessionRecipes';

function fixture() {
  vi.stubGlobal('crypto', webcrypto);
  document.body.innerHTML = '<section><h2>个人信息</h2><label>如何称呼您<input></label></section>';
  const profile = createEmptyProfile(); profile.basic.name = '虚构用户甲'; profile.revision = crypto.randomUUID();
  const scan = scanDocument().result;
  const data: Record<string, unknown> = {};
  const area = { setAccessLevel: vi.fn(async () => {}), get: vi.fn(async () => structuredClone(data)),
    set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, structuredClone(value)); }),
    remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete data[key]; }) };
  let tail = Promise.resolve();
  const request = vi.fn((_name: string, operation: () => Promise<unknown>) => {
    const next = tail.then(operation); tail = next.then(() => {}, () => {}); return next;
  });
  vi.stubGlobal('chrome', { runtime: { id: 'fixture' }, storage: { session: area } });
  vi.stubGlobal('navigator', { locks: { request } });
  function session() { const made = createSemanticBindingSession(scan, profile); if (!made.ok) throw new Error(made.reason); return made.session; }
  const original = session(); const field = original.request.fields[0]!;
  const verified = validateSemanticBindings(original, { requestId: original.request.requestId, status: 'mapped', bindings: [
    { ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' },
  ] }, scan, profile);
  return { profile, scan, data, area, session, verified, request };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('trusted browser-session semantic recipes', () => {
  it('rejects an old signed packet immediately after a connection revision changes, even before storage is cleared', async () => {
    const s = fixture(); const originalRevision = crypto.randomUUID();
    expect(await new SessionSemanticRecipes(originalRevision).remember(s.verified, s.scan, s.profile)).toBe(true);
    expect(await new SessionSemanticRecipes(originalRevision).propose(s.session(), s.scan, s.profile)).toBeDefined();
    expect(await new SessionSemanticRecipes(crypto.randomUUID()).propose(s.session(), s.scan, s.profile)).toBeUndefined();
    expect(s.data[SESSION_RECIPE_KEY]).toBeDefined();
  });
  it('does not enable recipe replay with a malformed connection revision', async () => {
    const s = fixture(); const cache = new SessionSemanticRecipes('untrusted-override');
    expect(await cache.remember(s.verified, s.scan, s.profile)).toBe(false);
    expect(await cache.propose(s.session(), s.scan, s.profile)).toBeUndefined(); expect(s.area.get).not.toHaveBeenCalled();
  });
  it('survives a new cache instance without storing raw clues, answers or routing', async () => {
    const s = fixture(); expect(await new SessionSemanticRecipes().remember(s.verified, s.scan, s.profile)).toBe(true);
    const serialized = JSON.stringify(s.data);
    for (const value of [s.profile.basic.name!, '如何称呼您', s.scan.url, s.scan.fields[0]!.id]) expect(serialized).not.toContain(value);
    expect(serialized.length).toBeLessThan(35000); expect(Object.keys(s.data).sort()).toEqual([SESSION_RECIPE_KEY, SESSION_RECIPE_SECRET].sort());
    const session = s.session(); const proposal = await new SessionSemanticRecipes().propose(session, s.scan, s.profile);
    expect(validateSemanticBindings(session, proposal, s.scan, s.profile)).toMatchObject({ ok: true });
    expect(s.area.setAccessLevel).toHaveBeenLastCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });
  it.each(['path', 'signature', 'extra', 'secret', 'duplicate'])('refuses tampered %s storage', async mode => {
    const s = fixture(); const cache = new SessionSemanticRecipes(); await cache.remember(s.verified, s.scan, s.profile);
    const packet = s.data[SESSION_RECIPE_KEY] as { entries: { path: string }[]; signature: string; extra?: string };
    if (mode === 'path') packet.entries[0]!.path = 'basic.phone';
    if (mode === 'signature') packet.signature = '0'.repeat(64);
    if (mode === 'extra') packet.extra = 'unexpected';
    if (mode === 'secret') s.data[SESSION_RECIPE_SECRET] = '0'.repeat(64);
    if (mode === 'duplicate') packet.entries.push(packet.entries[0]!);
    expect(await cache.propose(s.session(), s.scan, s.profile)).toBeUndefined();
  });
  it('rejects cloned receipts and sessions before touching storage', async () => {
    const s = fixture(); const cache = new SessionSemanticRecipes();
    expect(await cache.remember(structuredClone(s.verified), s.scan, s.profile)).toBe(false);
    expect(await cache.propose(structuredClone(s.session()), s.scan, s.profile)).toBeUndefined(); expect(s.area.get).not.toHaveBeenCalled();
  });
  it.each(['url', 'revision', 'options', 'version'])('does not replay across changed %s', async mode => {
    const s = fixture(); const cache = new SessionSemanticRecipes(); await cache.remember(s.verified, s.scan, s.profile);
    if (mode === 'url') s.scan.url += '?different=1';
    if (mode === 'revision') { s.profile.revision = crypto.randomUUID(); s.profile.basic.name = '虚构用户乙'; }
    if (mode === 'version') s.scan.contentVersion = 'old';
    if (mode === 'options') s.scan.fields[0]!.options.push({ label: '新选项', value: 'private-code', disabled: false });
    expect(await cache.propose(s.session(), s.scan, s.profile)).toBeUndefined();
  });
  it('clear removes meanings and their signing secret; an old signed packet cannot be replayed', async () => {
    const s = fixture(); const cache = new SessionSemanticRecipes(); await cache.remember(s.verified, s.scan, s.profile);
    const old = structuredClone(s.data[SESSION_RECIPE_KEY]); await clearSessionSemanticRecipes(); expect(s.data).toEqual({});
    s.data[SESSION_RECIPE_KEY] = old; expect(await cache.propose(s.session(), s.scan, s.profile)).toBeUndefined();
  });
  it('expires after ten minutes and rejects future timestamps', async () => {
    vi.useFakeTimers(); const s = fixture(); const cache = new SessionSemanticRecipes(); await cache.remember(s.verified, s.scan, s.profile);
    const now = Date.now(); vi.setSystemTime(now - 1); expect(await cache.propose(s.session(), s.scan, s.profile)).toBeUndefined();
    vi.setSystemTime(now + 600001); expect(await cache.propose(s.session(), s.scan, s.profile)).toBeUndefined();
  });
  it('storage errors are a miss and preserve the ordinary provider path', async () => {
    const s = fixture(); s.area.get.mockRejectedValue(new Error('storage unavailable'));
    const provider: SemanticProvider = { propose: vi.fn(async (request: Parameters<SemanticProvider['propose']>[0]) => ({ requestId: request.requestId, status: 'mapped', bindings: [
      { ref: request.fields[0]!.ref, fingerprint: request.fields[0]!.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' },
    ] })) };
    expect(await inferSemanticCandidates(s.scan, s.profile, provider, { recipes: new SessionSemanticRecipes() })).toMatchObject({ state: 'ready', matches: [{ value: '虚构用户甲' }] });
    expect(provider.propose).toHaveBeenCalledTimes(1);
  });
  it('a cancelled storage wait cannot start the provider or learn a recipe', async () => {
    const s = fixture(); const controller = new AbortController(); let release: (value: Record<string, unknown>) => void = () => {};
    s.area.get.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const provider: SemanticProvider = { propose: vi.fn(async () => { throw new Error('must not call'); }) };
    const pending = inferSemanticCandidates(s.scan, s.profile, provider, { recipes: new SessionSemanticRecipes(), signal: controller.signal });
    await vi.waitFor(() => expect(s.area.get).toHaveBeenCalled()); controller.abort(); expect(await pending).toEqual({ state: 'cancelled', matches: [] });
    release({}); await new Promise(resolve => setTimeout(resolve, 10)); expect(provider.propose).not.toHaveBeenCalled(); expect(s.area.set).not.toHaveBeenCalled();
  });
  it('does not cache when no cross-context lock is available', async () => {
    const s = fixture(); vi.stubGlobal('navigator', {});
    expect(await new SessionSemanticRecipes().remember(s.verified, s.scan, s.profile)).toBe(false); expect(s.area.set).not.toHaveBeenCalled();
  });
  it('serializes two distinct contexts so their verified meanings are not lost', async () => {
    const s = fixture(); let release: (value: Record<string, unknown>) => void = () => {};
    s.area.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = new SessionSemanticRecipes().remember(s.verified, s.scan, s.profile);
    await vi.waitFor(() => expect(s.area.get).toHaveBeenCalledTimes(1));
    document.querySelector('label')!.firstChild!.textContent = '怎样称呼您'; const next = scanDocument().result;
    const made = createSemanticBindingSession(next, s.profile); if (!made.ok) throw new Error(made.reason);
    const field = made.session.request.fields[0]!;
    const receipt = validateSemanticBindings(made.session, { requestId: made.session.request.requestId, status: 'mapped', bindings: [
      { ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' },
    ] }, next, s.profile);
    const second = new SessionSemanticRecipes().remember(receipt, next, s.profile);
    await Promise.resolve(); expect(s.area.get).toHaveBeenCalledTimes(1); release({});
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect((s.data[SESSION_RECIPE_KEY] as { entries: unknown[] }).entries).toHaveLength(2);
    expect(await new SessionSemanticRecipes().propose(s.session(), s.scan, s.profile)).toBeDefined();
  });
  it('does not write a verified receipt cancelled during storage read', async () => {
    const s = fixture(); const controller = new AbortController(); let release: (value: Record<string, unknown>) => void = () => {};
    s.area.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = new SessionSemanticRecipes().remember(s.verified, s.scan, s.profile, controller.signal);
    await vi.waitFor(() => expect(s.area.get).toHaveBeenCalled()); controller.abort(); release({});
    expect(await pending).toBe(false); expect(s.area.set).not.toHaveBeenCalled();
  });
  it('keeps at most one hundred compact signed meanings and evicts the oldest', async () => {
    const s = fixture(); const cache = new SessionSemanticRecipes();
    for (let index = 0; index < 101; index++) {
      document.querySelector('label')!.firstChild!.textContent = `如何称呼您${index}`; const scan = scanDocument().result;
      const made = createSemanticBindingSession(scan, s.profile); if (!made.ok) throw new Error(made.reason);
      const field = made.session.request.fields[0]!;
      const receipt = validateSemanticBindings(made.session, { requestId: made.session.request.requestId, status: 'mapped', bindings: [
        { ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' },
      ] }, scan, s.profile);
      expect(await cache.remember(receipt, scan, s.profile)).toBe(true);
    }
    expect((s.data[SESSION_RECIPE_KEY] as { entries: unknown[] }).entries).toHaveLength(100); expect(JSON.stringify(s.data).length).toBeLessThan(35000);
    document.querySelector('label')!.firstChild!.textContent = '如何称呼您0'; const scan = scanDocument().result;
    const made = createSemanticBindingSession(scan, s.profile); if (!made.ok) throw new Error(made.reason);
    expect(await cache.propose(made.session, scan, s.profile)).toBeUndefined();
  });
});
