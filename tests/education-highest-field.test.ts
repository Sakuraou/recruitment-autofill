import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { resolveEducationHighestField } from '../src/matching/educationHighestField';
import { educationSessionProfile } from './fixtures/education-session-page';

afterEach(() => { document.body.innerHTML = ''; });
const records = educationSessionProfile.education.map(record => ({ ...record, studyMode: '全日制' }));
function field(label: string, choices = '<option value="">请选择</option><option value="arbitrary-no">否</option><option value="arbitrary-yes">是</option>') {
  document.body.innerHTML = `<section><h2>教育经历</h2><label>${label}<select name="opaque">${choices}</select></label></section>`;
  return scanDocument(document).result.fields[0]!;
}
it.each(['是否最高学历', '是否最高学位', '是否全日制最高学历', '是否最高全日制学历'])('%s 本科否、硕士是，按可见含义返回内部值而不修改页面', caption => {
  const input = field(caption); const before = document.body.innerHTML;
  expect(resolveEducationHighestField(input, records, records[1]!.id)).toMatchObject({ status: 'known', value: 'arbitrary-no' });
  expect(resolveEducationHighestField(input, records, records[0]!.id)).toMatchObject({ status: 'known', value: 'arbitrary-yes' });
  expect(document.body.innerHTML).toBe(before); expect(document.querySelector('select')!.value).toBe('');
});
it('原生单选同样使用唯一可见是/否，选择值不携带真假语义', () => {
  document.body.innerHTML = '<section><h2>教育经历</h2><fieldset><legend>是否最高学位</legend><label><input type="radio" name="opaque" value="false">是</label><label><input type="radio" name="opaque" value="true">否</label></fieldset></section>';
  const input = scanDocument(document).result.fields[0]!;
  expect(input.kind).toBe('radio');
  expect(input.options[0]!.label).toBe('是');
  expect(resolveEducationHighestField(input, records, records[0]!.id)).toMatchObject({ status: 'known', value: input.options[0]!.value });
  expect(document.querySelector<HTMLInputElement>('input')!.checked).toBe(false);
});
it.each(['学校名称', '学历', '学位', '教育类型', '陌生问题'])('非最高问题%s不冒领普通字段', caption => {
  expect(resolveEducationHighestField(field(caption), records, records[0]!.id)).toEqual({ status: 'not-applicable' });
});
it.each(['是否已取得最高学位', '是否最高学历/最高学位', '最高学历', '最高学历专业', '是否最高学位并同意承诺'])('复杂或取得问题%s不升级为可填', caption => {
  expect(resolveEducationHighestField(field(caption), records, records[0]!.id).status).toBe('request-human');
});
it.each([
  '<option value="a">是</option><option value="b">是</option><option value="c">否</option>',
  '<option value="a">是</option><option value="a">否</option>',
  '<option value="a" disabled>是</option><option value="b">否</option>',
  '<option value="a">是否</option><option value="b">否</option>',
  '<option value="a">是</option><option value="b">未知</option>',
])('模糊/重复/同值/禁用选项整批拒绝：%s', choices => {
  expect(resolveEducationHighestField(field('是否最高学位', choices), records, records[0]!.id).status).toBe('request-human');
});
it('未知学位或并列最高保留待办，不当作否', () => {
  const input = field('是否最高学位');
  expect(resolveEducationHighestField(input, records.map(record => ({ ...record, degree: undefined })), records[1]!.id).status).toBe('request-human');
  expect(resolveEducationHighestField(input, [...records, { ...records[0]!, id: 'another-master' }], records[0]!.id).status).toBe('request-human');
});
it('直接标签冲突不由资源名或最高等级覆盖', () => {
  const input = field('是否最高学位'); input.ariaLabel = '是否最高学历'; input.name = 'HighestDegree';
  expect(resolveEducationHighestField(input, records, records[0]!.id).status).toBe('request-human');
});
it('全日制本科、非全日制硕士分别读取全日制最高结果', () => {
  const input = field('是否全日制最高学历'); const local = records.map((record, index) => ({ ...record, studyMode: index ? '全日制' : '非全日制' }));
  expect(resolveEducationHighestField(input, local, records[1]!.id)).toMatchObject({ status: 'known', value: 'arbitrary-yes' });
  expect(resolveEducationHighestField(input, local, records[0]!.id)).toMatchObject({ status: 'known', value: 'arbitrary-no' });
});
it.each(['input', 'textarea', 'checkbox'])('最高字段控件%s不在本轮原生选择范围', kind => {
  const input = field('是否最高学位'); input.kind = kind as typeof input.kind;
  expect(resolveEducationHighestField(input, records, records[0]!.id).status).toBe('request-human');
});
it('明确英文最高学位及 Yes/No 按可见含义解析', () => {
  const input = field('Is this your highest degree?', '<option value="no">Yes</option><option value="yes">No</option>');
  expect(resolveEducationHighestField(input, records, records[0]!.id)).toMatchObject({ status: 'known', value: 'no' });
});
it.each(['disabled', 'readOnly', 'blockedReason'])('最高问题%s仍拒绝填写', problem => {
  const input = field('是否最高学位');
  if (problem === 'blockedReason') input.blockedReason = 'hidden'; else input[problem as 'disabled' | 'readOnly'] = true;
  expect(resolveEducationHighestField(input, records, records[0]!.id)).toMatchObject({ status: 'request-human', reason: 'field-unsupported' });
});
