import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => boolean | undefined;
let listener: Listener;
const extensionId = 'projection-test-extension';
const addListener = vi.fn((callback: Listener) => { listener = callback; });
const setAccessLevel = vi.fn(async () => undefined);
const get = vi.fn(async () => ({ ["recruitment.profile.v1"]: {
  schemaVersion: 1,
  updatedAt: '2026-09-29T00:00:00.000Z',
  basic: { name: '不得返回' }, education: [],
  research: { papers: [], patents: [] },
  projects: [{ id: 'p1', name: '项目甲', role: '成员', technologies: [] }],
  internships: [{ id: 'i1', organization: '公司甲', role: '实习生' }], studentWork: [], awards: [], certificates: [],
  skills: { programmingLanguages: [], frameworks: [], tools: [], other: [] }, commonAnswers: {}, family: [],
} }));
function sender(value: { id?: string; url?: string; tab?: { id?: number; url?: string } }): chrome.runtime.MessageSender {
  return value as chrome.runtime.MessageSender;
}

beforeEach(async () => {
  vi.resetModules();
  addListener.mockClear(); setAccessLevel.mockClear(); get.mockClear();
  vi.stubGlobal('chrome', { runtime: {
    id: extensionId,
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onMessage: { addListener },
  }, storage: { local: { setAccessLevel, get } } });
  await import('../src/background/index');
});

describe('后台档案投影消息', () => {
  it('只接受严格空载荷，并返回最小项目投影', async () => {
    const response = vi.fn();
    const source = sender({ id: extensionId, url: 'https://jobs.example/app', tab: { id: 7, url: 'https://jobs.example/app' } });
    expect(listener({ type: 'RA_PROFILE_PROJECT', payload: { path: 'basic.name' } }, source, response)).toBe(false);
    expect(response).not.toHaveBeenCalled();
    expect(listener({ type: 'RA_PROFILE_PROJECT' }, source, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledOnce());
    expect(response).toHaveBeenCalledWith({ ok: true, data: {
      recordType: 'project', profileRevision: '2026-09-29T00:00:00.000Z',
      projects: [{ id: 'p1', name: '项目甲', role: '成员', technologies: [] }],
    } });
    expect(JSON.stringify(response.mock.calls[0]?.[0])).not.toContain('不得返回');
    expect(JSON.stringify(response.mock.calls[0]?.[0])).not.toContain('公司甲');
  });

  it('拒绝第三方扩展、无网页 sender 和非 HTTP 页面', () => {
    const response = vi.fn();
    expect(listener({ type: 'RA_PROFILE_PROJECT' }, sender({ id: 'other', url: 'https://jobs.example', tab: { id: 7 } }), response)).toBe(false);
    expect(listener({ type: 'RA_PROFILE_PROJECT' }, sender({ id: extensionId, url: 'chrome-extension://other/page', tab: { id: 7 } }), response)).toBe(false);
    expect(listener({ type: 'RA_PROFILE_PROJECT' }, sender({ id: extensionId, url: 'https://jobs.example' }), response)).toBe(false);
    expect(response).toHaveBeenCalledTimes(3);
    expect(response).toHaveBeenCalledWith({ ok: false, error: '不可信的档案投影请求' });
  });

  it('档案读取失败时不泄漏异常详情', async () => {
    get.mockRejectedValueOnce(new Error('secret storage detail'));
    const response = vi.fn();
    expect(listener({ type: 'RA_PROFILE_PROJECT' }, sender({ id: extensionId, url: 'https://jobs.example', tab: { id: 7 } }), response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledOnce());
    expect(response).toHaveBeenCalledWith({ ok: false, error: '无法读取本地档案' });
    expect(JSON.stringify(response.mock.calls[0]?.[0])).not.toContain('secret storage detail');
  });
});
