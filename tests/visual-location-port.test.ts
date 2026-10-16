import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVisualLocationPortHandler } from '../src/content/visualLocationPort';
import { locateVisualField } from '../src/popup/visualLocationClient';
import { VISUAL_LOCATION_PORT, VISUAL_LOCATION_DEADLINE_MS } from '../src/shared/visualLocationProtocol';
import { scanDocument, type ScanState } from '../src/content/scanner';
import type { VisualFieldLocation } from '../src/content/visualFieldLocator';

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return { listeners, addListener: (fn: (value: T) => void) => listeners.add(fn), removeListener: (fn: (value: T) => void) => listeners.delete(fn),
    emit: (value: T) => { for (const fn of [...listeners]) fn(value); } };
}
function channel(sender: Partial<chrome.runtime.MessageSender> = {}) {
  const value = { name: VISUAL_LOCATION_PORT, sender: { id: 'fictional', url: 'chrome-extension://fictional/popup.html', ...sender },
    onMessage: event<unknown>(), onDisconnect: event<void>(), postMessage: vi.fn(), disconnect: vi.fn(() => value.onDisconnect.emit(undefined)) };
  return { value, port: value as unknown as chrome.runtime.Port };
}
beforeEach(() => { vi.stubGlobal('chrome', { runtime: {} }); document.body.innerHTML = '<section><h2>个人信息</h2><label for="opaque">陌生问题甲</label><input id="opaque"></section>'; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function setup() {
  const original = scanDocument(); let current: ScanState | undefined = original;
  let release!: (value: VisualFieldLocation) => void;
  const pending = new Promise<VisualFieldLocation>(resolve => { release = resolve; });
  const locate = vi.fn<(scanId: string, fieldId: string, signal: AbortSignal) => Promise<VisualFieldLocation>>(() => pending);
  const install = vi.fn((expected: ScanState, next: ScanState | undefined) => { if (current !== expected) return false; current = next; return true; });
  const available = vi.fn(() => true);
  const handle = createVisualLocationPortHandler({ extensionId: 'fictional', popupUrl: 'chrome-extension://fictional/popup.html', getScan: () => current,
    available, install, create: () => ({ locate }) });
  const p = channel(); handle(p.port);
  const request = { type: 'locate', scanId: original.result.scanId, fieldId: original.result.fields[0]!.id };
  return { original, locate, install, release, handle, p, request, available, current: () => current, replace: () => { current = scanDocument(); } };
}
it.each(['id', 'url', 'tab', 'options', 'query', 'missing'] as const)('rejects untrusted %s sender before location', mode => {
  vi.useFakeTimers(); const s = setup(); s.p.value.disconnect();
  const p = channel(mode === 'id' ? { id: 'other' } : mode === 'url' ? { url: 'https://fictional.invalid/' } : mode === 'tab' ? { tab: { id: 1 } as chrome.tabs.Tab }
    : mode === 'options' ? { url: 'chrome-extension://fictional/options.html' } : mode === 'query' ? { url: 'chrome-extension://fictional/popup.html?x=1' } : { url: undefined });
  s.handle(p.port); p.value.onMessage.emit(s.request);
  expect(p.value.disconnect).toHaveBeenCalledOnce(); expect(s.locate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it.each(['coordinates', 'script', 'too-long', 'wrong-type'] as const)('rejects %s wire instructions without scrolling', mode => {
  const s = setup(); const request = mode === 'coordinates' ? { ...s.request, left: 10, top: 20 } : mode === 'script' ? { ...s.request, code: 'submit()' }
    : mode === 'too-long' ? { ...s.request, fieldId: 'x'.repeat(600) } : { ...s.request, fieldId: 3 };
  s.p.value.onMessage.emit(request); expect(s.locate).not.toHaveBeenCalled(); expect(s.install).not.toHaveBeenCalled();
  expect(s.p.value.postMessage).toHaveBeenCalledWith({ ok: false, error: expect.any(String) });
});
it('cancels a disconnect and cannot install a late returned scan', async () => {
  const s = setup(); s.p.value.onMessage.emit(s.request); const signal = s.locate.mock.calls[0]![2];
  s.p.value.disconnect(); expect(signal.aborted).toBe(true); const fresh = scanDocument();
  s.release({ state: 'located', scan: fresh, fieldId: fresh.result.fields[0]!.id, moved: true }); await Promise.resolve();
  expect(s.current()).toBeUndefined(); expect(s.p.value.postMessage).not.toHaveBeenCalled();
});
it('bounds idle ports and releases all deadlines without starting location', () => {
  vi.useFakeTimers(); const s = setup(), rest = Array.from({ length: 7 }, () => channel()); rest.forEach(p => s.handle(p.port));
  const ninth = channel(); s.handle(ninth.port); expect(ninth.value.disconnect).toHaveBeenCalledOnce();
  s.p.value.disconnect(); rest.forEach(p => p.value.disconnect()); expect(vi.getTimerCount()).toBe(0); expect(s.locate).not.toHaveBeenCalled();
});
it.each(['duplicate', 'deadline'] as const)('cancels %s while preserving isolation from a later scan', async mode => {
  vi.useFakeTimers(); const s = setup(); s.p.value.onMessage.emit(s.request); const signal = s.locate.mock.calls[0]![2];
  s.replace(); const newer = s.current();
  if (mode === 'duplicate') s.p.value.onMessage.emit(s.request); else await vi.advanceTimersByTimeAsync(VISUAL_LOCATION_DEADLINE_MS);
  expect(signal.aborted).toBe(true); expect(s.current()).toBe(newer); expect(vi.getTimerCount()).toBe(0);
});
it('installs only the fresh scan of the identical original node, once', async () => {
  const s = setup(); s.p.value.onMessage.emit(s.request); const fresh = scanDocument();
  s.release({ state: 'located', scan: fresh, fieldId: fresh.result.fields[0]!.id, moved: true }); await Promise.resolve();
  expect(s.current()).toBe(fresh); expect(s.install).toHaveBeenCalledOnce();
  expect(s.p.value.postMessage).toHaveBeenCalledWith({ ok: true, scanId: s.request.scanId, originalFieldId: s.request.fieldId,
    result: { state: 'located', moved: true, fieldId: fresh.result.fields[0]!.id, scan: fresh.result } });
});
it('does not install a returned clone node or an old field reference as a moved scan', async () => {
  for (const mode of ['clone', 'old-scan']) {
    const s = setup(); s.p.value.onMessage.emit(s.request);
    if (mode === 'clone') { const node = document.querySelector('input')!; node.replaceWith(node.cloneNode(true)); }
    const fresh = mode === 'clone' ? scanDocument() : s.original;
    s.release({ state: 'located', scan: fresh, fieldId: fresh.result.fields[0]!.id, moved: true }); await Promise.resolve();
    expect(s.current()).toBeUndefined(); expect(s.p.value.postMessage).toHaveBeenCalledWith(expect.objectContaining({ result: { state: 'manual', reason: 'stale' } }));
  }
});
function client() {
  const p = channel(); const connect = vi.fn(() => p.port); vi.stubGlobal('chrome', { tabs: { connect }, runtime: {} });
  const old = scanDocument(), fresh = scanDocument();
  const reply = { ok: true, scanId: old.result.scanId, originalFieldId: old.result.fields[0]!.id,
    result: { state: 'located', moved: true, scan: fresh.result, fieldId: fresh.result.fields[0]!.id } };
  return { ...p, connect, old, fresh, reply };
}
it('client validates but preserves original scan serialization', async () => {
  vi.useFakeTimers(); const p = client(); const promise = locateVisualField(12, p.reply.scanId, p.reply.originalFieldId, new AbortController().signal);
  p.value.onMessage.emit(p.reply); const result = await promise;
  expect(result.state === 'located' && result.scan).toBe(p.fresh.result); expect(p.connect).toHaveBeenCalledWith(12, { name: VISUAL_LOCATION_PORT, frameId: 0 });
  expect(vi.getTimerCount()).toBe(0); expect(p.value.onMessage.listeners.size).toBe(0);
});
it.each(['old-echo', 'old-target', 'absent-target', 'extra-coordinate', 'invalid-graph'] as const)('client rejects %s response without retries', async mode => {
  const p = client(); const promise = locateVisualField(12, p.reply.scanId, p.reply.originalFieldId, new AbortController().signal);
  const reply = structuredClone(p.reply);
  if (mode === 'old-echo') reply.scanId = 'unrelated';
  if (mode === 'old-target') reply.originalFieldId = 'unrelated';
  if (mode === 'absent-target') reply.result.fieldId = 'unrelated';
  if (mode === 'invalid-graph') reply.result.scan.semanticGraph!.rootId = 'unrelated';
  p.value.onMessage.emit(mode === 'extra-coordinate' ? { ...reply, x: 0 } : reply);
  await expect(promise).rejects.toThrow('核验'); expect(p.connect).toHaveBeenCalledOnce();
});
it('pre-abort or abort during connection sends no request and accepts no late response', async () => {
  for (const pre of [true, false]) {
    const p = client(), controller = new AbortController(); if (pre) controller.abort(); else p.connect.mockImplementationOnce(() => { controller.abort(); return p.port; });
    await expect(locateVisualField(12, p.reply.scanId, p.reply.originalFieldId, controller.signal)).rejects.toThrow('停止');
    expect(p.value.postMessage).not.toHaveBeenCalled(); if (pre) expect(p.connect).not.toHaveBeenCalled();
  }
});
