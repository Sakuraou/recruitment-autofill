import { useEffect, useMemo, useRef, useState } from 'react';
import { recordCandidates, relatedRecordChoices } from '../matching/recordCandidates';
import { matchFields } from '../matching/ruleMatcher';
import { isExtensionContext, PROFILE_STORAGE_KEY } from '../profile/storage';
import { errorMessage } from '../shared/errors';
import type { FillOutcome } from '../shared/types';
import { fillAutoUntilStable, fillPlan, fillWithAi, readSelection, scanPage, type PagePlan } from './bridge';
import { AI_CONNECTION_KEY } from '../ai/connection';
import { createDebugReport, downloadDebugReport } from './debug';
import { EXTENSION_VERSION } from '../shared/version';
import { Results } from './Results';
import { MobileWorkflowControls } from './MobileWorkflow';
import { ProjectRecordControls } from './ProjectRecords';
import { EducationRecordControls } from './EducationRecords';
import { InternshipRecordControls } from './InternshipRecords';
import { PublicationRecordControls } from './PublicationRecords';
import { StudentWorkRecordControls } from './StudentWorkRecords';
import { AwardRecordControls } from './AwardRecords';
import { fillWithAgent } from './agentBridge';
import type { AgentRunStatus } from '../agent/runController';

export function PopupApp() {
  const [plan, setPlan] = useState<PagePlan>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(new Set<string>());
  const [showResults, setShowResults] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [outcomes, setOutcomes] = useState<FillOutcome[]>([]);
  const [jd, setJd] = useState('');
  const aiPending = useRef<AbortController | undefined>(undefined);
  const [agentStatus, setAgentStatus] = useState<AgentRunStatus>();
  const [agentActive, setAgentActive] = useState(false);
  const candidates = useMemo(() => new Map(plan?.scan.fields.map(field => [field.id, recordCandidates(field, plan.profile)]) ?? []), [plan?.scan, plan?.profile]);
  function chooseRecord(fieldId: string, profileKey: string) {
    if (!plan || busy) return;
    const field = plan.scan.fields.find(item => item.id === fieldId);
    if (!field) return;
    const match = profileKey ? candidates.get(fieldId)?.find(choice => choice.match.matchedProfileKey === profileKey)?.match
      : matchFields(plan.scan.fields, plan.profile).find(item => item.fieldId === fieldId);
    if (!match) return;
    setPlan({ ...plan, matches: plan.matches.map(item => item.fieldId === fieldId ? match : item) });
    setSelected(previous => { const next = new Set(previous); next.delete(fieldId); return next; });
  }
  useEffect(() => {
    if (!isExtensionContext()) return;
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && (changes[PROFILE_STORAGE_KEY] || changes[AI_CONNECTION_KEY])) {
        aiPending.current?.abort();
        setPlan(undefined); setSelected(new Set()); setOutcomes([]); setMessage('档案或 AI 连接已更新，请重新扫描页面。');
      }
    };
    chrome.storage.onChanged.addListener(changed);
    const cancel = () => aiPending.current?.abort();
    window.addEventListener('pagehide', cancel);
    return () => { chrome.storage.onChanged.removeListener(changed); window.removeEventListener('pagehide', cancel); cancel(); };
  }, []);
  async function scan() {
    setBusy(true); setMessage(''); setOutcomes([]); setSelected(new Set()); setPlan(undefined);
    try {
      const next = await scanPage(); setPlan(next); setShowResults(true);
      if (!next.scan.fields.length) setMessage('未检测到可访问的表单控件。跨域 iframe、封闭 Shadow DOM 或特殊自定义控件仍需人工处理。');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function fill(mode: 'auto' | 'review') {
    if (!plan) return;
    setBusy(true); setMessage('');
    try {
      const iterative = mode === 'auto' ? await fillAutoUntilStable(plan) : undefined;
      const result = iterative?.outcomes ?? await fillPlan(plan, selected, mode);
      if (iterative) {
        setPlan(iterative.plan);
        // A rescan creates fresh field IDs; the final page state itself records
        // completed values and is safer than carrying stale per-field outcomes.
        setOutcomes([]);
      } else {
        setOutcomes(previous => [...previous.filter(item => !result.some(next => item.fieldId === next.fieldId)), ...result]);
      }
      const filled = result.filter(item => item.status === 'filled').length;
      const rounds = iterative && iterative.rounds > 1 ? `，自动重扫 ${iterative.rounds - 1} 次` : '';
      setMessage(`已填写 ${filled} 项，跳过或未完成 ${result.length - filled} 项${rounds}。请检查网页。`);
      setSelected(new Set());
    } catch (error) { setMessage(errorMessage(error)); setPlan(undefined); }
    finally { setBusy(false); }
  }
  async function fillAi() {
    const controller = new AbortController(); aiPending.current = controller;
    setBusy(true); setSelected(new Set()); setOutcomes([]); setMessage('正在填写已知字段，并识别本页的未知字段…');
    try {
      const result = await fillWithAi(controller.signal);
      if (controller.signal.aborted) return;
      setPlan(result.plan); setShowResults(true);
      const filled = result.outcomes.filter(item => item.status === 'filled').length;
      const stateMessage = {
        ready: 'AI 识别已处理', disabled: 'AI 未启用，请在“我的档案 → AI 识别连接”配置',
        'no-candidates': result.rounds ? 'AI 识别已处理，没有新增未知字段' : '没有可交给 AI 的未知字段', rejected: 'AI 结果未通过核验，未用于填写',
        unavailable: 'AI 服务不可用或页面已变化，未知字段未填', timeout: 'AI 识别超时，未知字段未填', cancelled: 'AI 识别已停止',
        'no-progress': 'AI 识别已处理，本轮没有可继续自动填写的值', 'limit-reached': 'AI 识别已处理，已达到本次三轮上限',
      }[result.state];
      setMessage(`本次已填写 ${filled} 项，AI 识别 ${result.rounds} 轮。${stateMessage}。剩余字段请查看匹配结果并检查网页。`);
    } catch (error) { setPlan(undefined); setMessage(controller.signal.aborted ? '已停止后续 AI 填写，请检查网页中已经填入的内容。' : errorMessage(error)); }
    finally { if (aiPending.current === controller) { aiPending.current = undefined; setBusy(false); } }
  }
  async function fillAgent() {
    if (aiPending.current) return;
    const controller = new AbortController(); aiPending.current = controller;
    setBusy(true); setAgentActive(true); setSelected(new Set()); setOutcomes([]);
    setAgentStatus({ phase: 'observing', steps: 0 }); setMessage('Agent 正在检查本页的字段和经历栏目…');
    try {
      const value = await fillWithAgent(controller.signal, status => { if (!controller.signal.aborted) setAgentStatus(status); });
      if (controller.signal.aborted) { setMessage('Agent 已停止，请检查已经填写的内容；当前网页草稿保留。'); return; }
      if (value.plan) { setPlan(value.plan); setShowResults(true); }
      const state = value.result.state;
      const explanation = state === 'complete' ? '本页可访问且支持的任务已核验完成，请检查网页'
        : state === 'needs-user' ? '仍有待办或需要补充的资料，请检查当前栏目'
        : state === 'stopped' ? '已停止后续填写，网页草稿保留'
        : state === 'limit-reached' ? '达到本次处理上限，可检查网页后再次启动'
        : state === 'unavailable' ? '服务不可用或页面已变化，请检查兼容 API 服务和当前网页'
        : '本轮未能继续，请检查当前页面和剩余字段';
      const pending = value.result.pending;
      setMessage(`Agent 已执行 ${value.result.steps} 步，普通字段写入 ${value.outcomes.filter(item => item.status === 'filled').length} 项。${explanation}。${pending
        ? `待办：${pending.fields} 个字段、${pending.records} 条待核验经历、${pending.blockers} 处需处理。` : ''}`);
    } catch (error) { setMessage(controller.signal.aborted ? 'Agent 已停止，网页草稿保留。' : errorMessage(error)); }
    finally { if (aiPending.current === controller) { aiPending.current = undefined; setBusy(false); setAgentActive(false); } }
  }
  const matches = plan?.matches ?? [];
  function chooseRecordGroup(fieldId: string, profileKey: string) {
    if (!plan || busy) return;
    const choices = relatedRecordChoices(plan.scan.fields, candidates, fieldId, profileKey)
      .filter(item => !outcomes.some(done => done.fieldId === item.fieldId));
    const replacements = new Map(choices.map(item => [item.fieldId, item]));
    setPlan({ ...plan, matches: plan.matches.map(item => replacements.get(item.fieldId) ?? item) });
    setSelected(previous => new Set([...previous].filter(id => !replacements.has(id))));
    setMessage(`已为同组 ${choices.length} 项选择同一段经历。请核对各项候选并勾选；尚未写入网页。`);
  }
  const available = matches.filter(match => !outcomes.some(item => item.fieldId === match.fieldId));
  const autoCount = available.filter(match => match.status === 'auto').length;
  const canReview = (match: (typeof matches)[number]) => match.value !== undefined || (candidates.get(match.fieldId)?.length ?? 0) > 0;
  const reviewCount = available.filter(match => match.status === 'review' && canReview(match)).length;
  const missingCount = matches.filter(match => match.status === 'missing').length;
  const protectedCount = matches.filter(match => match.status === 'blocked' || match.status === 'existing'
    || (match.status === 'review' && !canReview(match))).length;
  const debug = plan ? createDebugReport(plan.scan, plan.matches, plan.profile, outcomes) : '';
  return <main className="popup-app">
    <header className="row popup-header"><div className="brand"><span className="brand-mark">申</span><span>网申助手<small>2027 CAMPUS RECRUITMENT</small></span></div>
      <button type="button" className="text-button" onClick={() => { if (isExtensionContext()) void chrome.runtime.openOptionsPage(); else window.location.href = './options.html'; }}>我的档案 ↗</button></header>
    <section className="popup-intro"><div className="eyebrow">LESS REPETITION. MORE OPPORTUNITY.</div><h1>这一页，交给你的档案。</h1><p>本地识别重复信息，每一次申请由你确认。</p></section>
    {plan && <div className="scan-host">{new URL(plan.scan.url).host || '本地文件'} · {plan.scan.title}</div>}
    <section className="workflow-panel" aria-label="Agent 连续填写">
      <h2>Agent 连续填写本页（试用）</h2>
      <p>自动推进普通字段、教育、项目、实习、奖励、专业论著和校内职务，逐条添加并核验。需要已配置的兼容 API 本地服务。</p>
      <button type="button" className="primary" disabled={busy} onClick={() => void fillAgent()}>启动 Agent 连续填写</button>
      {agentActive && <button type="button" className="secondary" onClick={() => aiPending.current?.abort()}>停止 Agent</button>}
      {agentActive && agentStatus && <p role="status">{({ observing: '正在检查网页', thinking: '正在安排下一步', acting: '正在填写并核验' } as Record<string,string>)[agentStatus.phase] ?? '正在处理'} · 已执行 {agentStatus.steps} 步</p>}
      <small>运行期间请保持弹窗打开；关闭会停止后续操作并保留网页草稿。陌生字段、资料不完整的经历、附件和最终提交仍列为待办。</small>
    </section>
    {message && <div className="notice" role="status">{message}</div>}
    {!agentActive && <><MobileWorkflowControls /><EducationRecordControls /><InternshipRecordControls /><ProjectRecordControls /><AwardRecordControls /><PublicationRecordControls /><StudentWorkRecordControls /></>}
    <div className="popup-stats">{[[matches.length, '检测字段'], [autoCount, '可直接填写'], [reviewCount, '需要确认'], [missingCount, '缺少信息']].map(([count, label]) => <div key={label}><strong>{String(count).padStart(2, '0')}</strong><span>{label}</span></div>)}</div>
    <div className="popup-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void scan()}>{busy ? '处理中…' : '扫描页面'}</button>
      <button type="button" className="primary" disabled={busy || !autoCount} onClick={() => void fill('auto')}>一键填写高置信度字段</button></div>
    <div className="popup-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void fillAi()}>AI 识别并填写本页</button>
      {aiPending.current && !agentActive && <button type="button" className="secondary" onClick={() => aiPending.current?.abort()}>停止 AI 填写</button>}</div>

    {plan?.scan.warnings.map(warning => <div className="notice" key={warning}>{warning}</div>)}
    {!plan && !message && <div className="popup-profile-empty"><strong>从一份真实档案开始</strong>先在「我的档案」保存信息，再扫描当前网申页面。</div>}
    {plan && <><div className="row results-header"><h2>匹配结果 <span className="count">{matches.length}</span></h2><div className="view-tools"><label><input type="checkbox" checked={reveal} onChange={event => setReveal(event.target.checked)} />显示个人值</label><button className="text-button" type="button" onClick={() => setShowResults(value => !value)}>{showResults ? '收起' : '查看匹配结果'}</button></div></div>
      {showResults && <Results fields={plan.scan.fields} matches={matches} selected={selected} reveal={reveal} outcomes={outcomes} busy={busy} candidates={candidates} onChoose={chooseRecord} onChooseGroup={chooseRecordGroup} onSelect={(id, checked) => setSelected(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; })} />}
      {reviewCount > 0 && <button type="button" className="secondary confirmed-action" disabled={busy || !selected.size} onClick={() => void fill('review')}>确认填写已勾选的 {selected.size} 项</button>}
      {!!protectedCount && <p className="match-reason">另有 {protectedCount} 项已有内容或需要人工处理，已保护。</p>}
      <button type="button" className="secondary confirmed-action" disabled={busy} onClick={() => {
        try { downloadDebugReport(debug); setMessage('已生成问题报告：候选值已隐藏，包含识别与填写结果。分享前请检查是否还有网站文字中的个人信息。'); }
        catch { setMessage('报告下载失败，请展开下方识别详情并复制调试信息。'); }
      }}>下载问题报告（填写值已隐藏）</button>
      <details className="debug-panel"><summary>Debug · 识别详情（值已隐藏）</summary><pre>{debug}</pre><button className="secondary small" type="button" onClick={() => void navigator.clipboard.writeText(debug).then(() => setMessage('已复制脱敏调试信息。分享前请检查网站文字是否包含其他个人信息。')).catch(() => setMessage('复制失败，可手动选择调试文本。'))}>复制脱敏调试信息</button></details>
    </>}
    <details className="jd-panel"><summary>岗位 JD · 手动备忘</summary><textarea aria-label="岗位 JD" rows={5} maxLength={20000} value={jd} onChange={event => setJd(event.target.value)} placeholder="粘贴岗位职责与要求。仅作备忘，不参与 AI 识别。" /><div className="row"><button type="button" className="secondary small" disabled={busy} onClick={() => { setBusy(true); void readSelection().then(text => text ? setJd(text) : setMessage('页面没有选中文本，请先选中岗位信息。')).catch(error => setMessage(errorMessage(error))).finally(() => setBusy(false)); }}>读取页面选中文本</button><span>{jd.length} 字符</span></div><p>仅在本次弹窗中保留，不参与规则匹配。关闭弹窗后清除。</p></details>
    <p className="popup-footer"><span className="status-dot" />v{EXTENSION_VERSION} · 档案保存在本地 · 验证码与最终提交由你完成</p>
  </main>;
}
