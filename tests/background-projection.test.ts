import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { educationSessionProfile } from './fixtures/education-session-page';
import { internshipSessionProfile } from './fixtures/internship-session-page';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => boolean | undefined;
let listener: Listener;
const extensionId = 'projection-test-extension';
const addListener = vi.fn((callback: Listener) => { listener = callback; });
const setAccessLevel = vi.fn(async () => undefined);
const storedProfile = async (): Promise<Record<string, unknown>> => ({ ["recruitment.profile.v1"]: {
  schemaVersion: 1,
  updatedAt: '2026-09-29T00:00:00.000Z',
  basic: { name: '不得返回' }, education: [],
  research: { papers: [], patents: [] },
  projects: [{ id: 'p1', name: '项目甲', role: '成员', technologies: [] }],
  internships: [{ id: 'i1', organization: '公司甲', role: '实习生' }], studentWork: [], awards: [], certificates: [],
  skills: { programmingLanguages: [], frameworks: [], tools: [], other: [] }, commonAnswers: {}, family: [],
} });
const get = vi.fn(storedProfile);
function sender(value: { id?: string; url?: string; tab?: { id?: number; url?: string } }): chrome.runtime.MessageSender {
  return value as chrome.runtime.MessageSender;
}

beforeEach(async () => {
  vi.resetModules();
  addListener.mockClear(); setAccessLevel.mockClear(); get.mockReset(); get.mockImplementation(storedProfile);
  vi.stubGlobal('chrome', { runtime: {
    id: extensionId,
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onMessage: { addListener },
    onConnect: { addListener: vi.fn() },
  }, storage: { local: { setAccessLevel, get }, onChanged: { addListener: vi.fn() } } });
  await import('../src/background/index');
});

describe('后台档案投影消息', () => {
  it('实习固定空消息只返回当前集合，证明联系人及其他资料不返回', async () => {
    const profile = createEmptyProfile(); profile.updatedAt = 'fictional-internship-revision';
    profile.basic.name = '不得返回的姓名'; profile.projects = [{ id: 'private-project', name: '不得返回的项目', technologies: [] }];
    profile.internships = internshipSessionProfile.internships.map(record => ({ ...record,
      certifierName: '不得返回的证明人', certifierContact: '不得返回的电话' }));
    get.mockResolvedValueOnce({ ['recruitment.profile.v1']: profile });
    const response = vi.fn(); const source = { ...sender({ id: extensionId, url: 'https://jobs.example/app', tab: { id: 7 } }), frameId: 0 };
    for (const extra of [{ payload: {} }, { selector: 'button' }, { index: 0 }, { internships: profile.internships }]) {
      expect(listener({ type: 'RA_PROFILE_INTERNSHIP', ...extra }, source, response)).toBe(false);
    }
    expect(response).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    expect(listener({ type: 'RA_PROFILE_INTERNSHIP' }, source, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledOnce());
    const result = response.mock.calls[0]![0] as { ok: boolean; data: unknown };
    expect(result).toEqual({ ok: true, data: internshipSessionProfile });
    expect(JSON.stringify(result)).not.toContain('不得返回');
  });
  it.each(['foreign', 'no-tab', 'internal', 'frame', 'missing-frame', 'negative-tab', 'fractional-tab'])('实习投影拒绝%s来源而不读存储', mode => {
    const response = vi.fn();
    const source = { ...sender({ id: mode === 'foreign' ? 'other' : extensionId,
      url: mode === 'internal' ? 'chrome-extension://other/page' : 'https://jobs.example',
      ...(mode !== 'no-tab' ? { tab: { id: mode === 'negative-tab' ? -7 : mode === 'fractional-tab' ? 1.5 : 7 } } : {}) }),
      ...(mode !== 'missing-frame' ? { frameId: mode === 'frame' ? 1 : 0 } : {}) };
    expect(listener({ type: 'RA_PROFILE_INTERNSHIP' }, source, response)).toBe(false);
    expect(response).toHaveBeenCalledWith({ ok: false, error: '不可信的档案投影请求' }); expect(get).not.toHaveBeenCalled();
  });
  it('教育请求仅返回教育与修订号，保持源顺序，不返回基本信息和项目', async () => {
    const profile = createEmptyProfile(); profile.updatedAt = '2026-10-02T00:00:00.000Z';
    profile.basic.name = '不得返回的姓名'; profile.education = educationSessionProfile.education.map(record => ({ ...record }));
    profile.projects = [{ id: 'private-project', name: '不得返回的项目', technologies: [] }];
    get.mockResolvedValueOnce({ ['recruitment.profile.v1']: profile });
    const response = vi.fn(); const source = sender({ id: extensionId, url: 'https://jobs.example/app', tab: { id: 7 } });
    expect(listener({ type: 'RA_PROFILE_EDUCATION', payload: { path: 'basic.name' } }, source, response)).toBe(false);
    expect(response).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    expect(listener({ type: 'RA_PROFILE_EDUCATION' }, source, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledOnce());
    const result = response.mock.calls[0]![0] as { ok: boolean; data: { recordType: string; education: { school: string }[] } };
    expect(result.ok).toBe(true); expect(Object.keys(result.data).sort()).toEqual(['education', 'profileRevision', 'recordType']);
    expect(result.data.education.map(record => record.school)).toEqual(educationSessionProfile.education.map(record => record.school));
    expect(JSON.stringify(result)).not.toContain('不得返回');
  });
  it.each(['foreign', 'no-tab', 'internal'])('教育投影不接受%s来源', mode => {
    const response = vi.fn();
    const source = sender({ id: mode === 'foreign' ? 'other' : extensionId,
      url: mode === 'internal' ? 'chrome-extension://other/page' : 'https://jobs.example',
      ...(mode !== 'no-tab' ? { tab: { id: 7 } } : {}) });
    expect(listener({ type: 'RA_PROFILE_EDUCATION' }, source, response)).toBe(false);
    expect(response).toHaveBeenCalledWith({ ok: false, error: '不可信的档案投影请求' }); expect(get).not.toHaveBeenCalled();
  });
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
