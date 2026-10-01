import type { UserProfile } from '../profile/schema';
import { getPath } from '../shared/profilePaths';
import type { CollectionSpec, EditorField } from './fields';
import { collectionPresence, type CollectionKey } from '../profile/facts';

export interface EditorProps { profile: UserProfile; onChange: (path: string, value: unknown) => void }
export function Fields({ profile, onChange, base, fields }: EditorProps & { base: string; fields: EditorField[] }) {
  return <div className="field-grid">{fields.map(field => {
    const path = `${base}.${field.key}`;
    const value = getPath(profile, path);
    const shown = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
    const control = { id: path, value: shown, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(path, field.kind === 'list' ? event.target.value.split('\n') : event.target.value) };
    return <div className={`editor-field ${field.kind === 'textarea' || field.kind === 'list' ? 'wide' : ''}`} key={field.key}>
      <label htmlFor={path}>{field.label}</label>
      {field.kind === 'textarea' || field.kind === 'list' ? <textarea {...control} rows={field.kind === 'list' ? 3 : 4} />
        : field.kind === 'select' ? <select {...control}><option value="">请选择</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select>
          : <input {...control} type={field.kind === 'secret' ? 'password' : 'text'} autoComplete="off"
            placeholder={field.kind === 'date' ? 'YYYY-MM 或 YYYY-MM-DD' : undefined} />}
      {field.hint && <small>{field.hint}</small>}
    </div>;
  })}</div>;
}
const collectionFactKeys: Record<string, CollectionKey> = {
  projects: 'projects', internships: 'internships', studentWork: 'studentWork', awards: 'awards',
  'research.papers': 'papers', 'research.patents': 'patents', certificates: 'certificates',
};
export function CollectionFactEditor({ profile, onChange, factKey, title }: EditorProps & { factKey: CollectionKey; title: string }) {
  const path = `collectionFacts.${factKey}`;
  const stored = profile.collectionFacts?.[factKey];
  const state = stored?.state ?? collectionPresence(profile, factKey);
  return <div className="editor-field"><label htmlFor={path}>是否有{title}</label>
    <select id={path} value={state} onChange={event => onChange(path, {
      state: event.target.value, source: 'user', confirmed: event.target.value !== 'unknown', updatedAt: new Date().toISOString(),
    })}><option value="unknown">未确认</option><option value="known">有</option><option value="none">没有</option><option value="not_applicable">不适用</option></select>
    <small>空列表不会自动视为没有。选择“没有”或“不适用”时，已有资料须先核对；记录会保留。</small>
  </div>;
}
export function CollectionEditor({ profile, onChange, spec }: EditorProps & { spec: CollectionSpec }) {
  const raw = getPath(profile, spec.path);
  const items: unknown[] = Array.isArray(raw) ? raw : [];
  const factKey = collectionFactKeys[spec.path];
  function add() {
    const state = factKey && profile.collectionFacts?.[factKey]?.state;
    if (factKey && (state === 'none' || state === 'not_applicable')) onChange(`collectionFacts.${factKey}`, {
      state: 'unknown', source: 'user', confirmed: false, updatedAt: new Date().toISOString(),
    });
    onChange(spec.path, [...items, { id: crypto.randomUUID(), ...spec.defaults }]);
  }
  return <section className="collection"><div className="row section-heading"><h2>{spec.title} <span className="count">{items.length}</span></h2>
    <button type="button" className="secondary small" onClick={add}>＋ 添加{spec.title}</button></div>
    {factKey && <CollectionFactEditor profile={profile} onChange={onChange} factKey={factKey} title={spec.title} />}
    {!items.length && <div className="empty-card">还没有{spec.title}。只添加你的真实经历，暂时没有可以留空。</div>}
    {items.map((item, index) => <article className="record-card" key={String(getPath(item, 'id') ?? index)}>
      <div className="row record-heading"><h3>{spec.title} {String(index + 1).padStart(2, '0')}</h3>
        <button type="button" className="text-button danger" onClick={() => onChange(spec.path, items.filter((_, i) => i !== index))}>移除</button></div>
      <Fields profile={profile} onChange={onChange} base={`${spec.path}.${index}`} fields={spec.fields} />
    </article>)}
  </section>;
}
