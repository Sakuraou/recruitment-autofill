import { afterEach, expect, it } from 'vitest';
import { lifecycle } from './fixtures/record-editor-context';
import { educationSessionProfile } from './fixtures/education-session-page';
import { createEmptyProfile, type UserProfile } from '../src/profile/schema';
import { createEducationSemanticContext, educationSemanticContextCurrent, educationSemanticFieldIds,
  resolveCurrentEducationField } from '../src/ai/educationSemanticContext';
import { bindRecordEditor } from '../src/planner/recordEditorBinder';

afterEach(() => { document.body.innerHTML = ''; });
function setup(configure?: (profile: UserProfile, elements: HTMLInputElement[]) => void, type: 'education' | 'project' = 'education') {
  const profile = createEmptyProfile(); profile.revision = crypto.randomUUID();
  profile.education = educationSessionProfile.education.map(record => ({ ...record }));
  const elements = ['这个阶段在哪里学习', '这个阶段授予什么', '这一阶段的学业表现'].map(ariaLabel => Object.assign(document.createElement('input'), { ariaLabel }));
  configure?.(profile, elements);
  const state = lifecycle(elements, undefined, undefined, 1, type);
  const input = { plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
    runContext: state.context, scanState: state.fixture.scanState, profile };
  return { state, input, profile, elements, scan: state.fixture.scanState.result, context: createEducationSemanticContext(input) };
}
it('第二条教育读取自己的学校、学位、成绩，不取源数组第一条或最高教育', () => {
  const s = setup(); expect(s.context).toBeDefined(); expect(s.state.active.intentIndex).toBe(1);
  for (const [index, path, value] of [[0, 'education.school', '虚构青岚学院'], [1, 'education.degree', '学士学位'], [2, 'education.gpa', '3.6']] as const)
    expect(resolveCurrentEducationField(s.context!, s.scan, s.profile, s.scan.fields[index]!.id, path)).toMatchObject({ status: 'known', value });
  expect(JSON.stringify(s.context)).toBe('{"recordType":"education"}');
  expect(Object.isFrozen(s.context)).toBe(true); expect(s.elements.every(element => !element.value)).toBe(true);
});
it('允许只读范围查询，副本上下文或未规划字段没有任何取值能力', () => {
  const s = setup(); const ids = educationSemanticFieldIds(s.context!, s.scan, s.profile)!;
  expect(ids).toEqual(s.scan.fields.map(field => field.id)); expect(Object.isFrozen(ids)).toBe(true);
  expect(educationSemanticFieldIds(structuredClone(s.context!), s.scan, s.profile)).toBeUndefined();
  expect(resolveCurrentEducationField(s.context!, s.scan, s.profile, 'foreign-field', 'education.school')).toBeUndefined();
  expect(resolveCurrentEducationField(structuredClone(s.context!), s.scan, s.profile, ids[0]!, 'education.school')).toBeUndefined();
});
it('项目事务不能签发教育上下文', () => { expect(setup(undefined, 'project').context).toBeUndefined(); });
it.each(['plan', 'capture', 'activeTransaction'] as const)('复制%s不能签发教育上下文', key => {
  const s = setup(); expect(createEducationSemanticContext({ ...s.input, [key]: structuredClone(s.input[key]) })).toBeUndefined();
});
it.each(['stop', 'capture', 'revision', 'event', 'replace', 'silent-value', 'label', 'limit', 'profile', 'reorder', 'outside', 'control-map', 'editor-moved', 'list-replaced', 'list-map'])('%s使旧教育语义上下文失效', change => {
  const s = setup(); expect(s.context).toBeDefined();
  if (change === 'stop') s.state.context.stop();
  if (change === 'capture') s.state.context.capture(s.state.fixture.source);
  if (change === 'revision') s.state.context.bumpProfileRevision();
  if (change === 'event') s.elements[0]!.dispatchEvent(new Event('input', { bubbles: true }));
  if (change === 'replace') s.elements[0]!.replaceWith(s.elements[0]!.cloneNode(true));
  if (change === 'silent-value') s.elements[0]!.value = '保留手工内容';
  if (change === 'label') s.elements[0]!.ariaLabel = '不同问题';
  if (change === 'limit') s.elements[0]!.maxLength = 2;
  if (change === 'profile') s.profile.education[1]!.school = '新学校';
  if (change === 'reorder') s.profile.education.reverse();
  if (change === 'outside') document.body.append(s.elements[0]!);
  if (change === 'editor-moved') document.body.append(s.state.fixture.editor);
  if (change === 'list-replaced') {
    const list = s.state.fixture.scanState.semanticTargets.get(s.state.populatePlan.recordListNodeId)!;
    const replacement = list.cloneNode(false); list.replaceWith(replacement); replacement.appendChild(s.state.fixture.editor);
  }
  if (change === 'list-map') s.state.fixture.scanState.semanticTargets.set(s.state.populatePlan.recordListNodeId,
    s.state.fixture.scanState.semanticTargets.get(s.state.populatePlan.recordListNodeId)!.cloneNode(true) as Element);
  if (change === 'control-map') s.state.fixture.scanState.controls.set(s.scan.fields[0]!.id,
    { node: s.elements[0]!.cloneNode(true) as HTMLInputElement, fingerprint: s.state.fixture.controls[0]!.fingerprint });
  expect(educationSemanticContextCurrent(s.context!, s.scan, s.profile, [])).toBe(false);
  expect(resolveCurrentEducationField(s.context!, s.scan, s.profile, s.scan.fields[0]!.id, 'education.school')).toBeUndefined();
});
it('消费原字段计划后，不能再用旧上下文产生填写值', async () => {
  const s = setup(); const fields = new Map(s.scan.fields.map(field => [field.id, '虚构填写值']));
  expect(await bindRecordEditor({ ...s.input, provideValue: ({ scanFieldId }) => fields.get(scanFieldId),
    rescan: () => s.state.context.capture(s.state.fixture.source) })).toMatchObject({ status: 'advanced', writtenFieldCount: 3 });
  expect(createEducationSemanticContext(s.input)).toBeUndefined();
  expect(resolveCurrentEducationField(s.context!, s.scan, s.profile, s.scan.fields[0]!.id, 'education.school')).toBeUndefined();
});
it('重复教育身份或当前条目缺失不能签发上下文', () => {
  const s = setup(); s.profile.education[1]!.id = s.profile.education[0]!.id;
  expect(createEducationSemanticContext(s.input)).toBeUndefined();
  s.profile.education = []; expect(createEducationSemanticContext(s.input)).toBeUndefined();
});
it.each(['highest', 'stage', 'missing', 'precision', 'length', 'foreign'])('有当前上下文仍保留%s限制', mode => {
  const s = setup((profile, elements) => {
    if (mode === 'highest') elements[0]!.ariaLabel = '是否最高学位';
    if (mode === 'stage') elements[0]!.ariaLabel = '硕士学校';
    if (mode === 'missing') delete profile.education[1]!.school;
    if (mode === 'precision') elements[0]!.type = 'date';
    if (mode === 'length') elements[0]!.maxLength = 2;
  });
  expect(s.context).toBeDefined();
  const path = mode === 'foreign' ? 'projects.name' : mode === 'precision' ? 'education.startDate' : 'education.school';
  expect(resolveCurrentEducationField(s.context!, s.scan, s.profile, s.scan.fields[0]!.id, path)).toMatchObject({ status: 'request-human' });
  expect(s.elements.every(element => !element.value)).toBe(true);
});
