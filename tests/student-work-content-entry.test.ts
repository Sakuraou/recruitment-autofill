import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { studentWorkSessionProfile, installStudentWorkSessionPage } from './fixtures/student-work-session-page';
import { AGENT_OWNER_PORT } from '../src/content/agentOwnerPort';
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => boolean | undefined;
let listener: Listener; let page: ReturnType<typeof installStudentWorkSessionPage>;
let connections: ((port: chrome.runtime.Port) => void)[];
const source = { id: 'fictional-extension', url: 'chrome-extension://fictional-extension/popup.html' };
async function message(type: string, payload?: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  return new Promise(resolve => listener(payload === undefined ? { type } : { type, payload }, source, value => resolve(value as { ok: boolean; error?: string; data?: unknown })));
}
function rawMessage(request: unknown): Promise<{ ok: boolean; data?: unknown }> {
  return new Promise(resolve => listener(request, source, value => resolve(value as { ok: boolean; data?: unknown })));
}
function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return { addListener: (fn: (value: T) => void) => listeners.add(fn), removeListener: (fn: (value: T) => void) => listeners.delete(fn),
    emit: (value: T) => { for (const fn of [...listeners]) fn(value); } };
}
function owner() {
  const onMessage = event<unknown>(), onDisconnect = event<void>();
  const channel = { name: AGENT_OWNER_PORT, sender: source, onMessage, onDisconnect,
    postMessage: vi.fn(), disconnect: vi.fn(() => onDisconnect.emit(undefined)) };
  connections.forEach(handle => handle(channel as unknown as chrome.runtime.Port));
  onMessage.emit({ type: 'begin' });
  return { channel, token: channel.postMessage.mock.calls[0]?.[0]?.data?.token as string | undefined };
}
beforeEach(async () => {
  vi.resetModules(); delete window.__recruitmentAutofillInstalled; page = installStudentWorkSessionPage(document);
  connections = [];
  vi.stubGlobal('chrome', { runtime: { id: source.id, getURL: (path: string) => `chrome-extension://${source.id}/${path}`,
    onConnect: { addListener: (callback: (port: chrome.runtime.Port) => void) => { connections.push(callback); } }, onMessage: { addListener: (callback: Listener) => { listener = callback; } },
    sendMessage: vi.fn(async () => ({ ok: true, data: studentWorkSessionProfile })),
  } });
  await import('../src/content/index');
});

it('Agent 断开在档案加载中的校内职务，迟到投影不会新增或填写', async () => {
  const owned = owner(); expect(owned.token).toEqual(expect.any(String));
  let release!: (value: unknown) => void;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => new Promise(done => { release = done; }) as never);
  const pending = rawMessage({ type: 'RA_STUDENT_WORK_RECORD_START', agentRunToken: owned.token });
  expect((await message('RA_STUDENT_WORK_RECORD_STATUS')).data).toMatchObject({ state: { phase: 'preparing' } });
  owned.channel.disconnect();
  expect((await message('RA_STUDENT_WORK_RECORD_STATUS')).data).toMatchObject({ state: { phase: 'stopped' } });
  release({ ok: true, data: studentWorkSessionProfile }); await pending;
  expect(page.counts).toEqual({ add: 0, save: 0, submit: 0, remove: 0, cancel: 0 });
});
it('Agent 断开正在运行的校内职务并保留当前草稿，不继续保存', async () => {
  const owned = owner();
  expect((await rawMessage({ type: 'RA_STUDENT_WORK_RECORD_START', agentRunToken: owned.token })).ok).toBe(true);
  owned.channel.disconnect(); await new Promise(done => setTimeout(done, 120));
  expect((await message('RA_STUDENT_WORK_RECORD_STATUS')).data).toMatchObject({ state: { phase: 'stopped' } });
  expect(page.counts.save).toBe(0); expect(page.counts.submit).toBe(0);
});
it('独立校内职务占页时拒绝 Agent 所有权，断开失败连接不停止独立任务', async () => {
  await message('RA_STUDENT_WORK_RECORD_START'); const owned = owner();
  expect(owned.token).toBeUndefined(); expect(owned.channel.postMessage).toHaveBeenCalledWith({ ok: false, error: expect.any(String) });
  owned.channel.disconnect();
  expect((await message('RA_STUDENT_WORK_RECORD_STATUS')).data).toMatchObject({ state: { phase: 'running' } });
});
it.each(['START', 'RESUME'])('过期或伪造的 Agent token 不能 %s 校内职务', async operation => {
  const owned = owner(); owned.channel.disconnect();
  expect((await rawMessage({ type: `RA_STUDENT_WORK_RECORD_${operation}`, agentRunToken: owned.token })).ok).toBe(false);
  expect((await rawMessage({ type: `RA_STUDENT_WORK_RECORD_${operation}`, agentRunToken: crypto.randomUUID() })).ok).toBe(false);
  expect(page.counts.add).toBe(0); expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
it('Agent 正在占页时没有 token 的校内职务启动不能取事实或写页面', async () => {
  const owned = owner(); expect((await message('RA_STUDENT_WORK_RECORD_START')).ok).toBe(false);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled(); expect(page.counts.add).toBe(0); owned.channel.disconnect();
});
afterEach(async () => { await message('RA_STUDENT_WORK_RECORD_STOP'); await new Promise(done => setTimeout(done, 0));
  delete window.__recruitmentAutofillInstalled; document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('校内职务启动拒绝附带值/选择器，仅接受固定空消息', async () => {
  expect(await message('RA_STUDENT_WORK_RECORD_START', { selector: 'button', studentWork: studentWorkSessionProfile.studentWork })).toEqual({ ok: false, error: '无效的扩展请求' });
  expect(page.counts.add).toBe(0);
  expect((await message('RA_STUDENT_WORK_RECORD_START')).ok).toBe(true);
});
it.each(['RA_PROJECT_RECORD_START', 'RA_EDUCATION_RECORD_START', 'RA_INTERNSHIP_RECORD_START', 'RA_AWARD_RECORD_START', 'RA_PUBLICATION_RECORD_START', 'RA_WORKFLOW_RESUME', 'RA_RECORD_V2_START', 'RA_SCAN_SETTLED'])('校内职务运行占用页面时%s被拒绝，停止状态仍可查询', async type => {
  expect((await message('RA_STUDENT_WORK_RECORD_START')).ok).toBe(true);
  expect((await message(type)).ok).toBe(false);
  expect((await message('RA_STUDENT_WORK_RECORD_STATUS')).ok).toBe(true);
  expect((await message('RA_STUDENT_WORK_RECORD_STOP')).ok).toBe(true);
  expect(page.counts.save).toBe(0); expect(page.counts.submit).toBe(0);
});
it('外部 sender 的校内职务命令没有响应或页面动作', () => {
  const response = vi.fn(); expect(listener({ type: 'RA_STUDENT_WORK_RECORD_START' }, { ...source, id: 'foreign' }, response)).toBe(false);
  expect(response).not.toHaveBeenCalled(); expect(page.counts.add).toBe(0);
});
it('合作暂停等待本步结束、保持跨流程互斥，继续后仍可停止', async () => {
  await message('RA_STUDENT_WORK_RECORD_START'); expect((await message('RA_STUDENT_WORK_RECORD_PAUSE')).ok).toBe(true);
  await vi.waitFor(async () => {
    const status = await message('RA_STUDENT_WORK_RECORD_STATUS');
    expect(status.data).toMatchObject({ state: { phase: 'paused' } });
  });
  expect((await message('RA_PROJECT_RECORD_START')).ok).toBe(false); expect(page.counts.save).toBe(0);
  expect((await message('RA_STUDENT_WORK_RECORD_RESUME')).ok).toBe(true);
  expect((await message('RA_STUDENT_WORK_RECORD_STOP')).ok).toBe(true); expect(page.counts.save).toBe(0);
});

it('存在性准备期间原页面写入锁生效，Stop消息不必等待启动回复', async () => {
  page.list.hidden = true;
  const form = document.createElement('form');
  form.innerHTML = '<label>是否有校内职务<select><option value="">请选择</option><option value="y">是</option><option value="n">否</option></select></label>';
  page.list.before(form);
  let release!: (value: unknown) => void;
  const pending = new Promise(done => { release = done; });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => pending as never);
  const starting = message('RA_STUDENT_WORK_RECORD_START');
  const status = await message('RA_STUDENT_WORK_RECORD_STATUS');
  expect(status.data).toMatchObject({ state: { phase: 'preparing' } });
  for (const type of ['RA_PROJECT_RECORD_START', 'RA_EDUCATION_RECORD_START', 'RA_INTERNSHIP_RECORD_START', 'RA_AWARD_RECORD_START', 'RA_PUBLICATION_RECORD_START', 'RA_WORKFLOW_RESUME', 'RA_RECORD_V2_START', 'RA_SCAN_SETTLED']) {
    expect((await message(type)).ok).toBe(false);
  }
  expect((await message('RA_STUDENT_WORK_RECORD_STOP')).ok).toBe(true);
  release({ ok: true, data: studentWorkSessionProfile }); await starting;
  expect(form.querySelector<HTMLSelectElement>('select')!.value).toBe('');
  expect(page.counts).toEqual({ add: 0, save: 0, submit: 0, remove: 0, cancel: 0 });
});
