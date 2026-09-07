import { useState } from 'react';
import { parseProfileJson, profileSchema, type UserProfile } from '../profile/schema';
import { errorMessage } from '../shared/errors';

export function BackupEditor({ profile, onImport }: { profile: UserProfile; onImport: (profile: UserProfile) => void }) {
  const [json, setJson] = useState('');
  const [message, setMessage] = useState('');
  function importText(text: string) {
    try { onImport(parseProfileJson(text)); setMessage('已载入导入预览。请检查档案，点击「保存档案」后才会替换本地记录。'); }
    catch (error) { setMessage(errorMessage(error)); }
  }
  function exportJson() {
    try {
      const valid = profileSchema.parse(profile);
      const url = URL.createObjectURL(new Blob([JSON.stringify(valid, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `recruitment-profile-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已导出当前档案。JSON 备份包含个人资料，请保存在你信任的位置。');
    } catch (error) { setMessage(errorMessage(error)); }
  }
  return <section><h2>导入与备份</h2><p className="muted">仅接受本工具 schemaVersion: 1 格式。导入会校验全部字段，错误时保留当前档案。</p>
    <div className="notice">本地存储和 JSON 备份未加密。扩展不上传资料；能访问你电脑或浏览器档案的人，可能读取这些数据。卸载前请自行备份。</div>
    <div className="backup-actions"><button type="button" className="primary" onClick={exportJson}>导出当前档案 JSON ↓</button>
      <label className="secondary file-button">选择 JSON 文件<input type="file" accept=".json,application/json" onChange={event => {
        const file = event.target.files?.[0];
        if (file) {
          if (file.size > 2_000_000) setMessage('文件超过 2 MB，请精简后导入。');
          else void file.text().then(importText).catch(() => setMessage('文件读取失败，请重新选择。'));
        }
        event.target.value = '';
      }} /></label>
      <a href="./examples/sample-profile.json" download="sample-profile.json">下载虚构测试档案</a></div>
    <div className="editor-field"><label htmlFor="json-import">或粘贴 JSON</label><textarea id="json-import" className="code-input" rows={13} value={json} onChange={event => setJson(event.target.value)} placeholder={'{ "schemaVersion": 1, ... }'} /></div>
    <button type="button" className="secondary" disabled={!json.trim()} onClick={() => importText(json)}>校验并载入预览</button>
    {message && <p className="notice" role="status">{message}</p>}
  </section>;
}
