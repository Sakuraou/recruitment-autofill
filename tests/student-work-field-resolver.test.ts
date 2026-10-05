import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { resolveStudentWorkField } from '../src/matching/studentWorkFieldResolver';
import type { StudentWorkProjectionEntry } from '../src/profile/studentWorkProjection';
const record: StudentWorkProjectionEntry = { id: 'fictional-a', organization: '虚构学院', department: '就业服务办公室',
  role: '辅导员助理', cadreLevel: '无', startDate: '2021-09-01', endDate: '2022-06-30',
  shortDuties: '协助新生入学与日常事务。', description: '协助整理新生资料。', achievements: '完成新生资料归档。' };
function field(html: string) {
  document.body.innerHTML = '<section><h2>校内职务</h2>' + html + '</section>';
  return scanDocument().result.fields[0]!;
}
afterEach(() => { document.body.innerHTML = ''; });
it.each([
  ['组织团体名称', 'organization'], ['组织名称', 'organization'], ['Organization', 'organization'],
  ['所在部门', 'department'], ['担任职务', 'role'], ['职务名称', 'role'], ['Role', 'role'],
  ['干部级别', 'cadreLevel'], ['职责和成就', 'shortDuties'], ['职责与成就', 'shortDuties'],
  ['工作职责', 'description'], ['职责描述', 'description'], ['取得成就', 'achievements'],
  ['开始时间', 'startDate'], ['起始日期', 'startDate'], ['Start date', 'startDate'],
  ['结束时间', 'endDate'], ['结束日期', 'endDate'], ['End date', 'endDate'],
] as const)('resolves only current student work for %s', (label, key) => {
  expect(resolveStudentWorkField(field('<label>' + label + '<input></label>'), record))
    .toMatchObject({ status: 'known', key: 'studentWork.' + key, value: record[key] });
});
it('keeps two roles in the same organization independent', () => {
  const other = { ...record, id: 'fictional-b', role: '就业办助理', shortDuties: '协助就业资料归档。' };
  expect(resolveStudentWorkField(field('<label>担任职务<input></label>'), other)).toMatchObject({ value: other.role });
  expect(resolveStudentWorkField(field('<label>职责和成就<input></label>'), other)).toMatchObject({ value: other.shortDuties });
});
it.each(['时间', '任期', '是否学生干部', '是否有校内职务', '活动经历类型', '工作单位', '税前月薪',
  '实习工作描述', '项目职责', '联系人', '上传证明', '授权声明', '验证码', '未知问题', '部门或职务'])('rejects unrelated or ambiguous %s', label => {
  expect(resolveStudentWorkField(field('<label>' + label + '<input></label>'), record).status).toBe('request-human');
});
it('visible label beats machine identity', () => {
  expect(resolveStudentWorkField(field('<label>担任职务<input name="InternshipSalary"></label>'), record)).toMatchObject({ value: record.role });
});
it.each(['组织名称', '未知问题'])('conflicting primary label %s cannot borrow role placeholder', label => {
  expect(resolveStudentWorkField(field('<label>担任职务<input aria-label="' + label + '" placeholder="担任职务"></label>'), record))
    .toEqual({ status: 'request-human', reason: 'field-semantic-ambiguous' });
});
it('unknown primary does not borrow meaning from placeholder or machine id', () => {
  expect(resolveStudentWorkField(field('<label>未知问题<input placeholder="担任职务" name="studentWorkRole"></label>'), record).status).toBe('request-human');
});
it('supports explicit placeholder when there is no primary label', () => {
  expect(resolveStudentWorkField(field('<input placeholder="请输入组织团体名称">'), record)).toMatchObject({ value: record.organization });
});
it('combined duties require a prepared factual short text, never internal notes or implicit joins', () => {
  expect(resolveStudentWorkField(field('<label>职责和成就<input></label>'), { ...record, shortDuties: undefined }))
    .toEqual({ status: 'request-human', reason: 'profile-value-missing' });
});
it('missing cadre level is not inferred from the role', () => {
  expect(resolveStudentWorkField(field('<label>干部级别<input></label>'), { ...record, cadreLevel: undefined }))
    .toEqual({ status: 'request-human', reason: 'profile-value-missing' });
});
it('does not invent missing or month-only dates', () => {
  expect(resolveStudentWorkField(field('<label>开始时间<input type="date"></label>'), { ...record, startDate: undefined }))
    .toEqual({ status: 'request-human', reason: 'profile-value-missing' });
  expect(resolveStudentWorkField(field('<label>开始时间<input type="date"></label>'), { ...record, startDate: '2021-09' }))
    .toEqual({ status: 'request-human', reason: 'profile-date-precision' });
});
it('supports day to month and read-only native date formatting', () => {
  expect(resolveStudentWorkField(field('<label>开始时间<input type="month" readonly></label>'), record)).toMatchObject({ value: '2021-09' });
});
it.each([{ ...record, startDate: '2021-02-30' }, { ...record, endDate: '2020-01-01' }, { ...record, salary: 'forbidden' }])('rejects invalid or cross-collection entry %j', entry => {
  expect(resolveStudentWorkField(field('<label>担任职务<input></label>'), entry)).toEqual({ status: 'request-human', reason: 'profile-value-invalid' });
});
it('never truncates descriptions', () => {
  expect(resolveStudentWorkField(field('<label>职责和成就<input maxlength="4"></label>'), record))
    .toEqual({ status: 'request-human', reason: 'profile-value-too-long' });
});
it('selects explicit visible cadre level with opaque values', () => {
  expect(resolveStudentWorkField(field('<label>干部级别<select><option value="">请选择</option><option value="opaque">无</option></select></label>'), record))
    .toMatchObject({ status: 'known', value: 'opaque' });
});
it.each(['<option disabled value="a">无</option>', '<option value="无">班级</option>',
  '<option value="a">无</option><option value="b">无</option>', '<option value="a">班级或无</option>'])('rejects unavailable or ambiguous visible options %s', options => {
  expect(resolveStudentWorkField(field('<label>干部级别<select><option value="">请选择</option>' + options + '</select></label>'), record))
    .toEqual({ status: 'request-human', reason: 'field-options-unresolved' });
});
const ongoing = { ...record, endDate: undefined, endDateFact: { state: 'ongoing' as const, confirmed: true, source: 'user' as const } };
it('ongoing requires one visible native option and keeps opaque value', () => {
  expect(resolveStudentWorkField(field('<label>结束时间<select><option value="">请选择</option><option value="present-value">至今</option></select></label>'), ongoing))
    .toMatchObject({ status: 'known', value: 'present-value' });
});
it.each(['<input type="date">', '<input>', '<select><option value="">至今</option></select>',
  '<select><option value="a">至今</option><option value="b">至今</option></select>'])('ongoing cannot invent today or choose ambiguous %s', control => {
  expect(resolveStudentWorkField(field('<label>结束时间' + control + '</label>'), ongoing))
    .toEqual({ status: 'request-human', reason: 'field-options-unresolved' });
});
it('unconfirmed end fact cannot reuse a stale date or pretend ongoing', () => {
  expect(resolveStudentWorkField(field('<label>结束时间<input></label>'), { ...record, endDateFact: { state: 'known', confirmed: false, source: 'user' } }))
    .toEqual({ status: 'request-human', reason: 'profile-value-missing' });
});
it.each(['readonly', 'disabled', 'type="file"', 'type="checkbox"', 'type="password"', 'type="date"'])('protects incompatible role control %s', attr => {
  expect(resolveStudentWorkField(field('<label>担任职务<input ' + attr + '></label>'), record).status).toBe('request-human');
});
it('returns facts without write, click, model, or replacement authority', () => {
  const result = resolveStudentWorkField(field('<label>担任职务<input value="页面原值"></label>'), record);
  expect(result).toMatchObject({ status: 'known', value: record.role });
  expect(Object.isFrozen(result)).toBe(true);
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('页面原值');
});
