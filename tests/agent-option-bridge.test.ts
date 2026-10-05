import {afterEach,expect,it,vi} from 'vitest';
import {runAgentPage,type AgentBridgePorts} from '../src/popup/agentBridge';
import type {PagePlan} from '../src/popup/bridge';
import {scanDocument,type ScanState} from '../src/content/scanner';
import {verifyScanObservation} from '../src/content/scanFreshness';
import {captureOptionObservation} from '../src/content/optionObservation';
import {OptionObservationSession} from '../src/content/optionObservationSession';
import {AgentPageLease} from '../src/agent/pageLease';
import {agentOptionFieldIds} from '../src/agent/optionFieldScope';
import {createEmptyProfile,profileSchema} from '../src/profile/schema';
import {matchFields} from '../src/matching/ruleMatcher';
import {fillScan} from '../src/content/autofill';
import {EXTENSION_VERSION} from '../src/shared/version';
import type {AgentStepRequest} from '../src/agent/nextStepProtocol';
afterEach(()=>{document.body.innerHTML='';});
function setup(mode='normal'){
 document.body.innerHTML='<section aria-label="个人信息"><h2>个人信息</h2><label for="c">未知招聘问题</label><button id="c" type="button" role="combobox" aria-controls="l" aria-expanded="false">请选择</button><div id="l" role="listbox" hidden></div></section>';
 const node=document.querySelector<HTMLElement>('#c')!,list=document.querySelector<HTMLElement>('#l')!;let opens=0,selections=0,context='fictional-context',current:ScanState|undefined,token='';
 node.addEventListener('click',()=>{opens++;node.setAttribute('aria-expanded','true');list.hidden=false;if(mode!=='no-options')setTimeout(()=>{if(mode==='replace-late')node.replaceWith(node.cloneNode(true));if(mode==='manual-late')node.textContent='网页手选';list.innerHTML='<div role="option" data-value="internal-m">男</div><div role="option" data-value="internal-f">女</div>';},mode==='slow'?160:10);});
 list.addEventListener('click',event=>{const option=(event.target as Element).closest('[role="option"]');if(option){selections++;option.setAttribute('aria-selected','true');node.textContent=option.textContent;}});
 const profile=profileSchema.parse({...createEmptyProfile(),basic:{gender:'男'}}),lease=new AgentPageLease(()=>document.URL,()=>false),scans=new WeakMap<PagePlan,ScanState>();
 const ownerStop=new AbortController(),external=new AbortController(),session=new OptionObservationSession({extensionId:'fixture',popupUrl:'chrome-extension://fixture/popup.html',lease,getScan:()=>current,occupied:()=>false});
 const requests:AgentStepRequest[]=[],commands:unknown[]=[];let fieldAttempts=0;
 const ports:AgentBridgePorts={scan:async()=>{current=scanDocument();const plan={tabId:1,scan:current.result,matches:matchFields(current.result.fields,profile),profile};scans.set(plan,current);return plan;},context:async()=>context,
  owner:async()=>{token=lease.begin();return{token,signal:ownerStop.signal,close:()=>{lease.end(token);session.cancelOwned();ownerStop.abort();}};},
  check:async()=>({version:EXTENSION_VERSION,state:{phase:'idle',total:0,canStart:false},presence:{state:'pending',total:0,matched:0}}),
  optionCheck:async(_tab,scanId,ownedToken)=>{expect(ownedToken).toBe(token);expect(scanId).toBe(current?.result.scanId);const id=current&&[...agentOptionFieldIds(current.result)].find(id=>captureOptionObservation(current!,id));return{version:EXTENSION_VERSION,scanId,fieldIds:mode==='forged-ref'?['#c']:id?[id]:[]};},
  verify:async plan=>!!verifyScanObservation(scans.get(plan)!),
  decide:async(request,signal)=>{requests.push(request);signal.throwIfAborted();if(request.tasks.some(task=>task.kind==='observe-options')){if(mode==='context-change')context='different';if(mode==='replace')node.replaceWith(node.cloneNode(true));}
   return{requestId:request.requestId,status:'act',ref:request.tasks.find(task=>task.kind==='observe-options')?.ref??request.tasks[0]!.ref,reason:'available-task'};},
  fields:async plan=>{fieldAttempts++;const field=plan.scan.fields[0]!;if(!field.options.length)return[];return fillScan(scans.get(plan)!,{scanId:plan.scan.scanId,items:[{fieldId:field.id,value:profile.basic.gender!,confirmed:true}]});},
  command:async(_tab,request)=>{commands.push(request);if(request.type!=='RA_OBSERVE_OPTIONS')throw new Error('unexpected record action');const result=await session.run(request,{id:'fixture',url:'chrome-extension://fixture/popup.html'});if(result.status==='observed')current=session.takeScan(token);return{version:EXTENSION_VERSION,...result};},wait:async()=>{},
 };
 return{ports,external,requests,commands,node,profile,counts:()=>({opens,selections,fieldAttempts}),close:()=>{lease.end(token);session.cancelOwned();ownerStop.abort();}};
}
it('one Agent intent observes options once, freshly resolves the local answer and verifies completion',async()=>{
 const s=setup(),result=await runAgentPage(s.ports,s.external.signal);expect(result.plan?.scan.semanticGraph?.nodes.filter(node=>node.kind==='action'&&node.action==='unknown')).toEqual([]);expect(result.result).toMatchObject({state:'complete',steps:3,pending:{fields:0,records:0,blockers:0}});expect(s.counts()).toEqual({opens:1,selections:1,fieldAttempts:2});expect(s.node.textContent).toBe('男');expect(s.commands).toHaveLength(1);
 expect(s.requests.map(request=>request.tasks.map(task=>task.kind))).toEqual([['fill-visible'],['observe-options'],['fill-visible']]);expect(JSON.stringify(s.requests)).not.toMatch(/男|女|internal-|fictional-context|chrome-extension/u);
});
it('an empty list stays pending after one attempt, no repeat click and no false completion',async()=>{
 const s=setup('no-options'),result=await runAgentPage(s.ports,s.external.signal);expect(result.result.state).toBe('needs-user');expect(result.result.pending?.fields).toBe(1);expect(s.counts()).toEqual({opens:1,selections:0,fieldAttempts:1});
});
it.each(['context-change','replace','forged-ref'] as const)('rejects %s before an observation or a selected answer',async mode=>{
 const s=setup(mode),result=await runAgentPage(s.ports,s.external.signal);expect(result.result.state).not.toBe('complete');expect(s.counts().opens).toBe(0);expect(s.counts().selections).toBe(0);
});
it('popup ownership ending during the wait cannot select a late answer',async()=>{
 const s=setup('slow'),running=runAgentPage(s.ports,s.external.signal);await vi.waitFor(()=>expect(s.counts().opens).toBe(1));s.close();expect((await running).result.state).toBe('stopped');expect(s.counts().selections).toBe(0);
});
it.each(['replace-late','manual-late'] as const)('%s during observation cannot turn into fresh fill authority or false completion',async mode=>{
 const s=setup(mode),result=await runAgentPage(s.ports,s.external.signal);expect(result.result).toMatchObject({state:'needs-user',steps:2,pending:{fields:1}});expect(s.counts()).toEqual({opens:1,selections:0,fieldAttempts:1});
});
