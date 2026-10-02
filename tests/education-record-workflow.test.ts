import { afterEach, expect, it, vi } from 'vitest';
import { EducationRecordWorkflow } from '../src/content/educationRecordWorkflow';
import type { EducationProjectionResponse } from '../src/profile/educationProjection';
import type { RecordV2Session, RecordV2SessionResult } from '../src/content/recordV2Gateway';

const projection: EducationProjectionResponse = { recordType: 'education', profileRevision: 'fictional-workflow-revision', education: [{ id: 'fictional-bachelor', school: '虚构青岚学院', level: '本科', major: '软件工程' }] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fakeSession(advance?: () => Promise<RecordV2SessionResult>) {
  let state: RecordV2Session['state'] = 'ready'; let version = 0;
  return {
    get state() { return state; }, get snapshotVersion() { return version; },
    advance: vi.fn(advance ?? (async (): Promise<RecordV2SessionResult> => ({ status: ++version <= 3 ? 'advanced' : 'complete', snapshotVersion: version }))),
    pause: vi.fn(() => { state = 'paused'; }), resume: vi.fn(() => { state = 'ready'; }),
    stop: vi.fn(() => { state = 'stopped'; }),
  } satisfies RecordV2Session;
}
afterEach(() => { window.history.replaceState({}, '', '/'); });

it('启动一次后自主推进到完成，不需要弹窗持续调用 advance', async () => {
  const session = fakeSession();
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start();
  await vi.waitFor(() => expect(flow.status().phase).toBe('complete'));
  expect(session.advance).toHaveBeenCalledTimes(4);
  expect(flow.status()).toMatchObject({ total: 1, phase: 'complete' });
  expect(flow.holdsPage()).toBe(false);
});

it('重复启动不能创建第二个任务或再次调用工厂', async () => {
  const gate = deferred<RecordV2SessionResult>(); const factory = vi.fn(() => fakeSession(() => gate.promise));
  const flow = new EducationRecordWorkflow(document, async () => projection, factory);
  await flow.start();
  await expect(flow.start()).rejects.toThrow();
  expect(factory).toHaveBeenCalledTimes(1);
  flow.stop(); gate.resolve({ status: 'stopped', snapshotVersion: 0 });
});

it('读档案期间停止，迟到的档案不能创建或推进会话', async () => {
  const gate = deferred<EducationProjectionResponse>(); const factory = vi.fn(() => fakeSession());
  const flow = new EducationRecordWorkflow(document, () => gate.promise, factory);
  const starting = flow.start(); flow.stop(); gate.resolve(projection);
  await starting;
  expect(factory).not.toHaveBeenCalled(); expect(flow.status().phase).toBe('stopped');
});

it('读档案期间导航，迟到的档案不能开始填写', async () => {
  const gate = deferred<EducationProjectionResponse>(); const factory = vi.fn(() => fakeSession());
  const flow = new EducationRecordWorkflow(document, () => gate.promise, factory);
  const starting = flow.start(); window.history.replaceState({}, '', '/other-form'); gate.resolve(projection);
  await starting;
  expect(factory).not.toHaveBeenCalled();
  expect(flow.status()).toMatchObject({ phase: 'review', reason: 'page-changed' });
  flow.stop();
});

it('字段语义缺口只推进一次，保留草稿并给出明确原因', async () => {
  const session = fakeSession(async () => ({ status: 'request-human', reason: 'field-semantic-unknown', snapshotVersion: 2 }));
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start();
  await vi.waitFor(() => expect(flow.status().phase).toBe('review'));
  expect(flow.status().reason).toBe('field-semantic-unknown');
  expect(session.advance).toHaveBeenCalledTimes(1); expect(flow.holdsPage()).toBe(true);
  flow.stop(); expect(flow.holdsPage()).toBe(false);
});

it('异常不能把错误消息里的个人值带到状态', async () => {
  const session = fakeSession(async () => { throw new Error('虚构私密说明不应出现在公共状态'); });
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start(); await vi.waitFor(() => expect(flow.status().phase).toBe('review'));
  expect(JSON.stringify(flow.status())).not.toContain('虚构私密');
  expect(flow.status().reason).toBe('run-failed'); flow.stop();
});

it('无限 advanced 被次数限制停止，不能变成无界点击循环', async () => {
  const session = fakeSession(async () => ({ status: 'advanced', snapshotVersion: 1 }));
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start(); await vi.waitFor(() => expect(flow.status().phase).toBe('review'));
  expect(flow.status().reason).toBe('action-limit');
  // One Add, up to three population batches, one Save, then a final observation.
  expect(session.advance).toHaveBeenCalledTimes(6); expect(session.stop).toHaveBeenCalled(); flow.stop();
});

it('完整使用两次联动后仍允许最后一次完成观察', async () => {
  let calls = 0;
  const session = fakeSession(async () => ({ status: ++calls <= 5 ? 'advanced' : 'complete', snapshotVersion: calls }));
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start(); await vi.waitFor(() => expect(flow.status().phase).toBe('complete'));
  expect(session.advance).toHaveBeenCalledTimes(6); expect(session.stop).not.toHaveBeenCalled();
});

it('多个教育的虚假无限进展仍被固定总上限停止', async () => {
  const session = fakeSession(async () => ({ status: 'advanced', snapshotVersion: 1 }));
  const several = { ...projection, education: Array.from({ length: 6 }, (_, index) => ({ ...projection.education[0]!, id: `bounded-${index}` })) };
  const flow = new EducationRecordWorkflow(document, async () => several, () => session);
  await flow.start(); await vi.waitFor(() => expect(flow.status().phase).toBe('review'));
  expect(flow.status().reason).toBe('action-limit');
  expect(session.advance).toHaveBeenCalledTimes(31); expect(session.stop).toHaveBeenCalled(); flow.stop();
});

it('暂停后的迟到步骤不能推进下一条，恢复会等待旧步骤结束', async () => {
  const gate = deferred<RecordV2SessionResult>(); let calls = 0;
  const session = fakeSession(async () => ++calls === 1 ? gate.promise : { status: 'complete', snapshotVersion: 2 });
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start(); flow.pause();
  const resuming = flow.resume();
  expect(session.resume).not.toHaveBeenCalled();
  gate.resolve({ status: 'paused', snapshotVersion: 1 }); await resuming;
  await vi.waitFor(() => expect(flow.status().phase).toBe('complete'));
  expect(session.advance).toHaveBeenCalledTimes(2);
});

it('停止后的迟到结果不能把状态改回完成，也不能再执行下一步', async () => {
  const gate = deferred<RecordV2SessionResult>(); const session = fakeSession(() => gate.promise);
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start(); flow.stop(); gate.resolve({ status: 'complete', snapshotVersion: 1 });
  await vi.waitFor(() => expect(flow.holdsPage()).toBe(false));
  expect(flow.status().phase).toBe('stopped'); expect(session.advance).toHaveBeenCalledTimes(1);
});

it('当前步骤完成前请求暂停，不取消核验，也不推进下一步', async () => {
  const gate = deferred<RecordV2SessionResult>(); const session = fakeSession(() => gate.promise);
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start();
  expect(flow.pause().phase).toBe('pausing'); expect(session.pause).not.toHaveBeenCalled();
  gate.resolve({ status: 'advanced', snapshotVersion: 2 });
  await vi.waitFor(() => expect(flow.status().phase).toBe('paused'));
  expect(session.pause).not.toHaveBeenCalled(); expect(session.advance).toHaveBeenCalledTimes(1); flow.stop();
});

it('步骤等待期间导航，迟到完成不得改回成功', async () => {
  const gate = deferred<RecordV2SessionResult>(); const session = fakeSession(() => gate.promise);
  const flow = new EducationRecordWorkflow(document, async () => projection, () => session);
  await flow.start(); window.history.replaceState({}, '', '/other-application');
  gate.resolve({ status: 'complete', snapshotVersion: 2 });
  await vi.waitFor(() => expect(flow.status().phase).toBe('review'));
  expect(flow.status().reason).toBe('page-changed'); expect(session.stop).toHaveBeenCalled(); flow.stop();
});

