import { describe, expect, it, vi } from 'vitest';
import { RecordV2Gateway, type RecordV2GatewayState, type RecordV2Session,
  type RecordV2SessionResult } from '../src/content/recordV2Gateway';

function createSession(options: {
  state?: Exclude<RecordV2GatewayState, 'disabled' | 'idle'>;
  snapshotVersion?: number;
  advance?: () => Promise<RecordV2SessionResult>;
} = {}) {
  let state = options.state ?? 'ready';
  let version = options.snapshotVersion ?? 1;
  const defaultAdvance = async (): Promise<RecordV2SessionResult> => {
    state = 'running';
    version += 1;
    return { status: 'advanced', snapshotVersion: version };
  };
  const session: RecordV2Session = {
    get state() { return state; },
    get snapshotVersion() { return version; },
    advance: vi.fn(options.advance ?? defaultAdvance),
    pause: vi.fn(() => { state = 'paused'; }),
    resume: vi.fn(() => { state = 'ready'; }),
    stop: vi.fn(() => { state = 'stopped'; }),
  };
  return session;
}

describe('RecordV2Gateway', () => {
  it('默认关闭，不能启动或推进', async () => {
    const gateway = new RecordV2Gateway({ enabled: false });
    expect(gateway.status()).toEqual({ enabled: false, state: 'disabled', snapshotVersion: 0 });
    expect(() => gateway.start()).toThrow('通用多记录填写功能尚未启用');
    await expect(gateway.advance()).rejects.toThrow('通用多记录填写功能尚未启用');
  });

  it('仅由可信工厂创建会话，且拒绝重复启动', () => {
    const session = createSession();
    const factory = vi.fn(() => session);
    const gateway = new RecordV2Gateway({ enabled: true, createSession: factory,
      currentPageKey: () => '/fixture' });

    expect(gateway.start()).toEqual({ enabled: true, state: 'ready', snapshotVersion: 1 });
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith();
    expect(() => gateway.start()).toThrow('通用多记录填写会话已经存在');
  });

  it('转发单步推进、暂停、恢复和停止，但不替会话执行额外步骤', async () => {
    const session = createSession();
    const gateway = new RecordV2Gateway({ enabled: true, createSession: () => session,
      currentPageKey: () => '/fixture' });
    gateway.start();

    await expect(gateway.advance()).resolves.toEqual({ status: 'advanced', snapshotVersion: 2 });
    expect(session.advance).toHaveBeenCalledOnce();
    expect(gateway.pause()).toMatchObject({ state: 'paused', snapshotVersion: 2 });
    expect(session.pause).toHaveBeenCalledOnce();
    expect(gateway.resume()).toMatchObject({ state: 'ready', snapshotVersion: 2 });
    expect(session.resume).toHaveBeenCalledOnce();
    expect(gateway.stop()).toMatchObject({ state: 'stopped', snapshotVersion: 2 });
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it('页面地址变化会停止并丢弃旧会话', () => {
    let currentPage = '/fixture-a';
    const session = createSession();
    const gateway = new RecordV2Gateway({ enabled: true, createSession: () => session,
      currentPageKey: () => currentPage });
    gateway.start();

    currentPage = '/fixture-b';
    expect(gateway.status()).toEqual({ enabled: true, state: 'request-human', snapshotVersion: 0,
      reason: 'page-changed' });
    expect(session.stop).toHaveBeenCalledOnce();
    expect(() => gateway.resume()).toThrow('页面已变化，请重新启动');
  });

  it('推进期间发生页面变化时使迟到结果失效', async () => {
    let currentPage = '/fixture-a';
    let finishAdvance!: (result: RecordV2SessionResult) => void;
    const session = createSession({ advance: () => new Promise(resolve => { finishAdvance = resolve; }) });
    const gateway = new RecordV2Gateway({ enabled: true, createSession: () => session,
      currentPageKey: () => currentPage });
    gateway.start();

    const pending = gateway.advance();
    currentPage = '/fixture-b';
    expect(gateway.status()).toMatchObject({ state: 'request-human', reason: 'page-changed' });
    finishAdvance({ status: 'advanced', snapshotVersion: 2 });
    await expect(pending).resolves.toEqual({ status: 'request-human', snapshotVersion: 0,
      reason: 'page-changed' });
    expect(session.stop).toHaveBeenCalledOnce();
    expect(gateway.status()).toMatchObject({ state: 'request-human', reason: 'page-changed' });
  });

  it('驱动请求人工处理时保留原因', async () => {
    const session = createSession({ advance: async () => ({ status: 'request-human', snapshotVersion: 3,
      reason: 'ambiguous-card' }) });
    const gateway = new RecordV2Gateway({ enabled: true, createSession: () => session,
      currentPageKey: () => '/fixture' });
    gateway.start();

    await expect(gateway.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'ambiguous-card' });
    expect(gateway.status()).toMatchObject({ state: 'request-human', reason: 'ambiguous-card' });
    await expect(gateway.advance()).rejects.toThrow('当前会话需要人工处理，请停止后重新启动');
    expect(session.advance).toHaveBeenCalledOnce();
  });
});
