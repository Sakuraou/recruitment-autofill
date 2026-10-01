import { useEffect, useState } from 'react';
import { currentTab, send } from './bridge';
import { EXTENSION_VERSION } from '../shared/version';
import { errorMessage } from '../shared/errors';
import { projectWorkflowReason, type ProjectWorkflowState } from '../workflow/projectRecords';

type Action = 'RA_PROJECT_RECORD_START' | 'RA_PROJECT_RECORD_PAUSE' | 'RA_PROJECT_RECORD_RESUME' | 'RA_PROJECT_RECORD_STOP';

export function ProjectRecordControls() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<ProjectWorkflowState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false; let poll: ReturnType<typeof setTimeout> | undefined;
    async function status(id: number) {
      try {
        const result = await send<{ version: string; state: ProjectWorkflowState }>(id, { type: 'RA_PROJECT_RECORD_STATUS' });
        if (result.version !== EXTENSION_VERSION) throw new Error('请保留网页草稿后刷新招聘网页，以加载新版项目连续填写');
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
  }, [revision]);

  async function action(type: Action) {
    if (!tabId) return;
    setBusy(true); setError('');
    try {
      const tab = await currentTab();
      if (tab.id !== tabId) throw new Error('请切回启动任务的项目页面');
      const handshake = await send<{ version: string }>(tabId, { type: 'RA_PROJECT_RECORD_STATUS' });
      if (handshake.version !== EXTENSION_VERSION) throw new Error('请保留网页草稿后刷新招聘网页');
      setState(await send<ProjectWorkflowState>(tabId, { type })); setRevision(value => value + 1);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  if (!state || (!state.canStart && state.phase === 'idle')) return null;
  const active = ['preparing', 'running', 'pausing', 'paused', 'review'].includes(state.phase);
  return <section className="workflow-panel" aria-label="通用项目连续填写">
    <h2>项目 · 连续填写（试用）</h2>
    <p>按档案顺序逐条检查项目，跳过已有项，添加、填写并核验每条保存结果。支持明确的项目列表与原生表单控件。</p>
    {!active && <button className="primary" type="button" disabled={busy || !state.canStart} onClick={() => void action('RA_PROJECT_RECORD_START')}>连续填写全部项目</button>}
    <div className="workflow-status" role="status">
      {state.phase === 'preparing' && <p>正在读取本地项目档案…</p>}
      {state.phase === 'running' && <p>正在逐条填写 {state.total} 个档案项目。可以关闭弹窗，任务会继续。</p>}
      {state.phase === 'pausing' && <p>正在暂停，当前步骤核验结束后停止后续操作。</p>}
      {state.phase === 'paused' && <p>项目填写已暂停，请检查网页后继续。</p>}
      {state.phase === 'complete' && <p>全部 {state.total} 个档案项目已处理并核验。请检查网页；其他栏目和最终投递仍需完成。</p>}
      {state.phase === 'review' && <p>项目填写需要检查，当前草稿已保留。处理网页后，停止本轮再重新启动。</p>}
      {state.phase === 'stopped' && <p>项目任务已停止。已保存记录与网页草稿保留。</p>}
      {state.reason && <p>{projectWorkflowReason(state.reason)}</p>}
    </div>
    {active && <div className="popup-actions">
      {state.phase === 'running' && <button className="secondary" type="button" disabled={busy} onClick={() => void action('RA_PROJECT_RECORD_PAUSE')}>暂停项目填写</button>}
      {state.phase === 'paused' && <button className="secondary" type="button" disabled={busy} onClick={() => void action('RA_PROJECT_RECORD_RESUME')}>继续项目填写</button>}
      <button className="secondary" type="button" disabled={busy} onClick={() => void action('RA_PROJECT_RECORD_STOP')}>停止项目填写</button>
    </div>}
    {error && <p className="notice" role="alert">{error}</p>}
    <small>关闭弹窗后仍继续。缺少事实或无法判断字段时会停止并保留草稿；不自动删除、上传、勾选协议或最终提交。</small>
  </section>;
}
