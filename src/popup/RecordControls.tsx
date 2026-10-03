import { useEffect, useState } from 'react';
import { currentTab, send } from './bridge';
import { EXTENSION_VERSION } from '../shared/version';
import { errorMessage } from '../shared/errors';
import type { RecordWorkflowState } from '../workflow/recordState';


type RecordCommand = `RA_${'PROJECT' | 'EDUCATION' | 'INTERNSHIP'}_RECORD_${'START' | 'STATUS' | 'PAUSE' | 'RESUME' | 'STOP'}`;
export interface RecordControlsConfig {
  readonly messages: Readonly<Record<'status' | 'start' | 'pause' | 'resume' | 'stop', RecordCommand>>;
  readonly section: string; readonly title: string; readonly description: string;
  readonly startLabel: string; readonly noun: string; readonly unit: string;
  readonly reason: (reason?: string) => string;
}
export function RecordControls({ config }: { config: RecordControlsConfig }) {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<RecordWorkflowState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false; let poll: ReturnType<typeof setTimeout> | undefined;
    async function status(id: number) {
      try {
        const result = await send<{ version: string; state: RecordWorkflowState }>(id, { type: config.messages.status });
        if (result.version !== EXTENSION_VERSION) throw new Error('请保留网页草稿后刷新招聘网页，以加载新版连续填写');
        if (!disposed) {
          setState(result.state);
          if (['preparing', 'running', 'pausing', 'paused'].includes(result.state.phase)) poll = setTimeout(() => { void status(id); }, 750);
        }
      } catch (cause) { if (!disposed) setError(errorMessage(cause)); }
    }
    void currentTab().then(async tab => {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] });
      if (!disposed) { setTabId(tab.id); await status(tab.id); }
    }).catch(() => {});
    return () => { disposed = true; clearTimeout(poll); };
  }, [revision, config]);

  async function action(type: RecordCommand) {
    if (!tabId) return;
    setBusy(true); setError('');
    try {
      const tab = await currentTab();
      if (tab.id !== tabId) throw new Error('请切回启动任务的招聘页面');
      const handshake = await send<{ version: string }>(tabId, { type: config.messages.status });
      if (handshake.version !== EXTENSION_VERSION) throw new Error('请保留网页草稿后刷新招聘网页');
      setState(await send<RecordWorkflowState>(tabId, { type })); setRevision(value => value + 1);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  if (!state || (!state.canStart && state.phase === 'idle')) return null;
  const active = ['preparing', 'running', 'pausing', 'paused', 'review'].includes(state.phase);
  return <section className="workflow-panel" aria-label={config.section}>
    <h2>{config.title}</h2>
    <p>{config.description}</p>
    {!active && <button className="primary" type="button" disabled={busy || !state.canStart} onClick={() => void action(config.messages.start)}>{config.startLabel}</button>}
    <div className="workflow-status" role="status">
      {state.phase === 'preparing' && <p>正在读取本地{config.noun}档案…</p>}
      {state.phase === 'running' && <p>正在逐条填写 {state.total} {config.unit}。可以关闭弹窗，任务会继续。</p>}
      {state.phase === 'pausing' && <p>正在暂停，当前步骤核验结束后停止后续操作。</p>}
      {state.phase === 'paused' && <p>{config.noun}填写已暂停，请检查网页后继续。</p>}
      {state.phase === 'complete' && <p>全部 {state.total} {config.unit}已处理并核验。请检查网页；其他栏目和最终投递仍需完成。</p>}
      {state.phase === 'review' && <p>{config.noun}填写需要检查，当前草稿已保留。处理网页后，停止本轮再重新启动。</p>}
      {state.phase === 'stopped' && <p>{config.noun}任务已停止。已保存记录与网页草稿保留。</p>}
      {state.reason && <p>{config.reason(state.reason)}</p>}
    </div>
    {active && <div className="popup-actions">
      {state.phase === 'running' && <button className="secondary" type="button" disabled={busy} onClick={() => void action(config.messages.pause)}>暂停{config.noun}填写</button>}
      {state.phase === 'paused' && <button className="secondary" type="button" disabled={busy} onClick={() => void action(config.messages.resume)}>继续{config.noun}填写</button>}
      <button className="secondary" type="button" disabled={busy} onClick={() => void action(config.messages.stop)}>停止{config.noun}填写</button>
    </div>}
    {error && <p className="notice" role="alert">{error}</p>}
    <small>关闭弹窗后仍继续。缺少事实或无法判断字段时会停止并保留草稿；不自动删除、上传、勾选协议或最终提交。</small>
  </section>;
}

