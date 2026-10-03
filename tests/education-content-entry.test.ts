import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { educationSessionProfile, installEducationSessionPage } from './fixtures/education-session-page';
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => boolean | undefined;
let listener: Listener; let page: ReturnType<typeof installEducationSessionPage>;
const source = { id: 'fictional-extension', url: 'chrome-extension://fictional-extension/popup.html' };
async function message(type: string, payload?: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  return new Promise(resolve => listener(payload === undefined ? { type } : { type, payload }, source, value => resolve(value as { ok: boolean; error?: string; data?: unknown })));
}
beforeEach(async () => {
  vi.resetModules(); delete window.__recruitmentAutofillInstalled; page = installEducationSessionPage(document);
  vi.stubGlobal('chrome', { runtime: { id: source.id, getURL: (path: string) => `chrome-extension://${source.id}/${path}`,
    onConnect: { addListener: vi.fn() }, onMessage: { addListener: (callback: Listener) => { listener = callback; } },
    sendMessage: vi.fn(async () => ({ ok: true, data: educationSessionProfile })),
  } });
  await import('../src/content/index');
});
afterEach(async () => { await message('RA_EDUCATION_RECORD_STOP'); await new Promise(done => setTimeout(done, 0));
  delete window.__recruitmentAutofillInstalled; document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('教育启动拒绝附带值/选择器，仅接受固定空消息', async () => {
  expect(await message('RA_EDUCATION_RECORD_START', { selector: 'button', education: educationSessionProfile.education })).toEqual({ ok: false, error: '无效的扩展请求' });
  expect(page.counts.add).toBe(0);
  expect((await message('RA_EDUCATION_RECORD_START')).ok).toBe(true);
});
it.each(['RA_PROJECT_RECORD_START', 'RA_INTERNSHIP_RECORD_START', 'RA_WORKFLOW_RESUME', 'RA_RECORD_V2_START', 'RA_SCAN_SETTLED'])('教育运行占用页面时%s被拒绝，停止状态仍可查询', async type => {
  expect((await message('RA_EDUCATION_RECORD_START')).ok).toBe(true);
  expect((await message(type)).ok).toBe(false);
  expect((await message('RA_EDUCATION_RECORD_STATUS')).ok).toBe(true);
  expect((await message('RA_EDUCATION_RECORD_STOP')).ok).toBe(true);
  expect(page.counts.save).toBe(0); expect(page.counts.submit).toBe(0);
});
it('外部 sender 的教育命令没有响应或页面动作', () => {
  const response = vi.fn(); expect(listener({ type: 'RA_EDUCATION_RECORD_START' }, { ...source, id: 'foreign' }, response)).toBe(false);
  expect(response).not.toHaveBeenCalled(); expect(page.counts.add).toBe(0);
});
it('合作暂停等待本步结束、保持跨流程互斥，继续后仍可停止', async () => {
  await message('RA_EDUCATION_RECORD_START'); expect((await message('RA_EDUCATION_RECORD_PAUSE')).ok).toBe(true);
  await vi.waitFor(async () => {
    const status = await message('RA_EDUCATION_RECORD_STATUS');
    expect(status.data).toMatchObject({ state: { phase: 'paused' } });
  });
  expect((await message('RA_PROJECT_RECORD_START')).ok).toBe(false); expect(page.counts.save).toBe(0);
  expect((await message('RA_EDUCATION_RECORD_RESUME')).ok).toBe(true);
  expect((await message('RA_EDUCATION_RECORD_STOP')).ok).toBe(true); expect(page.counts.save).toBe(0);
});
