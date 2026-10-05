import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { profileSchema, createEmptyProfile } from '../src/profile/schema';
import { matchFields } from '../src/matching/ruleMatcher';
import { agentOrdinaryFieldIds, agentFieldFingerprint, buildAgentPageTasks, type AgentRecordCheck } from '../src/agent/pageTasks';
import { installEducationSessionPage, educationSessionProfile } from './fixtures/education-session-page';
import { installWeakProjectSessionPage } from './fixtures/weak-project-session-page';
const profile = profileSchema.parse({ ...createEmptyProfile(), basic: { name: '虚构姓名' }, education: educationSessionProfile.education });
const idle = (total = 0, canStart = false): AgentRecordCheck => ({ state: { phase: 'idle', total, canStart }, presence: { state: 'unverified', total, matched: 0 } });
const checks = () => ({ education: idle(2), project: idle(), internship: idle() });
afterEach(() => { document.body.innerHTML = ''; });
function observe(attempted = new Set<string>(), overrides = {}) {
  const scan = scanDocument().result;
  return buildAgentPageTasks(scan, matchFields(scan.fields, profile), profile, { ...checks(), ...overrides }, attempted);
}
it('ordinary fields are offered while missing unoffered fields remain pending after a deferred attempt', () => {
  document.body.innerHTML = '<section aria-label="个人信息"><h2>个人信息</h2><label>姓名<input required></label><label>陌生问题<input required></label></section>';
  expect(observe()).toMatchObject({ tasks: [{ kind: 'fill-visible', count: 2 }], pending: { fields: 2 } });
  const attempted = new Set([agentFieldFingerprint(scanDocument().result)]);
  expect(observe(attempted)).toMatchObject({ tasks: [], pending: { fields: 2, blockers: 1 } });
});
it('already populated ordinary fields do not create extra work', () => {
  document.body.innerHTML = '<label>姓名<input value="网页原值"></label>';
  expect(observe()).toMatchObject({ tasks: [], pending: { fields: 0, records: 0, blockers: 0 } });
});
it('a highest education summary is not mistaken for a missing education list', () => {
  document.body.innerHTML = '<h2>基本信息</h2><label>最高学历<select><option>硕士研究生</option></select></label>';
  expect(observe()?.pending.records).toBe(0);
});
it('offers the full education collection using its guarded record executor', () => {
  installEducationSessionPage(document);
  expect(observe(new Set(), { education: idle(2, true) })).toMatchObject({ tasks: [{ kind: 'education-records', count: 2 }], pending: { fields: 0, records: 2 } });
});
it('rechecks presence instead of trusting an old complete phase', () => {
  installEducationSessionPage(document);
  expect(observe(new Set(), { education: { ...idle(2, true), state: { phase: 'complete', canStart: true, total: 2 } } })?.tasks).toEqual([{ kind: 'education-records', count: 2 }]);
});
it('only an exact source identity proof removes the record task', () => {
  installEducationSessionPage(document);
  expect(observe(new Set(), { education: { ...idle(2, true), presence: { state: 'all-present', total: 2, matched: 2 } } })).toMatchObject({ tasks: [], pending: { records: 0 } });
  expect(observe(new Set(), { education: { ...idle(2, true), presence: { state: 'pending', total: 2, matched: 1 } } })?.pending.records).toBe(2);
});
it('cannot borrow fields inside an already open record editor', () => {
  const fixture = installEducationSessionPage(document); fixture.add.click();
  const scan = scanDocument().result;
  expect(scan.fields.length).toBeGreaterThan(5); expect(agentOrdinaryFieldIds(scan).size).toBe(0);
  expect(observe()).toMatchObject({ tasks: [], pending: { fields: 0, records: 2, blockers: 1 } });
});
it('a paused record task remains pending and is not silently resumed', () => {
  installEducationSessionPage(document);
  expect(observe(new Set(), { education: { ...idle(2, true), state: { phase: 'paused', canStart: true, total: 2 } } })).toMatchObject({ tasks: [], pending: { records: 2, blockers: 1 } });
});
it('rejects incomplete or duplicate field matching evidence', () => {
  document.body.innerHTML = '<label>姓名<input></label><label>邮箱<input type="email"></label>';
  const scan = scanDocument().result; const matches = matchFields(scan.fields, profile);
  expect(buildAgentPageTasks(scan, matches.slice(1), profile, checks(), new Set())).toBeUndefined();
  expect(buildAgentPageTasks(scan, [matches[0]!, matches[0]!], profile, checks(), new Set())).toBeUndefined();
});
it('rejects contradictory presence counts', () => {
  installEducationSessionPage(document);
  expect(observe(new Set(), { education: idle(1, true) })).toBeUndefined();
});
it('unsupported awards stay pending instead of disappearing from completion', () => {
  document.body.innerHTML = '<section aria-label="在校奖励"><h2>在校奖励</h2><p>暂无奖励</p><button>添加奖励</button></section>';
  expect(observe()?.pending.blockers).toBeGreaterThan(0);
});
it('blank pages cannot be declared filled', () => { expect(observe()?.pending.blockers).toBeGreaterThan(0); });
it('inaccessible frames remain blockers even when the main form is populated', () => {
  document.body.innerHTML = '<label>姓名<input value="已有姓名"></label><iframe src="https://invalid.example/"></iframe>';
  const scan = scanDocument().result;
  scan.warnings.push('跨域 iframe 无法访问');
  expect(buildAgentPageTasks(scan, matchFields(scan.fields, profile), profile, checks(), new Set())?.pending.blockers).toBeGreaterThan(0);
});
it.each(['unknown','known'] as const)('empty source collection marked %s still needs information', state => {
  installWeakProjectSessionPage(document);
  const source=createEmptyProfile();source.collectionFacts={projects:{state,confirmed:true,source:'user'}};
  const scan=scanDocument().result;
  expect(buildAgentPageTasks(scan,matchFields(scan.fields,source),source,{...checks(),project:idle(0,true)},new Set()))
    .toMatchObject({tasks:[],pending:{records:0,blockers:1}});
});
it.each(['none','not_applicable'] as const)('explicit %s allows an empty closed project list to have no record work', state => {
  installWeakProjectSessionPage(document);
  const source=createEmptyProfile();source.collectionFacts={projects:{state,confirmed:true,source:'user'}};
  const scan=scanDocument().result;
  expect(buildAgentPageTasks(scan,matchFields(scan.fields,source),source,{...checks(),project:idle(0,true)},new Set()))
    .toMatchObject({tasks:[],pending:{records:0,blockers:0}});
});
it('explicit absence cannot discard an already open foreign record draft',()=>{
  const fixture=installWeakProjectSessionPage(document);fixture.add.click();
  const source=createEmptyProfile();source.collectionFacts={projects:{state:'none',confirmed:true,source:'user'}};
  const scan=scanDocument().result;
  expect(buildAgentPageTasks(scan,matchFields(scan.fields,source),source,{...checks(),project:idle(0)},new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('explicit absence cannot discard a contradictory existing webpage record',()=>{
  const fixture=installWeakProjectSessionPage(document);fixture.add.click();
  fixture.list.querySelector<HTMLInputElement>('input')!.value='网页上的项目';
  fixture.list.querySelector<HTMLTextAreaElement>('textarea')!.value='已有项目描述';
  fixture.list.querySelector<HTMLButtonElement>('form button')!.click();
  const source=createEmptyProfile();source.collectionFacts={projects:{state:'none',confirmed:true,source:'user'}};
  const scan=scanDocument().result;
  expect(buildAgentPageTasks(scan,matchFields(scan.fields,source),source,{...checks(),project:idle(0,true)},new Set())?.pending.blockers).toBeGreaterThan(0);
});
