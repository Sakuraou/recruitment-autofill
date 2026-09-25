import { useEffect, useState } from 'react';
import { loadProfile } from '../profile/storage';
import { isMobileWorkflowPage } from '../content/mobileWorkflow';
import { workflowRequest, type WorkflowState } from '../workflow/model';
import { EXTENSION_VERSION } from '../shared/version';
import { errorMessage } from '../shared/errors';
import { currentTab, send } from './bridge';

export function MobileWorkflowControls() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<WorkflowState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [monthDates, setMonthDates] = useState(true);
  useEffect(() => {
    let disposed = false; let poll: ReturnType<typeof setTimeout> | undefined;
    const status = async (id: number) => {
      try {
        const result = await send<{ version: string; state: WorkflowState }>(id, { type: 'RA_WORKFLOW_STATUS' });
        if (result.version !== EXTENSION_VERSION) throw new Error('网页仍运行旧版脚本，请保留未保存内容后刷新招聘网页');
        if (!disposed) setState(result.state);
      } catch (cause) { if (!disposed) setError(errorMessage(cause)); }
      if (!disposed) poll = setTimeout(() => { void status(id); }, 1000);
    };
    void currentTab().then(async tab => {
      if (!isMobileWorkflowPage(tab.url ?? '') || disposed) return;
      setTabId(tab.id);
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] });
        if (!disposed) await status(tab.id);
      } catch (cause) { if (!disposed) setError(errorMessage(cause)); }
    }).catch(() => {});
    return () => { disposed = true; clearTimeout(poll); };
  }, []);
  async function action(type: 'RA_WORKFLOW_START' | 'RA_WORKFLOW_PAUSE' | 'RA_WORKFLOW_RESUME' | 'RA_WORKFLOW_STOP', scope: 'education-projects' | 'awards' | 'whole' = 'education-projects') {
    if (!tabId) return;
    setBusy(true); setError('');
    try {
      const tab = await currentTab();
      if (tab.id !== tabId || !isMobileWorkflowPage(tab.url ?? '')) throw new Error('请切回原来的中国移动简历页，再操作');
      const handshake = await send<{ version: string }>(tabId, { type: 'RA_WORKFLOW_STATUS' });
      if (handshake.version !== EXTENSION_VERSION) throw new Error('请保留未保存内容后刷新招聘网页，以加载新版脚本');
      const request = type === 'RA_WORKFLOW_START' ? { type, payload: workflowRequest(await loadProfile(), monthDates, scope) } : { type };
      setState(await send<WorkflowState>(tabId, request));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  if (!tabId) return null;
  const active = state && ['running', 'paused', 'blocked', 'review'].includes(state.phase);
  return <section className="workflow-panel" aria-label="中国移动连续填写">
    <h2>中国移动 · 连续填写</h2>
    <p>按档案展开栏目，逐条新增、填表并核验保存。包含教育、校内职务、实习、项目、奖励、专业论著、证书及计算机技能。缺资料时保留草稿并继续其他栏目，最后检查整页遗漏。</p>
    {!active && <><label className="workflow-date-option"><input type="checkbox" checked={monthDates} onChange={event => setMonthDates(event.target.checked)} />
      <span>月份日期按月初开始、月末结束填写（填表约定，原档案不变）</span></label>
      <button className="primary" type="button" disabled={busy || !state} onClick={() => void action('RA_WORKFLOW_START', 'whole')}>补全整份简历</button>
      <button className="secondary" type="button" disabled={busy || !state} onClick={() => void action('RA_WORKFLOW_START')}>连续填写教育与项目</button>
      <button className="secondary" type="button" disabled={busy || !state} onClick={() => void action('RA_WORKFLOW_START', 'awards')}>连续填写在校奖励</button></>}
    {state && state.phase !== 'idle' && <div className="workflow-status" role="status">
      <strong>本轮已检查 {state.index}/{state.total} 条 · 已保存 {state.saved} 条 · 已有 {state.existing} 条</strong>
      {state.current && <p>{state.current}</p>}<p>{state.message}</p>
      {!!state.issues.length && <ul>{state.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    </div>}
    {active && <div className="popup-actions"><button className="secondary" type="button" disabled={busy} onClick={() => void action(state.phase === 'running' ? 'RA_WORKFLOW_PAUSE' : 'RA_WORKFLOW_RESUME')}>{state.phase === 'running' ? '暂停连续填写' : '继续连续填写'}</button>
      <button className="secondary" type="button" disabled={busy} onClick={() => void action('RA_WORKFLOW_STOP')}>停止连续填写</button></div>}
    {error && <p className="notice" role="alert">{error}</p>}
    <small>关闭弹窗后任务继续。未知的证明、薪资等不会采用默认“否”或随意猜测；家庭、求职意向等未核验栏目会列入待办。最终投递由你完成。</small>
  </section>;
}
