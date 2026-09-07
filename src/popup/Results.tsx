import type { FieldDescriptor, FillOutcome, MatchResult } from '../shared/types';

const sources = { rule: '规则', alias: '别名', fuzzy: '模糊匹配', llm: 'AI' };
const statuses = { auto: '可直接填写', review: '需要确认', missing: '缺少可靠信息', blocked: '人工处理', existing: '保留已有值' };
export function Results({ matches, selected, onSelect, reveal, outcomes, busy, fields }: {
  matches: MatchResult[]; selected: Set<string>; onSelect: (id: string, checked: boolean) => void;
  reveal: boolean; outcomes: FillOutcome[]; busy: boolean;
  fields: FieldDescriptor[];
}) {
  const priority = { auto: 0, review: 1, missing: 2, existing: 3, blocked: 4 };
  const ordered = [...matches].sort((a, b) => priority[a.status] - priority[b.status]);
  return <div className="result-list">{ordered.map(match => {
    const outcome = outcomes.find(item => item.fieldId === match.fieldId);
    const valueLabel = fields.find(field => field.id === match.fieldId)?.options.find(option => option.value === match.value)?.label ?? match.value;
    return <article className={`match-card ${match.status}`} key={match.fieldId}>
      <div className="row"><span className="match-label">{match.fieldName}</span><span className={`result-badge ${match.status}`}>{outcome?.status === 'filled' ? '已填写 ✓' : statuses[match.status]}</span></div>
      {match.value !== undefined && <p className="match-value">{match.sensitive && !reveal ? '••••••（个人信息已隐藏）' : valueLabel}</p>}
      <div className="match-meta">{Math.round(match.confidence * 100)}% · {sources[match.source]}{match.matchedProfileKey ? ` · ${match.matchedProfileKey}` : ''}</div>
      <p className="match-reason">{outcome ? outcome.reason : match.reason}</p>
      {match.status === 'review' && match.value !== undefined && !outcome && <label className="match-confirm"><input type="checkbox" checked={selected.has(match.fieldId)} disabled={busy} onChange={event => onSelect(match.fieldId, event.target.checked)} />我已核对这个候选</label>}
    </article>;
  })}</div>;
}
