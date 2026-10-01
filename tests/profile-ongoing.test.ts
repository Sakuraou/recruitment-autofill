import { describe, expect, it } from 'vitest';
import { createEmptyProfile, parseProfileJson, profileSchema } from '../src/profile/schema';
import { projectProfile, projectProjectionResponseSchema } from '../src/profile/projection';
import { scanDocument } from '../src/content/scanner';
import { resolveProjectField } from '../src/matching/projectFieldResolver';
import { matchField } from '../src/matching/ruleMatcher';
import { compareProjectCard } from '../src/content/projectRecordIdentity';
import { buildWorkflowRecords, workflowRequest } from '../src/workflow/model';

const fact = { state: 'ongoing' as const, source: 'user' as const, confirmed: true, updatedAt: '2026-10-01T00:00:00Z' };
const record = { id: 'p', name: '虚构检索项目', description: '面向虚构校园资料的检索管理平台。', technologies: [], startDate: '2026-01-01', endDate: undefined, endDateFact: fact };
function field(control = '<select><option value="">请选择</option><option value="opaque-present">至今</option></select>') {
  document.body.innerHTML = `<section><h2>项目经历</h2><label>项目结束日期${control}</label></section>`;
  return scanDocument().result.fields[0]!;
}
function profileWith(project = record) {
  return parseProfileJson(JSON.stringify({ ...createEmptyProfile(), projects: [project] }));
}
function card(end: string) {
  document.body.innerHTML = `<article><h3>${record.name}</h3><p>开始日期：2026-01-01</p><p>结束日期：${end}</p><p>项目描述：${record.description}</p></article>`;
  return document.querySelector('article')!;
}
describe('进行中结束时间', () => {
  it('旧日期和空结束时间无损保留，空值不能推测至今', () => {
    const old = createEmptyProfile(); old.projects = [{ id: 'p', technologies: [] }];
    expect(parseProfileJson(JSON.stringify(old))).toEqual(old);
    expect(matchField(field(), old).value).toBeUndefined();
  });
  it('进行中状态无损保存及投影，不生成结束日或输出无关资料', () => {
    const profile = profileWith();
    expect(profile.projects[0]).toMatchObject({ endDateFact: fact });
    expect(profile.projects[0]!.endDate).toBeUndefined();
    const projection = projectProfile(profile);
    expect(projection.projects[0]).toMatchObject({ endDateFact: fact });
    expect(projectProjectionResponseSchema.safeParse(projection).success).toBe(true);
    expect(projection).not.toHaveProperty('basic');
  });
  it.each(['projects', 'education', 'internships', 'studentWork'] as const)('进行中与已有结束日冲突拒绝导入 %s，但不清除原值', key => {
    const entry = key === 'projects' ? record : { id: 'p', ...(key === 'education' ? { level: '本科' } : {}), startDate: record.startDate, endDateFact: fact };
    const raw = { ...createEmptyProfile(), [key]: [{ ...entry, endDate: '2026-06-30' }] };
    const result = profileSchema.safeParse(raw); expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.path.join('.'))).toContain(`${key}.0.endDate`);
    expect(raw[key][0]!.endDate).toBe('2026-06-30');
  });
  it('已知结束日期状态须有日期，不把缺资料当作已结束', () => {
    expect(profileSchema.safeParse({ ...createEmptyProfile(), projects: [{ ...record, endDateFact: { ...fact, state: 'known' } }] }).success).toBe(false);
  });
  it('普通匹配和当前项目绑定都仅选择唯一可见至今选项', () => {
    expect(matchField(field(), profileWith())).toMatchObject({ value: 'opaque-present', status: 'auto' });
    expect(resolveProjectField(field(), record)).toMatchObject({ status: 'known', key: 'projects.endDate', value: 'opaque-present' });
  });
  it.each(['<input type="date">', '<input type="month">', '<input>', '<select><option value="opaque">2026-10-01</option></select>',
    '<select><option value="a">至今</option><option value="b">Present</option></select>', '<select><option value="a" disabled>至今</option></select>'])('没有唯一的至今能力不能填今天或猜测：%s', control => {
    expect(resolveProjectField(field(control), record).status).toBe('request-human');
    expect(matchField(field(control), profileWith()).value).toBeUndefined();
  });
  it.each([{ ...fact, confirmed: false }, { ...fact, source: 'legacy' as const }, { ...fact, state: 'unknown' as const }, { ...fact, state: 'not_applicable' as const }])('未确认、旧来源、未知和不适用不能回答至今 %s', endDateFact => {
    const project = { ...record, endDateFact };
    expect(resolveProjectField(field(), project).status).toBe('request-human');
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(), projects: [project] }));
    expect(matchField(field(), profile).value).toBeUndefined();
  });
  it('相同名称、开始日及至今可去重；已结束卡片不能冒充进行中', () => {
    expect(compareProjectCard(card('至今'), record).verdict).toBe('same');
    expect(compareProjectCard(card('2026-06-30'), record).verdict).toBe('insufficient');
    expect(compareProjectCard(card('至今'), { ...record, endDateFact: undefined, endDate: '2026-06-30' }).verdict).toBe('insufficient');
  });
  it('移动固定日期流程保留缺资料状态，不能把进行中换成今天', () => {
    const fields = buildWorkflowRecords(workflowRequest(profileWith(), true))[0]!.fields;
    expect(fields.find(item => item.target === 'projectTime_t')?.value).toBeUndefined();
  });
  it('结束日期被明确标记未确认时，固定工作流不能绕过状态使用旧值', () => {
    const endDateFact = { ...fact, state: 'unknown' as const };
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(),
      projects: [{ ...record, endDate: '2026-06-30', endDateFact }],
      internships: [{ id: 'i', endDate: '2026-06-30', endDateFact }],
      studentWork: [{ id: 's', endDate: '2026-06-30', endDateFact }],
      education: [{ id: 'e', level: '本科', endDate: '2026-06-30', endDateFact }],
    }));
    const records = buildWorkflowRecords(workflowRequest(profile, true, 'whole'));
    for (const item of records) {
      expect(item.endDate).toBeUndefined();
      for (const target of ['projectTime_t', 'sltTime_t', 'schoolPost_endTime', 'workTime_t']) {
        const end = item.fields.find(candidate => candidate.target === target);
        if (end) expect(end.value).toBeUndefined();
      }
    }
  });
  it('多段教育的共同结束日期也不能绕过明确未知状态', () => {
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(), education: ['a', 'b'].map(id => ({ id, level: '本科', endDate: '2026-06-30', endDateFact: { ...fact, state: 'unknown' } })) }));
    document.body.innerHTML = '<label>毕业日期<input type="date"></label>';
    expect(matchField(scanDocument().result.fields[0]!, profile).value).toBeUndefined();
  });
});
