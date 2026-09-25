import type { FieldDescriptor, FillOutcome, MatchResult } from '../shared/types';
import type { RecordCandidate } from '../matching/recordCandidates';
import { relatedRecordChoices } from '../matching/recordCandidates';

const sources = { rule: '规则', alias: '别名', fuzzy: '模糊匹配', llm: 'AI' };
const statuses = { auto: '可直接填写', review: '需要确认', missing: '缺少可靠信息', blocked: '人工处理', existing: '保留已有值' };
const outcomeStatuses = { filled: '已填写 ✓', skipped: '已跳过', error: '未完成 · 请检查' };
export function Results({ matches, selected, onSelect, reveal, outcomes, busy, fields, candidates, onChoose, onChooseGroup }: {
  matches: MatchResult[]; selected: Set<string>; onSelect: (id: string, checked: boolean) => void;
  reveal: boolean; outcomes: FillOutcome[]; busy: boolean;
  fields: FieldDescriptor[];
  candidates?: Map<string, RecordCandidate[]>;
  onChoose?: (fieldId: string, profileKey: string) => void;
  onChooseGroup?: (fieldId: string, profileKey: string) => void;
}) {
  const priority = { auto: 0, review: 1, missing: 2, existing: 3, blocked: 4 };
  const ordered = [...matches].sort((a, b) => priority[a.status] - priority[b.status]);
  return <div className="result-list">{ordered.map(match => {
    const outcome = outcomes.find(item => item.fieldId === match.fieldId);
    const choices = candidates?.get(match.fieldId) ?? [];
    const statusLabel = match.status === 'review' && match.value === undefined && !choices.length ? '需手动填写' : statuses[match.status];
    const group = candidates && match.matchedProfileKey && match.value !== undefined
      ? relatedRecordChoices(fields, candidates, match.fieldId, match.matchedProfileKey).filter(item => !outcomes.some(done => done.fieldId === item.fieldId)) : [];
    const valueLabel = fields.find(field => field.id === match.fieldId)?.options.find(option => option.value === match.value)?.label ?? match.value;
    return <article className={`match-card ${match.status}`} key={match.fieldId}>
      <div className="row"><span className="match-label">{match.fieldName}</span><span className={`result-badge ${outcome?.status ?? match.status}`}>{outcome ? outcomeStatuses[outcome.status] : statusLabel}</span></div>
      {match.value !== undefined && <p className="match-value">{match.sensitive && !reveal ? '••••••（个人信息已隐藏）' : valueLabel}</p>}
      <div className="match-meta">{Math.round(match.confidence * 100)}% · {sources[match.source]}{match.matchedProfileKey ? ` · ${match.matchedProfileKey}` : ''}</div>
      <p className="match-reason">{outcome ? outcome.reason : match.reason}</p>
      {choices.length > 0 && !outcome && <label className="match-record-choice">选择这项字段对应的经历
        <select aria-label={`${match.fieldName}：选择档案经历`} disabled={busy}
          value={choices.some(choice => choice.match.matchedProfileKey === match.matchedProfileKey) ? match.matchedProfileKey : ''}
          onChange={event => onChoose?.(match.fieldId, event.target.value)}>
          <option value="">请选择，不默认使用第一条</option>
          {choices.map(choice => <option key={choice.match.matchedProfileKey} value={choice.match.matchedProfileKey}>{choice.label}</option>)}
        </select>
      </label>}
      {group.length > 1 && !outcome && <button type="button" className="secondary small" disabled={busy}
        onClick={() => onChooseGroup?.(match.fieldId, match.matchedProfileKey!)}>同组使用这段经历（{group.length} 项，仍需核对）</button>}
      {match.status === 'review' && match.value !== undefined && !outcome && <label className="match-confirm"><input type="checkbox" checked={selected.has(match.fieldId)} disabled={busy} onChange={event => onSelect(match.fieldId, event.target.checked)} />我已核对这个候选</label>}
    </article>;
  })}</div>;
}
