import { beforeEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { matchField } from '../src/matching/ruleMatcher';
import { createEmptyProfile, type EducationExperience } from '../src/profile/schema';
import { resolveEducationField, resolveBoundEducationField } from '../src/matching/educationFieldResolver';

const undergraduate: EducationExperience = { id: 'fictional-bachelor', level: '本科', school: '虚构青岚大学',
  college: '计算机学院', major: '软件工程', degree: '学士学位', educationType: '统招', schoolProperty: '国内普通院校',
  studyMode: '全日制', country: '中国', durationYears: '4', ranking: '前20%', gpa: '3.5', gpaScale: '4',
  startDate: '2020-09-01', endDate: '2024-06-30' };
const graduate: EducationExperience = { ...undergraduate, id: 'fictional-master', level: '硕士研究生', school: '虚构星河大学',
  college: '人工智能学院', major: '人工智能', degree: '硕士学位', schoolProperty: '211', durationYears: '3',
  ranking: '12/15，前80%', startDate: '2024-09-01', endDate: '2027-06-30' };
function field(html: string) {
  document.body.innerHTML = `<section><h2>教育经历</h2>${html}</section>`;
  return scanDocument(document).result.fields[0]!;
}
beforeEach(() => { document.body.innerHTML = ''; });
describe('教育附加事实的通用识别', () => {
  it.each([
    ['教育类型', 'educationType', '统招'], ['本科院校性质', 'schoolProperty', '国内普通院校'],
    ['硕士学制', 'durationYears', '3'], ['院校所属国家/地区', 'country', '中国'],
  ])('已有事实进入普通字段匹配：%s', (label, key, value) => {
    const profile = createEmptyProfile(); profile.education = [graduate, undergraduate];
    expect(matchField(field(`<label>${label}<input></label>`), profile))
      .toMatchObject({ status: 'auto', value, matchedProfileKey: expect.stringMatching(new RegExp(`education\\..*\\.${key}$`)) });
  });
  it('院校性质有不同事实且阶段不明时不默认第一条', () => {
    const profile = createEmptyProfile(); profile.education = [graduate, undergraduate];
    expect(matchField(field('<label>院校性质<input></label>'), profile)).toMatchObject({ status: 'review', value: undefined });
  });
  it('教育类型缺事实，不从全日制推断统招', () => {
    const profile = createEmptyProfile(); profile.education = [{ ...undergraduate, educationType: undefined }];
    expect(matchField(field('<label>教育类型<input></label>'), profile)).toMatchObject({ status: 'missing', value: undefined });
  });
  it('旧门户的教育类型实际提供全日制/非全日制，按完整选项识别学习形式', () => {
    const input = field('<label>教育类型<select name="RecruitmentPortalPersonProfile_EducationStudyMode"><option value="">请选择</option><option value="f">全日制</option><option value="p">非全日制</option></select></label>');
    const profile = createEmptyProfile(); profile.education = [graduate, undergraduate];
    expect(matchField(input, profile)).toMatchObject({ status: 'auto', value: 'f', matchedProfileKey: 'education.*.studyMode' });
    expect(resolveEducationField(input, undergraduate)).toMatchObject({ status: 'known', key: 'education.studyMode', value: 'f' });
  });
  it.each(['<option value="f">全日制</option>', '<option value="f">全日制</option><option value="x">其他</option>',
    '<option value="f">全日制</option><option value="p" disabled>非全日制</option>', '<option value="f">统招</option><option value="p">非全日制</option>',
    '<option value="f">全日制</option><option value="p">非全日制</option><option value="a" disabled>统招</option>'])('不完整或混合选项不能改变教育类型含义', choices => {
    const input = field(`<label>教育类型<select><option value="">请选择</option>${choices}</select></label>`);
    const result = resolveEducationField(input, undergraduate);
    expect(result).not.toMatchObject({ status: 'known', key: 'education.studyMode' });
  });
});
describe.each([undergraduate, graduate])('明确当前教育记录 $level', record => {
  it.each([
    ['学校名称', 'school'], ['学院', 'college'], ['专业', 'major'], ['学历', 'level'], ['学位', 'degree'],
    ['学习形式', 'studyMode'], ['教育类型', 'educationType'], ['院校性质', 'schoolProperty'], ['院校国家/地区', 'country'],
    ['学制', 'durationYears'], ['成绩排名', 'ranking'], ['GPA', 'gpa'], ['绩点满分', 'gpaScale'],
    ['入学日期', 'startDate'], ['毕业日期', 'endDate'],
  ] as const)('%s 只读取当前条目', (label, key) => {
    expect(resolveEducationField(field(`<label>${label}<input></label>`), record))
      .toMatchObject({ status: 'known', key: `education.${key}`, value: record[key] });
  });
});
describe('教育字段的语义和事实边界', () => {
  it('可见学校标签胜过项目资源名，陌生标签不借 ID 或提示语猜测', () => {
    expect(resolveEducationField(field('<label>学校<input name="ProjectName"></label>'), graduate)).toMatchObject({ status: 'known', value: graduate.school });
    expect(resolveEducationField(field('<label>学校业务编号<input name="EducationSchool" placeholder="学校名称"></label>'), graduate)).toEqual({ status: 'request-human', reason: 'field-semantic-ambiguous' });
    expect(resolveEducationField(field('<label>未知业务字段<input name="EducationSchool" placeholder="学校名称"></label>'), graduate)).toEqual({ status: 'request-human', reason: 'field-semantic-unknown' });
  });
  it('无标签资源名可以识别，只有栏目标题仍保持未知', () => {
    expect(resolveEducationField(field('<input name="EducationSchool">'), graduate)).toMatchObject({ status: 'known', value: graduate.school });
    expect(resolveEducationField(field('<input name="opaque">'), graduate)).toEqual({ status: 'request-human', reason: 'field-semantic-unknown' });
  });
  it.each(['姓名', '项目名称', '所在公司', '验证码', '我同意隐私协议'])('教育归属不授权无关字段：%s', label => {
    expect(resolveEducationField(field(`<label>${label}<input></label>`), graduate).status).toBe('request-human');
  });
  it.each(['最高学位', '最高学历专业', '是否最高学历', '是否最高学位'])('当前记录不能冒充最高汇总或布尔事实：%s', label => {
    expect(resolveEducationField(field(`<label>${label}<input></label>`), undergraduate)).toEqual({ status: 'request-human', reason: 'field-semantic-ambiguous' });
  });
  it('明确其他阶段及同强度标签冲突拒绝', () => {
    expect(resolveEducationField(field('<label>本科专业<input></label>'), graduate)).toEqual({ status: 'request-human', reason: 'field-semantic-ambiguous' });
    expect(resolveEducationField(field('<label>学校<input aria-label="专业"></label>'), undergraduate)).toEqual({ status: 'request-human', reason: 'field-semantic-ambiguous' });
  });
  it.each([['学位', 'degree'], ['教育类型', 'educationType'], ['院校性质', 'schoolProperty'], ['专业类别', 'majorCategory']] as const)('%s 缺失不从其他事实推断', (label, key) => {
    expect(resolveEducationField(field(`<label>${label}<input></label>`), { ...graduate, [key]: undefined })).toEqual({ status: 'request-human', reason: 'profile-value-missing' });
  });
  it.each(['<option value="a">211</option><option value="b">211</option>', '<option value="a" disabled>211</option>',
    '<option value="211">其他院校</option>', '<option value="a">211或其他院校</option>'])('重复、禁用、内部代码和模糊选项不自动选', choices => {
    expect(resolveEducationField(field(`<label>院校性质<select><option value="">请选择</option>${choices}</select></label>`), graduate)).toEqual({ status: 'request-human', reason: 'field-options-unresolved' });
  });
  it('唯一可见含义返回网页编码，原始事实不修改', () => {
    expect(resolveEducationField(field('<label>学位<select><option value="">请选择</option><option value="opaque-master">硕士学位</option></select></label>'), graduate)).toMatchObject({ status: 'known', value: 'opaque-master' });
    expect(graduate.degree).toBe('硕士学位');
  });
  it('年月不补日，完整日可用于月份，非法日期和倒置拒绝', () => {
    const input = field('<label>入学日期<input type="date"></label>');
    expect(resolveEducationField(input, { ...graduate, startDate: '2024-09' })).toEqual({ status: 'request-human', reason: 'profile-date-precision' });
    expect(resolveEducationField(input, { ...graduate, startDate: '2024-02-30' })).toEqual({ status: 'request-human', reason: 'profile-value-invalid' });
    expect(resolveEducationField(input, { ...graduate, startDate: '2028-01-01' })).toEqual({ status: 'request-human', reason: 'profile-value-invalid' });
    expect(resolveEducationField(field('<label>毕业日期<input type="month"></label>'), graduate)).toMatchObject({ status: 'known', value: '2027-06' });
  });
  it('未确认结束日期不使用旧值，进行中只选唯一至今且不改今天', () => {
    const ongoing = { ...graduate, endDate: undefined, endDateFact: { state: 'ongoing', source: 'user', confirmed: true } as const };
    expect(resolveEducationField(field('<label>毕业日期<select><option value="">请选择</option><option value="now">至今</option></select></label>'), ongoing)).toMatchObject({ status: 'known', value: 'now' });
    expect(resolveEducationField(field('<label>毕业日期<input type="date"></label>'), ongoing)).toEqual({ status: 'request-human', reason: 'field-options-unresolved' });
    expect(resolveEducationField(field('<label>毕业日期<input></label>'), { ...graduate, endDateFact: { state: 'unknown', source: 'user', confirmed: true } })).toEqual({ status: 'request-human', reason: 'profile-value-missing' });
  });
  it('数值不改写排名，超长专业不截断，控件类型不能串用', () => {
    expect(resolveEducationField(field('<label>成绩排名<input type="number"></label>'), graduate)).toEqual({ status: 'request-human', reason: 'field-unsupported' });
    expect(resolveEducationField(field('<label>GPA<input type="number"></label>'), { ...graduate, gpa: '3.5/4' })).toEqual({ status: 'request-human', reason: 'profile-value-invalid' });
    expect(resolveEducationField(field('<label>专业<input maxlength="2"></label>'), graduate)).toEqual({ status: 'request-human', reason: 'profile-value-too-long' });
    expect(resolveEducationField(field('<label>学位<input type="date"></label>'), graduate)).toEqual({ status: 'request-human', reason: 'field-unsupported' });
  });
  it('纯逻辑路径必须属于教育白名单，不接受索引、元数据或跨集合', () => {
    const input = field('<label>这段学习的专业方向<input></label>');
    expect(resolveBoundEducationField(input, graduate, 'education.major')).toMatchObject({ status: 'known', value: graduate.major });
    for (const path of ['education.0.major', 'education.id', 'education.endDateFact', 'projects.name', '__proto__'])
      expect(resolveBoundEducationField(input, graduate, path)).toEqual({ status: 'request-human', reason: 'field-semantic-unknown' });
  });
});
