import {afterEach,expect,it} from 'vitest';
import {scanDocument} from '../src/content/scanner';
import * as observation from '../src/content/optionObservation';
afterEach(()=>{document.body.innerHTML='';});
function fixture(mode='empty'){
 document.body.innerHTML='<section aria-label="个人信息"><label for="c">未知选项</label><button id="c" type="button" role="combobox" aria-controls="l" aria-expanded="false">请选择</button><div id="l" role="listbox" hidden></div><label>备注<input id="other"></label><button type="submit">最终提交</button></section>';
 const node=document.querySelector<HTMLElement>('#c')!,list=document.querySelector<HTMLElement>('#l')!,other=document.querySelector<HTMLInputElement>('#other')!;let opens=0,choices=0;
 const stop=new AbortController();let current=true;
 node.addEventListener('click',()=>{opens++;node.setAttribute('aria-expanded','true');list.hidden=false;
  setTimeout(()=>{
   if(mode==='abort')stop.abort();if(mode==='context')current=false;
   if(mode==='replace-node')node.replaceWith(node.cloneNode(true));if(mode==='replace-list')list.replaceWith(list.cloneNode(true));
   if(mode==='manual')node.textContent='网页手选';if(mode==='other-value')other.value='网页新值';
   if(mode==='foreign-action')list.parentElement!.insertAdjacentHTML('beforeend','<button type="button">新按钮</button>');
   if(mode==='hidden')list.hidden=true;if(mode==='collapsed')node.setAttribute('aria-expanded','false');
   if(mode==='text')list.textContent='正在等待内容';if(mode==='placeholder-child')list.innerHTML='<span>正在等待</span>';
   if(mode==='too-many')list.innerHTML='<div role="option">甲</div>'.repeat(201);
   if(mode==='selected')list.innerHTML='<div role="option" aria-selected="true">甲</div>';
   if(mode==='normal')list.innerHTML='<div role="option">甲</div><div role="option">乙</div>';
  },5);
 });list.addEventListener('click',()=>choices++);
 const scan=scanDocument(),id=[...scan.controls].find(([,control])=>control.node===node)![0],cap=observation.captureOptionObservation(scan,id)!;
 return{node,list,scan,id,cap,stop,current:()=>current,invalidateContext:()=>{current=false;},counts:()=>({opens,choices})};
}
type EmptyReader=(result:observation.OptionObservationResult)=>ReturnType<typeof scanDocument>|undefined;
const readEmpty=(result:observation.OptionObservationResult)=>(observation as unknown as {readEmptyOptionObservation?:EmptyReader}).readEmptyOptionObservation?.(result);
it('bounded empty outcome is distinct and has an original private fresh scan but no fill authority',async()=>{
 const s=fixture(),result=await observation.observeOptions(s.cap,s.stop.signal,s.current);
 expect(result).toEqual({status:'pending',reason:'options-empty'});expect(Object.isFrozen(result)).toBe(true);
 const fresh=readEmpty(result);expect(fresh).toBeDefined();expect(fresh?.result.scanId).not.toBe(s.scan.result.scanId);const freshId=[...fresh!.controls].find(([,control])=>control.node===s.node)![0];expect(freshId).not.toBe(s.id);expect(fresh?.result.fields.find(field=>field.id===freshId)?.options).toEqual([]);
 expect(observation.readOptionObservation(result)).toBeUndefined();expect(readEmpty({...result})).toBeUndefined();expect(readEmpty({status:'pending',reason:'options-empty'})).toBeUndefined();expect(s.counts()).toEqual({opens:1,choices:0});
});
it.each(['abort','context','replace-node','replace-list','manual','other-value','foreign-action','hidden','collapsed','text','placeholder-child','too-many','selected'] as const)('%s cannot be treated as harmless empty progress',async mode=>{
 const s=fixture(mode),result=await observation.observeOptions(s.cap,s.stop.signal,s.current);expect(result.status).toBe('pending');expect(result).not.toEqual({status:'pending',reason:'options-empty'});expect(readEmpty(result)).toBeUndefined();expect(s.counts()).toEqual({opens:1,choices:0});
});
it.each(['late-options','replace-node','replace-list','manual','other-value','label','hidden','collapsed'] as const)('the empty proof expires on subsequent %s',async mode=>{
 const s=fixture(),result=await observation.observeOptions(s.cap,s.stop.signal,s.current);expect(readEmpty(result)).toBeDefined();
 if(mode==='late-options')s.list.innerHTML='<div role="option">迟到</div>';if(mode==='replace-node')s.node.replaceWith(s.node.cloneNode(true));if(mode==='replace-list')s.list.replaceWith(s.list.cloneNode(true));if(mode==='manual')s.node.textContent='新答案';if(mode==='other-value')document.querySelector<HTMLInputElement>('#other')!.value='新值';if(mode==='label')document.querySelector('label')!.textContent='新题目';if(mode==='hidden')s.list.hidden=true;if(mode==='collapsed')s.node.setAttribute('aria-expanded','false');
 expect(readEmpty(result)).toBeUndefined();expect(observation.readOptionObservation(result)).toBeUndefined();expect(s.counts().choices).toBe(0);
});
it('normal observed options do not become an empty skip proof',async()=>{
 const s=fixture('normal'),result=await observation.observeOptions(s.cap,s.stop.signal,s.current);expect(result.status).toBe('observed');expect(readEmpty(result)).toBeUndefined();expect(observation.readOptionObservation(result)).toBeDefined();
});
it.each(['abort','context'] as const)('a completed empty proof expires when its %s owner ends',async mode=>{
 const s=fixture(),result=await observation.observeOptions(s.cap,s.stop.signal,s.current);expect(readEmpty(result)).toBeDefined();if(mode==='abort')s.stop.abort();else s.invalidateContext();expect(readEmpty(result)).toBeUndefined();
});
