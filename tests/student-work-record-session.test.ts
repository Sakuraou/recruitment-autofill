import { afterEach, expect, it } from 'vitest';
import { createStudentWorkRecordSession, studentWorkRecordAvailability } from '../src/content/studentWorkRecordSession';
import type { RecordV2Session } from '../src/content/recordV2Gateway';
import { studentWorkSessionProfile as profile, installStudentWorkSessionPage as install } from './fixtures/student-work-session-page';
const sessions: RecordV2Session[] = [];
function create() { const session = createStudentWorkRecordSession(document, profile); sessions.push(session); return session; }
async function run(session: RecordV2Session) { let result = await session.advance();
  for (let steps = 0; steps < 30 && result.status === 'advanced'; steps++) result = await session.advance(); return result; }
afterEach(()=>{ sessions.splice(0).forEach(session=>session.stop()); document.head.innerHTML=''; document.body.innerHTML=''; window.history.replaceState({},'','/'); });
it('one explicit student work list offers an owned bounded task',()=>{
  install(document); expect(studentWorkRecordAvailability(document)).toEqual({eligible:true});
});
it('three roles and terms independently Add, fill, Save and verify',async()=>{
  const fixture=install(document); const result=await run(create()); expect(result.status,JSON.stringify(result)).toBe('complete');
  expect(fixture.saved.map(work=>[work.role,work.startDate,work.endDate,work.shortDuties])).toEqual(profile.studentWork.map(work=>[work.role,work.startDate,work.endDate,work.shortDuties]));
  expect(fixture.saved.map(work=>work.cadreLevel)).toEqual(['none-value','none-value','none-value']);
  expect(fixture.counts).toEqual({add:3,save:3,remove:0,submit:0,cancel:0});
});
it('a restart compares all identities without Add or Save',async()=>{
  const fixture=install(document); expect((await run(create())).status).toBe('complete');
  expect((await run(create())).status).toBe('complete'); expect(fixture.counts.add).toBe(3); expect(fixture.counts.save).toBe(3);
});
it('one existing job does not skip a second role or a distinct term',async()=>{
  const fixture=install(document,[1]); expect((await run(create())).status).toBe('complete');
  expect(fixture.saved.map(work=>[work.role,work.startDate])).toEqual([['辅导员助理','2021-09-01'],['就业办助理','2022-09-01']]);
  expect(fixture.counts.add).toBe(2); expect(fixture.counts.save).toBe(2);
});
it.each([{unknown:true},{existingConflict:true}])('unknown fields or existing edits preserve draft %j',async option=>{
  const fixture=install(document,[],option); expect((await run(create())).status).toBe('request-human');
  expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(0);
});
it('refused Save occurs once and cannot trigger another Add',async()=>{
  const fixture=install(document,[],{saveRefused:true}); expect((await run(create())).status).toBe('request-human');
  expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(1);
});
it('wrong saved identity stops despite increased card count',async()=>{
  const fixture=install(document,[],{corruptSummary:true}); expect((await run(create())).status).toBe('request-human');
  expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(1);
});
it('Stop after Add preserves the editor without Save',async()=>{
  const fixture=install(document),session=create(); expect((await session.advance()).status).toBe('advanced'); session.stop();
  expect((await session.advance()).status).not.toBe('advanced'); expect(fixture.counts.save).toBe(0); expect(fixture.counts.add).toBe(1);
});
it.each(['replace','url'])('a changed %s invalidates ownership before Add',async mode=>{
  const fixture=install(document),session=create();
  if(mode==='replace')fixture.list.replaceWith(fixture.list.cloneNode(true)); else window.history.replaceState({},'','/changed');
  expect((await session.advance()).status).toBe('request-human'); expect(fixture.counts.add).toBe(0);
});
it('profile change before Add stops',async()=>{
  const fixture=install(document); let projection=profile; const session=createStudentWorkRecordSession(document,projection,async()=>projection); sessions.push(session);
  projection={...projection,profileRevision:'changed'}; expect((await session.advance()).status).toBe('request-human'); expect(fixture.counts.add).toBe(0);
});
it('source missing term has no Add authority',async()=>{
  const fixture=install(document); const session=createStudentWorkRecordSession(document,{...profile,studentWork:[{...profile.studentWork[0]!,startDate:undefined}]}); sessions.push(session);
  expect((await run(session)).status).toBe('request-human'); expect(fixture.counts.add).toBe(0);
});
it('already open foreign editor prevents session creation',()=>{
  const fixture=install(document); fixture.add.click(); expect(studentWorkRecordAvailability(document).eligible).toBe(false);
  expect(()=>create()).toThrow(); expect(fixture.counts.add).toBe(1);
});
it('explicit duties revealed by role are filled before each Save',async()=>{
  const fixture=install(document,[],{dynamicDuties:true}); const result=await run(create()); expect(result.status,JSON.stringify(result)).toBe('complete');
  expect(fixture.saved.map(work=>work.shortDuties)).toEqual(profile.studentWork.map(work=>work.shortDuties)); expect(fixture.counts.save).toBe(3);
},15_000);
it('unknown dynamic fields stop Save',async()=>{
  const fixture=install(document,[],{dynamicUnknown:true}); expect((await run(create())).status).toBe('request-human'); expect(fixture.counts.save).toBe(0);
});
it('Stop during role change prevents Save and further Add',async()=>{
  const fixture=install(document,[],{onRole:()=>session.stop()}); const session=create();
  expect((await run(session)).status).not.toBe('complete'); expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(0);
});
it('profile changes during filling cannot authorize Save',async()=>{
  let projection=profile; const fixture=install(document,[],{onRole:()=>{projection={...projection,profileRevision:'changed-during-fill'};}});
  const session=createStudentWorkRecordSession(document,projection,async()=>projection); sessions.push(session);
  expect((await run(session)).status).toBe('request-human'); expect(fixture.counts.save).toBe(0);
});
it('manual change after verified filling remains visible and prevents Save',async()=>{
  const fixture=install(document),session=create(); expect((await session.advance()).status).toBe('advanced'); expect((await session.advance()).status).toBe('advanced');
  fixture.list.querySelector<HTMLInputElement>('[data-key="role"]')!.value='用户更改的职务';
  expect((await session.advance()).status).toBe('request-human'); expect(fixture.counts.save).toBe(0);
  expect(fixture.list.querySelector<HTMLInputElement>('[data-key="role"]')!.value).toBe('用户更改的职务');
});
it('missing cadre fact or overly long duties are not invented or truncated',async()=>{
  for(const work of [{...profile.studentWork[0]!,cadreLevel:undefined},{...profile.studentWork[0]!,shortDuties:'字'.repeat(51)}]){
    const fixture=install(document); const session=createStudentWorkRecordSession(document,{...profile,studentWork:[work]}); sessions.push(session);
    expect((await run(session)).status).toBe('request-human'); expect(fixture.counts.save).toBe(0);
  }
});
it('an existing overlapping changed term prevents a duplicate Add',async()=>{
  const fixture=install(document,[0]); const p=[...fixture.cards[0]!.querySelectorAll('p')].find(node=>node.textContent!.startsWith('开始日期'))!;
  p.textContent='开始日期：2021-09-02'; expect((await run(create())).status).toBe('request-human'); expect(fixture.counts.add).toBe(0); expect(fixture.counts.save).toBe(0);
});
