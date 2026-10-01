import { describe, expect, it } from 'vitest';
import { createEmptyProfile, parseProfileJson, profileSchema } from '../src/profile/schema';
import { projectProfile, projectProjectionResponseSchema } from '../src/profile/projection';
import { workflowRequestSchema } from '../src/workflow/model';

describe('档案日历与精度', () => {
  it.each(['2026-02-30', '2025-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '2026-00', '2026-13']) (
    '导入拒绝非法日期 %s，不能把格式正确当成日历有效', date => {
      const profile = createEmptyProfile(); profile.basic.birthday = date;
      expect(() => parseProfileJson(JSON.stringify(profile))).toThrow();
    });

  it.each(['', '2026-02', '2024-02-29', '2000-02-29', '0099-12-31', '0001-01-01']) (
    '保留合法原值与精度 %s', date => {
      const profile = createEmptyProfile(); profile.basic.birthday = date;
      expect(parseProfileJson(JSON.stringify(profile)).basic.birthday).toBe(date);
    });

  it('所有单日期与经历日期复用校验，不能只保护出生日期', () => {
    const profile = createEmptyProfile();
    profile.education = [{ id: 'e', level: '本科', startDate: '2026-02-30' }];
    profile.projects = [{ id: 'p', endDate: '2026-02-30', technologies: [] }];
    profile.internships = [{ id: 'i', startDate: '2026-02-30' }];
    profile.studentWork = [{ id: 's', endDate: '2026-02-30' }];
    profile.research.papers = [{ id: 'r', date: '2026-02-30' }];
    profile.research.patents = [{ id: 't', date: '2026-02-30' }];
    profile.awards = [{ id: 'a', date: '2026-02-30' }];
    profile.certificates = [{ id: 'c', date: '2026-02-30' }];
    profile.family = [{ id: 'f', birthday: '2026-02-30' }];
    const result = profileSchema.safeParse(profile); expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.path.join('.')).sort()).toEqual([
      'education.0.startDate', 'projects.0.endDate', 'internships.0.startDate', 'studentWork.0.endDate',
      'research.papers.0.date', 'research.patents.0.date', 'awards.0.date', 'certificates.0.date', 'family.0.birthday',
    ].sort());
  });

  it.each([
    ['2026-06-30', '2026-06-01'], ['2026-10', '2026-09-30'], ['2026-10-01', '2026-09'],
  ])('各经历拒绝必然倒置 %s 到 %s，包括不同精度', (startDate, endDate) => {
    const profile = createEmptyProfile();
    profile.education = [{ id: 'e', level: '本科', startDate, endDate }];
    profile.projects = [{ id: 'p', startDate, endDate, technologies: [] }];
    profile.internships = [{ id: 'i', startDate, endDate }];
    profile.studentWork = [{ id: 's', startDate, endDate }];
    const result = profileSchema.safeParse(profile); expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.path.join('.')).sort()).toEqual([
      'education.0.endDate', 'projects.0.endDate', 'internships.0.endDate', 'studentWork.0.endDate',
    ].sort());
  });

  it.each([
    ['2026-09', '2026-09-01'], ['2026-09-30', '2026-09'], ['2026-09', '2026-09'], ['', '2026-09'],
  ])('月份范围仍可能一致时保留，不补造具体日 %s 到 %s', (startDate, endDate) => {
    const profile = createEmptyProfile(); profile.projects = [{ id: 'p', startDate, endDate, technologies: [] }];
    expect(parseProfileJson(JSON.stringify(profile)).projects[0]).toEqual(profile.projects[0]);
  });

  it('最小项目投影与移动请求不能绕过同一日期契约', () => {
    const profile = createEmptyProfile();
    profile.projects = [{ id: 'p', startDate: '2026-02-30', technologies: [] }];
    expect(projectProjectionResponseSchema.safeParse(projectProfile(profile)).success).toBe(false);
    expect(workflowRequestSchema.safeParse({ education: [], projects: profile.projects }).success).toBe(false);
    profile.projects[0]!.startDate = '2026-06-30'; profile.projects[0]!.endDate = '2026-06';
    expect(projectProjectionResponseSchema.safeParse(projectProfile(profile)).success).toBe(true);
    profile.projects[0]!.endDate = '2026-05';
    expect(projectProjectionResponseSchema.safeParse(projectProfile(profile)).success).toBe(false);
  });
});
