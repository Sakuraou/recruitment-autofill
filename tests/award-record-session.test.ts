import {afterEach,expect,it} from 'vitest';
import {createAwardRecordSession,awardRecordAvailability} from '../src/content/awardRecordSession';
import type {RecordV2Session} from '../src/content/recordV2Gateway';
import {awardSessionProfile,installAwardSessionPage} from './fixtures/award-session-page';
const sessions:RecordV2Session[]=[];
function create(){const value=createAwardRecordSession(document,awardSessionProfile);sessions.push(value);return value;}
async function run(session:RecordV2Session){let result=await session.advance();for(let step=0;step<25&&result.status==='advanced';step++)result=await session.advance();return result;}
afterEach(()=>{sessions.splice(0).forEach(session=>session.stop());document.head.innerHTML='';document.body.innerHTML='';window.history.replaceState({},'','/');});
it('one explicit award list offers a reversible record task',()=>{installAwardSessionPage(document);expect(awardRecordAvailability(document)).toEqual({eligible:true});});
it('fills and saves all three awards independently, including repeated scholarship names',async()=>{
  const fixture=installAwardSessionPage(document);const result=await run(create());
  expect(result.status).toBe('complete');expect(fixture.saved.map(award=>award.date)).toEqual(awardSessionProfile.awards.map(award=>award.date));
  expect(fixture.saved.map(award=>award.name)).toEqual(awardSessionProfile.awards.map(award=>award.name));
  expect(fixture.counts).toEqual({add:3,save:3,remove:0,submit:0,cancel:0});
});
it('restart freshly verifies saved identities with no duplicate Add or Save',async()=>{
  const fixture=installAwardSessionPage(document);expect((await run(create())).status).toBe('complete');
  expect((await run(create())).status).toBe('complete');expect(fixture.counts.add).toBe(3);expect(fixture.counts.save).toBe(3);
});
it('existing second-year scholarship does not skip the first-year award',async()=>{
  const fixture=installAwardSessionPage(document,[1]);expect((await run(create())).status).toBe('complete');
  expect(fixture.saved.map(award=>award.date)).toEqual(['2021-11-15','2023-04-18']);expect(fixture.counts.add).toBe(2);
});
it('unknown fields preserve the draft and prevent saving',async()=>{
  const fixture=installAwardSessionPage(document,[],{unknown:true});expect((await run(create())).status).toBe('request-human');
  expect(fixture.counts.add).toBe(1);expect(fixture.counts.save).toBe(0);expect(fixture.counts.submit+fixture.counts.remove).toBe(0);
});
it('conflicting website values preserve the original value and prevent saving',async()=>{
  const fixture=installAwardSessionPage(document,[],{existingConflict:true});expect((await run(create())).status).toBe('request-human');
  expect(fixture.list.querySelector<HTMLInputElement>('[data-key="school"]')?.value).toBe('网页已有其他学校');expect(fixture.counts.save).toBe(0);
});
it('uncertain Save stops after one click without another Add',async()=>{
  const fixture=installAwardSessionPage(document,[],{saveRefused:true});expect((await run(create())).status).toBe('request-human');
  expect(fixture.counts.add).toBe(1);expect(fixture.counts.save).toBe(1);
});
it('a foreign open editor prevents starting another record run',()=>{
  const fixture=installAwardSessionPage(document);fixture.add.click();expect(awardRecordAvailability(document).eligible).toBe(false);
  expect(()=>create()).toThrow();expect(fixture.counts.add).toBe(1);
});
it('Stop after opening the editor preserves the draft without Save',async()=>{
  const fixture=installAwardSessionPage(document);const session=create();expect((await session.advance()).status).toBe('advanced');session.stop();
  expect((await session.advance()).status).not.toBe('advanced');expect(fixture.counts.add).toBe(1);expect(fixture.counts.save).toBe(0);
});
it('a changed list element invalidates the run before Add',async()=>{
  const fixture=installAwardSessionPage(document);const session=create();fixture.list.replaceWith(fixture.list.cloneNode(true));
  expect((await session.advance()).status).toBe('request-human');expect(fixture.counts.add).toBe(0);
});
it('profile updates invalidate old award facts before Add',async()=>{
  const fixture=installAwardSessionPage(document);let projection=awardSessionProfile;
  const session=createAwardRecordSession(document,projection,async()=>projection);sessions.push(session);
  projection={...projection,profileRevision:'changed-revision'};
  expect((await session.advance()).status).toBe('request-human');expect(fixture.counts.add).toBe(0);
});
it('missing identity dates stop before Add rather than producing an unverifiable duplicate',async()=>{
  const fixture=installAwardSessionPage(document);
  const source={...awardSessionProfile,awards:[{...awardSessionProfile.awards[0]!,date:undefined}]};
  const session=createAwardRecordSession(document,source);sessions.push(session);
  expect((await session.advance()).status).toBe('request-human');expect(fixture.counts.add).toBe(0);
});
it('an already correct school value is preserved while the rest of this award is filled',async()=>{
  const fixture=installAwardSessionPage(document);
  fixture.add.addEventListener('click',()=>{fixture.list.querySelector<HTMLInputElement>('[data-key="school"]')!.value='虚构大学';});
  expect((await run(create())).status).toBe('complete');expect(fixture.saved).toHaveLength(3);expect(fixture.saved.every(award=>award.school==='虚构大学')).toBe(true);
});
