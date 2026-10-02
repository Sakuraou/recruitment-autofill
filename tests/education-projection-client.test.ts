import { afterEach, expect, it, vi } from 'vitest';
import { requestEducationProjection } from '../src/content/profileProjectionClient';
import { educationSessionProfile } from './fixtures/education-session-page';
afterEach(() => vi.unstubAllGlobals());
it('固定空载荷教育请求校验返回，保留硕士在前并冻结独立资料', async () => {
  const source = structuredClone(educationSessionProfile);
  source.education[0]!.endDateFact = { state: 'known', source: 'user', confirmed: true };
  const sendMessage = vi.fn(async () => ({ ok: true, data: source })); vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const result = await requestEducationProjection();
  expect(sendMessage).toHaveBeenCalledWith({ type: 'RA_PROFILE_EDUCATION' });
  expect(result).toEqual(source); expect(result.education[0]!.level).toBe('硕士研究生');
  expect(result.education).not.toBe(source.education); expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.education)).toBe(true); expect(Object.isFrozen(result.education[0])).toBe(true);
  expect(Object.isFrozen(result.education[0]!.endDateFact)).toBe(true);
});
it.each(['envelope', 'type', 'duplicate', 'extra'])('教育响应%s无效时不进入页面会话', async mode => {
  const response = mode === 'envelope' ? { ok: false, error: '不得输出的详情' }
    : { ok: true, data: mode === 'type' ? { ...educationSessionProfile, recordType: 'project' }
      : mode === 'extra' ? { ...educationSessionProfile, basic: { name: '不得输出' } }
        : { ...educationSessionProfile, education: [educationSessionProfile.education[0], educationSessionProfile.education[0]] } };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => response) } });
  await expect(requestEducationProjection()).rejects.toThrow(/教育档案投影/u);
});
