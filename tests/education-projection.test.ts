import { describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { educationProfile, educationProjectionResponseSchema } from '../src/profile/educationProjection';

function profile() {
  const result = createEmptyProfile(); result.revision = 'fictional-education-revision';
  result.basic.name = '不得返回的虚构姓名'; result.projects = [{ id: 'project', name: '不得返回的虚构项目', technologies: [] }];
  result.education = [{ id: 'master', level: '硕士研究生', school: '虚构星河大学', degree: '硕士学位', educationType: '统招',
    schoolProperty: '211', durationYears: '3', endDateFact: { state: 'ongoing', source: 'user', confirmed: true } },
  { id: 'bachelor', level: '本科', school: '虚构青岚大学', degree: '学士学位', durationYears: '4', endDate: '2024-06-30' }];
  return result;
}
describe('内部最小教育投影', () => {
  it('仅保留两段原教育事实和修订，不挑最高记录或发送其他集合', () => {
    const original = profile(); const data = educationProfile(original);
    expect(data).toEqual({ recordType: 'education', profileRevision: original.revision, education: original.education });
    expect(data.education.map(record => record.id)).toEqual(['master', 'bachelor']);
    expect(JSON.stringify(data)).not.toContain('不得返回');
    expect(educationProjectionResponseSchema.safeParse(data).success).toBe(true);
  });
  it('条目和嵌套事实与源对象独立且冻结', () => {
    const original = profile(); const data = educationProfile(original);
    expect(Object.isFrozen(data)).toBe(true); expect(Object.isFrozen(data.education)).toBe(true);
    expect(Object.isFrozen(data.education[0])).toBe(true); expect(Object.isFrozen(data.education[0]!.endDateFact)).toBe(true);
    original.education[0]!.school = '另一个虚构学校'; original.education[0]!.endDateFact!.confirmed = false;
    expect(data.education[0]).toMatchObject({ school: '虚构星河大学', endDateFact: { confirmed: true } });
  });
  it('旧资料没有修订号时使用更新时间，仍不创造教育事实', () => {
    const original = profile(); original.revision = undefined; original.updatedAt = '2026-10-02T00:00:00.000Z';
    delete original.education[0]!.degree;
    const data = educationProfile(original); expect(data.profileRevision).toBe(original.updatedAt);
    expect(data.education[0]).not.toHaveProperty('degree');
  });
  it('空教育列表保持空列表', () => {
    expect(educationProfile(createEmptyProfile()).education).toEqual([]);
  });
  it.each(['id', 'unknown', 'date', 'range', 'ongoing', 'duplicate', 'length'])('拒绝无效源教育契约：%s', change => {
    const original = profile(); const first = original.education[0]!;
    if (change === 'id') first.id = 'x'.repeat(201);
    if (change === 'unknown') Object.assign(first, { apiKey: 'fictional-forbidden-field' });
    if (change === 'date') first.startDate = '2026-02-30';
    if (change === 'range') { first.startDate = '2028-01'; first.endDateFact = undefined; first.endDate = '2027-06'; }
    if (change === 'ongoing') first.endDate = '2027-06';
    if (change === 'duplicate') original.education[1]!.id = first.id;
    if (change === 'length') original.education = Array.from({ length: 31 }, (_, index) => ({ id: 'fake-' + index, level: '本科' }));
    expect(() => educationProfile(original)).toThrow();
  });
  it('严格响应不接受基本信息和其他记录类型', () => {
    const data = educationProfile(profile());
    expect(educationProjectionResponseSchema.safeParse({ ...data, basic: { name: 'fictional' } }).success).toBe(false);
    expect(educationProjectionResponseSchema.safeParse({ ...data, recordType: 'project' }).success).toBe(false);
  });
});
