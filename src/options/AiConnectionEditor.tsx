import { useEffect, useRef, useState } from 'react';
import { checkAiConnection } from '../ai/loopbackProvider';
import { connectionFileSchema, disableAiConnection, enableAiConnection, loadAiConnection } from '../ai/connection';

export function AiConnectionEditor() {
  const [enabled, setEnabled] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => { void loadAiConnection().then(value => setEnabled(!!value)).catch(() => setMessage('无法读取 AI 连接设置。'));
    return () => pending.current?.abort(); }, []);
  async function connect(file: File) {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setBusy(true); setMessage('正在连接本机 AI 服务…');
    try {
      if (file.size > 1000) throw new Error('连接文件格式无效');
      const connection = connectionFileSchema.parse(JSON.parse(await file.text()));
      if (!await checkAiConnection(connection, controller.signal)) throw new Error('本机服务尚未就绪。请启动服务并确认模型配置，然后重新导入连接文件。');
      if (controller.signal.aborted) return;
      await enableAiConnection(connection); setEnabled(true); setMessage('AI 连接已启用。回到招聘网页，点击“AI 识别并填写本页”。');
    } catch { if (!controller.signal.aborted) setMessage('连接失败：请启动本机 AI 服务，配置模型，并导入它生成的连接文件。'); }
    finally { if (pending.current === controller) { pending.current = undefined; setBusy(false); } }
  }
  return <section><h2>AI 识别连接</h2><p>AI 协助识别规则不认识的字段。填写内容仍从你的本地档案读取。</p>
    <p>启动项目中的本机服务后，导入 artifacts/semantic-connection.local.json。连接文件只含配对令牌，API 密钥留在本机服务环境中。</p>
    <p className="notice">启用后，点击 AI 填写会将未知字段的简短线索和选项交给模型分析。已知个人值会先遮盖；完整档案、截图和填写值不发送。网页文字仍可能含尚未识别的个人信息。</p>
    <p role="status">{enabled ? 'AI 连接已启用' : 'AI 连接未启用'}{message ? ` · ${message}` : ''}</p>
    <label className="secondary">导入 AI 连接文件<input aria-label="导入 AI 连接文件" type="file" accept="application/json,.json" disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void connect(file); }} /></label>
    <button type="button" className="secondary" disabled={busy || !enabled} onClick={() => { pending.current?.abort(); void disableAiConnection().then(() => { setEnabled(false); setMessage('已关闭 AI 连接并移除配对令牌。'); }).catch(() => setMessage('关闭失败，请重试。')); }}>关闭 AI 连接</button>
    <p className="muted">连接配置单独保存，不会进入档案 JSON。规则填写不需要 AI 服务。</p>
  </section>;
}
