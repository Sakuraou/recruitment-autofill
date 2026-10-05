import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentPageLease } from '../src/agent/pageLease';
import { AGENT_OWNER_PORT, createAgentOwnerPortHandler } from '../src/content/agentOwnerPort';
import { openAgentPageOwner } from '../src/popup/agentOwnerClient';
import { EXTENSION_VERSION } from '../src/shared/version';
function event<T>() { const listeners = new Set<(value: T) => void>(); return { addListener: (fn: (value: T) => void) => listeners.add(fn),
  removeListener: (fn: (value: T) => void) => listeners.delete(fn), emit: (value: T) => { for (const fn of [...listeners]) fn(value); } }; }
function channel(sender: Partial<chrome.runtime.MessageSender> = {}) {
  const messages = event<unknown>(); const disconnected = event<void>();
  const value = { name: AGENT_OWNER_PORT, sender: { id: 'fictional-extension', url: 'chrome-extension://fictional-extension/popup.html', ...sender },
    onMessage: messages, onDisconnect: disconnected, postMessage: vi.fn(), disconnect: vi.fn(() => disconnected.emit(undefined)) };
  return { value, port: value as unknown as chrome.runtime.Port };
}
function fixture(occupied = false, version = EXTENSION_VERSION) {
  const lease = new AgentPageLease(() => 'https://fixture.example/', () => occupied); const releaseOwnedTasks = vi.fn();
  const handle = createAgentOwnerPortHandler({ extensionId: 'fictional-extension', extensionUrl: path => `chrome-extension://fictional-extension/${path}`, version, lease, releaseOwnedTasks });
  return { lease, releaseOwnedTasks, handle };
}
beforeEach(() => { vi.stubGlobal('chrome', { runtime: {} }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('issues ownership once and releases owned work on popup disconnection', () => {
  const s = fixture(); const p = channel(); s.handle(p.port); p.value.onMessage.emit({ type: 'begin' });
  expect(p.value.postMessage).toHaveBeenCalledWith({ ok: true, data: { token: expect.any(String), version: EXTENSION_VERSION } });
  expect(s.lease.holdsPage()).toBe(true); p.value.disconnect(); expect(s.lease.holdsPage()).toBe(false); expect(s.releaseOwnedTasks).toHaveBeenCalledOnce();
  p.value.onDisconnect.emit(undefined); expect(s.releaseOwnedTasks).toHaveBeenCalledOnce();
});
it.each([{ id: 'other' }, { url: 'https://site.example/' }, { url: 'chrome-extension://fictional-extension/options.html' }, { url: undefined }])('rejects untrusted owner %j', sender => {
  const s = fixture(); const p = channel(sender); s.handle(p.port); p.value.onMessage.emit({ type: 'begin' }); expect(s.lease.holdsPage()).toBe(false); expect(s.releaseOwnedTasks).not.toHaveBeenCalled();
});
it.each([{ type: 'begin', profile: {} }, { type: 'click' }, { type: 'begin', token: crypto.randomUUID() }])('does not issue a lease for malformed owner command %j', request => {
  const s = fixture(); const p = channel(); s.handle(p.port); p.value.onMessage.emit(request); expect(s.lease.holdsPage()).toBe(false); expect(p.value.disconnect).toHaveBeenCalledOnce();
});
it('a second owner cannot release the first page lease', () => {
  const s = fixture(); const a = channel(); s.handle(a.port); a.value.onMessage.emit({ type: 'begin' }); const b = channel(); s.handle(b.port); b.value.onMessage.emit({ type: 'begin' });
  expect(s.lease.holdsPage()).toBe(true); expect(s.releaseOwnedTasks).not.toHaveBeenCalled(); expect(b.value.postMessage).toHaveBeenCalledWith({ ok: false, error: expect.any(String) }); a.value.disconnect();
});
it('occupied pages reject ownership before any capability is issued', () => {
  const s = fixture(true); const p = channel(); s.handle(p.port); p.value.onMessage.emit({ type: 'begin' }); expect(s.lease.holdsPage()).toBe(false); expect(s.releaseOwnedTasks).not.toHaveBeenCalled();
});
it('duplicated owner messages terminate the old intent instead of allocating another', () => {
  const s = fixture(); const p = channel(); s.handle(p.port); p.value.onMessage.emit({ type: 'begin' }); p.value.onMessage.emit({ type: 'begin' });
  expect(p.value.postMessage).toHaveBeenCalledTimes(1); expect(s.lease.holdsPage()).toBe(false); expect(s.releaseOwnedTasks).toHaveBeenCalledOnce();
});
it('unused connections expire without creating or stopping any task', () => {
  vi.useFakeTimers(); const s = fixture(); const p = channel(); s.handle(p.port); vi.advanceTimersByTime(5000); expect(p.value.disconnect).toHaveBeenCalledOnce(); expect(s.releaseOwnedTasks).not.toHaveBeenCalled();
});
function connectFixture(version = EXTENSION_VERSION) {
  const s = fixture(false, version); const service = channel(); const clientMessages = event<unknown>(); const clientDisconnect = event<void>();
  const client = { onMessage: clientMessages, onDisconnect: clientDisconnect, postMessage: (value: unknown) => service.value.onMessage.emit(value),
    disconnect: () => { service.value.onDisconnect.emit(undefined); clientDisconnect.emit(undefined); } } as unknown as chrome.runtime.Port;
  service.value.postMessage.mockImplementation(value => clientMessages.emit(value));
  service.value.disconnect.mockImplementation(() => { service.value.onDisconnect.emit(undefined); clientDisconnect.emit(undefined); });
  s.handle(service.port); vi.stubGlobal('chrome', { runtime: {}, tabs: { connect: vi.fn(() => client) } });
  return { ...s, service };
}
it('extension owner client keeps its page lease until completion', async () => {
  const s = connectFixture(); const owner = await openAgentPageOwner(1, new AbortController().signal);
  expect(s.lease.mayWrite(owner.token)).toBe(true); expect(owner.signal.aborted).toBe(false); owner.close(); expect(owner.signal.aborted).toBe(true); expect(s.lease.holdsPage()).toBe(false);
});
it('owner client Stop releases page ownership and cancels its combined action signal', async () => {
  const s = connectFixture(); const stop = new AbortController(); const owner = await openAgentPageOwner(1, stop.signal); stop.abort();
  expect(owner.signal.aborted).toBe(true); expect(s.lease.holdsPage()).toBe(false); expect(s.releaseOwnedTasks).toHaveBeenCalledOnce();
});
it('unexpected content disconnect invalidates the current client owner', async () => {
  const s = connectFixture(); const owner = await openAgentPageOwner(1, new AbortController().signal); s.service.value.disconnect(); expect(owner.signal.aborted).toBe(true); expect(s.lease.holdsPage()).toBe(false);
});
it('old-version handshakes are rejected and their page lease is released', async () => {
  const s = connectFixture('0.0.0'); await expect(openAgentPageOwner(1, new AbortController().signal)).rejects.toThrow(); expect(s.lease.holdsPage()).toBe(false);
});
it('already stopped callers cannot connect or allocate a page lease', async () => {
  const s = connectFixture(); const stop = new AbortController(); stop.abort(); await expect(openAgentPageOwner(1, stop.signal)).rejects.toThrow(); expect(s.lease.holdsPage()).toBe(false);
  s.service.value.disconnect();
});
