import { describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { detectField } from '../src/matching/fieldMatcher';
import { matchField } from '../src/matching/ruleMatcher';
import { firstInternship, secondInternship, internshipField } from './fixtures/internship-facts';

const aliases = [['工作描述', 'description'], ['入职日期', 'startDate'], ['入职时间', 'startDate'],
  ['离职日期', 'endDate'], ['离职时间', 'endDate'], ['活动经历类型', 'experienceType'], ['工作类型', 'workType'],
  ['企业性质', 'companyProperty'], ['税前月薪范围', 'monthlySalary'], ['gross monthly salary range', 'monthlySalary']] as const;
describe('实习新增通用字段的证据', () => {
  it.each(aliases)('在实习区域识别 %s', (label, key) => {
    expect(detectField(internshipField(label))).toMatchObject({ alias: { scope: 'internships', key }, confidence: 1, ambiguous: false });
  });
  it.each(aliases.filter(([, key]) => key !== 'monthlySalary'))('单条实习的 %s 读取原事实', (label, key) => {
    const profile = createEmptyProfile(); profile.internships = [{ ...firstInternship }];
    expect(matchField(internshipField(label), profile)).toMatchObject({ status: 'auto', value: firstInternship[key], matchedProfileKey: `internships.0.${key}` });
  });
  it('多条实习没有当前条证据时不选第一条公司或描述', () => {
    const profile = createEmptyProfile(); profile.internships = [firstInternship, secondInternship];
    for (const label of ['工作单位', '工作描述', '入职日期', '工作类型'])
      expect(matchField(internshipField(label), profile)).toMatchObject({ status: 'review', value: undefined });
  });
  it.each(['项目经历', '教育经历', '校内职务', '基本信息', ''])('实习专用新增别名不从 %s 借资料', sectionText => {
    for (const [label, key] of aliases.filter(([, key]) => key !== 'description'))
      expect(detectField(internshipField(label, { sectionText }))).not.toMatchObject({ alias: { scope: 'internships', key }, confidence: 1 });
  });
  it('工作描述在校内职务保持其独立集合', () => {
    expect(detectField(internshipField('工作描述', { sectionText: '校内职务' })))
      .toMatchObject({ alias: { scope: 'studentWork', key: 'description' }, confidence: 1 });
  });
  it.each([firstInternship, secondInternship])('实习有无证明属于当前条原事实：$id', record => {
    const profile = createEmptyProfile(); profile.internships = [record];
    const control = internshipField('是否有证明', { kind: 'select', type: 'select-one', options: [
      { label: '是', value: 'false', disabled: false }, { label: '否', value: 'true', disabled: false },
    ] });
    expect(matchField(control, profile)).toMatchObject({ status: 'auto', matchedProfileKey: 'internships.0.hasProof',
      value: record.hasProof === '是' ? 'false' : 'true' });
  });
  it('缺证明状态、多条实习、冲突问题不使用默认否或集合存在性', () => {
    const profile = createEmptyProfile(); const control = internshipField('是否有实习证明', { kind: 'select', type: 'select-one',
      options: [{ label: '是', value: 'yes', disabled: false }, { label: '否', value: 'no', disabled: false }] });
    profile.internships = [{ ...firstInternship, hasProof: undefined }];
    expect(matchField(control, profile)).toMatchObject({ status: 'missing', value: undefined });
    profile.internships = [firstInternship, secondInternship];
    expect(matchField(control, profile)).toMatchObject({ status: 'review', value: undefined });
    profile.internships = [firstInternship];
    expect(matchField({ ...control, ariaLabel: '是否有实习经历' }, profile)).toMatchObject({ status: 'review', value: undefined });
    expect(matchField({ ...control, label: '是否有证明或担保人' }, profile)).toMatchObject({ status: 'review', value: undefined });
  });
  it.each(['项目经历', '校内职务', '基本信息', ''])('非实习的泛有无证明不借 hasProof：%s', sectionText => {
    const profile = createEmptyProfile(); profile.internships = [firstInternship];
    expect(matchField(internshipField('是否有证明', { sectionText, kind: 'select', options: [
      { label: '是', value: 'y', disabled: false }, { label: '否', value: 'n', disabled: false },
    ] }), profile)).toMatchObject({ status: 'review', value: undefined });
  });
});
