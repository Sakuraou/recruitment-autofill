import { describe, expect, it } from 'vitest';
import { lifecycle } from './fixtures/record-editor-context';
import { createEmptyProfile, type UserProfile } from '../src/profile/schema';
import { createSemanticBindingSession, validateSemanticBindings, type SemanticBindingPath } from '../src/ai/semanticBinding';
import { resolveSemanticCandidates } from '../src/ai/semanticCandidates';
import { createProjectSemanticContext } from '../src/ai/projectSemanticContext';
import { bindRecordEditor } from '../src/planner/recordEditorBinder';

function setup(paths: readonly SemanticBindingPath[] = ['projects.name', 'projects.description'],
  configure?: (profile: UserProfile, elements: (HTMLInputElement | HTMLSelectElement)[]) => void) {
  const elements: (HTMLInputElement | HTMLSelectElement)[] = paths.map((_, index) => Object.assign(document.createElement('input'), { ariaLabel: `这项工作叫什么${index}` }));
  const profile = createEmptyProfile(); profile.revision = crypto.randomUUID();
  profile.projects = [
    { id: 'p1', name: '虚构项目一', description: '第一条说明', technologies: [] },
    { id: 'p2', name: '虚构项目二', description: '第二条说明', technologies: [] },
  ]; configure?.(profile, elements);
  const state = lifecycle(elements, undefined, undefined, 1);
  const scan = state.fixture.scanState.result;
  const input = { plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
    runContext: state.context, scanState: state.fixture.scanState, profile };
  const context = createProjectSemanticContext(input); expect(context).toBeDefined();
  const prepared = createSemanticBindingSession(scan, profile); if (!prepared.ok) throw new Error(prepared.reason);
  const result = validateSemanticBindings(prepared.session, { requestId: prepared.session.request.requestId, status: 'mapped',
    bindings: prepared.session.request.fields.map((field, index) => ({ ref: field.ref, fingerprint: field.fingerprint,
      path: paths[index]!, certainty: 'certain', evidence: 'label' })) }, scan, profile);
  expect(result.ok).toBe(true); return { state, profile, scan, input, context: context!, result };
}
describe('planner-owned current project semantic values', () => {
  it('uses the planner second intent for every bound field without exposing its index or writing any input', () => {
    const s = setup(); expect(s.state.active.intentIndex).toBe(1);
    expect(resolveSemanticCandidates(s.result, s.scan, s.profile, s.context)).toMatchObject({ ok: true, matches: [
      { value: '虚构项目二', source: 'llm', status: 'review' }, { value: '第二条说明', source: 'llm', status: 'review' },
    ] });
    expect(JSON.stringify(s.context)).toBe('{"recordType":"project"}');
    expect(s.state.fixture.controls.every(control => (control.node as HTMLInputElement).value === '')).toBe(true);
  });
  it('without a planner context keeps logical project bindings valueless instead of defaulting to the first record', () => {
    const s = setup(); const result = resolveSemanticCandidates(s.result, s.scan, s.profile);
    expect(result.ok && result.matches.every(match => match.value === undefined)).toBe(true);
  });
  it('cloned context cannot produce a candidate', () => {
    const s = setup(); expect(resolveSemanticCandidates(s.result, s.scan, s.profile, structuredClone(s.context))).toEqual({ ok: false, reason: 'invalid-project-context' });
  });
  it('consumes the original editor plan once and rejects its old semantic context after writing', async () => {
    const s = setup(); const candidates = resolveSemanticCandidates(s.result, s.scan, s.profile, s.context);
    if (!candidates.ok) throw new Error(candidates.reason);
    const values = new Map(candidates.matches.map(match => [match.fieldId, match.value]));
    const result = await bindRecordEditor({ ...s.input,
      provideValue: ({ scanFieldId }) => values.get(scanFieldId),
      rescan: () => s.state.context.capture(s.state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'advanced', writtenFieldCount: 2 });
    expect(s.state.fixture.controls.map(control => (control.node as HTMLInputElement).value)).toEqual(['虚构项目二', '第二条说明']);
    expect(createProjectSemanticContext(s.input)).toBeUndefined();
    expect(resolveSemanticCandidates(s.result, s.scan, s.profile, s.context)).toEqual({ ok: false, reason: 'invalid-project-context' });
  });
  it.each(['stop', 'capture', 'revision', 'event', 'replace', 'silent-value', 'label', 'limit', 'control-map'])('invalidates a current project after %s', change => {
    const s = setup();
    if (change === 'stop') s.state.context.stop();
    if (change === 'capture') s.state.context.capture(s.state.fixture.source);
    if (change === 'revision') s.state.context.bumpProfileRevision();
    if (change === 'event') s.state.fixture.controls[0]!.node.dispatchEvent(new Event('input', { bubbles: true }));
    if (change === 'replace') s.state.fixture.controls[0]!.node.replaceWith(s.state.fixture.controls[0]!.node.cloneNode(true));
    if (change === 'silent-value') (s.state.fixture.controls[0]!.node as HTMLInputElement).value = '手工内容';
    if (change === 'label') s.state.fixture.controls[0]!.node.setAttribute('aria-label', '新问题');
    if (change === 'limit') (s.state.fixture.controls[0]!.node as HTMLInputElement).maxLength = 2;
    if (change === 'control-map') {
      const original = s.state.fixture.controls[0]!; const clone = original.node.cloneNode(true) as HTMLInputElement; original.node.after(clone);
      s.state.fixture.scanState.controls.set(s.scan.fields[0]!.id, { node: clone, fingerprint: original.fingerprint });
    }
    expect(resolveSemanticCandidates(s.result, s.scan, s.profile, s.context)).toEqual({ ok: false, reason: 'invalid-project-context' });
  });
  it.each(['plan', 'capture', 'activeTransaction'])('cannot issue from a cloned %s capability', key => {
    const s = setup(); expect(createProjectSemanticContext({ ...s.input, [key]: structuredClone(s.input[key as 'plan' | 'capture' | 'activeTransaction']) })).toBeUndefined();
  });
  it('invalidates both the binding and record context on a same-revision project edit', () => {
    const s = setup(); s.profile.projects[1]!.description = '新的第二条说明';
    expect(resolveSemanticCandidates(s.result, s.scan, s.profile, s.context)).toEqual({ ok: false, reason: 'stale-binding' });
    expect(createProjectSemanticContext({ ...s.input, profile: { ...s.profile, projects: [s.profile.projects[0]!, s.profile.projects[0]!] } })).toBeUndefined();
  });
  it.each(['partial-date', 'too-long', 'missing', 'fuzzy-option', 'duplicate-option', 'unsupported-type'])('keeps %s without a writable value', mode => {
    const path: SemanticBindingPath = mode === 'partial-date' ? 'projects.startDate' : mode.includes('option') ? 'projects.role' : 'projects.description';
    const s = setup([path], (profile, elements) => {
      const record = profile.projects[1]!;
      if (mode === 'partial-date') { record.startDate = '2024-03'; (elements[0] as HTMLInputElement).type = 'date'; }
      if (mode === 'too-long') (elements[0] as HTMLInputElement).maxLength = 2;
      if (mode === 'missing') delete record.description;
      if (mode === 'unsupported-type') (elements[0] as HTMLInputElement).type = 'email';
      if (mode.includes('option')) { record.role = '开发成员'; elements[0] = Object.assign(document.createElement('select'), {
        ariaLabel: '这项工作叫什么0', innerHTML: '<option value="">请选择</option>' + (mode === 'fuzzy-option'
          ? '<option value="private-code">高级开发成员</option>' : '<option value="one">开发成员</option><option value="two">开发成员</option>'),
      }); }
    });
    const result = resolveSemanticCandidates(s.result, s.scan, s.profile, s.context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ source: 'llm', status: 'review' });
    expect(result.matches[0]!.value).toBeUndefined();
    expect(s.state.fixture.controls.every(control => (control.node as HTMLInputElement).value === '')).toBe(true);
  });
  it('reads an exact full date and current visible option codes using common project formatting', () => {
    const s = setup(['projects.startDate', 'projects.role'], (profile, elements) => {
      profile.projects[1]!.startDate = '2024-03-07'; profile.projects[1]!.role = '开发成员'; (elements[0] as HTMLInputElement).type = 'date';
      elements[1] = Object.assign(document.createElement('select'), { ariaLabel: '这项工作叫什么1',
        innerHTML: '<option value="">请选择</option><option value="opaque-role">开发成员</option>' });
    });
    expect(resolveSemanticCandidates(s.result, s.scan, s.profile, s.context)).toMatchObject({ ok: true, matches: [
      { value: '2024-03-07', source: 'llm', status: 'review' }, { value: 'opaque-role', source: 'llm', status: 'review' },
    ] });
  });
  it('uses an explicitly confirmed ongoing option instead of generating an end date', () => {
    const s = setup(['projects.endDate'], (profile, elements) => {
      profile.projects[1]!.endDateFact = { state: 'ongoing', source: 'user', confirmed: true, updatedAt: '2026-10-02T00:00:00.000Z' };
      elements[0] = Object.assign(document.createElement('select'), { ariaLabel: '这项工作叫什么0',
        innerHTML: '<option value="">请选择</option><option value="opaque-present">Present</option>' });
    });
    expect(resolveSemanticCandidates(s.result, s.scan, s.profile, s.context)).toMatchObject({ ok: true, matches: [{ value: 'opaque-present', source: 'llm' }] });
  });
});
