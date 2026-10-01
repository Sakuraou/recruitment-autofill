import { useEffect, useMemo, useState } from 'react';
import { recordCandidates, relatedRecordChoices } from '../matching/recordCandidates';
import { matchFields } from '../matching/ruleMatcher';
import { isExtensionContext, PROFILE_STORAGE_KEY } from '../profile/storage';
import { errorMessage } from '../shared/errors';
import type { FillOutcome } from '../shared/types';
import { fillAutoUntilStable, fillPlan, readSelection, scanPage, type PagePlan } from './bridge';
import { createDebugReport, downloadDebugReport } from './debug';
import { EXTENSION_VERSION } from '../shared/version';
import { Results } from './Results';
import { MobileWorkflowControls } from './MobileWorkflow';
import { ProjectRecordControls } from './ProjectRecords';

export function PopupApp() {
  const [plan, setPlan] = useState<PagePlan>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(new Set<string>());
  const [showResults, setShowResults] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [outcomes, setOutcomes] = useState<FillOutcome[]>([]);
  const [jd, setJd] = useState('');
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
      if (area === 'local' && changes[PROFILE_STORAGE_KEY]) {
        setPlan(undefined); setSelected(new Set()); setOutcomes([]); setMessage('档案已更新，请重新扫描页面。');
      }
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
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
    <MobileWorkflowControls />
    <ProjectRecordControls />
    <div className="popup-stats">{[[matches.length, '检测字段'], [autoCount, '可直接填写'], [reviewCount, '需要确认'], [missingCount, '缺少信息']].map(([count, label]) => <div key={label}><strong>{String(count).padStart(2, '0')}</strong><span>{label}</span></div>)}</div>
    <div className="popup-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void scan()}>{busy ? '处理中…' : '扫描页面'}</button>
      <button type="button" className="primary" disabled={busy || !autoCount} onClick={() => void fill('auto')}>一键填写高置信度字段</button></div>
    {message && <div className="notice" role="status">{message}</div>}
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
    <details className="jd-panel"><summary>岗位 JD · 手动备忘</summary><textarea aria-label="岗位 JD" rows={5} maxLength={20000} value={jd} onChange={event => setJd(event.target.value)} placeholder="粘贴岗位职责与要求。本版不调用 AI。" /><div className="row"><button type="button" className="secondary small" disabled={busy} onClick={() => { setBusy(true); void readSelection().then(text => text ? setJd(text) : setMessage('页面没有选中文本，请先选中岗位信息。')).catch(error => setMessage(errorMessage(error))).finally(() => setBusy(false)); }}>读取页面选中文本</button><span>{jd.length} 字符</span></div><p>仅在本次弹窗中保留，不参与规则匹配。关闭弹窗后清除。</p></details>
    <p className="popup-footer"><span className="status-dot" />v{EXTENSION_VERSION} · 档案保存在本地 · 验证码与最终提交由你完成</p>
  </main>;
}
