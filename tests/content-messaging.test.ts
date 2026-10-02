import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentResponse, ScanResult } from '../src/shared/types';
import { PAGE_OPERATION_PORT } from '../src/shared/pageOperationProtocol';

type MessageListener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (response: ContentResponse<unknown>) => void) => boolean | undefined;
let listener: MessageListener;
let portListener: (port: chrome.runtime.Port) => void;
const extensionId = 'recruitment-autofill-test';
const sender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
const addListener = vi.fn((callback: MessageListener) => { listener = callback; });
function testPort() {
  const messages = new Set<(value: unknown) => void>(); const disconnects = new Set<() => void>();
  const port = { name: PAGE_OPERATION_PORT, sender,
    onMessage: { addListener: (fn: (value: unknown) => void) => messages.add(fn), removeListener: (fn: (value: unknown) => void) => messages.delete(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnects.add(fn), removeListener: (fn: () => void) => disconnects.delete(fn) },
    postMessage: vi.fn(), disconnect: () => { for (const fn of [...disconnects]) fn(); },
  };
  portListener(port as unknown as chrome.runtime.Port);
  return { port, send: (value: unknown) => { for (const fn of [...messages]) fn(value); } };
}

beforeEach(async () => {
  vi.resetModules();
  addListener.mockClear();
  document.body.innerHTML = '<label>姓名<input></label>';
  delete window.__recruitmentAutofillInstalled;
  vi.stubGlobal('chrome', { runtime: {
    id: extensionId,
    getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
    onMessage: { addListener }, onConnect: { addListener: (fn: (port: chrome.runtime.Port) => void) => { portListener = fn; } },
  } });
  await import('../src/content/index');
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Content Script 消息入口', () => {
  it('真实入口的端口与消息共享占用锁；断开中止后续字段并使扫描失效', async () => {
    document.body.innerHTML = '<label>姓名<input></label><label>手机号<input></label>';
    const response = vi.fn(); listener({ type: 'RA_SCAN' }, sender, response);
    const scanned = response.mock.calls[0]![0] as { ok: true; data: ScanResult };
    const p = testPort(); let laterWrites = 0;
    document.querySelectorAll('input')[0]!.addEventListener('input', () => p.port.disconnect());
    document.querySelectorAll('input')[1]!.addEventListener('input', () => laterWrites++);
    p.send({ type: 'RA_FILL', payload: { scanId: scanned.data.scanId,
      items: scanned.data.fields.map(field => ({ fieldId: field.id, value: '虚构内容', confirmed: true })) } });
    response.mockClear(); listener({ type: 'RA_SCAN' }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false, error: '正在填写，请等待完成后再操作' });
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    listener({ type: 'RA_FILL', payload: { scanId: scanned.data.scanId, items: [] } }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false, error: '请先扫描当前页面' });
    expect(laterWrites).toBe(0); expect(p.port.postMessage).not.toHaveBeenCalled();
    listener({ type: 'RA_SCAN' }, sender, response); expect(response).toHaveBeenLastCalledWith({ ok: true, data: expect.any(Object) });
  });

  it('取消稳定扫描后零新快照，旧扫描不能用于后续填写', async () => {
    const response = vi.fn(); listener({ type: 'RA_SCAN' }, sender, response);
    const p = testPort(); p.send({ type: 'RA_SCAN_SETTLED' }); p.port.disconnect();
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    listener({ type: 'RA_FILL', payload: { scanId: 'old', items: [] } }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false, error: '请先扫描当前页面' }); expect(p.port.postMessage).not.toHaveBeenCalled();
  });
  it('重复注入不会重复注册监听器', async () => {
    vi.resetModules();
    await import('../src/content/index');
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it('拒绝第三方扩展或同扩展网页 content script 发来的命令', () => {
    const response = vi.fn();
    expect(listener({ type: 'RA_SCAN' }, { ...sender, id: 'other' }, response)).toBe(false);
    expect(listener({ type: 'RA_SCAN' }, { ...sender, url: 'https://recruitment.example/' }, response)).toBe(false);
    expect(listener({ type: 'RA_SCAN' }, { id: extensionId }, response)).toBe(false);
    expect(response).not.toHaveBeenCalled();
  });

  it('拒绝格式不合规请求及尚未扫描的填写', () => {
    const response = vi.fn();
    listener({ type: 'RA_FILL', payload: { scanId: 'x', items: [{ fieldId: 'x', value: '真实值' }] } }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false, error: '无效的扩展请求' });
    listener({ type: 'RA_FILL', payload: { scanId: 'x', items: [] } }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false, error: '请先扫描当前页面' });
  });

  it('多记录入口默认关闭，且拒绝外部注入档案或执行参数', () => {
    const response = vi.fn();
    listener({ type: 'RA_RECORD_V2_STATUS' }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: true, data: {
      version: expect.any(String),
      state: { enabled: false, state: 'disabled', snapshotVersion: 0 },
    } });

    listener({ type: 'RA_RECORD_V2_START', payload: { profile: { name: '伪造档案' }, selector: '#submit' } },
      sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false, error: '无效的扩展请求' });

    listener({ type: 'RA_RECORD_V2_START' }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false, error: '通用多记录填写功能尚未启用' });
  });

  it('项目试用只接受空载荷，并返回无个人值的可用性状态', () => {
    const response = vi.fn();
    listener({ type: 'RA_PROJECT_RECORD_STATUS' }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: true, data: { version: expect.any(String),
      state: { phase: 'idle', total: 0, canStart: false, reason: 'record-list-unverified' } } });
    listener({ type: 'RA_PROJECT_RECORD_START', payload: { selector: '#submit', profile: {} } }, sender, response);
    expect(response).toHaveBeenLastCalledWith({ ok: false, error: '无效的扩展请求' });
    response.mockClear();
    listener({ type: 'RA_PROJECT_RECORD_START' }, { ...sender, url: 'https://untrusted.example/' }, response);
    expect(response).not.toHaveBeenCalled();
  });

  it('扫描只返回可序列化描述，随后填写对应的内存节点', async () => {
    const response = vi.fn();
    listener({ type: 'RA_SCAN' }, sender, response);
    const scanResponse = response.mock.calls[0]?.[0] as ContentResponse<ScanResult>;
    expect(scanResponse.ok).toBe(true);
    if (!scanResponse.ok) throw new Error('扫描失败');
    expect(JSON.stringify(scanResponse)).not.toContain('controls');
    const result = await new Promise<ContentResponse<unknown>>((resolve) => {
      expect(listener({ type: 'RA_FILL', payload: {
        scanId: scanResponse.data.scanId,
        items: [{ fieldId: scanResponse.data.fields[0]!.id, value: '真实姓名', confirmed: true }],
      } }, sender, resolve)).toBe(true);
    });
    expect(result).toMatchObject({ ok: true, data: [{ status: 'filled' }] });
    expect(document.querySelector('input')?.value).toBe('真实姓名');
  });
});
