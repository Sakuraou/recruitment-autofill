import {afterEach,expect,it} from 'vitest';
import {scanDocument} from '../src/content/scanner';
import {verifyRecordPresence} from '../src/agent/recordCompletion';
import {buildAgentPageTasks,type AgentRecordCheck} from '../src/agent/pageTasks';
import {agentStepRequestSchema,parseAgentStepProposal} from '../src/agent/nextStepProtocol';
import {createEmptyProfile} from '../src/profile/schema';
import {matchFields} from '../src/matching/ruleMatcher';
import {installAwardSessionPage,awardSessionProfile} from './fixtures/award-session-page';
afterEach(()=>{document.body.innerHTML='';});
it('offers all three awards using their own guarded task',()=>{
 installAwardSessionPage(document);const profile=createEmptyProfile();profile.awards=awardSessionProfile.awards.map(award=>({...award}));
 const scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(3),new Set()))
 .toMatchObject({tasks:[{kind:'award-records',count:3}],pending:{records:3,blockers:0}});
});
const idle=(total=0,canStart=false):AgentRecordCheck=>({state:{phase:'idle',total,canStart},presence:{state:'unverified',total,matched:0}});
const checks=(total=0)=>({education:idle(),project:idle(),internship:idle(),award:idle(total,true),publication:idle(),'student-work':idle()});
it.each(['known','unknown'] as const)('empty %s award source stays pending without another category borrowing the task',state=>{
 installAwardSessionPage(document);const profile=createEmptyProfile();profile.collectionFacts={awards:{state,source:'user',confirmed:true}};
 const scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set()))
 .toMatchObject({tasks:[],pending:{records:0,blockers:1}});
});
it.each(['none','not_applicable'] as const)('explicit %s has no task only for an empty closed award list',state=>{
 const fixture=installAwardSessionPage(document);const profile=createEmptyProfile();profile.collectionFacts={awards:{state,source:'user',confirmed:true}};
 let scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBe(0);
 fixture.add.click();scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('absence cannot discard a contradictory saved award',()=>{
 installAwardSessionPage(document,[0]);const profile=createEmptyProfile();profile.collectionFacts={awards:{state:'none',source:'user',confirmed:true}};
 const scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('a previous complete phase with missing award identities reoffers the task',()=>{
 installAwardSessionPage(document);const profile=createEmptyProfile();profile.awards=awardSessionProfile.awards.map(award=>({...award}));const scan=scanDocument().result;
 expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,{...checks(3),award:{state:{phase:'complete',total:3,canStart:true},presence:{state:'pending',total:3,matched:0}}},new Set())?.tasks).toEqual([{kind:'award-records',count:3}]);
});
it('proves all awards independently even when summary order is reversed',()=>{
 const page=installAwardSessionPage(document,[2,1,0]);expect(verifyRecordPresence(scanDocument(),awardSessionProfile)).toEqual({state:'all-present',total:3,matched:3});expect(page.counts.add).toBe(0);
});
it('equal card count does not prove the missing first-year scholarship',()=>{
 installAwardSessionPage(document,[1,1,2]);expect(verifyRecordPresence(scanDocument(),awardSessionProfile)).toEqual({state:'pending',total:3,matched:2});
});
it('an open award editor cannot be used as a completion proof',()=>{
 const page=installAwardSessionPage(document,[0,1,2]);page.add.click();expect(verifyRecordPresence(scanDocument(),awardSessionProfile).state).toBe('unverified');
});
it('replaced award card invalidates the old private observation',()=>{
 const page=installAwardSessionPage(document,[0,1,2]);const scan=scanDocument();const card=page.list.querySelector('article')!;card.replaceWith(card.cloneNode(true));expect(verifyRecordPresence(scan,awardSessionProfile).state).toBe('unverified');
});
it('all five offered categories fit the fixed protocol without adding arbitrary actions',()=>{
 const request={protocol:1,requestId:crypto.randomUUID(),canComplete:false,pending:{fields:1,records:9,blockers:0},tasks:[
 {ref:'task-0',kind:'fill-visible',count:1},{ref:'task-1',kind:'education-records',count:2},{ref:'task-2',kind:'project-records',count:2},{ref:'task-3',kind:'internship-records',count:2},{ref:'task-4',kind:'award-records',count:3}]};
 const parsed=agentStepRequestSchema.safeParse(request);expect(parsed.success).toBe(true);
 if(parsed.success)expect(parseAgentStepProposal({requestId:request.requestId,status:'act',ref:'task-4',reason:'available-task'},parsed.data)?.ref).toBe('task-4');
 expect(agentStepRequestSchema.safeParse({...request,tasks:[...request.tasks,{ref:'task-5',kind:'unsupported-records',count:1}]}).success).toBe(false);
});
