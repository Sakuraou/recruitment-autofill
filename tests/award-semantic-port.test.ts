import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecordSemanticPortHandler } from '../src/background/recordSemanticPort';
import { EDUCATION_SEMANTIC_PORT } from '../src/ai/educationPortProtocol';
import { PROJECT_SEMANTIC_PORT } from '../src/ai/projectPortProtocol';
import { createAwardSemanticClient } from '../src/content/awardSemanticClient';
import { INTERNSHIP_SEMANTIC_PORT } from '../src/ai/internshipPortProtocol';
import { AWARD_SEMANTIC_PORT } from '../src/ai/awardPortProtocol';
import { AWARD_SEMANTIC_BINDING_PATHS, type SemanticRequest } from '../src/ai/semanticProtocol';
import { createEmptyProfile } from '../src/profile/schema';
import type { SemanticProvider } from '../src/ai/semanticCandidates';

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return { addListener: (listener: (value: T) => void) => listeners.add(listener),
    removeListener: (listener: (value: T) => void) => listeners.delete(listener),
    emit: (value: T) => { for (const listener of [...listeners]) listener(value); } };
}
const url = 'https://fictional-projects.example.test/app';
function port(overrides: Partial<chrome.runtime.MessageSender> = {}) {
  const onMessage = event<unknown>(); const onDisconnect = event<void>();
  const value = { name: AWARD_SEMANTIC_PORT, sender: { id: 'fictional-extension', url,
    frameId: 0, documentId: crypto.randomUUID(), documentLifecycle: 'active', tab: { id: 7, url }, ...overrides },
    onMessage, onDisconnect, postMessage: vi.fn(), disconnect: vi.fn(() => onDisconnect.emit(undefined)) };
  return { value, port: value as unknown as chrome.runtime.Port };
}
function request(): SemanticRequest {
  return { protocol: 4, requestId: crypto.randomUUID(), allowedPaths: [...AWARD_SEMANTIC_BINDING_PATHS], fields: [{ ref: 'field-0',
    fingerprint: '0123456789abcdef', kind: 'input', type: 'text', section: 'award', record: 'creating',
    label: '这次工作叫什么 虚构候选', ariaLabel: '', tableHeader: '', title: '', placeholder: '', options: [] }] };
}
function proposal(value: SemanticRequest) {
  return { requestId: value.requestId, status: 'mapped', bindings: value.fields.map(field => ({ ref: field.ref,
    fingerprint: field.fingerprint, path: 'awards.name', certainty: 'certain', evidence: 'label' })) };
}
function fixture() {
  const profile = createEmptyProfile(); profile.basic.name = '虚构候选'; profile.revision = crypto.randomUUID();
  const connection = { protocol: 1 as const, enabled: true as const, userConfirmed: true as const, token: 'ab'.repeat(32), cacheRevision: crypto.randomUUID() };
  const provider: SemanticProvider = { propose: vi.fn(async value => proposal(value as SemanticRequest)) };
  const deps = { extensionId: 'fictional-extension', connection: vi.fn(async () => connection), profile: vi.fn(async () => profile),
    tab: vi.fn(async () => ({ id: 7, url }) as chrome.tabs.Tab), provider: vi.fn(() => provider) };
  const handle = createRecordSemanticPortHandler(deps, 'award'); const channel = port(); handle(channel.port);
  const send = (body: unknown = { type: 'RA_AWARD_SEMANTIC', request: request() }) => channel.value.onMessage.emit(body);
  return { profile, connection, provider, deps, handle, channel, send };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('trusted award semantic background port', () => {
  it.each(['education-first', 'project-first'])('%s：生产后台两个栏目共用在途互斥，断开后才可重用', mode => {
    const s = fixture(); s.channel.value.disconnect();
    const handle = createRecordSemanticPortHandler(s.deps); const first = port(); const second = port();
    if (mode === 'education-first') second.value.name = PROJECT_SEMANTIC_PORT;
    else first.value.name = PROJECT_SEMANTIC_PORT;
    handle(first.port); handle(second.port);
    expect(first.value.disconnect).not.toHaveBeenCalled(); expect(second.value.disconnect).toHaveBeenCalledOnce();
    expect(s.deps.profile).not.toHaveBeenCalled(); expect(s.provider.propose).not.toHaveBeenCalled();
    first.value.disconnect(); const next = port(); handle(next.port); expect(next.value.disconnect).not.toHaveBeenCalled(); next.value.disconnect();
  });
  it('redacts saved personal literals again and returns only validated meanings with no credentials or values', async () => {
    const s = fixture(); s.send(); await vi.waitFor(() => expect(s.channel.value.postMessage).toHaveBeenCalledOnce());
    expect(s.channel.value.postMessage.mock.calls[0]![0]).toMatchObject({ state: 'ready', proposal: { bindings: [{ path: 'awards.name' }] } });
    const sent = JSON.stringify(vi.mocked(s.provider.propose).mock.calls[0]![0]);
    expect(sent).not.toMatch(/虚构候选|fictional-projects|token|intentIndex/); expect(sent).toContain('[redacted]');
    expect(JSON.stringify(s.channel.value.postMessage.mock.calls)).not.toContain(s.connection.token);
  });
  it.each(['extension', 'frame', 'document', 'inactive', 'url', 'tab', 'no-tab'])('rejects invalid %s sources before reading storage', async mode => {
    const s = fixture(); s.channel.value.disconnect();
    const overrides: Partial<chrome.runtime.MessageSender> = mode === 'extension' ? { id: 'other' } : mode === 'frame' ? { frameId: 1 }
      : mode === 'document' ? { documentId: undefined } : mode === 'inactive' ? { documentLifecycle: 'prerender' }
        : mode === 'url' ? { url: 'chrome-extension://fictional/options.html' } : mode === 'no-tab' ? { tab: undefined }
          : { tab: { id: 7, url: url + '/other' } as chrome.tabs.Tab };
    const rejected = port(overrides); s.handle(rejected.port); expect(rejected.value.disconnect).toHaveBeenCalledOnce();
    rejected.value.onMessage.emit({ type: 'RA_AWARD_SEMANTIC', request: request() });
    expect(s.deps.connection).not.toHaveBeenCalled(); expect(s.deps.profile).not.toHaveBeenCalled();
  });
  it.each(['extra', 'basic', 'index', 'oversized'])('rejects %s requests without reaching the provider', async mode => {
    const s = fixture(); const body = { type: 'RA_AWARD_SEMANTIC', request: request() };
    if (mode === 'basic') { body.request.fields[0]!.section = 'basic'; body.request.fields[0]!.record = 'none'; }
    if (mode === 'oversized') body.request.fields[0]!.label = '长'.repeat(40_001);
    if (mode === 'index') Object.assign(body.request, { intentIndex: 1 });
    s.send(mode === 'extra' ? { ...body, endpoint: url } : body);
    await vi.waitFor(() => expect(s.channel.value.postMessage).toHaveBeenCalledWith({ state: 'rejected' }));
    expect(s.provider.propose).not.toHaveBeenCalled();
  });
  it('does not call an upstream provider while AI is disabled', async () => {
    const s = fixture(); s.deps.connection.mockResolvedValueOnce(undefined as unknown as typeof s.connection);
    s.send(); await vi.waitFor(() => expect(s.channel.value.postMessage).toHaveBeenCalledWith({ state: 'disabled' }));
    expect(s.provider.propose).not.toHaveBeenCalled();
  });
  it('rejects a changed current tab before a provider call', async () => {
    const s = fixture(); s.deps.tab.mockResolvedValueOnce({ id: 7, url: url + '/changed' } as chrome.tabs.Tab);
    s.send(); await vi.waitFor(() => expect(s.channel.value.postMessage).toHaveBeenCalledWith({ state: 'rejected' }));
    expect(s.provider.propose).not.toHaveBeenCalled();
  });
  it.each(['connection', 'profile', 'tab'])('rejects a %s change while waiting for the model', async mode => {
    const s = fixture(); let reply!: (response: unknown) => void;
    s.provider.propose = vi.fn(() => new Promise(resolve => { reply = resolve; })); s.send();
    await vi.waitFor(() => expect(s.provider.propose).toHaveBeenCalledOnce());
    if (mode === 'connection') s.connection.cacheRevision = crypto.randomUUID();
    if (mode === 'profile') s.profile.basic.name = '资料已改动';
    if (mode === 'tab') s.deps.tab.mockResolvedValueOnce({ id: 7, url: url + '/changed' } as chrome.tabs.Tab);
    reply(proposal(vi.mocked(s.provider.propose).mock.calls[0]![0] as SemanticRequest));
    await vi.waitFor(() => expect(s.channel.value.postMessage).toHaveBeenCalledWith({ state: 'rejected' }));
  });
  it.each(['path', 'reference', 'answer'])('rejects invalid model %s output as a whole', async mode => {
    const s = fixture(); s.provider.propose = vi.fn(async value => {
      const result = proposal(value as SemanticRequest);
      if (mode === 'path') result.bindings[0]!.path = 'basic.name';
      if (mode === 'reference') result.bindings[0]!.ref = 'field-29';
      return mode === 'answer' ? { ...result, answer: '不能返回个人答案' } : result;
    }); s.send(); await vi.waitFor(() => expect(s.channel.value.postMessage).toHaveBeenCalledWith({ state: 'rejected' }));
  });
  it.each(['disconnect', 'duplicate', 'timeout'])('aborts %s and ignores any late provider result', async mode => {
    if (mode === 'timeout') vi.useFakeTimers(); const s = fixture(); let reply!: (response: unknown) => void;
    s.provider.propose = vi.fn(() => new Promise(resolve => { reply = resolve; })); s.send();
    await vi.waitFor(() => expect(s.provider.propose).toHaveBeenCalledOnce());
    if (mode === 'disconnect') s.channel.value.disconnect();
    if (mode === 'duplicate') s.send();
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(15_001);
    const [body, signal] = vi.mocked(s.provider.propose).mock.calls[0]!; expect(signal.aborted).toBe(true);
    reply(proposal(body as SemanticRequest)); await Promise.resolve(); await Promise.resolve();
    expect(s.channel.value.postMessage).toHaveBeenCalledTimes(mode === 'disconnect' ? 0 : 1);
    if (mode !== 'disconnect') expect(s.channel.value.postMessage).toHaveBeenCalledWith({ state: mode === 'timeout' ? 'timeout' : 'rejected' });
  });
  it('refuses a second port for the same tab and releases its slot after disconnect', () => {
    const s = fixture(); const second = port(); s.handle(second.port); expect(second.value.disconnect).toHaveBeenCalledOnce();
    s.channel.value.disconnect(); const third = port(); s.handle(third.port); expect(third.value.disconnect).not.toHaveBeenCalled(); third.value.disconnect();
  });
  it('does not expose transport errors', async () => {
    const s = fixture(); s.provider.propose = vi.fn().mockRejectedValue(new Error('private credentials in provider error'));
    s.send(); await vi.waitFor(() => expect(s.channel.value.postMessage).toHaveBeenCalledWith({ state: 'unavailable' }));
    expect(JSON.stringify(s.channel.value.postMessage.mock.calls)).not.toContain('private');
  });
});

describe('content award semantic client', () => {
  function client() {
    const channel = port(); const connect = vi.fn(() => channel.port);
    vi.stubGlobal('chrome', { runtime: { connect, lastError: undefined } });
    return { channel, connect, provider: createAwardSemanticClient() };
  }
  it('opens only the named fixed channel and accepts a request-local valid proposal', async () => {
    const s = client(); const body = request(); const result = s.provider.propose(body, new AbortController().signal);
    expect(s.connect).toHaveBeenCalledWith({ name: AWARD_SEMANTIC_PORT });
    expect(s.channel.value.postMessage).toHaveBeenCalledWith({ type: 'RA_AWARD_SEMANTIC', request: body });
    s.channel.value.onMessage.emit({ state: 'ready', proposal: proposal(body) });
    await expect(result).resolves.toEqual(proposal(body)); expect(s.channel.value.disconnect).toHaveBeenCalledOnce();
  });
  it.each(['invalid-source', 'extra', 'wrong-request', 'disabled', 'disconnect', 'cancel'])('rejects %s without returning any usable proposal', async mode => {
    const s = client(); const body = request(); const controller = new AbortController();
    if (mode === 'invalid-source') body.fields[0]!.section = 'basic';
    const result = s.provider.propose(body, controller.signal);
    const rejected = expect(result).rejects.toThrow();
    if (mode === 'extra') s.channel.value.onMessage.emit({ state: 'ready', proposal: proposal(body), token: 'forbidden' });
    if (mode === 'wrong-request') s.channel.value.onMessage.emit({ state: 'ready', proposal: proposal(request()) });
    if (mode === 'disabled') s.channel.value.onMessage.emit({ state: 'disabled' });
    if (mode === 'disconnect') s.channel.value.onDisconnect.emit(undefined);
    if (mode === 'cancel') controller.abort();
    await rejected;
    expect(s.connect).toHaveBeenCalledTimes(mode === 'invalid-source' ? 0 : 1);
  });
});

const recordChannels=[PROJECT_SEMANTIC_PORT,EDUCATION_SEMANTIC_PORT,INTERNSHIP_SEMANTIC_PORT,AWARD_SEMANTIC_PORT];
it.each(recordChannels.flatMap(first=>recordChannels.map(second=>({first,second}))))('$first 与 $second 竞争同一个真实标签槽位，断开后释放',({first,second})=>{
 const s=fixture();s.channel.value.disconnect();const handle=createRecordSemanticPortHandler(s.deps);
 const a=port(),b=port(),c=port();a.value.name=first;b.value.name=second;c.value.name=second;
 handle(a.port);handle(b.port);expect(a.value.disconnect).not.toHaveBeenCalled();expect(b.value.disconnect).toHaveBeenCalledOnce();
 expect(s.deps.profile).not.toHaveBeenCalled();expect(s.provider.propose).not.toHaveBeenCalled();a.value.disconnect();handle(c.port);expect(c.value.disconnect).not.toHaveBeenCalled();c.value.disconnect();
});
it('四个栏目共享全局八个在途槽位，第九个拒绝，释放后可复用',()=>{
 const s=fixture();s.channel.value.disconnect();const handle=createRecordSemanticPortHandler(s.deps);
 const entries=Array.from({length:8},(_,index)=>{const entry=port({tab:{id:index+20,url} as chrome.tabs.Tab});entry.value.name=recordChannels[index%recordChannels.length]!;handle(entry.port);expect(entry.value.disconnect).not.toHaveBeenCalled();return entry;});
 const ninth=port({tab:{id:29,url} as chrome.tabs.Tab});handle(ninth.port);expect(ninth.value.disconnect).toHaveBeenCalledOnce();
 expect(s.deps.profile).not.toHaveBeenCalled();entries[0]!.value.disconnect();const reused=port({tab:{id:29,url} as chrome.tabs.Tab});handle(reused.port);expect(reused.value.disconnect).not.toHaveBeenCalled();reused.value.disconnect();entries.slice(1).forEach(entry=>entry.value.disconnect());
});
