import { expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { matchField } from '../src/matching/ruleMatcher';
import type { FieldDescriptor } from '../src/shared/types';
import { educationSessionProfile } from './fixtures/education-session-page';
function profile() {
  const result = createEmptyProfile();
  result.education = educationSessionProfile.education.map(record => ({ ...record, studyMode: '全日制' }));
  return result;
}
const field = (caption: string, overrides: Partial<FieldDescriptor> = {}): FieldDescriptor => ({
  id: 'highest-summary', kind: 'input', type: 'text', label: caption, ariaLabel: '', tableHeader: '',
  placeholder: '', title: '', name: '', htmlId: '', parentText: '', previousText: '', sectionText: '',
  options: [], maxLength: null, required: false, hasValue: false, disabled: false, readOnly: false, ...overrides,
});
it('学历最高与学位最高独立，博士学历低学位不能覆盖硕士学位', () => {
  const data = profile(); data.education.push({ id: 'fictional-doctor', level: '博士研究生', degree: '学士学位', school: '虚构博士学校', major: '虚构博士专业' });
  expect(matchField(field('最高学历'), data)).toMatchObject({ status: 'auto', value: '博士研究生' });
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'auto', value: '硕士学位', matchedProfileKey: 'education.0.degree' });
  expect(matchField(field('最高学历专业'), data)).toMatchObject({ status: 'auto', value: '虚构博士专业' });
});
it('高学历明确无学位时，读取其他记录的明确最高学位', () => {
  const data = profile(); data.education[0]!.degree = '无';
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'auto', value: '学士学位', matchedProfileKey: 'education.1.degree' });
});
it('源顺序与日期不参与最高学位判断，原事实不修改', () => {
  const data = profile(); data.education[0]!.degree = '无'; data.education.reverse(); const before = JSON.stringify(data);
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'auto', value: '学士学位', matchedProfileKey: 'education.0.degree' });
  expect(JSON.stringify(data)).toBe(before);
});
it('低学历条目缺学位时也不能忽略该未知维度', () => {
  const data = profile(); delete data.education[1]!.degree;
  expect(matchField(field('最高学位'), data).value).toBeUndefined();
  expect(matchField(field('最高学历'), data)).toMatchObject({ status: 'auto', value: '硕士研究生' });
});
it.each(['未取得博士学位', '预计硕士学位', '未知学位名称'])('学位名称%s不当成明确最高学位', degree => {
  const data = profile(); data.education[0]!.degree = degree;
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'review', value: undefined });
});
it('未知学历不能当最低，但明确学位仍独立判断', () => {
  const data = profile(); data.education.push({ id: 'fictional-other', level: '其他', degree: '博士学位', school: '虚构其他学校' });
  expect(matchField(field('最高学历'), data)).toMatchObject({ status: 'review', value: undefined });
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'auto', value: '博士学位' });
});
it('同级最高学历共同值可填，不同学校不可默认首条', () => {
  const data = profile(); data.education.push({ ...data.education[0]!, id: 'fictional-master-two', school: '虚构第二学校', degree: '工学硕士' });
  expect(matchField(field('最高学历'), data)).toMatchObject({ status: 'auto', value: '硕士研究生' });
  expect(matchField(field('最高学历院校'), data)).toMatchObject({ status: 'review', value: undefined });
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'review', value: undefined });
});
it('相同最高学位原事实可以汇总为共同值，不选择第一条', () => {
  const data = profile(); data.education.push({ ...data.education[0]!, id: 'fictional-master-two', school: '虚构第二学校' });
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'auto', value: '硕士学位', matchedProfileKey: 'education.*.degree' });
});
it.each(['全日制最高学历', '最高全日制学历'])('%s排除明确非全日制硕士，不能沿用最高学历', caption => {
  const data = profile(); data.education[0]!.studyMode = '非全日制';
  expect(matchField(field(caption), data)).toMatchObject({ status: 'auto', value: '本科' });
});
it('全日制最高学历相关学校也来自同一完整集合候选', () => {
  const data = profile(); data.education[0]!.studyMode = '非全日制';
  expect(matchField(field('全日制最高学历院校'), data)).toMatchObject({ status: 'auto', value: data.education[1]!.school });
});
it.each(['统招', '', undefined])('未知学习形式%s不能推断全日制', studyMode => {
  const data = profile(); data.education[0]!.studyMode = studyMode;
  expect(matchField(field('全日制最高学历'), data).value).toBeUndefined();
});
it.each(['已取得最高学位', '是否最高学位', '已获得最高学历', 'Highest earned degree'])('摘要问题%s不能转为普通最高事实', caption => {
  expect(matchField(field(caption), profile()).value).toBeUndefined();
});
it('扁平个人信息资源名的 degree 也比较学位而非学历', () => {
  const data = profile(); data.education[0]!.degree = '无';
  expect(matchField(field('', { name: 'RecruitmentPortalPersonProfile_Degree' }), data))
    .toMatchObject({ status: 'auto', value: '学士学位' });
});
it('明确本科阶段仍读本科原学位，不被最高摘要替代', () => {
  expect(matchField(field('本科学位'), profile())).toMatchObject({ status: 'auto', value: '学士学位', matchedProfileKey: 'education.1.degree' });
});
it.each(['Highest degree', 'Highest full-time qualification'])('明确英文摘要%s按独立维度解析', caption => {
  const data = profile(); data.education[0]!.studyMode = '非全日制';
  expect(matchField(field(caption), data)).toMatchObject({ status: 'auto', value: caption.includes('degree') ? '硕士学位' : '本科' });
});
it.each(['非全日制最高学历', '全日制最高学位', '最高学历学位', '本科最高学位'])('未支持或组合维度%s不混为普通最高摘要', caption => {
  expect(matchField(field(caption), profile()).value).toBeUndefined();
});
it('全部明确无学位沿用共同原事实，单条明确无也不变成缺失', () => {
  const data = profile(); data.education.forEach(record => { record.degree = '无'; });
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'auto', value: '无' });
  data.education = data.education.slice(0, 1);
  expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'auto', value: '无' });
});
it('重复身份使完整最高结果失效，已有人工值仍保留', () => {
  const data = profile(); data.education[1]!.id = data.education[0]!.id;
  expect(matchField(field('最高学历'), data)).toMatchObject({ status: 'review', value: undefined });
  expect(matchField(field('最高学历', { hasValue: true }), data)).toMatchObject({ status: 'existing', value: undefined });
});
