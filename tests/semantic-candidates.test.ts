import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { fillScan } from '../src/content/autofill';
import { createEmptyProfile, type UserProfile } from '../src/profile/schema';
import { matchFields } from '../src/matching/ruleMatcher';
import { createSemanticBindingSession, validateSemanticBindings, type SemanticBindingPath, type SemanticBindingSession } from '../src/ai/semanticBinding';
import { inferSemanticCandidates, resolveSemanticCandidates, type SemanticProvider } from '../src/ai/semanticCandidates';

function setup(label = '如何称呼您', control = '<input>', edit?: (profile: UserProfile) => void) {
  document.body.innerHTML = `<section><h2>个人信息</h2><label>${label}${control}</label><button type="submit">提交</button></section>`;
  const state = scanDocument(); const profile = createEmptyProfile();
  profile.basic = { name: '虚构用户甲', gender: '男', birthday: '2000-01-02', heightCm: '175', weightKg: '65', email: 'fictional@example.test' };
  profile.jobPreferences = { positions: ['研发岗'], cities: ['虚构城'], earliestStartDate: '2026-10', expectedSalary: '10000-15000元/月' };
  edit?.(profile);
  return { state, scan: state.result, profile };
}
function binding(s: ReturnType<typeof setup>, path: SemanticBindingPath = 'basic.name') {
  const prepared = createSemanticBindingSession(s.scan, s.profile);
  if (!prepared.ok) throw new Error(prepared.reason);
  const { request } = prepared.session; const field = request.fields[0]!;
  const validated = validateSemanticBindings(prepared.session, { requestId: request.requestId, status: 'mapped',
    bindings: [{ ref: field.ref, fingerprint: field.fingerprint, path, certainty: 'certain', evidence: 'label' }] }, s.scan, s.profile);
  if (!validated.ok) throw new Error(validated.reason);
  return validated;
}
const providerFor = (path: SemanticBindingPath = 'basic.name'): SemanticProvider => ({
  propose: vi.fn(async (request: SemanticBindingSession['request']) => ({ requestId: request.requestId, status: 'mapped', bindings: request.fields.map(field =>
    ({ ref: field.ref, fingerprint: field.fingerprint, path, certainty: 'certain', evidence: 'label' })) })),
});
afterEach(() => { vi.useRealTimers(); });

describe('M5 local semantic candidates', () => {
  it('excludes already considered fields using current references without a provider retry or altering the full observation', async () => {
    const s = setup(); const provider = providerFor(); const before = JSON.stringify(s.scan);
    const result = await inferSemanticCandidates(s.scan, s.profile, provider, { excludedFieldIds: new Set(s.scan.fields.map(field => field.id)) });
    expect(result).toEqual({ state: 'no-candidates', matches: [] }); expect(provider.propose).not.toHaveBeenCalled();
    expect(JSON.stringify(s.scan)).toBe(before);
  });
  it('uses a signed binding to read the saved local name, retaining llm and review provenance', () => {
    const s = setup(); const proposal = binding(s);
    const result = resolveSemanticCandidates(proposal, s.scan, s.profile);
    expect(result).toMatchObject({ ok: true, matches: [{ source: 'llm', status: 'review', value: '虚构用户甲', matchedProfileKey: 'basic.name' }] });
    expect(JSON.stringify(proposal)).not.toContain('虚构用户甲');
  });
  it('refuses forged or JSON-cloned successful bindings and rechecks local contents before any value is read', () => {
    const s = setup(); const trusted = binding(s);
    expect(resolveSemanticCandidates(JSON.parse(JSON.stringify(trusted)), s.scan, s.profile)).toEqual({ ok: false, reason: 'stale-binding' });
    s.profile.basic.name = 'changed';
    expect(resolveSemanticCandidates(trusted, s.scan, s.profile)).toEqual({ ok: false, reason: 'stale-binding' });
  });
  it.each([
    ['怎样联系您', 'basic.phone', undefined, 'missing'],
    ['到岗安排', 'jobPreferences.earliestStartDate', '<input type="date">', 'review'],
    ['怎么称呼您', 'basic.name', '<input maxlength="2">', 'review'],
    ['个人体格', 'basic.heightCm', undefined, 'review'],
    ['体格 (inches)', 'basic.heightCm', undefined, 'review'],
    ['联系渠道', 'basic.phone', '<input type="email">', 'review'],
  ] as const)('does not invent or silently reformat a saved fact: %s', (label, path, control, status) => {
    const s = setup(label, control);
    const result = resolveSemanticCandidates(binding(s, path), s.scan, s.profile);
    expect(result).toMatchObject({ ok: true, matches: [{ status, source: 'llm' }] });
    if (result.ok) expect(result.matches[0]!.value).toBeUndefined();
  });
  it('preserves explicit cm units and full dates reduced to month precision without adding a day', () => {
    const height = setup('体格 (CM)'); const result = resolveSemanticCandidates(binding(height, 'basic.heightCm'), height.scan, height.profile);
    expect(result).toMatchObject({ ok: true, matches: [{ value: '175', source: 'llm', status: 'review' }] });
    const date = setup('您的诞生时刻', '<input type="month">');
    expect(resolveSemanticCandidates(binding(date, 'basic.birthday'), date.scan, date.profile))
      .toMatchObject({ ok: true, matches: [{ value: '2000-01', source: 'llm', status: 'review' }] });
  });
  it('cannot turn an alias option into a rule source; fuzzy and duplicated visible options provide no value', () => {
    const alias = setup('您的身份称谓', '<select><option value="">请选择</option><option value="opaque">男性</option></select>');
    // This label intentionally remains unknown to the rule dictionary.
    const result = resolveSemanticCandidates(binding(alias, 'basic.gender'), alias.scan, alias.profile);
    expect(result).toMatchObject({ ok: true, matches: [{ value: 'opaque', source: 'llm', status: 'review' }] });
    for (const options of ['<option value="a">研发岗及其它</option>', '<option value="a">研发岗</option><option value="b">研发岗</option>']) {
      const s = setup('工作设想', `<select><option value="">请选择</option>${options}</select>`);
      const result = resolveSemanticCandidates(binding(s, 'jobPreferences.positions'), s.scan, s.profile);
      if (!result.ok) throw new Error(result.reason);
      expect(result.matches[0]).toMatchObject({ value: undefined, source: 'llm', status: 'review' });
    }
  });
  it('uses the appropriate saved essay variant without generated prose or truncation', () => {
    const s = setup('谈谈你本人', '<textarea maxlength="10"></textarea>', profile => {
      profile.commonAnswers.selfEvaluation = { short: '虚构短文', long: '长'.repeat(20), byLimit: {} };
    });
    expect(resolveSemanticCandidates(binding(s, 'commonAnswers.selfEvaluation'), s.scan, s.profile))
      .toMatchObject({ ok: true, matches: [{ value: '虚构短文', source: 'llm', matchedProfileKey: 'commonAnswers.selfEvaluation.short' }] });
  });
  it('fills a verified candidate only after explicit confirmation, preserving existing live values and never submitting', async () => {
    const s = setup(); const result = resolveSemanticCandidates(binding(s), s.scan, s.profile);
    if (!result.ok) throw new Error(result.reason);
    const input = document.querySelector('input')!; let submits = 0;
    document.addEventListener('submit', () => submits++, { once: true });
    const item = { fieldId: result.matches[0]!.fieldId, value: result.matches[0]!.value!, confirmed: false };
    expect((await fillScan(s.state, { scanId: s.scan.scanId, items: [item] }))[0]!.status).toBe('skipped');
    expect(input.value).toBe('');
    expect((await fillScan(s.state, { scanId: s.scan.scanId, items: [{ ...item, confirmed: true }] }))[0]!.status).toBe('filled');
    expect(input.value).toBe('虚构用户甲'); expect(submits).toBe(0);
    const preserved = setup(); const second = resolveSemanticCandidates(binding(preserved), preserved.scan, preserved.profile);
    if (!second.ok) throw new Error(second.reason);
    document.querySelector('input')!.value = 'manual edit';
    expect((await fillScan(preserved.state, { scanId: preserved.scan.scanId, items: [{ fieldId: second.matches[0]!.fieldId, value: second.matches[0]!.value!, confirmed: true }] }))[0]!.status).not.toBe('filled');
    expect(document.querySelector('input')!.value).toBe('manual edit');
  });
});

describe('M5 bounded provider interface', () => {
  it('is disabled without a configured provider and leaves deterministic known fields working', async () => {
    const s = setup('姓名');
    expect(await inferSemanticCandidates(s.scan, s.profile)).toEqual({ state: 'disabled', matches: [] });
    expect(matchFields(s.scan.fields, s.profile)[0]).toMatchObject({ status: 'auto', value: '虚构用户甲' });
  });
  it('sends only the minimal semantic request to a provider, then returns local candidates', async () => {
    const s = setup(); const provider = providerFor();
    expect(await inferSemanticCandidates(s.scan, s.profile, provider)).toMatchObject({ state: 'ready', matches: [{ value: '虚构用户甲', source: 'llm' }] });
    const calls = vi.mocked(provider.propose).mock.calls;
    expect(calls).toHaveLength(1); expect(JSON.stringify(calls)).not.toContain('虚构用户甲');
    expect(calls[0]![1]).toBeInstanceOf(AbortSignal);
  });
  it('does not call the provider for known, protected or already filled fields', async () => {
    const s = setup('姓名'); const provider = providerFor();
    expect(await inferSemanticCandidates(s.scan, s.profile, provider)).toEqual({ state: 'no-candidates', matches: [] });
    expect(provider.propose).not.toHaveBeenCalled();
  });
  it('returns a generic unavailable state on rejection without copying errors or retrying', async () => {
    const s = setup(); const provider = { propose: vi.fn().mockRejectedValue(new Error('private token leaked from server')) };
    const result = await inferSemanticCandidates(s.scan, s.profile, provider);
    expect(result).toEqual({ state: 'unavailable', matches: [] }); expect(provider.propose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('times out, aborts the request and ignores late results without stale candidates or another call', async () => {
    vi.useFakeTimers(); const s = setup(); let late: ((value: unknown) => void) | undefined; let signal: AbortSignal | undefined;
    const provider: SemanticProvider = { propose: vi.fn((_, current) => { signal = current; return new Promise(resolve => { late = resolve; }); }) };
    const pending = inferSemanticCandidates(s.scan, s.profile, provider, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toEqual({ state: 'timeout', matches: [] }); expect(signal!.aborted).toBe(true);
    late!({}); await Promise.resolve(); expect(provider.propose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels in flight or before starting, and never returns candidates after the abort', async () => {
    const s = setup(); const cancel = new AbortController();
    const provider: SemanticProvider = { propose: vi.fn(() => new Promise(() => {})) };
    const pending = inferSemanticCandidates(s.scan, s.profile, provider, { signal: cancel.signal }); cancel.abort();
    expect(await pending).toEqual({ state: 'cancelled', matches: [] });
    provider.propose = vi.fn();
    expect(await inferSemanticCandidates(s.scan, s.profile, provider, { signal: cancel.signal })).toEqual({ state: 'cancelled', matches: [] });
    expect(provider.propose).not.toHaveBeenCalled();
  });
  it('rechecks context after the provider returns and rejects changed local data', async () => {
    const s = setup(); const provider = providerFor();
    const currentContext = vi.fn(() => { s.profile.basic.name = 'changed'; return { scan: s.scan, profile: s.profile }; });
    expect(await inferSemanticCandidates(s.scan, s.profile, provider, { currentContext })).toMatchObject({ state: 'rejected', matches: [] });
    expect(currentContext).toHaveBeenCalledTimes(1);
  });
  it('keeps unresolved or schema-invalid output separate from transport failures', async () => {
    for (const mode of ['unresolved', 'invalid']) {
      const s = setup(); const provider: SemanticProvider = { propose: async request => mode === 'invalid' ? { value: 'invented' }
        : { requestId: request.requestId, status: 'unresolved', bindings: [] } };
      expect(await inferSemanticCandidates(s.scan, s.profile, provider)).toMatchObject({ state: 'rejected', matches: [] });
    }
  });
});
