import { describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { internshipProfile, internshipProjectionResponseSchema } from '../src/profile/internshipProjection';
import { firstInternship, secondInternship } from './fixtures/internship-facts';

function profile() {
  const result = createEmptyProfile(); result.revision = 'fictional-internship-revision';
  result.basic.name = '不得返回的虚构本人姓名'; result.basic.phone = '不得返回的虚构手机号';
  result.studentWork = [{ id: 'student', organization: '不得返回的虚构校内组织' }];
  result.projects = [{ id: 'project', name: '不得返回的虚构项目', technologies: [] }];
  result.internships = [{ ...firstInternship, certifierName: '不得返回的虚构证明人', certifierContact: '不得返回的虚构联系号码',
    certifierCompany: '不得返回的虚构证明单位', certifierDuty: '不得返回的虚构证明职务', certifierRelation: '不得返回的虚构关系',
    cadreLevel: '不得返回的虚构干部级别', shortDuties: '不得返回的虚构校内简述' }, { ...secondInternship }];
  return result;
}
describe('内部最小实习投影', () => {
  it('按源顺序保留两条原事实，排除本人、其他集合与证明联系人', () => {
    const original = profile(); const data = internshipProfile(original);
    expect(data).toEqual({ recordType: 'internship', profileRevision: original.revision, internships: [firstInternship, secondInternship] });
    expect(JSON.stringify(data)).not.toContain('不得返回');
    expect(internshipProjectionResponseSchema.safeParse(data).success).toBe(true);
  });
  it('条目与嵌套日期状态独立冻结，源记录改变不污染快照', () => {
    const original = profile(); original.internships[1]!.endDate = undefined;
    original.internships[1]!.endDateFact = { state: 'ongoing', source: 'user', confirmed: true };
    const data = internshipProfile(original); const second = data.internships[1]!;
    expect(Object.isFrozen(data)).toBe(true); expect(Object.isFrozen(data.internships)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true); expect(Object.isFrozen(second.endDateFact)).toBe(true);
    original.internships[1]!.organization = '另一个虚构公司'; original.internships[1]!.endDateFact!.confirmed = false;
    expect(second.organization).toBe(secondInternship.organization); expect(second.endDateFact!.confirmed).toBe(true);
  });
  it('不添补缺失的公司、岗位、工作描述、类型、月薪或证明状态', () => {
    const original = profile(); original.internships = [{ id: 'fictional-empty' }];
    expect(internshipProfile(original).internships).toEqual([{ id: 'fictional-empty' }]);
  });
  it('旧档案沿用更新时间而不生成修订或事实', () => {
    const original = profile(); original.revision = undefined; original.updatedAt = '2026-10-03T00:00:00.000Z';
    expect(internshipProfile(original).profileRevision).toBe(original.updatedAt);
  });
  it('空集合保持空，不把校内职务或项目转成实习', () => {
    const original = profile(); original.internships = [];
    expect(internshipProfile(original).internships).toEqual([]);
  });
  it.each(['id', 'duplicate', 'length', 'unknown', 'date', 'range', 'ongoing', 'known', 'proof', 'text'])('拒绝无效源契约：%s', change => {
    const original = profile(); const first = original.internships[0]!;
    if (change === 'id') first.id = 'x'.repeat(201);
    if (change === 'duplicate') original.internships[1]!.id = first.id;
    if (change === 'length') original.internships = Array.from({ length: 101 }, (_, index) => ({ id: 'fake-' + index }));
    if (change === 'unknown') Object.assign(first, { apiKey: 'fictional-forbidden-field' });
    if (change === 'date') first.startDate = '2025-02-30';
    if (change === 'range') first.startDate = '2026-01-01';
    if (change === 'ongoing') first.endDateFact = { state: 'ongoing', source: 'user', confirmed: true };
    if (change === 'known') { first.endDate = undefined; first.endDateFact = { state: 'known', source: 'user', confirmed: true }; }
    if (change === 'proof') Object.assign(first, { hasProof: '未知' });
    if (change === 'text') first.description = 'x'.repeat(20_001);
    expect(() => internshipProfile(original)).toThrow();
  });
  it.each(['basic', 'projects', 'recordType', 'certifierContact'])('严格响应拒绝额外范围：%s', key => {
    const data = internshipProfile(profile());
    const altered = key === 'certifierContact' ? { ...data, internships: [{ ...firstInternship, certifierContact: 'fictional' }] }
      : { ...data, [key]: key === 'recordType' ? 'project' : {} };
    expect(internshipProjectionResponseSchema.safeParse(altered).success).toBe(false);
  });
});
