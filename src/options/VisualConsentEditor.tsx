import { useEffect, useState } from 'react';
import { loadVisualConsent, setVisualConsent, visualConsentSchema } from '../ai/visualSettings';
import { createLatestLocalRefresh } from '../ai/latestLocalRefresh';
export function VisualConsentEditor({ aiEnabled }: { aiEnabled: boolean }) {
 const [enabled,setEnabled]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let mounted=true;
  const refresh=createLatestLocalRefresh(loadVisualConsent,value=>{if(mounted)setEnabled(visualConsentSchema.safeParse(value).success)});
  const changed=(changes:Record<string,chrome.storage.StorageChange>,area:string)=>{if(area==='local'&&'recruitment.visual.consent.v1' in changes){setConfirmed(false);void refresh()}};
  chrome.storage.onChanged.addListener(changed);void refresh();
  return()=>{mounted=false;chrome.storage.onChanged.removeListener(changed)}
 },[]);
 async function change(value:boolean){setBusy(true);try{await setVisualConsent(value,confirmed);setEnabled(value);if(!value)setConfirmed(false);setMessage(value?'局部截图识别已启用。':'局部截图识别已关闭。')}catch{setMessage('设置未保存，请重试。')}finally{setBusy(false)}}
 return <section><h3>局部截图识别</h3><p>默认关闭。遇到无法从文字识别的字段时，只将本机遮挡后的字段标签局部图像交给已配置的模型分析。原始截图和档案留在本机；模型只解释字段含义，填写值仍来自档案。</p>
 <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>我允许发送遮挡后的局部图像用于字段识别</label>
 <p role="status">{enabled?'局部截图识别已启用':'局部截图识别未启用'}{message?` · ${message}`:''}</p>
 <button type="button" disabled={busy||enabled||!aiEnabled||!confirmed} onClick={()=>void change(true)}>启用局部截图识别</button>
 <button type="button" className="secondary" disabled={busy||!enabled} onClick={()=>void change(false)}>关闭局部截图识别</button>
 {!aiEnabled&&<p className="muted">请先连接本机 AI 服务。关闭 AI 连接后不会发送图像请求。</p>}
 </section>;
}
