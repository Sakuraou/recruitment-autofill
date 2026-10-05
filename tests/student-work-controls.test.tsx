import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudentWorkRecordControls } from '../src/popup/StudentWorkRecords';
import { EXTENSION_VERSION } from '../src/shared/version';
import type { RecordWorkflowState } from '../src/workflow/recordState';

const bridge = vi.hoisted(() => ({ currentTab: vi.fn(), send: vi.fn() }));
vi.mock('../src/popup/bridge', () => bridge);
let state: RecordWorkflowState;
let finish!: (value: RecordWorkflowState) => void;
let pending: Promise<RecordWorkflowState>;

beforeEach(() => {
  state = { phase: 'idle', total: 0, canStart: true };
  pending = new Promise(done => { finish = done; });
  bridge.currentTab.mockResolvedValue({ id: 8, url: 'https://careers.example.test/student-work' });
  bridge.send.mockImplementation(async (_id, message) => {
    if (message.type.endsWith('_STATUS')) return { version: EXTENSION_VERSION, state };
    if (message.type.endsWith('_START')) { state = { phase: 'preparing', total: 0, canStart: false }; return pending; }
    if (message.type.endsWith('_STOP')) { state = { phase: 'stopped', total: 0, canStart: true }; return state; }
    throw new Error('Unexpected command');
  });
  vi.stubGlobal('chrome', { scripting: { executeScript: vi.fn(async () => []) } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('启动只发送固定校内职务消息，脚本仅注入主框架；完整后不谎称整份简历完成', async () => {
  render(<StudentWorkRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部校内职务' }));
  await screen.findByRole('button', { name: '停止校内职务填写' });
  expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 8, frameIds: [0] }, files: ['content.js'] });
  expect(bridge.send).toHaveBeenCalledWith(8, { type: 'RA_STUDENT_WORK_RECORD_START' });
  state = { phase: 'complete', total: 3, canStart: true };
  await act(async () => { finish(state); await pending; });
  await screen.findByText('全部 3 段经历已处理并核验。请检查网页；其他栏目和最终投递仍需完成。');
  expect(bridge.send.mock.calls.every(([, request]) => Object.keys(request).length === 1)).toBe(true);
});
it('旧网页脚本拒绝启动，不发送开始消息', async () => {
  bridge.send.mockResolvedValue({ version: '0.0.0', state });
  render(<StudentWorkRecordControls />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '连续填写全部校内职务' })).toBeNull();
  expect(bridge.send.mock.calls.some(([, request]) => request.type.endsWith('_START'))).toBe(false);
});
it('切换标签后拒绝启动，保留原页任务状态', async () => {
  render(<StudentWorkRecordControls />);
  const start = await screen.findByRole('button', { name: '连续填写全部校内职务' });
  bridge.currentTab.mockResolvedValue({ id: 9, url: 'https://careers.example.test/another' });
  fireEvent.click(start); await screen.findByText('请切回启动任务的招聘页面');
  expect(bridge.send.mock.calls.some(([, request]) => request.type.endsWith('_START'))).toBe(false);
});
it('身份信息不完整保持待检查，并明确组织、职务和任期缺口', async () => {
  state = { phase: 'review', total: 3, canStart: false, reason: 'record-identity-unverified' };
  render(<StudentWorkRecordControls />);
  await screen.findByText('校内职务缺少组织、担任职务或完整任期，无法可靠核对重复记录。');
  expect(screen.queryByText(/全部 3 段经历已处理并核验/)).toBeNull();
  expect(screen.getByRole('button', { name: '停止校内职务填写' })).not.toBeNull();
});

it('启动请求未返回时，弹窗显示准备并允许停止；迟到的启动回复不能覆盖停止状态', async () => {
  render(<StudentWorkRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部校内职务' }));
  await screen.findByText('正在读取校内职务档案，并等待网页展开经历列表…');
  const stop = screen.getByRole('button', { name: '停止校内职务填写' });
  expect((stop as HTMLButtonElement).disabled).toBe(false); fireEvent.click(stop);
  await screen.findByText('校内职务任务已停止。已保存记录与网页草稿保留。');
  await act(async () => { finish({ phase: 'complete', total: 2, canStart: true }); await pending; });
  expect(screen.queryByText(/全部 2 段经历已处理并核验/)).toBeNull();
  expect(bridge.send.mock.calls.filter(([, message]) => message.type.endsWith('_STOP'))).toHaveLength(1);
});

it('准备中关闭弹窗不发送停止，重开仍能查看真实准备状态并停止', async () => {
  const first = render(<StudentWorkRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部校内职务' }));
  await screen.findByRole('button', { name: '停止校内职务填写' }); first.unmount();
  expect(bridge.send.mock.calls.some(([, message]) => message.type.endsWith('_STOP'))).toBe(false);
  render(<StudentWorkRecordControls />);
  await screen.findByText('正在读取校内职务档案，并等待网页展开经历列表…');
  fireEvent.click(screen.getByRole('button', { name: '停止校内职务填写' }));
  await waitFor(() => expect(screen.queryByText('校内职务任务已停止。已保存记录与网页草稿保留。')).not.toBeNull());
  await act(async () => { finish(state); await pending; });
});

it('停止后的迟到回复只触发真实查询，不把不可启动状态改为可启动', async () => {
  render(<StudentWorkRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部校内职务' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止校内职务填写' }));
  await screen.findByText('校内职务任务已停止。已保存记录与网页草稿保留。');
  state = { phase: 'stopped', total: 0, canStart: false };
  await act(async () => { finish({ phase: 'complete', total: 2, canStart: true }); await pending; });
  await waitFor(() => expect((screen.getByRole('button', { name: '连续填写全部校内职务' }) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.queryByText(/全部 2 段经历已处理并核验/)).toBeNull();
});

it('旧准备加载结束后真实页面已就绪，刷新状态恢复启动按钮', async () => {
  bridge.send.mockImplementation(async (_id, message) => {
    if (message.type.endsWith('_STATUS')) return { version: EXTENSION_VERSION, state };
    if (message.type.endsWith('_START')) { state = { phase: 'preparing', total: 0, canStart: false }; return pending; }
    state = { phase: 'stopped', total: 0, canStart: false }; return state;
  });
  render(<StudentWorkRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部校内职务' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止校内职务填写' }));
  await screen.findByText('校内职务任务已停止。已保存记录与网页草稿保留。');
  expect((screen.getByRole('button', { name: '连续填写全部校内职务' }) as HTMLButtonElement).disabled).toBe(true);
  state = { phase: 'stopped', total: 0, canStart: true };
  await act(async () => { finish(state); await pending; });
  await waitFor(() => expect((screen.getByRole('button', { name: '连续填写全部校内职务' }) as HTMLButtonElement).disabled).toBe(false));
});
