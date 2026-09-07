import { describe, expect, it } from 'vitest';
import { createEmptyProfile, parseProfileJson, profileSchema } from '../src/profile/schema';

describe('档案格式', () => {
  it('空档案不填入任何假个人信息，并可无损往返', () => {
    const profile = createEmptyProfile();
    expect(profile.basic).toEqual({});
    expect(parseProfileJson(JSON.stringify(profile))).toEqual(profile);
  });
  it('拒绝错误字段和未来版本，避免静默丢数据', () => {
    expect(profileSchema.safeParse({ ...createEmptyProfile(), schemaVersion: 2 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...createEmptyProfile(), surprise: 'data' }).success).toBe(false);
  });
  it('学历和学位独立，字数版本可扩展', () => {
    const profile = createEmptyProfile();
    profile.education.push({ id: 'education-1', level: '硕士研究生', degree: '工程硕士' });
    profile.commonAnswers.selfEvaluation = { byLimit: { '50': '真实内容', '500': '用户维护的完整内容' } };
    expect(profileSchema.safeParse(profile).success).toBe(true);
  });
});
