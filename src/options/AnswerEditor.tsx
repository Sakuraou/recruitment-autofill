import { useState } from 'react';
import type { EditorProps } from './Editors';
import { answerFields } from './fields';
import { getPath } from '../shared/profilePaths';

export function AnswerEditor({ profile, onChange }: EditorProps) {
  const [limit, setLimit] = useState('200');
  const [custom, setCustom] = useState('');
  return <section><div className="row section-heading"><h2>常用回答</h2><span className="local-label">用户原文 · 不自动生成</span></div>
    <p className="muted">按招聘表单的字数要求保存不同版本。填写时选用能完整放入的答案，不截断原文。</p>
    <div className="answer-tabs">{['50', '100', '150', '200', '300', '500', 'short', 'medium', 'long'].map(value =>
      <button type="button" key={value} className={limit === value ? 'selected' : ''} onClick={() => setLimit(value)}>
        {{ short: '短版', medium: '中版', long: '长版' }[value] ?? `${value} 字`}</button>)}</div>
    <div className="row custom-limit"><label htmlFor="custom-limit">其他字数上限</label><input id="custom-limit" type="number" min="1" max="9999" value={custom} onChange={e => setCustom(e.target.value)} />
      <button type="button" className="secondary small" disabled={!/^\d{1,4}$/.test(custom) || Number(custom) < 1} onClick={() => setLimit(custom)}>编辑 {custom || '自定义'} 字版</button></div>
    <p className="muted">当前编辑：{limit} {/^\d+$/.test(limit) ? '字版' : ''}</p>
    {answerFields.map(([key, label]) => {
      const base = `commonAnswers.${key}`;
      const path = /^\d+$/.test(limit) ? `${base}.byLimit.${limit}` : `${base}.${limit}`;
      const raw = getPath(profile, path);
      const value = typeof raw === 'string' ? raw : '';
      return <div className="editor-field answer-field" key={key}><label htmlFor={path}>{label}</label>
        <textarea id={path} rows={5} value={value} onChange={e => {
          const existing = profile.commonAnswers[key] ?? { byLimit: {} };
          onChange(base, /^\d+$/.test(limit) ? { ...existing, byLimit: { ...existing.byLimit, [limit]: e.target.value } } : { ...existing, [limit]: e.target.value });
        }} /><small className={/^\d+$/.test(limit) && value.length > Number(limit) ? 'danger' : ''}>{value.length} 字符{ /^\d+$/.test(limit) ? ` / ${limit}` : ''}（按网页 maxlength 的 UTF-16 计数）</small></div>;
    })}
  </section>;
}
