import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentResponse, ScanResult } from '../src/shared/types';

type MessageListener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (response: ContentResponse<unknown>) => void) => boolean | undefined;
let listener: MessageListener;
const extensionId = 'recruitment-autofill-test';
const sender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
const addListener = vi.fn((callback: MessageListener) => { listener = callback; });

beforeEach(async () => {
  vi.resetModules();
  addListener.mockClear();
  document.body.innerHTML = '<label>姓名<input></label>';
  delete window.__recruitmentAutofillInstalled;
  vi.stubGlobal('chrome', { runtime: {
    id: extensionId,
    getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
    onMessage: { addListener },
  } });
  await import('../src/content/index');
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Content Script 消息入口', () => {
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
