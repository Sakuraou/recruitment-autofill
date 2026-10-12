import { useEffect, useRef, useState } from 'react';
import { loadAiConnection, AI_CONNECTION_KEY } from '../ai/connection';
import { checkVisualCapability, type VisualCapability } from '../ai/visualCapabilities';
import { loadVisualConsent, setVisualConsent, VISUAL_SETTINGS_KEY, visualConsentSchema } from '../ai/visualSettings';
import { createLatestLocalRefresh } from '../ai/latestLocalRefresh';
export function VisualConsentEditor({ aiEnabled }: { aiEnabled: boolean }) {
  const [enabled, setEnabled] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [capability, setCapability] = useState<VisualCapability>('unknown'), [checking, setChecking] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    const refresh = createLatestLocalRefresh(loadVisualConsent, value => {
      if (mounted) setEnabled(visualConsentSchema.safeParse(value).success);
    });
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (AI_CONNECTION_KEY in changes) { pending.current?.abort(); setCapability('unknown'); setChecking(false); }
      if (VISUAL_SETTINGS_KEY in changes) { setConfirmed(false); void refresh(); }
    };
    chrome.storage.onChanged.addListener(changed); void refresh();
    return () => { mounted = false; pending.current?.abort(); chrome.storage.onChanged.removeListener(changed); };
  }, []);
  useEffect(() => {
    if (!aiEnabled) { pending.current?.abort(); setCapability('unknown'); setChecking(false); }
  }, [aiEnabled]);

  async function inspect() {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setChecking(true); setCapability('unknown');
    try {
      const connection = await loadAiConnection();
      const result = await checkVisualCapability(connection ? { protocol: connection.protocol, token: connection.token } : undefined, controller.signal);
      if (!controller.signal.aborted) setCapability(result);
    } catch { if (!controller.signal.aborted) setCapability('unknown'); }
    finally {
      if (pending.current === controller && !controller.signal.aborted) { pending.current = undefined; setChecking(false); }
    }
  }
  async function change(value: boolean) {
    setBusy(true);
    try {
      await setVisualConsent(value, confirmed); setEnabled(value);
      if (!value) setConfirmed(false);
      setMessage(value ? '局部截图识别已启用。' : '局部截图识别已关闭。');
    } catch { setMessage('设置未保存，请重试。'); }
    finally { setBusy(false); }
  }
  return <section><h3>局部截图识别</h3>
    <p>默认关闭。遇到无法从文字识别的字段时，只将本机遮挡后的字段标签局部图像交给已配置的模型分析。原始截图和档案留在本机；模型只解释字段含义，填写值仍来自档案。</p>
    <button type="button" disabled={!aiEnabled || checking || busy} onClick={() => void inspect()}>
      {checking ? '正在检查本机视觉接口…' : '检查本机视觉接口'}
    </button>
    <p>{capability === 'available' ? '本机图片请求接口已配置；云模型是否支持图片仍需实际核验。'
      : capability === 'unsupported' ? '本机服务没有图片请求接口；请升级服务或改用支持图片输入的兼容配置后重启。'
      : '本机视觉接口能力尚未确认；检查只访问本机，不调用模型。'}</p>
    <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />我允许发送遮挡后的局部图像用于字段识别</label>
    <p role="status">{enabled ? '局部截图识别已启用' : '局部截图识别未启用'}{message ? ` · ${message}` : ''}</p>
    <button type="button" disabled={busy || checking || enabled || !aiEnabled || !confirmed || capability === 'unsupported'} onClick={() => void change(true)}>启用局部截图识别</button>
    <button type="button" className="secondary" disabled={busy || !enabled} onClick={() => void change(false)}>关闭局部截图识别</button>
    {!aiEnabled && <p className="muted">请先连接本机 AI 服务。关闭 AI 连接后不会发送图像请求。</p>}
  </section>;
}

