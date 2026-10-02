import { afterEach, describe, expect, it, vi } from 'vitest';
import { SemanticRecipeCache } from '../src/ai/semanticRecipes';
import { scanDocument } from '../src/content/scanner';
import { createEmptyProfile } from '../src/profile/schema';
import { createSemanticBindingSession, validateSemanticBindings } from '../src/ai/semanticBinding';
import { inferSemanticCandidates, resolveSemanticCandidates, type SemanticProvider } from '../src/ai/semanticCandidates';

function setup(html?: string) {
  document.body.innerHTML = html ?? '<section><h2>个人信息</h2><label>如何称呼您<input></label><button type="submit">最终提交</button></section>';
  const scan = scanDocument().result; const profile = createEmptyProfile(); profile.basic.name = '虚构用户甲';
  profile.revision = crypto.randomUUID();
  const prepared = createSemanticBindingSession(scan, profile); if (!prepared.ok) throw new Error(prepared.reason);
  const session = prepared.session; const field = session.request.fields[0]!;
  const proposal = { requestId: session.request.requestId, status: 'mapped', bindings: [{ ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' }] };
  const result = validateSemanticBindings(session, proposal, scan, profile);
  if (!result.ok) throw new Error(result.reason);
  return { scan, profile, result };
}
function prepared(s: ReturnType<typeof setup>) {
  const made = createSemanticBindingSession(s.scan, s.profile); if (!made.ok) throw new Error(made.reason); return made.session;
}
afterEach(() => vi.useRealTimers());

describe('private verified semantic recipes', () => {
  it('stores meaning, requires a fresh issued session and resolves the current local value', () => {
    const s = setup(); const cache = new SemanticRecipeCache(); expect(cache.remember(s.result, s.scan, s.profile)).toBe(true);
    const oldScanId = s.scan.scanId; s.scan = scanDocument().result; expect(s.scan.scanId).not.toBe(oldScanId);
    const session = prepared(s); const proposal = cache.propose(session, s.scan, s.profile); expect(proposal).toBeDefined();
    expect(JSON.stringify(proposal)).not.toContain('虚构用户甲');
    const verified = validateSemanticBindings(session, proposal, s.scan, s.profile);
    expect(resolveSemanticCandidates(verified, s.scan, s.profile)).toMatchObject({ ok: true, matches: [{ value: '虚构用户甲', source: 'llm', status: 'review' }] });
    expect(cache.propose(session, s.scan, s.profile)).toBeUndefined();
  });
  it('does not retain any previous personal answer and resets on profile edits', () => {
    const s = setup(); const cache = new SemanticRecipeCache(); cache.remember(s.result, s.scan, s.profile);
    s.profile.basic.name = '虚构用户乙'; s.profile.revision = crypto.randomUUID(); const fresh = prepared(s);
    expect(cache.propose(fresh, s.scan, s.profile)).toBeUndefined();
  });
  it('refuses cloned or forged validation receipts and sessions', () => {
    const s = setup(); const cache = new SemanticRecipeCache();
    expect(cache.remember(JSON.parse(JSON.stringify(s.result)), s.scan, s.profile)).toBe(false);
    cache.remember(s.result, s.scan, s.profile);
    const session = prepared(s); expect(cache.propose(JSON.parse(JSON.stringify(session)), s.scan, s.profile)).toBeUndefined();
    expect(cache.propose(session, { ...s.scan, url: 'https://other.example.test/' }, s.profile)).toBeUndefined();
  });
  it.each(['label', 'section', 'type', 'options', 'new-field', 'action', 'version', 'limit', 'required'])('does not replay after a changed %s', change => {
    const s = setup(); const cache = new SemanticRecipeCache(); cache.remember(s.result, s.scan, s.profile);
    if (change === 'label') document.querySelector('label')!.firstChild!.textContent = '其他未知问题';
    if (change === 'section') document.querySelector('h2')!.textContent = '家庭成员';
    if (change === 'type') document.querySelector('input')!.type = 'email';
    if (change === 'limit') document.querySelector('input')!.maxLength = 2;
    if (change === 'required') document.querySelector('input')!.required = true;
    if (change === 'options') document.querySelector('input')!.replaceWith(Object.assign(document.createElement('select'), { innerHTML: '<option>新选项</option>' }));
    if (change === 'new-field') document.querySelector('section')!.insertAdjacentHTML('beforeend', '<label>新问题<input></label>');
    if (change === 'action') { document.querySelector('button')!.type = 'button'; document.querySelector('button')!.textContent = '删除记录'; }
    s.scan = scanDocument().result;
    if (change === 'version') s.scan.contentVersion = 'old-version';
    const made = createSemanticBindingSession(s.scan, s.profile);
    expect(made.ok ? cache.propose(made.session, s.scan, s.profile) : undefined).toBeUndefined();
  });
  it('refuses a stale accepted receipt instead of learning from an obsolete response', () => {
    const s = setup(); const cache = new SemanticRecipeCache(); s.profile.basic.name = '已变化';
    expect(cache.remember(s.result, s.scan, s.profile)).toBe(false);
  });
  it('expires after ten minutes and refuses a backwards clock', () => {
    vi.useFakeTimers(); const s = setup(); const cache = new SemanticRecipeCache(); cache.remember(s.result, s.scan, s.profile);
    vi.advanceTimersByTime(600001); expect(cache.propose(prepared(s), s.scan, s.profile)).toBeUndefined();
    const t = setup(); cache.remember(t.result, t.scan, t.profile); const now = Date.now(); vi.setSystemTime(now - 1);
    expect(cache.propose(prepared(t), t.scan, t.profile)).toBeUndefined();
  });
  it('clear removes all replayable meanings', () => {
    const s = setup(); const cache = new SemanticRecipeCache(); cache.remember(s.result, s.scan, s.profile); cache.clear();
    expect(cache.propose(prepared(s), s.scan, s.profile)).toBeUndefined();
  });
  it('leaves legacy profiles without an opaque saved revision uncached', () => {
    const s = setup(); delete s.profile.revision;
    const created = createSemanticBindingSession(s.scan, s.profile); if (!created.ok) throw new Error(created.reason);
    const field = created.session.request.fields[0]!;
    const result = validateSemanticBindings(created.session, { requestId: created.session.request.requestId, status: 'mapped', bindings: [
      { ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' },
    ] }, s.scan, s.profile);
    expect(new SemanticRecipeCache().remember(result, s.scan, s.profile)).toBe(false);
  });
  it('bounds retained meanings and does not let a returned proposal mutate its private entries', () => {
    const s = setup(); const cache = new SemanticRecipeCache(2);
    for (let index = 0; index < 3; index++) {
      document.querySelector('label')!.firstChild!.textContent = `如何称呼您${index}`;
      s.scan = scanDocument().result; const session = prepared(s); const field = session.request.fields[0]!;
      const result = validateSemanticBindings(session, { requestId: session.request.requestId, status: 'mapped', bindings: [
        { ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' },
      ] }, s.scan, s.profile);
      expect(cache.remember(result, s.scan, s.profile)).toBe(true);
    }
    const proposal = cache.propose(prepared(s), s.scan, s.profile)!; proposal.bindings[0]!.path = 'basic.phone';
    expect(cache.propose(prepared(s), s.scan, s.profile)!.bindings[0]!.path).toBe('basic.name');
    document.querySelector('label')!.firstChild!.textContent = '如何称呼您0'; s.scan = scanDocument().result;
    expect(cache.propose(prepared(s), s.scan, s.profile)).toBeUndefined();
    expect(JSON.stringify(cache)).toBe('{}');
  });
  it('rejects changed disabled options, but reads fresh internal option values locally on a valid hit', () => {
    const s = setup('<section><h2>个人信息</h2><label>您的身份称谓<select><option value="">请选择</option><option value="old">男性</option><option value="f" disabled>女性</option></select></label></section>');
    s.profile.basic.gender = '男'; const session = prepared(s); const field = session.request.fields[0]!;
    const result = validateSemanticBindings(session, { requestId: session.request.requestId, status: 'mapped', bindings: [
      { ref: field.ref, fingerprint: field.fingerprint, path: 'basic.gender', certainty: 'certain', evidence: 'label' },
    ] }, s.scan, s.profile);
    const cache = new SemanticRecipeCache(); expect(cache.remember(result, s.scan, s.profile)).toBe(true);
    document.querySelector('select')!.options[1]!.value = 'new-internal-value'; s.scan = scanDocument().result;
    const next = prepared(s); const proposal = cache.propose(next, s.scan, s.profile);
    const verified = validateSemanticBindings(next, proposal, s.scan, s.profile);
    expect(resolveSemanticCandidates(verified, s.scan, s.profile)).toMatchObject({ ok: true, matches: [{ value: 'new-internal-value', source: 'llm' }] });
    document.querySelector('select')!.options[2]!.label = '其他未知选项'; s.scan = scanDocument().result;
    expect(cache.propose(prepared(s), s.scan, s.profile)).toBeUndefined();
  });
  it('declines a truncated model option view rather than pretending a large choice list was fully observed', () => {
    const s = setup(`<section><h2>个人信息</h2><label>如何称呼您<select>${Array.from({ length: 41 }, (_, index) => `<option value="${index ? index : ''}">${index ? `选项${index}` : '请选择'}</option>`).join('')}</select></label></section>`);
    expect(new SemanticRecipeCache().remember(s.result, s.scan, s.profile)).toBe(false);
  });
  it('reuses a verified meaning with zero provider calls but still runs the live context check and local value resolver', async () => {
    const s = setup(); const cache = new SemanticRecipeCache(); cache.remember(s.result, s.scan, s.profile); s.scan = scanDocument().result;
    const provider: SemanticProvider = { propose: vi.fn(async () => { throw new Error('must not call'); }) };
    const currentContext = vi.fn(() => ({ scan: s.scan, profile: s.profile }));
    expect(await inferSemanticCandidates(s.scan, s.profile, provider, { recipes: cache, currentContext })).toMatchObject({ state: 'ready', matches: [{ value: '虚构用户甲', source: 'llm', status: 'review' }] });
    expect(provider.propose).not.toHaveBeenCalled(); expect(currentContext).toHaveBeenCalledTimes(1);
    expect(await inferSemanticCandidates(s.scan, s.profile, undefined, { recipes: cache })).toEqual({ state: 'disabled', matches: [] });
  });
  it('rejects a cache hit when the live webpage observation changes before resolution', async () => {
    const s = setup(); const cache = new SemanticRecipeCache(); cache.remember(s.result, s.scan, s.profile);
    const changed = structuredClone(s.scan); changed.fields[0]!.label = '已换问题';
    const provider: SemanticProvider = { propose: vi.fn(async () => { throw new Error('must not call'); }) };
    expect(await inferSemanticCandidates(s.scan, s.profile, provider, { recipes: cache, currentContext: () => ({ scan: changed, profile: s.profile }) }))
      .toEqual({ state: 'rejected', matches: [] }); expect(provider.propose).not.toHaveBeenCalled();
  });
  it('does not learn a cancelled late provider response', async () => {
    const s = setup(); const cache = new SemanticRecipeCache(); const controller = new AbortController();
    let resolveReply: (value: unknown) => void = () => {};
    const provider: SemanticProvider = { propose: vi.fn(() => new Promise(resolve => { resolveReply = resolve; })) };
    const pending = inferSemanticCandidates(s.scan, s.profile, provider, { recipes: cache, signal: controller.signal });
    await vi.waitFor(() => expect(provider.propose).toHaveBeenCalled()); controller.abort(); expect(await pending).toEqual({ state: 'cancelled', matches: [] });
    const request = vi.mocked(provider.propose).mock.calls[0]![0]; const field = request.fields[0]!;
    resolveReply({ requestId: request.requestId, status: 'mapped', bindings: [{ ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' }] });
    await Promise.resolve(); await Promise.resolve(); expect(cache.propose(prepared(s), s.scan, s.profile)).toBeUndefined();
  });
  it('learns a fresh provider result only after the live context check and local resolution', async () => {
    const s = setup(); const cache = new SemanticRecipeCache();
    const provider: SemanticProvider = { propose: vi.fn(async (request: Parameters<SemanticProvider['propose']>[0]) => ({ requestId: request.requestId, status: 'mapped', bindings:
      request.fields.map(field => ({ ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' })) })) };
    expect(await inferSemanticCandidates(s.scan, s.profile, provider, { recipes: cache })).toMatchObject({ state: 'ready' });
    s.scan = scanDocument().result;
    expect(await inferSemanticCandidates(s.scan, s.profile, provider, { recipes: cache })).toMatchObject({ state: 'ready' });
    expect(provider.propose).toHaveBeenCalledTimes(1);
  });
  it('does not replay a partial batch with an uncached field', () => {
    const s = setup('<section><h2>个人信息</h2><label>如何称呼您<input></label><label>如何联系您<input></label></section>');
    const cache = new SemanticRecipeCache(); expect(cache.remember(s.result, s.scan, s.profile)).toBe(true);
    expect(prepared(s).request.fields).toHaveLength(2);
    expect(cache.propose(prepared(s), s.scan, s.profile)).toBeUndefined();
  });
  it('fails closed for an issued session whose current context is malformed', () => {
    const s = setup(); const cache = new SemanticRecipeCache(); cache.remember(s.result, s.scan, s.profile);
    const session = prepared(s); Object.assign(s.profile, { unexpected: s.profile });
    expect(cache.propose(session, s.scan, s.profile)).toBeUndefined();
  });
});
