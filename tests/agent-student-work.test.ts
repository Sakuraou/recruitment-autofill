import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { verifyRecordPresence } from '../src/agent/recordCompletion';
import { buildAgentPageTasks, type AgentRecordCheck } from '../src/agent/pageTasks';
import { agentStepRequestSchema, parseAgentStepProposal } from '../src/agent/nextStepProtocol';
import { createEmptyProfile, profileSchema } from '../src/profile/schema';
import { studentWorkProfile } from '../src/profile/studentWorkProjection';
import { matchFields } from '../src/matching/ruleMatcher';
import { installStudentWorkSessionPage, studentWorkSessionProfile } from './fixtures/student-work-session-page';
afterEach(() => { document.body.innerHTML = ''; });
const idle = (total=0, canStart=false): AgentRecordCheck => ({state:{phase:'idle',total,canStart},presence:{state:'unverified',total,matched:0}});
const checks = (total=0) => ({education:idle(),project:idle(),internship:idle(),award:idle(),publication:idle(),'student-work':idle(total,true)});
function source() {
 const profile=createEmptyProfile();profile.studentWork=studentWorkSessionProfile.studentWork.map(record=>profileSchema.shape.studentWork.element.parse(record));return profile;
}
it('offers all student work through their own task and local studentWork collection',()=>{
 installStudentWorkSessionPage(document);const profile=source();const scan=scanDocument().result;
 expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(3),new Set()))
 .toMatchObject({tasks:[{kind:'student-work-records',count:3}],pending:{records:3,blockers:0}});
});
it.each(['known','unknown'] as const)('empty %s student work collection remains pending',state=>{
 installStudentWorkSessionPage(document);const profile=createEmptyProfile();profile.collectionFacts={studentWork:{state,source:'user',confirmed:true}};
 const scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set()))
 .toMatchObject({tasks:[],pending:{records:0,blockers:1}});
});
it.each(['none','not_applicable'] as const)('explicit %s removes empty work but preserves an open draft',state=>{
 const page=installStudentWorkSessionPage(document);const profile=createEmptyProfile();profile.collectionFacts={studentWork:{state,source:'user',confirmed:true}};
 let scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBe(0);
 page.add.click();scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('absence cannot discard an existing student work',()=>{
 installStudentWorkSessionPage(document,[0]);const profile=createEmptyProfile();profile.collectionFacts={studentWork:{state:'none',source:'user',confirmed:true}};
 const scan=scanDocument().result;expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,checks(),new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('a student work section without an actionable list remains a blocker',()=>{
 document.body.innerHTML='<section aria-label="校内职务"><h2>校内职务</h2><p>暂无校内职务</p></section>';
 const scan=scanDocument().result;const profile=source();expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,{...checks(3),'student-work':idle(3)},new Set())?.pending.blockers).toBeGreaterThan(0);
});
it('a stale complete state does not remove missing student work identities',()=>{
 installStudentWorkSessionPage(document);const profile=source();const scan=scanDocument().result;
 expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,{...checks(3),'student-work':{state:{phase:'complete',total:3,canStart:true},presence:{state:'pending',total:3,matched:0}}},new Set())?.tasks).toEqual([{kind:'student-work-records',count:3}]);
});
it.each(['paused','review','running','preparing'] as const)('%s student work cannot be silently restarted',phase=>{
 installStudentWorkSessionPage(document);const profile=source();const scan=scanDocument().result;
 expect(buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,{...checks(3),'student-work':{...idle(3,true),state:{phase,total:3,canStart:true}}},new Set()))
 .toMatchObject({tasks:[],pending:{records:3,blockers:1}});
});
it('current private identities prove reversed cards, preserving same-organization distinct roles and terms student work',()=>{
 const page=installStudentWorkSessionPage(document,[2,1,0]);expect(verifyRecordPresence(scanDocument(),studentWorkProfile(source()))).toEqual({state:'all-present',total:3,matched:3});expect(page.counts.add).toBe(0);
});
it('equal card count cannot hide a missing student work',()=>{
 installStudentWorkSessionPage(document,[1,1,2]);expect(verifyRecordPresence(scanDocument(),studentWorkProfile(source()))).toEqual({state:'pending',total:3,matched:2});
});
it('a contradictory overlapping saved term remains unverified',()=>{
 const page=installStudentWorkSessionPage(document,[2,1,0]);page.cards[0]!.querySelectorAll('p')[3]!.textContent='结束日期：2023-07-30';
 expect(verifyRecordPresence(scanDocument(),studentWorkProfile(source())).state).toBe('unverified');
});
it('replaced private card invalidates the old observation',()=>{
 const page=installStudentWorkSessionPage(document,[2,1,0]);const scan=scanDocument();page.cards[0]!.replaceWith(page.cards[0]!.cloneNode(true));
 expect(verifyRecordPresence(scan,studentWorkProfile(source())).state).toBe('unverified');
});
it('open editor cannot prove completion',()=>{
 const page=installStudentWorkSessionPage(document,[0,1,2]);page.add.click();expect(verifyRecordPresence(scanDocument(),studentWorkProfile(source())).state).toBe('unverified');
});

it('all seven bounded tasks fit; model selectors, values, and unoffered refs remain rejected', () => {
 const kinds = ['fill-visible','education-records','project-records','internship-records','award-records','publication-records','student-work-records'];
 const request = { protocol: 1, requestId: crypto.randomUUID(), canComplete: false, pending: { fields: 1, records: 6, blockers: 0 },
  tasks: kinds.map((kind,index) => ({ ref: 'task-'+index, kind, count: 1 })) };
 const parsed = agentStepRequestSchema.safeParse(request); expect(parsed.success).toBe(true);
 if (!parsed.success) return;
 const proposal = { requestId: request.requestId, status: 'act', ref: 'task-6', reason: 'available-task' };
 expect(parseAgentStepProposal(proposal, parsed.data)?.ref).toBe('task-6');
 expect(parseAgentStepProposal({ ...proposal, ref: 'task-7' }, parsed.data)).toBeUndefined();
 expect(parseAgentStepProposal({ ...proposal, selector: 'button', value: 'invented' }, parsed.data)).toBeUndefined();
 expect(agentStepRequestSchema.safeParse({ ...request, tasks: [...request.tasks, { ref: 'task-7', kind: 'student-work-records', count: 1 }] }).success).toBe(false);
 expect(agentStepRequestSchema.safeParse({ ...request, tasks: request.tasks.map(task => task.ref === 'task-6' ? { ...task, kind: 'unknown-records' } : task) }).success).toBe(false);
});
it.each(['missing', 'month-only'] as const)('source %s term cannot be count-verified against complete cards', mode => {
 installStudentWorkSessionPage(document, [0,1,2]); const profile = source();
 profile.studentWork[0]!.startDate = mode === 'missing' ? undefined : '2021-09';
 expect(verifyRecordPresence(scanDocument(),studentWorkProfile(profile))).toEqual({ state: 'unverified', total: 3, matched: 0 });
});
it('visible incomplete role cannot be hidden by three complete-looking card counts', () => {
 const page = installStudentWorkSessionPage(document,[0,1,2]); page.cards[1]!.querySelectorAll('p')[1]!.textContent = '担任职务：待补充';
 expect(verifyRecordPresence(scanDocument(),studentWorkProfile(source()))).toEqual({ state: 'unverified', total: 3, matched: 0 });
});
it('student cadre question without student-work list remains pending and cannot imply a role', () => {
 document.body.innerHTML='<section aria-label="校内职务"><h2>校内职务</h2><form><fieldset><legend>是否学生干部</legend><label><input type="radio" name="cadre" value="y">是</label><label><input type="radio" name="cadre" value="n">否</label></fieldset></form></section>';
 const scan=scanDocument().result, profile=source();
 const tasks = buildAgentPageTasks(scan,matchFields(scan.fields,profile),profile,{...checks(3),'student-work':idle(3)},new Set());
 expect(tasks?.tasks.some(task=>task.kind==='student-work-records')).toBe(false); expect(tasks?.pending.fields).toBeGreaterThan(0);
 expect(document.querySelector<HTMLInputElement>('input:checked')).toBeNull();
});
