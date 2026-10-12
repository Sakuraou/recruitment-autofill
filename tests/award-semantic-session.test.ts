import { afterEach, expect, it, vi } from 'vitest';
import { createAwardRecordSession } from '../src/content/awardRecordSession';
import { awardSessionProfile, installAwardSessionPage } from './fixtures/award-session-page';
import type { RecordV2Session } from '../src/content/recordV2Gateway';
import type { SemanticProvider } from '../src/ai/semanticCandidates';
const sessions:RecordV2Session[]=[];
afterEach(()=>{sessions.splice(0).forEach(session=>session.stop());document.body.innerHTML='';document.head.innerHTML='';window.history.replaceState({},'','/');});
async function run(session:RecordV2Session){let result=await session.advance();for(let i=0;i<30&&result.status==='advanced';i++)result=await session.advance();return result;}
function setup(){const fixture=installAwardSessionPage(document);fixture.add.addEventListener('click',()=>{
 const input=fixture.list.querySelector<HTMLInputElement>('[data-key="name"]')!;input.closest('label')!.firstChild!.textContent='这项荣誉具体叫什么';
});return fixture;}
function provider(action?:(request:Parameters<SemanticProvider['propose']>[0],signal:AbortSignal)=>void):SemanticProvider {
 return{propose:vi.fn(async(request:Parameters<SemanticProvider['propose']>[0],signal:AbortSignal)=>{action?.(request,signal);return{requestId:request.requestId,status:'mapped',bindings:request.fields.map(field=>({ref:field.ref,fingerprint:field.fingerprint,path:'awards.name',certainty:'certain',evidence:'label'}))}})};
}
it('uses the real award transaction to fill three unknown-label records and restart without duplicates',async()=>{
 const fixture=setup(),model=provider(request=>{expect(request.protocol).toBe(4);expect(request.fields).toHaveLength(1);expect(JSON.stringify(request)).not.toContain('校级二等奖学金');});
 const session=createAwardRecordSession(document,awardSessionProfile,undefined,undefined,model);sessions.push(session);
 expect((await run(session)).status).toBe('complete');expect(model.propose).toHaveBeenCalledTimes(3);
 expect(fixture.saved.map(item=>[item.name,item.date])).toEqual(awardSessionProfile.awards.map(item=>[item.name,item.date]));
 const restarted=createAwardRecordSession(document,awardSessionProfile,undefined,undefined,model);sessions.push(restarted);
 expect((await run(restarted)).status).toBe('complete');expect(fixture.counts.add).toBe(3);expect(fixture.counts.save).toBe(3);expect(fixture.counts.submit).toBe(0);
});
it.each(['stop','replace','transient','manual','label','navigation'])('%s while inference is pending refuses the delayed candidate and does not save',async mode=>{
 const fixture=setup();let release!:(value:unknown)=>void;
 const model:SemanticProvider={propose:vi.fn(async(request:Parameters<SemanticProvider['propose']>[0])=>{await new Promise(resolve=>{release=resolve});return{requestId:request.requestId,status:'mapped',bindings:request.fields.map(field=>({ref:field.ref,fingerprint:field.fingerprint,path:'awards.name',certainty:'certain',evidence:'label'}))}})};
 const session=createAwardRecordSession(document,awardSessionProfile,undefined,undefined,model);sessions.push(session);
 expect((await session.advance()).status).toBe('advanced');const pending=session.advance();await vi.waitFor(()=>expect(model.propose).toHaveBeenCalled());
 const input=fixture.list.querySelector<HTMLInputElement>('[data-key="name"]')!;
 if(mode==='stop')session.stop();if(mode==='replace')input.replaceWith(input.cloneNode(true));
 if(mode==='transient'||mode==='manual'){input.value='用户手改';input.dispatchEvent(new Event('input',{bubbles:true}));if(mode==='transient')input.value='';}
 if(mode==='label')input.closest('label')!.firstChild!.textContent='另一个问题';if(mode==='navigation')window.history.replaceState({},'','/changed');
 release(undefined);expect((await pending).status).not.toBe('advanced');expect(fixture.counts.save).toBe(0);expect(input.value).toBe(mode==='manual'?'用户手改':'');
});
it('missing known facts do not trigger a model to reinterpret or invent the answer',async()=>{
 const fixture=setup(),model=provider();
 const projection={...awardSessionProfile,awards:[{...awardSessionProfile.awards[0]!,school:undefined}]};
 const session=createAwardRecordSession(document,projection,undefined,undefined,model);sessions.push(session);
 expect((await run(session)).status).toBe('request-human');expect(model.propose).not.toHaveBeenCalled();expect(fixture.counts.save).toBe(0);
});
it('a known existing school conflict is preserved before any model request',async()=>{
 const fixture=installAwardSessionPage(document,[],{existingConflict:true}),model=provider();
 fixture.add.addEventListener('click',()=>{fixture.list.querySelector<HTMLInputElement>('[data-key="name"]')!.closest('label')!.firstChild!.textContent='这项荣誉具体叫什么';});
 const session=createAwardRecordSession(document,awardSessionProfile,undefined,undefined,model);sessions.push(session);
 expect((await run(session)).status).toBe('request-human');expect(model.propose).not.toHaveBeenCalled();
 expect(fixture.list.querySelector<HTMLInputElement>('[data-key="school"]')!.value).toBe('网页已有其他学校');expect(fixture.counts.save).toBe(0);
});
it('an unknown meaning stays bound through the existing cadre expansion without a second request on that node',async()=>{
 const fixture=installAwardSessionPage(document,[],{cadre:'select',dynamicCadre:true}),model=provider();
 fixture.add.addEventListener('click',()=>{fixture.list.querySelector<HTMLInputElement>('[data-key="name"]')!.closest('label')!.firstChild!.textContent='这项荣誉具体叫什么';});
 const projection={...awardSessionProfile,awards:awardSessionProfile.awards.slice(0,1),applicant:{studentCadre:'是' as const,studentCadreDescription:'虚构班级事务协调'}};
 const session=createAwardRecordSession(document,projection,undefined,undefined,model);sessions.push(session);
 expect((await run(session)).status).toBe('complete');expect(model.propose).toHaveBeenCalledTimes(1);
 expect(fixture.saved.map(record=>record.cadreDescription)).toEqual(['虚构班级事务协调']);
});
