import {afterEach,expect,it} from 'vitest';
import {scanDocument} from '../src/content/scanner';
import {captureOptionObservation,observeOptions,readOptionObservation} from '../src/content/optionObservation';
afterEach(()=>{document.body.innerHTML='';});
function fixture(onOpen?:()=>void){
 document.body.innerHTML='<main><section aria-label="个人信息"><label for="observed">任意招聘选项</label><button type="button" role="combobox" aria-expanded="false" aria-controls="choices" id="observed">请选择</button><div role="listbox" id="choices" hidden></div><label>姓名<input id="other"></label><button type="button" id="final">最终提交</button></section></main>';
 const target=document.querySelector<HTMLElement>('#observed')!,list=document.querySelector<HTMLElement>('#choices')!;let opens=0,selects=0,submits=0;
 target.addEventListener('click',()=>{opens++;target.setAttribute('aria-expanded','true');list.hidden=false;onOpen?.();if(!onOpen)setTimeout(()=>{list.innerHTML='<div role="option" data-value="opaque-1">待识别选项甲</div><div role="option" data-value="opaque-2">待识别选项乙</div>';},5);});
 list.addEventListener('click',()=>selects++);document.querySelector('#final')!.addEventListener('click',()=>submits++);
 const scan=scanDocument();const id=[...scan.controls].find(([,control])=>control.node===target)?.[0]??'';
 return {scan,id,target,list,counts:()=>({opens,selects,submits})};
}
it('opens only one issued inert combobox, waits options, exposes no labels/values and requires a fresh private scan',async()=>{
 const s=fixture(),cap=captureOptionObservation(s.scan,s.id);expect(cap).toBeDefined();if(!cap)return;
 expect(JSON.stringify(cap)).toBe('{"kind":"option-observation"}');
 const result=await observeOptions(cap,new AbortController().signal,()=>true);expect(result).toEqual({status:'observed',optionCount:2});
 expect(s.counts()).toEqual({opens:1,selects:0,submits:0});expect(Object.isFrozen(result)).toBe(true);
 const fresh=readOptionObservation(result);expect(fresh).toBeDefined();expect(fresh?.result.scanId).not.toBe(s.scan.result.scanId);
 expect(fresh?.result.fields.find(field=>field.type==='aria-combobox')?.options.map(option=>option.label)).toEqual(['待识别选项甲','待识别选项乙']);
 expect(JSON.stringify(result)).not.toMatch(/任意|opaque|choices|观察|待识别/u);expect(readOptionObservation({...result})).toBeUndefined();
});
it('a cloned capability cannot click and an issued capability cannot be replayed',async()=>{
 const s=fixture(),cap=captureOptionObservation(s.scan,s.id);expect(cap).toBeDefined();if(!cap)return;
 expect((await observeOptions({...cap},new AbortController().signal,()=>true)).status).toBe('pending');expect(s.counts().opens).toBe(0);
 expect((await observeOptions(cap,new AbortController().signal,()=>true)).status).toBe('observed');
 expect((await observeOptions(cap,new AbortController().signal,()=>true)).status).toBe('pending');expect(s.counts().opens).toBe(1);
});
it.each(['submit','link','disabled','readonly','hidden','consent','captcha','pre-filled','multiple-owner','no-reference','shadow'] as const)('no observation authority for %s control',async mode=>{
 const s=fixture();if(mode==='submit')s.target.removeAttribute('type');if(mode==='link'){const a=document.createElement('a');a.href='https://invalid.example/';s.target.before(a);a.append(s.target);}
 if(mode==='disabled')s.target.setAttribute('aria-disabled','true');if(mode==='readonly')s.target.setAttribute('aria-readonly','true');if(mode==='hidden')s.target.hidden=true;
 if(mode==='consent'||mode==='captcha')document.querySelector('label')!.textContent=mode==='consent'?'同意协议授权':'短信验证码';
 if(mode==='pre-filled')s.target.textContent='网页已有选择';if(mode==='multiple-owner'){const clone=s.target.cloneNode(true) as Element;clone.removeAttribute('id');s.target.after(clone);}
 if(mode==='no-reference')s.target.removeAttribute('aria-controls');if(mode==='shadow'){const host=document.createElement('div');s.target.before(host);const shadow=host.attachShadow({mode:'open'});shadow.append(s.target,s.list);}
 const scan=scanDocument(),id=[...scan.controls].find(([,control])=>control.node===s.target)?.[0];expect(id?captureOptionObservation(scan,id):undefined).toBeUndefined();expect(s.counts()).toEqual({opens:0,selects:0,submits:0});
});
it.each(['already-aborted','context','node-replaced','list-replaced','label-changed','other-value-changed'] as const)('stale %s issue cannot open',async mode=>{
 const s=fixture(),cap=captureOptionObservation(s.scan,s.id);expect(cap).toBeDefined();if(!cap)return;
 const stop=new AbortController();if(mode==='already-aborted')stop.abort();if(mode==='node-replaced')s.target.replaceWith(s.target.cloneNode(true));if(mode==='list-replaced')s.list.replaceWith(s.list.cloneNode(true));
 if(mode==='label-changed')document.querySelector('label')!.textContent='另外一个字段';if(mode==='other-value-changed')document.querySelector<HTMLInputElement>('#other')!.value='用户新写入';
 expect((await observeOptions(cap,stop.signal,()=>mode!=='context')).status).toBe('pending');expect(s.counts().opens).toBe(0);
});
it.each(['answer','context','stop','replace-list','other-value'] as const)('opening %s changes preserve pending, never choose an option',async mode=>{
 let current=true;const stop=new AbortController();
 const s=fixture(()=>{if(mode==='answer')s.target.textContent='网站自动选了内容';if(mode==='context')current=false;if(mode==='stop')stop.abort();if(mode==='replace-list')s.list.replaceWith(s.list.cloneNode(true));if(mode==='other-value')document.querySelector<HTMLInputElement>('#other')!.value='用户新值';
  s.list.innerHTML='<div role="option" data-value="v">选项</div>';
 });const cap=captureOptionObservation(s.scan,s.id);expect(cap).toBeDefined();if(!cap)return;
 const result=await observeOptions(cap,stop.signal,()=>current);expect(result.status).toBe('pending');expect(readOptionObservation(result)).toBeUndefined();expect(s.counts()).toEqual({opens:1,selects:0,submits:0});
});
it.each(['foreign-button','foreign-text','hidden-list','selected-option','too-many-options','nested-list'] as const)('opening %s does not yield action authority',async mode=>{
 const s=fixture(()=>{s.list.innerHTML='<div role="option" data-value="v">选项</div>';
  if(mode==='foreign-button'){const add=document.createElement('button');add.textContent='突然出现的新操作';document.querySelector('section')!.append(add);}
  if(mode==='foreign-text')document.querySelector('label')!.textContent='改变了的问题';
  if(mode==='hidden-list')s.list.hidden=true;
  if(mode==='selected-option')s.list.firstElementChild!.setAttribute('aria-selected','true');
  if(mode==='too-many-options')s.list.innerHTML='<div role="option">项</div>'.repeat(201);
  if(mode==='nested-list')s.list.innerHTML='<div role="listbox"><div role="option">他人选项</div></div>';
 });const cap=captureOptionObservation(s.scan,s.id);expect(cap).toBeDefined();if(!cap)return;
 const result=await observeOptions(cap,new AbortController().signal,()=>true);expect(result.status).toBe('pending');expect(readOptionObservation(result)).toBeUndefined();expect(s.counts()).toEqual({opens:1,selects:0,submits:0});
});
it('a completed observation is unusable after an unchanged-looking option replacement',async()=>{
 const s=fixture(),cap=captureOptionObservation(s.scan,s.id);expect(cap).toBeDefined();if(!cap)return;
 const result=await observeOptions(cap,new AbortController().signal,()=>true);expect(result.status).toBe('observed');
 s.list.firstElementChild!.replaceWith(s.list.firstElementChild!.cloneNode(true));expect(readOptionObservation(result)).toBeUndefined();
});
it('opening exception and throwing context produce value-free pending results',async()=>{
 const s=fixture(),cap=captureOptionObservation(s.scan,s.id);expect(cap).toBeDefined();if(!cap)return;
 const result=await observeOptions(cap,new AbortController().signal,()=>{throw new Error('private-context-detail');});
 expect(result).toEqual({status:'pending',reason:'observation-invalidated'});expect(JSON.stringify(result)).not.toContain('private-context-detail');expect(s.counts().opens).toBe(0);
});
it('no option load has a bounded terminal result and no retry',async()=>{
 const s=fixture(()=>{}),cap=captureOptionObservation(s.scan,s.id);expect(cap).toBeDefined();if(!cap)return;
 const started=Date.now(),result=await observeOptions(cap,new AbortController().signal,()=>true);expect(result.status).toBe('pending');expect(Date.now()-started).toBeLessThan(1500);expect(s.counts().opens).toBe(1);
});
it.each(['file','password','text'] as const)('native %s input cannot become an observation-only button',mode=>{
 const s=fixture(),input=document.createElement('input');input.type=mode;input.id=s.target.id;input.setAttribute('role','combobox');input.setAttribute('aria-controls','choices');input.setAttribute('aria-expanded','false');s.target.replaceWith(input);
 const scan=scanDocument(),id=[...scan.controls].find(([,control])=>control.node===input)?.[0]??'';
 expect(captureOptionObservation(scan,id)).toBeUndefined();expect(s.counts()).toEqual({opens:0,selects:0,submits:0});
});
