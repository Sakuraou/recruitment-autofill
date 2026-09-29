import { describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { projectProfile, projectProjectionResponseSchema } from '../src/profile/projection';

describe('可信档案投影', () => {
  it('只返回项目记录和档案修订，不返回 basic 或其他集合', () => {
    const profile = createEmptyProfile();
    profile.updatedAt = '2026-09-29T00:00:00.000Z';
    profile.basic.name = '不应跨边界的姓名';
    profile.projects.push({ id: 'project-1', name: '项目甲', role: '开发成员', technologies: ['TypeScript'] });
    profile.internships.push({ id: 'internship-1', organization: '公司甲', role: '实习生' });

    const projection = projectProfile(profile);
    expect(projection).toEqual({ recordType: 'project', profileRevision: profile.updatedAt,
      projects: [{ id: 'project-1', name: '项目甲', role: '开发成员', technologies: ['TypeScript'] }] });
    expect(JSON.stringify(projection)).not.toContain('不应跨边界的姓名');
    expect(JSON.stringify(projection)).not.toContain('公司甲');
    expect(projectProjectionResponseSchema.safeParse(projection).success).toBe(true);
  });

  it('投影是冻结的，不能由调用方修改内部数组', () => {
    const profile = createEmptyProfile();
    profile.projects.push({ id: 'project-1', name: '项目甲', technologies: [] });
    const projection = projectProfile(profile);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.projects)).toBe(true);
  });
});
