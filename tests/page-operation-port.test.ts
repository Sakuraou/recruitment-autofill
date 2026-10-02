import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPageOperationPortHandler } from '../src/content/pageOperationPort';
import { fillPageCancelable, scanPageCancelable } from '../src/popup/pageOperationClient';
import { PAGE_OPERATION_DEADLINE_MS, PAGE_OPERATION_PORT, type PageOperation } from '../src/shared/pageOperationProtocol';
import { scanDocument } from '../src/content/scanner';

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return { listeners, addListener: (fn: (value: T) => void) => listeners.add(fn),
    removeListener: (fn: (value: T) => void) => listeners.delete(fn), emit: (value: T) => { for (const fn of [...listeners]) fn(value); } };
}
function channel(sender: Partial<chrome.runtime.MessageSender> = {}) {
  const onMessage = event<unknown>(); const onDisconnect = event<void>();
  const value = { name: PAGE_OPERATION_PORT, sender: { id: 'fictional-extension', url: 'chrome-extension://fictional-extension/popup.html', ...sender },
    onMessage, onDisconnect, postMessage: vi.fn(), disconnect: vi.fn(() => onDisconnect.emit(undefined)) };
  return { value, port: value as unknown as chrome.runtime.Port };
}
const request = { type: 'RA_FILL' as const, payload: { scanId: 'scan-fictional', items: [{ fieldId: 'field-fictional', value: '虚构答案', confirmed: true }] } };
const result = [{ fieldId: 'field-fictional', status: 'filled' as const, reason: '已核验' }];
function fixture() {
  let occupied = false; let release!: (value: unknown) => void;
  const done = new Promise(resolve => { release = resolve; });
  const execute = vi.fn<(request: PageOperation, signal: AbortSignal) => Promise<unknown>>(() => done); const invalidate = vi.fn();
  const released = vi.fn(() => { occupied = false; });
  const acquire = vi.fn(() => { if (occupied) throw new Error('busy'); occupied = true; return released; });
  const handle = createPageOperationPortHandler({ extensionId: 'fictional-extension',
    extensionUrl: path => `chrome-extension://fictional-extension/${path}`, acquire, invalidate, execute });
  const port = channel(); handle(port.port);
  return { handle, port, execute, invalidate, acquire, released, release, occupied: () => occupied };
}
beforeEach(() => { vi.stubGlobal('chrome', { runtime: {} }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it.each(['other', 'website', 'content', 'missing-url', 'missing-id'] as const)('拒绝%s端口来源，零页面占用和执行', mode => {
  const s = fixture(); s.port.value.disconnect();
  const p = channel(mode === 'other' ? { id: 'other' } : mode === 'website' ? { url: 'https://example.test/popup.html' }
    : mode === 'content' ? { url: 'chrome-extension://fictional-extension/content.js' } : mode === 'missing-url' ? { url: undefined } : { id: undefined });
  s.handle(p.port); p.value.onMessage.emit(request);
  expect(p.value.disconnect).toHaveBeenCalledOnce(); expect(s.acquire).not.toHaveBeenCalled(); expect(s.execute).not.toHaveBeenCalled();
});
it.each(['unknown', 'extra', 'invalid-item', 'oversized'] as const)('拒绝%s请求且不开始填写', mode => {
  const s = fixture(); const body = mode === 'unknown' ? { type: 'RA_SUBMIT' } : mode === 'extra' ? { ...request, selector: '#submit' }
    : mode === 'invalid-item' ? { ...request, payload: { ...request.payload, items: [{ ...request.payload.items[0], confirmed: 'yes' }] } }
      : { ...request, payload: { ...request.payload, items: Array.from({ length: 7 }, () => ({ ...request.payload.items[0], value: '长'.repeat(50_000) })) } };
  s.port.value.onMessage.emit(body); expect(s.execute).not.toHaveBeenCalled(); expect(s.acquire).not.toHaveBeenCalled();
  expect(s.port.value.postMessage).toHaveBeenCalledWith({ ok: false, error: expect.any(String) });
});
it('断开取消等待，但占用锁到实际批次结束才释放；迟到结果不发送', async () => {
  const s = fixture(); s.port.value.onMessage.emit(request); const signal = s.execute.mock.calls[0]![1];
  s.port.value.disconnect(); expect(signal.aborted).toBe(true); expect(s.occupied()).toBe(true); expect(s.invalidate).toHaveBeenCalledOnce();
  const next = channel(); s.handle(next.port); next.value.onMessage.emit(request);
  expect(s.execute).toHaveBeenCalledOnce(); expect(next.value.postMessage).toHaveBeenCalledWith({ ok: false, error: expect.any(String) });
  s.release(result); await Promise.resolve(); await Promise.resolve();
  expect(s.occupied()).toBe(false); expect(s.released).toHaveBeenCalledOnce(); expect(s.port.value.postMessage).not.toHaveBeenCalled();
  const fresh = channel(); s.handle(fresh.port); fresh.value.onMessage.emit(request); await Promise.resolve(); await Promise.resolve();
  expect(s.execute).toHaveBeenCalledTimes(2); expect(fresh.value.postMessage).toHaveBeenCalledWith({ ok: true, data: result });
  s.port.value.onDisconnect.emit(undefined); expect(s.invalidate).toHaveBeenCalledOnce();
});
it('重复端口请求取消原批次，零第二次执行和零迟到成功', async () => {
  const s = fixture(); s.port.value.onMessage.emit(request); s.port.value.onMessage.emit(request);
  expect(s.execute).toHaveBeenCalledOnce(); expect(s.execute.mock.calls[0]![1].aborted).toBe(true);
  s.release(result); await Promise.resolve(); await Promise.resolve();
  expect(s.port.value.postMessage).toHaveBeenCalledOnce(); expect(s.port.value.postMessage).toHaveBeenCalledWith({ ok: false, error: expect.any(String) });
});
it('超时取消正在执行的批次，实际结束之前不能释放占用', async () => {
  vi.useFakeTimers(); const s = fixture(); s.port.value.onMessage.emit(request);
  await vi.advanceTimersByTimeAsync(PAGE_OPERATION_DEADLINE_MS);
  expect(s.execute.mock.calls[0]![1].aborted).toBe(true); expect(s.occupied()).toBe(true);
  expect(s.port.value.onMessage.listeners.size).toBe(0); expect(s.port.value.onDisconnect.listeners.size).toBe(0);
  s.release(result); await Promise.resolve(); await Promise.resolve(); expect(s.occupied()).toBe(false);
  expect(s.port.value.postMessage).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('八个未发请求的连接有界，断开不清除当前扫描，超时清理连接', async () => {
  vi.useFakeTimers(); const s = fixture(); const rest = Array.from({ length: 7 }, () => channel()); rest.forEach(p => s.handle(p.port));
  const ninth = channel(); s.handle(ninth.port); expect(ninth.value.disconnect).toHaveBeenCalledOnce();
  s.port.value.disconnect(); expect(s.invalidate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(PAGE_OPERATION_DEADLINE_MS);
  expect(vi.getTimerCount()).toBe(0); expect(s.execute).not.toHaveBeenCalled(); expect(s.invalidate).not.toHaveBeenCalled();
});

function client() {
  const p = channel(); const connect = vi.fn(() => p.port);
  vi.stubGlobal('chrome', { tabs: { connect }, runtime: {} }); return { ...p, connect };
}
it('预取消的客户端零连接', async () => {
  const p = client(); const controller = new AbortController(); controller.abort();
  await expect(fillPageCancelable(12, request.payload, controller.signal)).rejects.toThrow('停止'); expect(p.connect).not.toHaveBeenCalled();
});
it('连接建立的同步间隙取消，零请求且关闭端口', async () => {
  const p = client(); const controller = new AbortController(); p.connect.mockImplementation(() => { controller.abort(); return p.port; });
  await expect(fillPageCancelable(12, request.payload, controller.signal)).rejects.toThrow('停止'); expect(p.value.postMessage).not.toHaveBeenCalled();
  expect(p.value.disconnect).toHaveBeenCalledOnce();
});
it('客户端取消移除资源，迟到回复不能返回成功', async () => {
  vi.useFakeTimers(); const p = client(); const controller = new AbortController();
  const pending = fillPageCancelable(12, request.payload, controller.signal); const rejection = expect(pending).rejects.toThrow('停止');
  controller.abort(); p.value.onMessage.emit({ ok: true, data: result }); await rejection;
  expect(p.value.disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); expect(p.value.onMessage.listeners.size).toBe(0);
});
it.each(['wrong-field', 'extra-field', 'extra-property', 'invalid-status'] as const)('客户端拒绝%s结果并不重试', async mode => {
  const p = client(); const controller = new AbortController(); const pending = fillPageCancelable(12, request.payload, controller.signal);
  const data = mode === 'wrong-field' ? [{ ...result[0], fieldId: 'other' }] : mode === 'extra-field' ? [...result, ...result]
    : mode === 'invalid-status' ? [{ ...result[0], status: 'saved' }] : result;
  p.value.onMessage.emit(mode === 'extra-property' ? { ok: true, data, script: 'submit()' } : { ok: true, data });
  await expect(pending).rejects.toThrow('核验'); expect(p.connect).toHaveBeenCalledOnce(); expect(p.value.disconnect).toHaveBeenCalledOnce();
});
it('客户端严格匹配当前批次结果，且清理连接与计时器', async () => {
  vi.useFakeTimers(); const p = client(); const pending = fillPageCancelable(12, request.payload, new AbortController().signal);
  p.value.onMessage.emit({ ok: true, data: result }); expect(await pending).toEqual(result);
  expect(p.connect).toHaveBeenCalledWith(12, { name: PAGE_OPERATION_PORT, frameId: 0 }); expect(vi.getTimerCount()).toBe(0);
});
it('断开或超时后的客户端不降级回旧消息', async () => {
  vi.useFakeTimers(); const p = client(); const pending = fillPageCancelable(12, request.payload, new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow('超时'); await vi.advanceTimersByTimeAsync(PAGE_OPERATION_DEADLINE_MS + 1000); await rejected;
  expect(p.connect).toHaveBeenCalledOnce(); expect(p.value.disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it.each(['disconnect', 'post-failure'] as const)('%s结束客户端且不尝试第二次连接', async mode => {
  const p = client(); if (mode === 'post-failure') p.value.postMessage.mockImplementation(() => { throw new Error('gone'); });
  const pending = fillPageCancelable(12, request.payload, new AbortController().signal);
  if (mode === 'disconnect') p.value.onDisconnect.emit(undefined);
  await expect(pending).rejects.toThrow('连接中断'); expect(p.connect).toHaveBeenCalledOnce();
  expect(p.value.onMessage.listeners.size).toBe(0); expect(p.value.onDisconnect.listeners.size).toBe(0);
});
it.each(['wrong-reference', 'wrong-shape', 'bad-version'] as const)('稳定扫描拒绝%s语义图', async mode => {
  document.body.innerHTML = '<label>姓名<input></label>'; const scan = scanDocument().result;
  const graph = structuredClone(scan.semanticGraph!);
  if (mode === 'wrong-reference') Object.assign(graph.nodes.find(node => node.kind === 'field')!, { fieldId: 'other-field' });
  else if (mode === 'wrong-shape') Object.assign(graph, { nodes: [{}] });
  else Object.assign(graph, { schemaVersion: 99 });
  const p = client(); const pending = scanPageCancelable(12, new AbortController().signal);
  p.value.onMessage.emit({ ok: true, data: { ...scan, semanticGraph: graph } }); await expect(pending).rejects.toThrow('核验');
});
it('稳定扫描只接受有效描述及语义图；取消不返回新扫描', async () => {
  document.body.innerHTML = '<label>姓名<input></label>'; const scan = scanDocument().result;
  const p = client(); const pending = scanPageCancelable(12, new AbortController().signal);
  p.value.onMessage.emit({ ok: true, data: scan }); const returned = await pending; expect(returned).toEqual(scan);
  expect(JSON.stringify(returned)).toBe(JSON.stringify(scan));
  const bad = client(); const invalid = scanPageCancelable(12, new AbortController().signal);
  bad.value.onMessage.emit({ ok: true, data: { ...scan, fields: [...scan.fields, ...scan.fields] } }); await expect(invalid).rejects.toThrow('核验');
  const canceled = client(); const controller = new AbortController(); const late = scanPageCancelable(12, controller.signal);
  const rejected = expect(late).rejects.toThrow('停止'); controller.abort(); canceled.value.onMessage.emit({ ok: true, data: scan }); await rejected;
});
