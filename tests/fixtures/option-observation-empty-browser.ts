import {scanDocument} from '../../src/content/scanner';
import {captureOptionObservation,observeOptions,readEmptyOptionObservation,readOptionObservation} from '../../src/content/optionObservation';
export async function run(mode:string){
 document.body.innerHTML='<label for="c">未知问题</label><button id="c" type="button" role="combobox" aria-controls="l" aria-expanded="false">请选择</button><div id="l" role="listbox" hidden></div><label>另一项<input id="other"></label>';
 const node=document.querySelector<HTMLElement>('#c')!,list=document.querySelector<HTMLElement>('#l')!;let opens=0,choices=0,current=true;const stop=new AbortController();
 node.addEventListener('click',()=>{opens++;node.setAttribute('aria-expanded','true');list.hidden=false;setTimeout(()=>{
  if(mode==='normal')list.innerHTML='<div role="option">甲</div><div role="option">乙</div>';
  if(mode==='stop')stop.abort();if(mode==='context')current=false;if(mode==='manual')node.textContent='页面答案';
  if(mode==='replace')node.replaceWith(node.cloneNode(true));if(mode==='hidden')list.hidden=true;
  if(mode==='foreign')document.body.insertAdjacentHTML('beforeend','<button type="button">陌生操作</button>');
 },20);});list.addEventListener('click',()=>choices++);
 const scan=scanDocument(),id=[...scan.controls].find(([,control])=>control.node===node)![0],cap=captureOptionObservation(scan,id);if(!cap)throw new Error('no fixture observation');
 const result=await observeOptions(cap,stop.signal,()=>current),empty=!!readEmptyOptionObservation(result),observed=!!readOptionObservation(result);
 if(readEmptyOptionObservation({...result}))throw new Error('serialized empty proof accepted');
 if(mode==='late')list.innerHTML='<div role="option">迟到选项</div>';if(mode==='owner-close')stop.abort();
 const after=!!readEmptyOptionObservation(result);return{mode,status:result.status,empty,observed,after,opens,choices};
}
