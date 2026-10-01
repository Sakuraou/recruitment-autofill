import { beforeEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { resolveProjectField } from '../src/matching/projectFieldResolver';
import type { ProjectProjectionEntry } from '../src/profile/projection';

const record: ProjectProjectionEntry = { id: 'fictional-project', name: '虚构检索平台', role: '开发成员', organization: '无',
  description: '面向虚构校园资料的检索与收藏管理平台。', responsibilities: '完成查询接口与测试。',
  achievements: '完成课程演示。', technologies: ['TypeScript', 'React'], startDate: '2026-01-01', endDate: '2026-06-30' };
function field(html: string) {
  document.body.innerHTML = `<section><h2>项目经历</h2>${html}</section>`;
  return scanDocument(document).result.fields[0]!;
}
beforeEach(() => { document.body.innerHTML = ''; });
describe('已验证项目编辑器的字段投影', () => {
  it.each([
    ['Project name', 'name', record.name], ['课题名称', 'name', record.name], ['名称', 'name', record.name],
    ['简介', 'description', record.description], ['项目职责', 'responsibilities', record.responsibilities],
    ['职务', 'role', record.role], ['所在公司', 'organization', record.organization],
    ['项目成果', 'achievements', record.achievements], ['技术栈', 'technologies', 'TypeScript、React'],
    ['开始日期', 'startDate', record.startDate], ['结束日期', 'endDate', record.endDate],
  ])('解析当前项目的 %s', (label, key, value) => {
    expect(resolveProjectField(field(`<label>${label}<input></label>`), record))
      .toMatchObject({ status: 'known', key: `projects.${key}`, value });
  });
  it('可见标签胜过带学校含义的内部资源名', () => {
    expect(resolveProjectField(field('<label>项目名称<input name="RecruitmentPortalEducation_School"></label>'), record))
      .toMatchObject({ status: 'known', key: 'projects.name', value: record.name });
  });
  it.each(['姓名', '毕业日期', '验证码', '我同意隐私协议', '未知接口参数 X'])('项目归属不会授权填入无关或保护字段：%s', label => {
    expect(resolveProjectField(field(`<label>${label}<input></label>`), record).status).toBe('request-human');
  });
  it('同强度语义冲突保持歧义，不选择一个标签强填', () => {
    const result = resolveProjectField(field('<label>项目名称<input aria-label="项目角色"></label>'), record);
    expect(result).toEqual({ status: 'request-human', reason: 'field-semantic-ambiguous' });
  });
  it('月份精度不能推算成日期，完整日期可写月份控件', () => {
    expect(resolveProjectField(field('<label>开始日期<input type="date"></label>'), { ...record, startDate: '2026-01' }))
      .toEqual({ status: 'request-human', reason: 'profile-date-precision' });
    expect(resolveProjectField(field('<label>开始日期<input type="month"></label>'), record))
      .toMatchObject({ status: 'known', value: '2026-01' });
  });
  it('非法日历日期和超长文本明确停下，不改日期或截断', () => {
    expect(resolveProjectField(field('<label>开始日期<input type="date"></label>'), { ...record, startDate: '2026-02-30' }))
      .toEqual({ status: 'request-human', reason: 'profile-value-invalid' });
    expect(resolveProjectField(field('<label>项目描述<textarea maxlength="5"></textarea></label>'), record))
      .toEqual({ status: 'request-human', reason: 'profile-value-too-long' });
  });
  it('选项按可见含义匹配，网页内部值只在唯一匹配后使用', () => {
    expect(resolveProjectField(field('<label>项目角色<select><option value="">请选择</option><option value="opaque-17">开发成员</option><option value="开发成员">其它角色</option></select></label>'), record))
      .toMatchObject({ status: 'known', value: 'opaque-17' });
  });
  it.each(['<option value="a">开发成员</option><option value="b">开发成员</option>',
    '<option value="开发成员">其它角色</option>', '<option value="a" disabled>开发成员</option>',
    '<option value="a">开发成员兼负责人</option>'])('重复、仅内部值、禁用或模糊选项不能自动选', options => {
    expect(resolveProjectField(field(`<label>项目角色<select><option value="">请选择</option>${options}</select></label>`), record))
      .toEqual({ status: 'request-human', reason: 'field-options-unresolved' });
  });
  it('缺失事实与不支持的 checkbox 明确停下', () => {
    expect(resolveProjectField(field('<label>项目职务<input></label>'), { ...record, role: undefined }))
      .toEqual({ status: 'request-human', reason: 'profile-value-missing' });
    expect(resolveProjectField(field('<label>项目角色<input type="checkbox"></label>'), record))
      .toEqual({ status: 'request-human', reason: 'field-unsupported' });
  });
  it('未知可见标签不被看似已知的内部 ID 或提示语替代', () => {
    expect(resolveProjectField(field('<label>未知业务编号<input name="projectName" placeholder="项目名称"></label>'), record))
      .toEqual({ status: 'request-human', reason: 'field-semantic-unknown' });
  });
  it('完全无标签时可以使用明确项目资源名，不能借栏目标题猜测', () => {
    expect(resolveProjectField(field('<input name="projectName">'), record))
      .toMatchObject({ status: 'known', key: 'projects.name' });
    expect(resolveProjectField(field('<input name="opaque-unknown">'), record))
      .toEqual({ status: 'request-human', reason: 'field-semantic-unknown' });
  });
  it('相同精度日期倒置时停止', () => {
    expect(resolveProjectField(field('<label>开始日期<input type="date"></label>'), { ...record, startDate: '2026-07-01' }))
      .toEqual({ status: 'request-human', reason: 'profile-value-invalid' });
  });
  it('不同精度的起止时间只拒绝必然倒置，不自动补日', () => {
    const control = field('<label>结束日期<input type="month"></label>');
    expect(resolveProjectField(control, { ...record, startDate: '2026-09-30', endDate: '2026-09' }))
      .toMatchObject({ status: 'known', value: '2026-09' });
    expect(resolveProjectField(control, { ...record, startDate: '2026-10-01', endDate: '2026-09' }))
      .toEqual({ status: 'request-human', reason: 'profile-value-invalid' });
  });
});
