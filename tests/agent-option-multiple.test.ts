import {afterEach,expect,it,vi} from 'vitest';
import {runAgentPage,type AgentBridgePorts} from '../src/popup/agentBridge';
import type {PagePlan} from '../src/popup/bridge';
import {scanDocument,type ScanState} from '../src/content/scanner';
import {verifyScanObservation} from '../src/content/scanFreshness';
import {OptionObservationSession} from '../src/content/optionObservationSession';
import {AgentPageLease} from '../src/agent/pageLease';
import {createEmptyProfile,profileSchema} from '../src/profile/schema';
import {matchFields} from '../src/matching/ruleMatcher';
import {fillScan} from '../src/content/autofill';
import {EXTENSION_VERSION} from '../src/shared/version';
import type {AgentStepRequest} from '../src/agent/nextStepProtocol';

afterEach(()=>{document.body.innerHTML='';});
function setup(mode='two',count=2){
 document.body.innerHTML='<section aria-label="个人信息">'+Array.from({length:count},(_,i)=>'<label for="c'+i+'">未知招聘问题</label><button type="button" id="c'+i+'" role="combobox" aria-controls="l'+i+'" aria-expanded="false">请选择</button><div role="listbox" id="l'+i+'" hidden></div>').join('')+'</section>';
 const nodes=[...document.querySelectorAll<HTMLElement>('[role="combobox"]')],lists=[...document.querySelectorAll<HTMLElement>('[role="listbox"]')],opens=nodes.map(()=>0),selections=nodes.map(()=>0);
 nodes.forEach((node,i)=>node.addEventListener('click',()=>{opens[i]=(opens[i]??0)+1;node.setAttribute('aria-expanded','true');lists[i]!.hidden=false;
  if(mode==='all-observed'||(i>0&&!['all-empty','budget'].includes(mode)))lists[i]!.innerHTML='<div role="option" data-value="private-m">男</div><div role="option" data-value="private-f">女</div>';
  if(mode==='manual'&&i===0)node.textContent='手改';if(mode==='replace'&&i===0)node.replaceWith(node.cloneNode(true));
 }));
 lists.forEach((list,i)=>list.addEventListener('click',event=>{const option=(event.target as Element).closest('[role="option"]');if(option){selections[i]=(selections[i]??0)+1;option.setAttribute('aria-selected','true');nodes[i]!.textContent=option.textContent;}}));
 let current:ScanState|undefined,token='',fieldAttempts=0,context='fictional-private-context';
 const profile=profileSchema.parse({...createEmptyProfile(),basic:{gender:'男'}}),lease=new AgentPageLease(()=>document.URL,()=>false),plans=new WeakMap<PagePlan,ScanState>();
 const ownerStop=new AbortController(),external=new AbortController(),session=new OptionObservationSession({extensionId:'fixture',popupUrl:'chrome-extension://fixture/popup.html',lease,getScan:()=>current,occupied:()=>false});
 const requests:AgentStepRequest[]=[],commandFields:number[]=[];
 const ports:AgentBridgePorts={
  scan:async()=>{current=scanDocument();const plan={tabId:1,scan:current.result,matches:matchFields(current.result.fields,profile),profile};plans.set(plan,current);return plan;},context:async()=>context,
  owner:async()=>{token=lease.begin();return{token,signal:ownerStop.signal,close:()=>{session.cancelOwned();lease.end(token);ownerStop.abort();}};},
  check:async()=>({version:EXTENSION_VERSION,state:{phase:'idle',total:0,canStart:false},presence:{state:'pending',total:0,matched:0}}),
  optionCheck:async(_tab,scanId,owned)=>{expect(owned).toBe(token);const fieldId=current&&session.nextField(owned,current);return{version:EXTENSION_VERSION,scanId,fieldIds:fieldId?[fieldId]:[]};},
  verify:async plan=>!!verifyScanObservation(plans.get(plan)!),
  decide:async(request,signal)=>{requests.push(request);signal.throwIfAborted();if(mode==='context-change'&&request.tasks.some(t=>t.kind==='observe-options'))context='new-context';return{requestId:request.requestId,status:'act',ref:request.tasks.find(t=>t.kind==='observe-options')?.ref??request.tasks[0]!.ref,reason:'available-task'};},
  fields:async plan=>{fieldAttempts++;const fields=plan.scan.fields.filter(field=>field.options.length&&!field.hasValue);if(!fields.length)return[];return fillScan(plans.get(plan)!,{scanId:plan.scan.scanId,items:fields.map(field=>({fieldId:field.id,value:profile.basic.gender!,confirmed:true}))});},
  command:async(_tab,request)=>{
   if(request.type!=='RA_OBSERVE_OPTIONS')throw new Error('unexpected command');const node=current?.controls.get(request.payload.fieldId)?.node;commandFields.push(nodes.findIndex(value=>value===node));
   if(mode==='forged-pending')return{version:EXTENSION_VERSION,status:'pending',reason:'options-empty'};
   if(mode==='extra-empty')return{version:EXTENSION_VERSION,status:'empty',reason:'options-empty',value:'男'};
   if(mode==='slow'){await new Promise(done=>setTimeout(done,80));external.signal.throwIfAborted();}
   const result=await session.run(request,{id:'fixture',url:'chrome-extension://fixture/popup.html'});
   if(result.status==='observed'||result.reason==='options-empty'){
    const fresh=session.takeScan(token);if(!fresh)return{version:EXTENSION_VERSION,status:'pending',reason:'observation-invalidated'};current=fresh;
    if(result.status==='pending')return{version:EXTENSION_VERSION,status:'empty',reason:'options-empty'};
   }
   return{version:EXTENSION_VERSION,...result};
  },wait:async()=>{},
 };
 return {ports,external,requests,commandFields,nodes,profile,counts:()=>({opens,selections,fieldAttempts}),close:()=>{session.cancelOwned();lease.end(token);ownerStop.abort();}};
}
it('a verified empty first field does not block observing and filling the second; the first remains pending',async()=>{
 const s=setup(),result=await runAgentPage(s.ports,s.external.signal);expect(s.counts().opens).toEqual([1,1]);expect(s.counts().selections).toEqual([0,1]);expect(s.commandFields).toEqual([0,1]);
 expect(result.result.state).toBe('needs-user');expect(result.result.pending?.fields).toBe(1);expect(s.nodes[0]!.textContent).toBe('请选择');expect(s.nodes[1]!.textContent).toBe('男');
 expect(JSON.stringify(s.requests)).not.toMatch(/男|女|private-m|fictional-private-context|"c0"|"c1"|scanId/u);
});
it('two identical unanswered task shapes have distinct private progress identities and each open once',async()=>{
 const s=setup('all-empty'),result=await runAgentPage(s.ports,s.external.signal);expect(s.commandFields).toEqual([0,1]);expect(s.counts()).toEqual({opens:[1,1],selections:[0,0],fieldAttempts:1});
 expect(result.result).toMatchObject({state:'needs-user',steps:3,pending:{fields:2}});expect(s.requests.map(r=>r.tasks.map(t=>t.kind))).toEqual([['fill-visible'],['observe-options'],['observe-options']]);
});
it('two populated observations resolve both local answers and finish only after both are verified',async()=>{
 const s=setup('all-observed'),result=await runAgentPage(s.ports,s.external.signal);expect(result.result.state).toBe('complete');expect(result.result.pending?.fields).toBe(0);expect(s.counts().opens).toEqual([1,1]);expect(s.counts().selections).toEqual([1,1]);
});
it('the private eight-control budget preserves all nine unknowns and never opens the ninth',async()=>{
 const s=setup('budget',9),result=await runAgentPage(s.ports,s.external.signal);expect(result.result).toMatchObject({state:'needs-user',steps:9,pending:{fields:9}});expect(s.counts().opens).toEqual([1,1,1,1,1,1,1,1,0]);expect(s.commandFields).toEqual([0,1,2,3,4,5,6,7]);
},12000);
it.each(['manual','replace'] as const)('%s invalidation cannot become an empty continuation to the second field',async mode=>{
 const s=setup(mode),result=await runAgentPage(s.ports,s.external.signal);expect(result.result.state).toBe('needs-user');expect(s.commandFields).toEqual([0]);expect(s.counts().opens).toEqual([1,0]);expect(s.counts().selections).toEqual([0,0]);
});
it('raw pending reason options-empty does not authorize a second action',async()=>{
 const s=setup('forged-pending'),result=await runAgentPage(s.ports,s.external.signal);expect(result.result.state).toBe('needs-user');expect(s.commandFields).toEqual([0]);expect(s.counts().opens).toEqual([0,0]);
});
it('a response carrying an empty result and arbitrary personal value is rejected',async()=>{
 const s=setup('extra-empty'),result=await runAgentPage(s.ports,s.external.signal);expect(result.result.state).toBe('unavailable');expect(s.commandFields).toEqual([0]);expect(s.counts().selections).toEqual([0,0]);
});
it('changed popup context prevents the first observation and any remainder',async()=>{
 const s=setup('context-change'),result=await runAgentPage(s.ports,s.external.signal);expect(result.result.state).toBe('context-changed');expect(s.counts().opens).toEqual([0,0]);expect(s.commandFields).toEqual([]);
});
it('stopping before a delayed first observation prevents all remaining fields',async()=>{
 const s=setup('slow'),running=runAgentPage(s.ports,s.external.signal);await vi.waitFor(()=>expect(s.commandFields).toEqual([0]));s.external.abort();expect((await running).result.state).toBe('stopped');expect(s.counts().opens).toEqual([0,0]);
});
