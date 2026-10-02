import { expect, it } from 'vitest';
import { educationHighestFact, educationHighestMarker, type EducationHighestFacet } from '../src/profile/educationHighestFacts';
import type { EducationProjectionEntry } from '../src/profile/educationProjection';

const records = (): EducationProjectionEntry[] => [
  { id: 'fictional-master', level: '硕士研究生', degree: '硕士学位', studyMode: '全日制', startDate: '2024-09', endDate: '2027-06' },
  { id: 'fictional-bachelor', level: '本科', degree: '学士学位', studyMode: '全日制', startDate: '2020-09', endDate: '2024-06' },
];
it.each(['level', 'degree', 'fulltimeLevel'] as const)('完整集合 %s 不按数组末条选最高，本科否硕士是', facet => {
  const source = records(); const before = JSON.stringify(source);
  expect(educationHighestMarker(source, source[1]!.id, facet)).toEqual({ status: 'known', value: false });
  expect(educationHighestMarker(source, source[0]!.id, facet)).toEqual({ status: 'known', value: true });
  expect(educationHighestMarker([...source].reverse(), source[0]!.id, facet)).toEqual({ status: 'known', value: true });
  expect(JSON.stringify(source)).toBe(before);
});
it('博士学历只有学士学位时，最高学历和最高学位独立取不同记录', () => {
  const source = [...records(), { id: 'fictional-doctor', level: '博士研究生' as const, degree: '工学学士学位', studyMode: '全日制' }];
  expect(educationHighestFact(source, 'level')).toEqual({ status: 'known', rank: 4, candidateIds: ['fictional-doctor'] });
  expect(educationHighestFact(source, 'degree')).toEqual({ status: 'known', rank: 2, candidateIds: ['fictional-master'] });
  expect(educationHighestMarker(source, 'fictional-doctor', 'degree')).toEqual({ status: 'known', value: false });
});
it.each([undefined, '', '未知', '预计硕士学位', '无硕士学位', '不是硕士', '硕士学位（在读）'])('学位 %s 不是明确等级，不从学历推断或选本科学位', degree => {
  const source = records(); source[0]!.degree = degree;
  expect(educationHighestFact(source, 'degree')).toMatchObject({ status: 'request-human', reason: 'education-degree-unknown' });
  expect(educationHighestMarker(source, source[1]!.id, 'degree').status).toBe('request-human');
  expect(educationHighestMarker(source, source[0]!.id, 'level')).toEqual({ status: 'known', value: true });
});
it('明确无学位与缺学位分开，已知本科学位可以最高', () => {
  const source = records(); source[0]!.degree = '无';
  expect(educationHighestMarker(source, source[0]!.id, 'degree')).toEqual({ status: 'known', value: false });
  expect(educationHighestMarker(source, source[1]!.id, 'degree')).toEqual({ status: 'known', value: true });
});
it('全部明确无学位：没有最高学位候选，所有记录最高学位为否', () => {
  const source = records().map(record => ({ ...record, degree: '无' }));
  expect(educationHighestFact(source, 'degree')).toEqual({ status: 'none', reason: 'education-no-degree' });
  expect(educationHighestMarker(source, source[0]!.id, 'degree')).toEqual({ status: 'known', value: false });
});
it('同级两个硕士不默认最后一条，低于最高的本科仍明确否', () => {
  const source = [...records(), { ...records()[0]!, id: 'fictional-other-master', startDate: '2021-09', endDate: '2024-06' }];
  expect(educationHighestFact(source, 'degree')).toEqual({ status: 'known', rank: 2, candidateIds: ['fictional-master', 'fictional-other-master'] });
  expect(educationHighestMarker(source, 'fictional-master', 'degree')).toMatchObject({ status: 'request-human', reason: 'education-highest-tied' });
  expect(educationHighestMarker(source, 'fictional-other-master', 'level').status).toBe('request-human');
  expect(educationHighestMarker(source, 'fictional-bachelor', 'degree')).toEqual({ status: 'known', value: false });
});
it('全日制本科和非全日制硕士：三个维度分别判断', () => {
  const source = records(); source[0]!.studyMode = '非全日制';
  expect(educationHighestMarker(source, 'fictional-master', 'level')).toEqual({ status: 'known', value: true });
  expect(educationHighestMarker(source, 'fictional-master', 'fulltimeLevel')).toEqual({ status: 'known', value: false });
  expect(educationHighestMarker(source, 'fictional-bachelor', 'fulltimeLevel')).toEqual({ status: 'known', value: true });
});
it.each([undefined, '', '统招', '脱产', '未知', '不是全日制', '非全日制或全日制'])('学习形式 %s 不当作非全日制，不以统招代替', studyMode => {
  const source = records(); source[0]!.studyMode = studyMode; source[0]!.educationType = '统招';
  expect(educationHighestFact(source, 'fulltimeLevel')).toMatchObject({ status: 'request-human', reason: 'education-study-mode-unknown' });
  expect(educationHighestMarker(source, 'fictional-bachelor', 'fulltimeLevel').status).toBe('request-human');
  expect(educationHighestMarker(source, 'fictional-master', 'degree')).toEqual({ status: 'known', value: true });
});
it('全部明确非全日制：无全日制最高候选，全部标记否', () => {
  const source = records().map(record => ({ ...record, studyMode: '非全日制' }));
  expect(educationHighestFact(source, 'fulltimeLevel')).toEqual({ status: 'none', reason: 'education-no-fulltime' });
  expect(educationHighestMarker(source, source[1]!.id, 'fulltimeLevel')).toEqual({ status: 'known', value: false });
});
it('其他阶段不当作最低，但明确的学位维度保持独立', () => {
  const source = records(); source[0]!.level = '其他';
  expect(educationHighestFact(source, 'level')).toMatchObject({ status: 'request-human', reason: 'education-stage-unknown' });
  expect(educationHighestFact(source, 'fulltimeLevel').status).toBe('request-human');
  expect(educationHighestMarker(source, source[0]!.id, 'degree')).toEqual({ status: 'known', value: true });
});
it.each(['工学硕士学位', '工程硕士', 'Master of Science', "Master's degree"])('明确学位 %s 等价为硕士等级，保留原文', degree => {
  const source = records(); source[0]!.degree = degree;
  expect(educationHighestMarker(source, source[0]!.id, 'degree')).toEqual({ status: 'known', value: true }); expect(source[0]!.degree).toBe(degree);
});
it.each(['duplicate', 'bad-date', 'extra', 'too-many', 'bad-level'])('集合%s校验失败，不产出任何最高判断', mode => {
  let source = records();
  if (mode === 'duplicate') source[1]!.id = source[0]!.id;
  if (mode === 'bad-date') source[0]!.endDate = '2024-02-30';
  if (mode === 'extra') source = [{ ...source[0]!, invented: '私有值' } as unknown as EducationProjectionEntry];
  if (mode === 'too-many') source = Array.from({ length: 31 }, (_, index) => ({ ...source[0]!, id: `entry-${index}` }));
  if (mode === 'bad-level') source[0]!.level = '硕士' as EducationProjectionEntry['level'];
  expect(educationHighestFact(source, 'level')).toEqual({ status: 'request-human', reason: 'education-record-invalid' });
});
it('空集合和外部当前记录不提供默认答案', () => {
  expect(educationHighestFact([], 'level')).toEqual({ status: 'request-human', reason: 'education-records-missing' });
  expect(educationHighestMarker(records(), 'foreign', 'degree')).toEqual({ status: 'request-human', reason: 'education-current-record-missing' });
});
it('冻结源数据不修改，最高结果冻结且不包含学校、成绩或日期', () => {
  const source = Object.freeze(records().map(record => Object.freeze({ ...record, school: '虚构学校私有内容', gpa: '3.9' })));
  const result = educationHighestFact(source, 'level'); expect(Object.isFrozen(result)).toBe(true);
  if (result.status === 'known') expect(Object.isFrozen(result.candidateIds)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/虚构学校|3\.9|2027|2024/);
});
it.each([null, undefined, 'invalid', [null], [1]])('运行时非法集合 %j 安全拒绝', invalid => {
  expect(educationHighestFact(invalid as unknown as EducationProjectionEntry[], 'degree')).toEqual({ status: 'request-human', reason: 'education-record-invalid' });
});
it('运行时非法维度不默认为学历', () => {
  expect(educationHighestFact(records(), 'unexpected' as EducationHighestFacet)).toEqual({ status: 'request-human', reason: 'education-facet-unknown' });
});
it('学历词不能当作学位，缺少本科学位也不猜测为无', () => {
  const source = records(); source[1]!.degree = '本科';
  expect(educationHighestFact(source, 'degree').status).toBe('request-human');
  source[1]!.degree = undefined; expect(educationHighestFact(source, 'degree').status).toBe('request-human');
});
