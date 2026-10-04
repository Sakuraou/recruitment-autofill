import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InternshipRecordControls } from '../src/popup/InternshipRecords';
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
  bridge.currentTab.mockResolvedValue({ id: 8, url: 'https://careers.example.test/internship' });
  bridge.send.mockImplementation(async (_id, message) => {
    if (message.type.endsWith('_STATUS')) return { version: EXTENSION_VERSION, state };
    if (message.type.endsWith('_START')) { state = { phase: 'preparing', total: 0, canStart: false }; return pending; }
    if (message.type.endsWith('_STOP')) { state = { phase: 'stopped', total: 0, canStart: true }; return state; }
    throw new Error('Unexpected command');
  });
  vi.stubGlobal('chrome', { scripting: { executeScript: vi.fn(async () => []) } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('启动请求未返回时，弹窗显示准备并允许停止；迟到的启动回复不能覆盖停止状态', async () => {
  render(<InternshipRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部实习经历' }));
  await screen.findByText('正在读取实习档案，并等待网页展开实习列表…');
  const stop = screen.getByRole('button', { name: '停止实习填写' });
  expect((stop as HTMLButtonElement).disabled).toBe(false); fireEvent.click(stop);
  await screen.findByText('实习任务已停止。已保存记录与网页草稿保留。');
  await act(async () => { finish({ phase: 'complete', total: 2, canStart: true }); await pending; });
  expect(screen.queryByText(/全部 2 条实习经历已处理并核验/)).toBeNull();
  expect(bridge.send.mock.calls.filter(([, message]) => message.type.endsWith('_STOP'))).toHaveLength(1);
});

it('准备中关闭弹窗不发送停止，重开仍能查看真实准备状态并停止', async () => {
  const first = render(<InternshipRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部实习经历' }));
  await screen.findByRole('button', { name: '停止实习填写' }); first.unmount();
  expect(bridge.send.mock.calls.some(([, message]) => message.type.endsWith('_STOP'))).toBe(false);
  render(<InternshipRecordControls />);
  await screen.findByText('正在读取实习档案，并等待网页展开实习列表…');
  fireEvent.click(screen.getByRole('button', { name: '停止实习填写' }));
  await waitFor(() => expect(screen.queryByText('实习任务已停止。已保存记录与网页草稿保留。')).not.toBeNull());
  await act(async () => { finish(state); await pending; });
});

it('停止后的迟到回复只触发真实查询，不把不可启动状态改为可启动', async () => {
  render(<InternshipRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部实习经历' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止实习填写' }));
  await screen.findByText('实习任务已停止。已保存记录与网页草稿保留。');
  state = { phase: 'stopped', total: 0, canStart: false };
  await act(async () => { finish({ phase: 'complete', total: 2, canStart: true }); await pending; });
  await waitFor(() => expect((screen.getByRole('button', { name: '连续填写全部实习经历' }) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.queryByText(/全部 2 条实习经历已处理并核验/)).toBeNull();
});

it('旧准备加载结束后真实页面已就绪，刷新状态恢复启动按钮', async () => {
  bridge.send.mockImplementation(async (_id, message) => {
    if (message.type.endsWith('_STATUS')) return { version: EXTENSION_VERSION, state };
    if (message.type.endsWith('_START')) { state = { phase: 'preparing', total: 0, canStart: false }; return pending; }
    state = { phase: 'stopped', total: 0, canStart: false }; return state;
  });
  render(<InternshipRecordControls />);
  fireEvent.click(await screen.findByRole('button', { name: '连续填写全部实习经历' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止实习填写' }));
  await screen.findByText('实习任务已停止。已保存记录与网页草稿保留。');
  expect((screen.getByRole('button', { name: '连续填写全部实习经历' }) as HTMLButtonElement).disabled).toBe(true);
  state = { phase: 'stopped', total: 0, canStart: true };
  await act(async () => { finish(state); await pending; });
  await waitFor(() => expect((screen.getByRole('button', { name: '连续填写全部实习经历' }) as HTMLButtonElement).disabled).toBe(false));
});
