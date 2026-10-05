import { afterEach, expect, it } from 'vitest';
import { runAgentPage, type AgentBridgePorts } from '../src/popup/agentBridge';
import { scanDocument, type ScanState } from '../src/content/scanner';
import { verifyScanObservation } from '../src/content/scanFreshness';
import { matchFields } from '../src/matching/ruleMatcher';
import { createEmptyProfile, profileSchema } from '../src/profile/schema';
import { StudentWorkRecordWorkflow } from '../src/content/studentWorkRecordWorkflow';
import { studentWorkProfile } from '../src/profile/studentWorkProjection';
import { verifyRecordPresence } from '../src/agent/recordCompletion';
import { EXTENSION_VERSION } from '../src/shared/version';
import type { AgentStepRequest } from '../src/agent/nextStepProtocol';
import type { PagePlan } from '../src/popup/bridge';
import { studentWorkSessionProfile, installStudentWorkSessionPage } from './fixtures/student-work-session-page';
const active: StudentWorkRecordWorkflow[] = [];
afterEach(() => { active.splice(0).forEach(flow=>flow.stop()); document.body.innerHTML=''; });
function setup(options: { unknown?: boolean; missingDate?: boolean; corruptedSave?: boolean } = {}) {
 const page=installStudentWorkSessionPage(document,[],{unknown:options.unknown,corruptSummary:options.corruptedSave,dynamicDuties:true});
 const profile=profileSchema.parse({...createEmptyProfile(),studentWork:studentWorkSessionProfile.studentWork.map(record=>options.missingDate?{...record,startDate:undefined}:record)});
 const flow=new StudentWorkRecordWorkflow(document,async()=>studentWorkProfile(profile)); active.push(flow);
 const owner=new AbortController(), token=crypto.randomUUID(), requests: AgentStepRequest[]=[], commands: unknown[]=[];
 const scans=new WeakMap<PagePlan,ScanState>(); let context='fictional-private-context', closes=0;
 const ports:AgentBridgePorts={
  context:async()=>context,
  scan:async()=>{const scan=scanDocument();const plan={tabId:1,scan:scan.result,matches:matchFields(scan.result.fields,profile),profile};scans.set(plan,scan);return plan;},
  owner:async()=>({token,signal:owner.signal,close:()=>{closes++;owner.abort();if(flow.holdsPage())flow.stop();}}),
  check:async(_tab,kind,capability)=>{
   expect(capability).toBe(token);
   return {version:EXTENSION_VERSION,state:kind==='student-work'?flow.status():{phase:'idle',total:0,canStart:false},
    presence:kind==='student-work'?verifyRecordPresence(scanDocument(),studentWorkProfile(profile)):{state:'unverified',total:0,matched:0}};
  },
  verify:async plan=>!!verifyScanObservation(scans.get(plan)!),
  decide:async request=>{requests.push(request);return {requestId:request.requestId,status:'act',ref:request.tasks[0]!.ref,reason:'available-task'};},
  fields:async()=>{throw new Error('ordinary executor must not borrow student-work editor');},
  command:async(_tab,request)=>{
   commands.push(request);
   if(request.type==='RA_STUDENT_WORK_RECORD_START'){expect(request).toEqual({type:'RA_STUDENT_WORK_RECORD_START',agentRunToken:token});return flow.start();}
   expect(request).toEqual({type:'RA_STUDENT_WORK_RECORD_STATUS'});return {version:EXTENSION_VERSION,state:flow.status()};
  },
  wait:async signal=>{signal.throwIfAborted();await new Promise(done=>setTimeout(done,20));signal.throwIfAborted();},
 };
 return {page,profile,flow,ports,requests,commands,owner,token,closeCount:()=>closes,setContext:(value:string)=>{context=value;}};
}
it('Agent adds distinct roles and terms in order, verifies every save; restart does not add duplicates', async () => {
 const s=setup(), first=await runAgentPage(s.ports,new AbortController().signal);
 expect(first.result).toMatchObject({state:'complete',steps:1,pending:{fields:0,records:0,blockers:0}});
 expect(s.page.saved.map(record=>[record.role,record.startDate,record.endDate])).toEqual(s.profile.studentWork.map(record=>[record.role,record.startDate,record.endDate]));
 expect(s.page.saved.map(record=>record.shortDuties)).toEqual(s.profile.studentWork.map(record=>record.shortDuties));
 expect(s.page.counts).toEqual({add:3,save:3,submit:0,remove:0,cancel:0});
 const previous=s.requests.length; s.ports.owner=async()=>{const next=new AbortController();return {token:s.token,signal:next.signal,close:()=>next.abort()};};
 expect((await runAgentPage(s.ports,new AbortController().signal)).result).toMatchObject({state:'complete',steps:0});
 expect(s.requests).toHaveLength(previous);expect(s.page.counts.add).toBe(3);expect(s.closeCount()).toBe(1);
 const model=JSON.stringify(s.requests);for(const secret of ['虚构学院','辅导员助理','就业办助理','2021-09-01',s.token,'fictional-private-context'])expect(model).not.toContain(secret);
 expect(s.requests[0]?.tasks).toEqual([{ref:'task-0',kind:'student-work-records',count:3}]);
},45_000);
it.each(['unknown','missing-date','corrupted-save'] as const)('Agent %s stops with pending student work, never repeats Add or pretends complete',async mode=>{
 const s=setup({unknown:mode==='unknown',missingDate:mode==='missing-date',corruptedSave:mode==='corrupted-save'});
 expect((await runAgentPage(s.ports,new AbortController().signal)).result.state).toBe('needs-user');
 expect(s.page.counts.add).toBe(mode==='missing-date'?0:1);expect(s.page.counts.save).toBe(mode==='corrupted-save'?1:0);
 expect(s.page.counts.submit).toBe(0);expect(s.page.counts.remove).toBe(0);
},15_000);
it('owner cancellation before student-work start never reaches its Add or Save',async()=>{
 const s=setup(), command=s.ports.command;
 s.ports.command=async(tab,request)=>{if(request.type==='RA_STUDENT_WORK_RECORD_START'){s.owner.abort();return {phase:'stopped',total:3,canStart:true};}return command(tab,request);};
 expect((await runAgentPage(s.ports,new AbortController().signal)).result.state).toBe('stopped');expect(s.page.counts.add).toBe(0);expect(s.page.counts.save).toBe(0);
});
it('changed private context while model decides cannot issue the student-work command',async()=>{
 const s=setup(), decide=s.ports.decide;s.ports.decide=async(request,signal)=>{s.setContext('different-profile');return decide(request,signal);};
 expect((await runAgentPage(s.ports,new AbortController().signal)).result.state).toBe('context-changed');expect(s.commands).toEqual([]);expect(s.page.counts.add).toBe(0);
});
it('claimed complete status without three private identities cannot prove success',async()=>{
 const s=setup();s.ports.command=async(_tab,request)=>request.type.endsWith('_START')?{phase:'complete',total:3,canStart:true}:{version:EXTENSION_VERSION,state:{phase:'complete',total:3,canStart:true}};
 expect((await runAgentPage(s.ports,new AbortController().signal)).result.state).toBe('needs-user');expect(s.page.counts.add).toBe(0);
});
