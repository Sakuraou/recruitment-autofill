import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { verifyRecordPresence } from '../src/agent/recordCompletion';
import { buildAgentPageTasks, type AgentRecordCheck } from '../src/agent/pageTasks';
import { agentStepRequestSchema, parseAgentStepProposal } from '../src/agent/nextStepProtocol';
import { createEmptyProfile, profileSchema } from '../src/profile/schema';
import { publicationProfile } from '../src/profile/publicationProjection';
import { matchFields } from '../src/matching/ruleMatcher';
import { installPublicationSessionPage, publicationSessionProfile } from './fixtures/publication-session-page';
afterEach(() => { document.body.innerHTML = ''; });
const idle = (total=0, canStart=false): AgentRecordCheck => ({state:{phase:'idle',total,canStart},presence:{state:'unverified',total,matched:0}});
const checks = (total=0) => ({education:idle(),project:idle(),internship:idle(),award:idle(),publication:idle(total,true),'student-work':idle()});
function source() {
 const profile=createEmptyProfile();profile.research.papers=publicationSessionProfile.publications.map(paper=>profileSchema.shape.research.shape.papers.element.parse(paper));return profile;
}
it('offers all papers through their own task and local research collection',()=>{
 installPublicationSessionPage(document);const profile=source();const scan=scanDocument().result;
 expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(3),new Set()))
 .toMatchObject({tasks:[{kind:'publication-records',count:3}],pending:{records:3,blockers:0}});
});
it.each(['known','unknown'] as const)('empty %s paper collection remains pending',state=>{
 installPublicationSessionPage(document);const profile=createEmptyProfile();profile.collectionFacts={papers:{state,source:'user',confirmed:true}};
 const scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set()))
 .toMatchObject({tasks:[],pending:{records:0,blockers:1}});
});
it.each(['none','not_applicable'] as const)('explicit %s removes empty work but preserves an open draft',state=>{
 const page=installPublicationSessionPage(document);const profile=createEmptyProfile();profile.collectionFacts={papers:{state,source:'user',confirmed:true}};
 let scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBe(0);
 page.add.click();scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('absence cannot discard an existing paper',()=>{
 installPublicationSessionPage(document,[0]);const profile=createEmptyProfile();profile.collectionFacts={papers:{state:'none',source:'user',confirmed:true}};
 const scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('a paper section without an actionable list remains a blocker',()=>{
 document.body.innerHTML='<section aria-label="专业论著"><h2>专业论著</h2><p>暂无专业论著</p></section>';
 const scan=scanDocument().result;const profile=source();expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,{...checks(3),publication:idle(3)},new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('a stale complete state does not remove missing paper identities',()=>{
 installPublicationSessionPage(document);const profile=source();const scan=scanDocument().result;
 expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,{...checks(3),publication:{state:{phase:'complete',total:3,canStart:true},presence:{state:'pending',total:3,matched:0}}},new Set())?.tasks).toEqual([{kind:'publication-records',count:3}]);
});
it.each(['paused','review','running','preparing'] as const)('%s papers cannot be silently restarted',phase=>{
 installPublicationSessionPage(document);const profile=source();const scan=scanDocument().result;
 expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,{...checks(3),publication:{...idle(3,true),state:{phase,total:3,canStart:true}}},new Set()))
 .toMatchObject({tasks:[],pending:{records:3,blockers:1}});
});
it('current private identities prove reversed cards, preserving same-title different DOI papers',()=>{
 const page=installPublicationSessionPage(document,[2,1,0]);expect(verifyRecordPresence(scanDocument(),publicationProfile(source()))).toEqual({state:'all-present',total:3,matched:3});expect(page.counts.add).toBe(0);
});
it('equal card count cannot hide a missing paper',()=>{
 installPublicationSessionPage(document,[1,1,2]);expect(verifyRecordPresence(scanDocument(),publicationProfile(source()))).toEqual({state:'pending',total:3,matched:2});
});
it('a contradictory saved author order remains unverified',()=>{
 const page=installPublicationSessionPage(document,[2,1,0]);page.cards[0]!.querySelectorAll('p')[4]!.textContent='作者排序：第三作者';
 expect(verifyRecordPresence(scanDocument(),publicationProfile(source())).state).toBe('unverified');
});
it('replaced private card invalidates the old observation',()=>{
 const page=installPublicationSessionPage(document,[2,1,0]);const scan=scanDocument();page.cards[0]!.replaceWith(page.cards[0]!.cloneNode(true));
 expect(verifyRecordPresence(scan,publicationProfile(source())).state).toBe('unverified');
});
it('open editor cannot prove completion',()=>{
 const page=installPublicationSessionPage(document,[0,1,2]);page.add.click();expect(verifyRecordPresence(scanDocument(),publicationProfile(source())).state).toBe('unverified');
});
it('six offered tasks fit the bounded protocol and unknown actions stay rejected',()=>{
 const kinds=['fill-visible','education-records','project-records','internship-records','award-records','publication-records'];
 const request={protocol:1,requestId:crypto.randomUUID(),canComplete:false,pending:{fields:1,records:5,blockers:0},tasks:kinds.map((kind,index)=>({ref:'task-'+index,kind,count:1}))};
 const parsed=agentStepRequestSchema.safeParse(request);expect(parsed.success).toBe(true);
 if(parsed.success){expect(parseAgentStepProposal({requestId:request.requestId,status:'act',ref:'task-5',reason:'available-task'},parsed.data)?.ref).toBe('task-5');
 expect(parseAgentStepProposal({requestId:request.requestId,status:'act',ref:'task-6',reason:'available-task'},parsed.data)).toBeUndefined();}
 expect(agentStepRequestSchema.safeParse({...request,tasks:[...request.tasks,{ref:'task-6',kind:'unsupported-records',count:1}]}).success).toBe(false);
});
