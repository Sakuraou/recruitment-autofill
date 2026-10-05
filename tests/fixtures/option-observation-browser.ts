import { scanDocument } from '../../src/content/scanner';
import { captureOptionObservation, observeOptions, readOptionObservation } from '../../src/content/optionObservation';
import {OptionObservationSession} from '../../src/content/optionObservationSession';
import {AgentPageLease} from '../../src/agent/pageLease';

export async function run(mode: string) {
  document.body.innerHTML = '<section aria-label="个人信息"><label for="probe">未知招聘选项</label><button id="probe" type="button" role="combobox" aria-controls="options" aria-expanded="false">请选择</button><div id="options" role="listbox" hidden></div><label>姓名<input id="other"></label><button id="submit" type="button">最终提交</button></section>';
  const node = document.querySelector<HTMLElement>('#probe')!, list = document.querySelector<HTMLElement>('#options')!;
  let opens = 0, selections = 0, submits = 0;
  node.addEventListener('click', () => {
    opens++; node.setAttribute('aria-expanded', 'true'); list.hidden = false;
    if (mode === 'answer') node.textContent = '网页自动选择';
    if (mode === 'other') document.querySelector<HTMLInputElement>('#other')!.value = '用户新写内容';
    if (mode === 'replace') list.replaceWith(list.cloneNode(true));
    if (mode !== 'timeout') setTimeout(() => {
      list.innerHTML = '<div role="option" data-value="opaque-a">选项甲</div><div role="option" data-value="opaque-b">选项乙</div>';
      if (mode === 'selected') list.firstElementChild!.setAttribute('aria-selected', 'true');
    }, 25);
  });
  list.addEventListener('click', () => selections++);
  document.querySelector('#submit')!.addEventListener('click', () => submits++);
  if (mode === 'submit') node.removeAttribute('type');
  const scan = scanDocument(), id = [...scan.controls].find(([, control]) => control.node === node)?.[0] ?? '';
  const cap = captureOptionObservation(scan, id);
  if (!cap) return { mode, status: 'unissued', opens, selections, submits };
  const stop = new AbortController(); if (mode === 'abort') stop.abort();
  const clone = await observeOptions({ ...cap }, stop.signal, () => true);
  if (clone.status !== 'pending' || opens) throw new Error('cloned authority performed an action');
  const result = await observeOptions(cap, stop.signal, () => true);
  const fresh = readOptionObservation(result);
  const replay = await observeOptions(cap, stop.signal, () => true);
  if (replay.status !== 'pending') throw new Error('authority replay accepted');
  if (mode === 'normal') {
    if (!fresh || result.status !== 'observed' || result.optionCount !== 2) throw new Error('fresh observation missing');
    if (readOptionObservation({ ...result })) throw new Error('serialized result accepted');
    list.firstElementChild!.replaceWith(list.firstElementChild!.cloneNode(true));
    if (readOptionObservation(result)) throw new Error('stale result accepted');
  }
  return { mode, status: result.status, opens, selections, submits };
}

export async function runSession(mode: string) {
 document.body.innerHTML='<label for="c">招聘选项</label><button id="c" type="button" role="combobox" aria-controls="l" aria-expanded="false">请选择</button><div role="listbox" id="l" hidden></div>';
 const node=document.querySelector<HTMLElement>('#c')!,list=document.querySelector<HTMLElement>('#l')!;
 let opens=0,selections=0,occupied=false;
 node.addEventListener('click',()=>{opens++;node.setAttribute('aria-expanded','true');list.hidden=false;setTimeout(()=>{list.innerHTML='<div role="option" data-value="fictional-private">选项</div>';},50);});
 list.addEventListener('click',()=>selections++);
 let scan=scanDocument();const id=[...scan.controls].find(([,control])=>control.node===node)?.[0]??'';
 const lease=new AgentPageLease(()=>document.URL,()=>occupied),token=lease.begin();
 const sender={id:'fixture-extension',url:'chrome-extension://fixture-extension/popup.html'};
 const session=new OptionObservationSession({extensionId:sender.id,popupUrl:sender.url,lease,getScan:()=>scan,occupied:()=>occupied});
 const request={type:'RA_OBSERVE_OPTIONS',agentRunToken:token,payload:{scanId:scan.result.scanId,fieldId:id}};
 if(mode==='source')sender.id='foreign';if(mode==='occupied')occupied=true;
 const running=session.run(request,sender);
 if(mode==='stop')session.stop(token);
 if(mode==='close'){lease.end(token);session.stop(token);}
 if(mode==='rescan')scan=scanDocument();
 if(mode==='replace')node.replaceWith(node.cloneNode(true));
 if(mode==='duplicate'&&(await session.run(request,sender)).status!=='pending')throw new Error('duplicate request accepted');
 const result=await running;
 if(session.takeScan(crypto.randomUUID()))throw new Error('different owner retrieved observation');
 const fresh=!!session.takeScan(token);if(session.takeScan(token))throw new Error('private scan replay accepted');
 if(session.holdsPage())throw new Error('session did not release occupancy');
 return {mode,status:result.status,opens,selections,fresh};
}
