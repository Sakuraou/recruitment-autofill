import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { awardSessionProfile, installAwardSessionPage } from './fixtures/award-session-page';
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => boolean | undefined;
let listener: Listener; let page: ReturnType<typeof installAwardSessionPage>;
const source = { id: 'fictional-extension', url: 'chrome-extension://fictional-extension/popup.html' };
async function message(type: string, payload?: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  return new Promise(resolve => listener(payload === undefined ? { type } : { type, payload }, source, value => resolve(value as { ok: boolean; error?: string; data?: unknown })));
}
beforeEach(async () => {
  vi.resetModules(); delete window.__recruitmentAutofillInstalled; page = installAwardSessionPage(document);
  vi.stubGlobal('chrome', { runtime: { id: source.id, getURL: (path: string) => `chrome-extension://${source.id}/${path}`,
    onConnect: { addListener: vi.fn() }, onMessage: { addListener: (callback: Listener) => { listener = callback; } },
    sendMessage: vi.fn(async () => ({ ok: true, data: awardSessionProfile })),
  } });
  await import('../src/content/index');
});
afterEach(async () => { await message('RA_AWARD_RECORD_STOP'); await new Promise(done => setTimeout(done, 0));
  delete window.__recruitmentAutofillInstalled; document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('奖励启动拒绝附带值/选择器，仅接受固定空消息', async () => {
  expect(await message('RA_AWARD_RECORD_START', { selector: 'button', awards: awardSessionProfile.awards })).toEqual({ ok: false, error: '无效的扩展请求' });
  expect(page.counts.add).toBe(0);
  expect((await message('RA_AWARD_RECORD_START')).ok).toBe(true);
});
it.each(['RA_PROJECT_RECORD_START', 'RA_EDUCATION_RECORD_START', 'RA_WORKFLOW_RESUME', 'RA_RECORD_V2_START', 'RA_SCAN_SETTLED'])('奖励运行占用页面时%s被拒绝，停止状态仍可查询', async type => {
  expect((await message('RA_AWARD_RECORD_START')).ok).toBe(true);
  expect((await message(type)).ok).toBe(false);
  expect((await message('RA_AWARD_RECORD_STATUS')).ok).toBe(true);
  expect((await message('RA_AWARD_RECORD_STOP')).ok).toBe(true);
  expect(page.counts.save).toBe(0); expect(page.counts.submit).toBe(0);
});
it('外部 sender 的奖励命令没有响应或页面动作', () => {
  const response = vi.fn(); expect(listener({ type: 'RA_AWARD_RECORD_START' }, { ...source, id: 'foreign' }, response)).toBe(false);
  expect(response).not.toHaveBeenCalled(); expect(page.counts.add).toBe(0);
});
it('合作暂停等待本步结束、保持跨流程互斥，继续后仍可停止', async () => {
  await message('RA_AWARD_RECORD_START'); expect((await message('RA_AWARD_RECORD_PAUSE')).ok).toBe(true);
  await vi.waitFor(async () => {
    const status = await message('RA_AWARD_RECORD_STATUS');
    expect(status.data).toMatchObject({ state: { phase: 'paused' } });
  });
  expect((await message('RA_PROJECT_RECORD_START')).ok).toBe(false); expect(page.counts.save).toBe(0);
  expect((await message('RA_AWARD_RECORD_RESUME')).ok).toBe(true);
  expect((await message('RA_AWARD_RECORD_STOP')).ok).toBe(true); expect(page.counts.save).toBe(0);
});

it('存在性准备期间原页面写入锁生效，Stop消息不必等待启动回复', async () => {
  page.list.hidden = true;
  const form = document.createElement('form');
  form.innerHTML = '<label>是否有奖励经历<select><option value="">请选择</option><option value="y">是</option><option value="n">否</option></select></label>';
  page.list.before(form);
  let release!: (value: unknown) => void;
  const pending = new Promise(done => { release = done; });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => pending as never);
  const starting = message('RA_AWARD_RECORD_START');
  const status = await message('RA_AWARD_RECORD_STATUS');
  expect(status.data).toMatchObject({ state: { phase: 'preparing' } });
  for (const type of ['RA_PROJECT_RECORD_START', 'RA_EDUCATION_RECORD_START', 'RA_WORKFLOW_RESUME', 'RA_RECORD_V2_START', 'RA_SCAN_SETTLED']) {
    expect((await message(type)).ok).toBe(false);
  }
  expect((await message('RA_AWARD_RECORD_STOP')).ok).toBe(true);
  release({ ok: true, data: awardSessionProfile }); await starting;
  expect(form.querySelector<HTMLSelectElement>('select')!.value).toBe('');
  expect(page.counts).toEqual({ add: 0, save: 0, submit: 0, remove: 0, cancel: 0 });
});
