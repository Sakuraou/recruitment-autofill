import { afterEach, expect, it, vi } from 'vitest';
import { requestInternshipProjection } from '../src/content/profileProjectionClient';
import { internshipSessionProfile } from './fixtures/internship-session-page';
afterEach(() => vi.unstubAllGlobals());
it('固定空载荷实习请求校验返回，保留源顺序并冻结独立资料', async () => {
  const source = structuredClone(internshipSessionProfile);
  source.internships[0]!.endDateFact = { state: 'known', source: 'user', confirmed: true };
  const sendMessage = vi.fn(async () => ({ ok: true, data: source })); vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const result = await requestInternshipProjection();
  expect(sendMessage).toHaveBeenCalledWith({ type: 'RA_PROFILE_INTERNSHIP' });
  expect(result).toEqual(source); expect(result.internships[0]!.organization).toBe(source.internships[0]!.organization);
  expect(result.internships).not.toBe(source.internships); expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.internships)).toBe(true); expect(Object.isFrozen(result.internships[0])).toBe(true);
  expect(Object.isFrozen(result.internships[0]!.endDateFact)).toBe(true);
});
it.each(['envelope', 'type', 'duplicate', 'extra'])('实习响应%s无效时不进入页面会话', async mode => {
  const response = mode === 'envelope' ? { ok: false, error: '不得输出的详情' }
    : { ok: true, data: mode === 'type' ? { ...internshipSessionProfile, recordType: 'project' }
      : mode === 'extra' ? { ...internshipSessionProfile, basic: { name: '不得输出' } }
        : { ...internshipSessionProfile, internships: [internshipSessionProfile.internships[0], internshipSessionProfile.internships[0]] } };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => response) } });
  await expect(requestInternshipProjection()).rejects.toThrow(/实习档案投影/u);
});
