import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AGENT_OWNER_PORT} from '../src/content/agentOwnerPort';
import type {ScanResult} from '../src/shared/types';
import {EXTENSION_VERSION} from '../src/shared/version';
type Response={ok:boolean;data?:unknown;error?:string};
type Listener=(request:unknown,sender:chrome.runtime.MessageSender,respond:(response:unknown)=>void)=>boolean|undefined;
const source={id:'fixture-extension',url:'chrome-extension://fixture-extension/popup.html'};
let listener:Listener,connections:Array<(port:chrome.runtime.Port)=>void>,opens:number,selections:number;
let node:HTMLElement,list:HTMLElement,delay:number,owners:Array<()=>void>;
function event<T>(){const listeners=new Set<(value:T)=>void>();return{addListener:(fn:(value:T)=>void)=>listeners.add(fn),removeListener:(fn:(value:T)=>void)=>listeners.delete(fn),emit:(value:T)=>{for(const fn of [...listeners])fn(value);}};}
function owner(){const onMessage=event<unknown>(),onDisconnect=event<void>();const port={name:AGENT_OWNER_PORT,sender:source,onMessage,onDisconnect,postMessage:vi.fn(),disconnect:vi.fn(()=>onDisconnect.emit(undefined))};connections.forEach(handle=>handle(port as unknown as chrome.runtime.Port));onMessage.emit({type:'begin'});owners.push(port.disconnect);return{token:port.postMessage.mock.calls[0]?.[0]?.data?.token as string|undefined,port};}
const message=(request:unknown,sender:chrome.runtime.MessageSender=source):Promise<Response>=>new Promise(resolve=>listener(request,sender,response=>resolve(response as Response)));
async function request(){const ownership=owner();const response=await message({type:'RA_SCAN'});const scan=response.data as ScanResult;const field=scan.fields.find(field=>field.htmlId==='c');expect(field).toBeDefined();return{ownership,scan,value:{type:'RA_OBSERVE_OPTIONS',agentRunToken:ownership.token,payload:{scanId:scan.scanId,fieldId:field!.id}}};}
beforeEach(async()=>{vi.resetModules();delete window.__recruitmentAutofillInstalled;connections=[];owners=[];opens=0;selections=0;delay=20;
 document.body.innerHTML='<section aria-label="个人信息"><label for="c">招聘选项</label><button id="c" type="button" role="combobox" aria-controls="l" aria-expanded="false">请选择</button><div id="l" role="listbox" hidden></div><label>姓名<input id="other"></label></section>';
 node=document.querySelector<HTMLElement>('#c')!;list=document.querySelector<HTMLElement>('#l')!;
 const original=node,originalList=list;node.addEventListener('click',()=>{opens++;original.setAttribute('aria-expanded','true');originalList.hidden=false;if(delay>=0)setTimeout(()=>{originalList.innerHTML='<div role="option" data-value="internal-a">选项甲</div><div role="option" data-value="internal-b">选项乙</div>';},delay);});list.addEventListener('click',()=>selections++);
 vi.stubGlobal('chrome',{runtime:{id:source.id,getURL:(path:string)=>`chrome-extension://${source.id}/${path}`,onConnect:{addListener:(fn:(port:chrome.runtime.Port)=>void)=>connections.push(fn)},onMessage:{addListener:(fn:Listener)=>{listener=fn;}},sendMessage:vi.fn(async()=>{throw new Error('profile read was not requested');})}});
 await import('../src/content/index');
});
afterEach(async()=>{owners.forEach(disconnect=>disconnect());await new Promise(done=>setTimeout(done,0));document.body.innerHTML='';delete window.__recruitmentAutofillInstalled;vi.unstubAllGlobals();});
it('actual content registration opens exactly once and hands off a new scan without exposing option values',async()=>{
 const s=await request(),result=await message(s.value);expect(result).toEqual({ok:true,data:{version:EXTENSION_VERSION,status:'observed',optionCount:2}});expect(opens).toBe(1);expect(selections).toBe(0);expect(JSON.stringify(result)).not.toMatch(/选项|internal/u);
 expect((await message({type:'RA_VERIFY_SCAN',payload:{scanId:s.scan.scanId}})).ok).toBe(false);
 const current=await message({type:'RA_SCAN'});expect((current.data as ScanResult).fields.find(field=>field.htmlId==='c')?.options.map(option=>option.label)).toEqual(['选项甲','选项乙']);expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
it.each(['no-token','wrong-token','old-scan','wrong-field','extra-selector','extra-value','options-source'] as const)('rejects %s observation before an action',async mode=>{
 const s=await request(),value:Record<string,unknown>={...s.value,payload:{...s.value.payload}};
 if(mode==='no-token')delete value.agentRunToken;if(mode==='wrong-token')value.agentRunToken=crypto.randomUUID();if(mode==='old-scan')value.payload={...s.value.payload,scanId:crypto.randomUUID()};
 if(mode==='wrong-field')value.payload={...s.value.payload,fieldId:'#c'};if(mode==='extra-selector')value.selector='button';if(mode==='extra-value')value.payload={...s.value.payload,value:'yes'};
 const response=await message(value,mode==='options-source'?{...source,url:chrome.runtime.getURL('options.html')}:source);
 expect(response.ok===false||(response.data as {status?:string})?.status==='pending').toBe(true);expect(opens).toBe(0);expect(selections).toBe(0);
});
it.each(['RA_PROJECT_RECORD_START','RA_EDUCATION_RECORD_START','RA_INTERNSHIP_RECORD_START','RA_AWARD_RECORD_START','RA_PUBLICATION_RECORD_START','RA_STUDENT_WORK_RECORD_START','RA_WORKFLOW_RESUME','RA_RECORD_V2_START','RA_SCAN','RA_SCAN_SETTLED'] as const)('active observation holds the original page against %s',async type=>{
 delay=120;const s=await request(),pending=message(s.value);expect(opens).toBe(1);
 const response=await message(type.endsWith('_RECORD_START')?{type,agentRunToken:s.ownership.token}:{type});expect(response.ok).toBe(false);expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
 expect((await message({type:'RA_OBSERVE_OPTIONS_STOP',agentRunToken:s.ownership.token})).ok).toBe(true);expect((await pending).data).toMatchObject({status:'pending'});expect(selections).toBe(0);
});
it.each(['stop','owner-close','node-replace','manual-answer'] as const)('actual %s cancels observation without selecting late options',async mode=>{
 delay=120;const s=await request(),pending=message(s.value);expect(opens).toBe(1);
 if(mode==='stop')await message({type:'RA_OBSERVE_OPTIONS_STOP',agentRunToken:s.ownership.token});if(mode==='owner-close')s.ownership.port.disconnect();if(mode==='node-replace')node.replaceWith(node.cloneNode(true));if(mode==='manual-answer')node.textContent='用户已经选择';
 expect((await pending).data).toMatchObject({status:'pending'});expect(selections).toBe(0);expect(opens).toBe(1);
});
it('foreign extension or page sends no response and performs no action',()=>{
 for(const sender of [{...source,id:'foreign'},{...source,url:'https://website.invalid/'}]){const reply=vi.fn();expect(listener({type:'RA_OBSERVE_OPTIONS'},sender,reply)).toBe(false);expect(reply).not.toHaveBeenCalled();}expect(opens).toBe(0);
});
it('a forged stop cannot invalidate the legitimate observation',async()=>{
 const s=await request(),pending=message(s.value);expect((await message({type:'RA_OBSERVE_OPTIONS_STOP',agentRunToken:crypto.randomUUID()})).ok).toBe(false);
 expect((await pending).data).toMatchObject({status:'observed'});expect(opens).toBe(1);expect(selections).toBe(0);
});
it('local eligibility exposes only the current ordinary field reference, without opening the dropdown',async()=>{
 const s=await request();expect(await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:s.scan.scanId}})).toEqual({ok:true,data:{version:EXTENSION_VERSION,scanId:s.scan.scanId,fieldIds:[s.value.payload.fieldId]}});expect(opens).toBe(0);expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
it('eligibility excludes protected consent and already populated lists',async()=>{
 document.querySelector('label')!.textContent='同意隐私授权';let s=await request();expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:s.scan.scanId}})).data).toMatchObject({fieldIds:[]});s.ownership.port.disconnect();
 document.querySelector('label')!.textContent='招聘选项';list.innerHTML='<div role="option">已有选项</div>';s=await request();expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:s.scan.scanId}})).data).toMatchObject({fieldIds:[]});expect(opens).toBe(0);
});
it('eligibility cannot refer to a record editor even when its combo is empty and inert',async()=>{
 document.querySelector('section')!.setAttribute('aria-label','项目经历');document.querySelector('section')!.insertAdjacentHTML('afterbegin','<h2>项目经历</h2><div role="list"></div>');const record=document.createElement('form');list.before(record);record.append(node,list);document.querySelector('[role="list"]')!.append(record);
 const s=await request();expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:s.scan.scanId}})).data).toMatchObject({fieldIds:[]});expect((await message(s.value)).data).toMatchObject({status:'pending'});expect(opens).toBe(0);
});
it('eligibility rejects changed original control nodes and extra payload',async()=>{
 const s=await request();node.replaceWith(node.cloneNode(true));expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:s.scan.scanId}})).ok).toBe(false);
 expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:s.scan.scanId,selector:'button'}})).ok).toBe(false);expect(opens).toBe(0);
});
function secondCombo(){
 document.querySelector('section')!.insertAdjacentHTML('beforeend','<label for="second">另一招聘选项</label><button id="second" type="button" role="combobox" aria-expanded="false" aria-controls="second-list">请选择</button><div role="listbox" id="second-list" hidden></div>');
 const second=document.querySelector<HTMLElement>('#second')!,secondList=document.querySelector<HTMLElement>('#second-list')!;let clicks=0;
 second.addEventListener('click',()=>{clicks++;second.setAttribute('aria-expanded','true');secondList.hidden=false;secondList.innerHTML='<div role="option">选项乙</div>';});
 return {second,count:()=>clicks};
}
it('private unanswered content handoff installs a fresh scan and exposes no selected answer',async()=>{
 delay=-1;const s=await request();expect(await message(s.value)).toEqual({ok:true,data:{version:EXTENSION_VERSION,status:'empty',reason:'options-empty'}});
 expect((await message({type:'RA_VERIFY_SCAN',payload:{scanId:s.scan.scanId}})).ok).toBe(false);const response=await message({type:'RA_SCAN'}),scan=response.data as ScanResult;
 expect(scan.scanId).not.toBe(s.scan.scanId);expect(scan.fields.find(f=>f.htmlId==='c')).toMatchObject({hasValue:false,options:[]});expect(opens).toBe(1);expect(selections).toBe(0);
});
it('content preview keeps original attempts across UUID rescans and offers the second combo',async()=>{
 delay=-1;const second=secondCombo(),s=await request();expect((await message(s.value)).data).toMatchObject({status:'empty'});
 node.setAttribute('aria-expanded','false');list.hidden=true;const scan=(await message({type:'RA_SCAN'})).data as ScanResult,field=scan.fields.find(f=>f.htmlId==='second')!;
 expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:scan.scanId}})).data).toMatchObject({fieldIds:[field.id]});
 const first=scan.fields.find(f=>f.htmlId==='c')!;expect((await message({...s.value,payload:{scanId:scan.scanId,fieldId:first.id}})).data).toMatchObject({status:'pending',reason:'observation-already-attempted'});
 expect((await message({...s.value,payload:{scanId:scan.scanId,fieldId:field.id}})).data).toMatchObject({status:'observed',optionCount:1});expect(second.count()).toBe(1);expect(opens).toBe(1);expect(selections).toBe(0);
});
it('same-owner stop after the unanswered handoff revokes all remaining observation tasks',async()=>{
 delay=-1;const second=secondCombo(),s=await request();await message(s.value);expect((await message({type:'RA_OBSERVE_OPTIONS_STOP',agentRunToken:s.ownership.token})).ok).toBe(true);
 const scan=(await message({type:'RA_SCAN'})).data as ScanResult;expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:scan.scanId}})).data).toMatchObject({fieldIds:[]});expect(second.count()).toBe(0);
});
it.each(['manual','replace','outside'] as const)('content %s invalidation cannot be transformed into an empty continuation',async mode=>{
 delay=-1;const second=secondCombo(),s=await request();node.addEventListener('click',()=>{if(mode==='manual')node.textContent='手改';if(mode==='replace')node.replaceWith(node.cloneNode(true));if(mode==='outside')document.body.append(document.createElement('aside'));});
 expect((await message(s.value)).data).toMatchObject({status:'pending'});const scan=(await message({type:'RA_SCAN'})).data as ScanResult;
 expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:scan.scanId}})).data).toMatchObject({fieldIds:[]});expect(second.count()).toBe(0);expect(opens).toBe(1);
});
it('a forged stop after empty proof adoption does not consume the second eligible control',async()=>{
 delay=-1;secondCombo();const s=await request();await message(s.value);expect((await message({type:'RA_OBSERVE_OPTIONS_STOP',agentRunToken:crypto.randomUUID()})).ok).toBe(false);
 const scan=(await message({type:'RA_SCAN'})).data as ScanResult;expect((await message({type:'RA_AGENT_OPTION_CHECK',agentRunToken:s.ownership.token,payload:{scanId:scan.scanId}})).data).toMatchObject({fieldIds:[scan.fields.find(f=>f.htmlId==='second')!.id]});expect(opens).toBe(1);
});
