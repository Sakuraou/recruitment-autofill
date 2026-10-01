import { useEffect, useState } from 'react';
import { createEmptyProfile, type UserProfile } from '../profile/schema';
import { isExtensionContext, loadProfile, saveProfile } from '../profile/storage';
import { updatePath } from '../shared/profilePaths';
import { errorMessage } from '../shared/errors';
import { Fields, CollectionEditor, CollectionFactEditor } from './Editors';
import { answerFields, basicFields, collections, sections } from './fields';
import { AnswerEditor } from './AnswerEditor';
import { BackupEditor } from './BackupEditor';

export function OptionsApp() {
  const [profile, setProfile] = useState<UserProfile>(createEmptyProfile);
  const [section, setSection] = useState('basic');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void loadProfile().then(setProfile).catch(error => setMessage(errorMessage(error))).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function change(path: string, value: unknown) {
    setProfile(previous => updatePath(previous, path, value));
    setDirty(true); setMessage('');
  }
  async function save() {
    setSaving(true);
    try { setProfile(await saveProfile(profile)); setDirty(false); setMessage('档案已保存在此浏览器。回到招聘页面重新扫描即可使用。'); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setSaving(false); }
  }
  const editorProps = { profile, onChange: change };
  const collection = (key: string) => {
    const spec = collections[key];
    return spec ? <CollectionEditor key={key} {...editorProps} spec={spec} /> : null;
  };
  const answerCount = answerFields.filter(([key]) => {
    const value = profile.commonAnswers[key];
    return value && [...Object.values(value.byLimit), value.short, value.medium, value.long].some(text => text?.trim());
  }).length;
  return <div className="options-app">
    <aside className="sidebar"><a href="./options.html" className="brand"><span className="brand-mark">申</span><span>网申助手<small>RECRUITMENT ASSISTANT</small></span></a>
      <div className="workspace-label">2027 校园招聘 <span>本地工作区</span></div>
      <nav aria-label="档案分类">{sections.map(([key, label, number]) => <button key={key} type="button" className={section === key ? 'active' : ''} onClick={() => setSection(key)}><span>{number}</span>{label}<b>›</b></button>)}</nav>
      <div className="sidebar-note"><span className="status-dot" />资料留在此浏览器<p>只使用你的真实信息。<br />留空比猜测更可靠。</p></div>
    </aside>
    <main className="options-main"><header className="topbar"><span>我的档案 <span className="crumb"> / {sections.find(([key]) => key === section)?.[1]}</span></span><span className="local-label">● LOCAL FIRST</span></header>
      <div className="page-content"><div className="hero"><div className="eyebrow">YOUR PROFILE, READY TO APPLY</div><h1>准备一次，从容申请。</h1><p>把重复的填写交给档案，把时间留给下一次机会。</p></div>
        <div className="profile-stats"><div><strong>{profile.education.length.toString().padStart(2, '0')}</strong><span>教育经历</span></div><div><strong>{(profile.projects.length + profile.internships.length).toString().padStart(2, '0')}</strong><span>项目与实习</span></div><div><strong>{answerCount.toString().padStart(2, '0')}</strong><span>常用回答</span></div><div className="stats-tip">填写事实 · 检查匹配 · 人工提交</div></div>
        {!isExtensionContext() && <div className="notice">当前是界面预览。请加载 dist 文件夹后，从扩展打开「我的档案」以使用浏览器本地存储。</div>}
        {loading ? <p role="status">正在读取本地档案…</p> : <fieldset className="editor-body" disabled={saving}>
          {section === 'basic' && <section><div className="row section-heading"><h2>基础信息</h2><span className="muted">没有的信息可以留空</span></div><Fields {...editorProps} base="basic" fields={basicFields} /></section>}
          {['education', 'projects', 'internships', 'studentWork', 'family'].includes(section) && collection(section)}
          {section === 'family' && <p className="notice">家庭成员保存在本地。MVP 1 对家庭与联系人字段保留人工填写，避免与本人信息混淆。</p>}
          {section === 'research' && <><h2>科研经历</h2><Fields {...editorProps} base="research" fields={[{ key: 'researchDirection', label: '总体研究方向', kind: 'textarea' }, { key: 'summary', label: '科研总结', kind: 'textarea' }]} />{collection('papers')}{collection('patents')}</>}
          {section === 'awards' && <>{collection('awards')}{collection('certificates')}</>}
          {section === 'skills' && <><h2>专业技能</h2><CollectionFactEditor {...editorProps} factKey="computerSkills" title="计算机技能" /><p className="muted">每行一项，仅填写你实际掌握的技能。</p><Fields {...editorProps} base="skills" fields={[{ key: 'programmingLanguages', label: '编程语言', kind: 'list' }, { key: 'frameworks', label: '框架', kind: 'list' }, { key: 'tools', label: '工具', kind: 'list' }, { key: 'other', label: '其他技能', kind: 'list' }]} /></>}
          {section === 'answers' && <AnswerEditor {...editorProps} />}
          {section === 'backup' && <BackupEditor profile={profile} onImport={imported => { setProfile(imported); setDirty(true); }} />}
        </fieldset>}
      </div>
      <footer className="save-bar"><div><strong>{dirty ? '有尚未保存的修改' : '本地档案'}</strong><p role="status">{message || (profile.updatedAt ? `上次保存 ${new Date(profile.updatedAt).toLocaleString('zh-CN')}` : '填写后保存，即可在网申中复用。')}</p></div><button className="primary" type="button" disabled={loading || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存档案'} <span>↗</span></button></footer>
    </main>
  </div>;
}
