import { describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { resolveInternshipField, resolveBoundInternshipField } from '../src/matching/internshipFieldResolver';
import { matchField } from '../src/matching/ruleMatcher';
import { firstInternship, secondInternship, internshipField as field } from './fixtures/internship-facts';

const labels = [['工作单位', 'organization'], ['所在部门', 'department'], ['职务', 'role'], ['工作描述', 'description'],
  ['工作业绩', 'achievements'], ['活动经历类型', 'experienceType'], ['工作类型', 'workType'], ['企业性质', 'companyProperty'],
  ['入职日期', 'startDate'], ['离职日期', 'endDate']] as const;
const options = (labels: string[]) => labels.map((label, index) => ({ label, value: 'opaque-' + index, disabled: false }));
const rejection = (reason: string) => ({ status: 'request-human', reason });
describe.each([firstInternship, secondInternship])('当前实习 $id', record => {
  it.each(labels)('%s 只取当前条事实，不取第一条、最后一条或其他集合', (label, key) => {
    expect(resolveInternshipField(field(label), record)).toMatchObject({ status: 'known', key: `internships.${key}`, value: record[key] });
  });
  it('税前月薪范围精确选项仍来自当前条', () => {
    expect(resolveInternshipField(field('税前月薪', { kind: 'select', type: 'select-one',
      options: options([firstInternship.monthlySalary!, secondInternship.monthlySalary!]) }), record))
      .toMatchObject({ status: 'known', key: 'internships.monthlySalary', value: record.id === firstInternship.id ? 'opaque-0' : 'opaque-1' });
  });
  it('证明有无只用已保存原状态，网页内部值相反也按可见答案', () => {
    expect(resolveInternshipField(field('是否有证明', { kind: 'radio', type: 'radio',
      options: [{ label: '是', value: '__radio_option_0', disabled: false }, { label: '否', value: '__radio_option_1', disabled: false }] }), record))
      .toMatchObject({ status: 'known', key: 'internships.hasProof', value: record.hasProof === '是' ? '__radio_option_0' : '__radio_option_1' });
  });
});
describe('实习语义、日期与原事实边界', () => {
  it('可见公司标签优先于学校资源名，未知标签不借项目 ID 或提示语填入', () => {
    expect(resolveInternshipField(field('工作单位', { name: 'EducationSchool' }), secondInternship)).toMatchObject({ status: 'known', value: secondInternship.organization });
    expect(resolveInternshipField(field('未知业务编号', { name: 'InternshipCompany', placeholder: '工作单位' }), firstInternship)).toEqual(rejection('field-semantic-unknown'));
  });
  it('直接标签冲突拒绝；栏目、相邻文字不冒充字段问题', () => {
    expect(resolveInternshipField(field('工作单位', { ariaLabel: '所在部门' }), firstInternship)).toEqual(rejection('field-semantic-ambiguous'));
    expect(resolveInternshipField(field('', { previousText: '工作单位', parentText: '工作描述', name: 'opaque' }), firstInternship)).toEqual(rejection('field-semantic-unknown'));
    expect(resolveInternshipField(field('实习经历'), firstInternship)).toEqual(rejection('field-semantic-unknown'));
  });
  it('无直接标签的明确英文公司资源名可以识别', () => {
    expect(resolveInternshipField(field('', { name: 'InternshipCompany' }), firstInternship)).toMatchObject({ status: 'known', key: 'internships.organization' });
  });
  it.each(labels)('%s 缺失不借同条其他字段或另一条实习', (label, key) => {
    expect(resolveInternshipField(field(label), { ...firstInternship, [key]: undefined })).toEqual(rejection('profile-value-missing'));
  });
  it('缺描述不使用成果，成果完整也保持缺失', () => {
    expect(resolveInternshipField(field('工作描述'), { ...secondInternship, description: undefined })).toEqual(rejection('profile-value-missing'));
  });
  it.each(['姓名', '手机号', '毕业院校', '项目名称', '期望薪资', '家庭住址'])('实习归属不授权无关事实：%s', label => {
    expect(resolveInternshipField(field(label), firstInternship).status).toBe('request-human');
  });
  it.each(['验证码', '证明人姓名', '证明人联系电话', '证明联系人职务', '上传实习证明', '附件', '我同意隐私协议', 'signature', 'contact email'])('保护字段不允许本地或绑定路径冒充：%s', label => {
    expect(resolveInternshipField(field(label), firstInternship)).toEqual(rejection('field-unsupported'));
    expect(resolveBoundInternshipField(field(label), firstInternship, 'internships.description')).toEqual(rejection('field-unsupported'));
  });
  it.each(['internships.0.organization', 'internships[0].description', 'studentWork.description', 'projects.role',
    'internships.certifierContact', 'internships.id', 'internships.endDateFact', 'internships.*.role', 'internships.organization.extra'])('逻辑绑定拒绝索引和外来路径：%s', path => {
    expect(resolveBoundInternshipField(field('陌生字段'), firstInternship, path)).toEqual(rejection('field-semantic-unknown'));
  });
  it('纯逻辑绑定只能格式化所传当前条，不产生 DOM 或模型能力', () => {
    const control = field('陌生字段'); const before = JSON.stringify([control, secondInternship]);
    const result = resolveBoundInternshipField(control, secondInternship, 'internships.description');
    expect(result).toMatchObject({ status: 'known', value: secondInternship.description }); expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify([control, secondInternship])).toBe(before);
  });
  it.each(['checkbox', 'file', 'password', 'hidden', 'email', 'number', 'url'])('不支持的控件不写工作描述：%s', type => {
    expect(resolveInternshipField(field('工作描述', { kind: type === 'checkbox' ? 'checkbox' : 'input', type }), firstInternship)).toEqual(rejection('field-unsupported'));
  });
  it('禁用、阻止和只读文本拒绝', () => {
    for (const overrides of [{ disabled: true }, { readOnly: true }, { blockedReason: 'fictional-block' }])
      expect(resolveInternshipField(field('工作单位', overrides), firstInternship)).toEqual(rejection('field-unsupported'));
  });
  it('工作描述不截断；页面字数限制与原生 maxlength 都生效', () => {
    expect(resolveInternshipField(field('工作描述', { kind: 'textarea', maxLength: 5 }), firstInternship)).toEqual(rejection('profile-value-too-long'));
    expect(resolveInternshipField(field('工作描述', { kind: 'textarea', parentText: '不超过5字' }), firstInternship)).toEqual(rejection('profile-value-too-long'));
  });
  it('月份不补日，完整日期可以写月份控件', () => {
    expect(resolveInternshipField(field('入职日期', { type: 'date' }), { ...firstInternship, startDate: '2025-07' })).toEqual(rejection('profile-date-precision'));
    expect(resolveInternshipField(field('入职日期', { type: 'month' }), firstInternship)).toMatchObject({ status: 'known', value: '2025-07' });
  });
  it('非法公历或必然倒置拒绝，重叠月份保留原精度', () => {
    expect(resolveInternshipField(field('离职日期', { type: 'date' }), { ...firstInternship, endDate: '2025-02-30' })).toEqual(rejection('profile-value-invalid'));
    expect(resolveInternshipField(field('离职日期', { type: 'date' }), { ...firstInternship, endDate: '2025-06-30' })).toEqual(rejection('profile-value-invalid'));
    expect(resolveInternshipField(field('离职日期', { type: 'month' }), { ...firstInternship, endDate: '2025-07' })).toMatchObject({ status: 'known', value: '2025-07' });
  });
  it('已确认进行中只选唯一可见至今，不生成今天或离职日期', () => {
    const record = { ...firstInternship, endDate: undefined, endDateFact: { state: 'ongoing', source: 'user', confirmed: true } as const };
    expect(resolveInternshipField(field('离职日期', { kind: 'select', type: 'select-one', options: options(['至今', '2026-01-01']) }), record))
      .toMatchObject({ status: 'known', value: 'opaque-0' });
    expect(resolveInternshipField(field('离职日期', { type: 'date' }), record)).toEqual(rejection('field-options-unresolved'));
    expect(resolveInternshipField(field('离职日期', { kind: 'select', options: options(['至今', '至今']) }), record)).toEqual(rejection('field-options-unresolved'));
  });
  it('旧的、未确认或未知结束状态不能沿用残留日期或猜至今', () => {
    for (const fact of [{ state: 'unknown', source: 'user', confirmed: true }, { state: 'known', source: 'legacy', confirmed: true },
      { state: 'known', source: 'user', confirmed: false }] as const)
      expect(resolveInternshipField(field('离职日期'), { ...firstInternship, endDateFact: fact })).toEqual(rejection('profile-value-missing'));
  });
  it.each(['duplicate', 'disabled', 'internal', 'fuzzy'])('公司性质选项不猜测：%s', mode => {
    const choices = options(mode === 'duplicate' ? ['民营企业', '民营企业'] : mode === 'fuzzy' ? ['民营企业或其他'] : ['其他']);
    if (mode === 'disabled') { choices[0]!.label = '民营企业'; choices[0]!.disabled = true; }
    if (mode === 'internal') choices[0]!.value = '民营企业';
    expect(resolveInternshipField(field('企业性质', { kind: 'select', type: 'select-one', options: choices }), firstInternship)).toEqual(rejection('field-options-unresolved'));
  });
  it('没有证明状态时不沿用默认否；不完整或重复选项不能填入', () => {
    const control = field('是否有证明', { kind: 'radio', type: 'radio', options: options(['是', '否']) });
    expect(resolveInternshipField(control, { ...firstInternship, hasProof: undefined })).toEqual(rejection('profile-value-missing'));
    expect(resolveInternshipField({ ...control, options: options(['是']) }, firstInternship)).toEqual(rejection('field-options-unresolved'));
    expect(resolveInternshipField({ ...control, options: options(['否', '否']) }, firstInternship)).toEqual(rejection('field-options-unresolved'));
  });
});
describe('经历月薪的口径', () => {
  it('原始范围原样返回，普通匹配和当前记录格式化均不转成一个金额', () => {
    const control = field('税前月薪范围'); const profile = createEmptyProfile(); profile.internships = [firstInternship];
    expect(resolveInternshipField(control, firstInternship)).toMatchObject({ status: 'known', value: '1000-2000/月' });
    expect(matchField(control, profile)).toMatchObject({ status: 'auto', value: '1000-2000/月' });
  });
  it.each(['税前月薪（元）', '税前月薪范围（美元）', '税前月薪范围 / 年薪', '税前月薪范围（税后）',
    'gross monthly salary range USD', '税前月薪范围（人民币）', 'gross monthly salary range net', '税前月薪范围（每小时）'])('单位、税后或周期不明不能推算：%s', label => {
    const profile = createEmptyProfile(); profile.internships = [firstInternship];
    expect(resolveInternshipField(field(label), firstInternship).status).toBe('request-human');
    expect(matchField(field(label), profile)).not.toMatchObject({ status: 'auto', value: expect.any(String) });
    expect(resolveBoundInternshipField(field(label), firstInternship, 'internships.monthlySalary').status).toBe('request-human');
  });
  it('金额输入不选择区间端点；工作类型也不能填入数字控件', () => {
    expect(resolveInternshipField(field('税前月薪范围', { type: 'number' }), firstInternship)).toEqual(rejection('field-unsupported'));
    expect(resolveInternshipField(field('税前月薪'), firstInternship)).toEqual(rejection('field-unsupported'));
    expect(resolveInternshipField(field('工作类型', { type: 'number' }), firstInternship)).toEqual(rejection('field-unsupported'));
  });
  it.each(['2000', '2000-1000/月', 'USD 1000-2000', '面议', '1000-2000/年'])('非确认月薪范围不转换：%s', monthlySalary => {
    expect(resolveInternshipField(field('税前月薪范围'), { ...firstInternship, monthlySalary })).toEqual(rejection('profile-value-invalid'));
  });
  it('缺月薪不使用期望薪资，缺经历类型不因为栏目为实习而补造', () => {
    const profile = createEmptyProfile(); profile.internships = [{ ...firstInternship, monthlySalary: undefined, experienceType: undefined }];
    profile.jobPreferences = { positions: [], cities: [], expectedSalary: '1000-2000/月' };
    expect(matchField(field('税前月薪范围'), profile)).toMatchObject({ status: 'missing', value: undefined });
    expect(resolveInternshipField(field('活动经历类型'), profile.internships[0]!)).toEqual(rejection('profile-value-missing'));
  });
});
