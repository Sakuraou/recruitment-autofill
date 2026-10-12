import { afterEach, expect, it, vi } from 'vitest';
import { createPublicationRecordSession } from '../src/content/publicationRecordSession';
import { publicationSessionProfile, installPublicationSessionPage } from './fixtures/publication-session-page';
import type { RecordV2Session } from '../src/content/recordV2Gateway';
import type { SemanticProvider } from '../src/ai/semanticCandidates';
const sessions:RecordV2Session[]=[];
afterEach(()=>{sessions.splice(0).forEach(session=>session.stop());document.body.innerHTML='';document.head.innerHTML='';window.history.replaceState({},'','/');});
async function run(session:RecordV2Session){let result=await session.advance();for(let i=0;i<30&&result.status==='advanced';i++)result=await session.advance();return result;}
function setup(){const fixture=installPublicationSessionPage(document);fixture.add.addEventListener('click',()=>{
 const input=fixture.list.querySelector<HTMLInputElement>('[data-key="title"]')!;input.closest('label')!.firstChild!.textContent='这篇成果具体叫什么';
});return fixture;}
function provider(action?:(request:Parameters<SemanticProvider['propose']>[0],signal:AbortSignal)=>void):SemanticProvider {
 return{propose:vi.fn(async(request:Parameters<SemanticProvider['propose']>[0],signal:AbortSignal)=>{action?.(request,signal);return{requestId:request.requestId,status:'mapped',bindings:request.fields.map(field=>({ref:field.ref,fingerprint:field.fingerprint,path:'papers.title',certainty:'certain',evidence:'label'}))}})};
}
it('uses the real publication transaction to fill three unknown-label records and restart without duplicates',async()=>{
 const fixture=setup(),model=provider(request=>{expect(request.protocol).toBe(5);expect(request.fields).toHaveLength(1);expect(JSON.stringify(request)).not.toContain('红外检测方法');});
 const session=createPublicationRecordSession(document,publicationSessionProfile,undefined,undefined,model);sessions.push(session);
 expect((await run(session)).status).toBe('complete');expect(model.propose).toHaveBeenCalledTimes(3);
 expect(fixture.saved.map(item=>[item.title,item.date])).toEqual(publicationSessionProfile.publications.map(item=>[item.title,item.date]));
 const restarted=createPublicationRecordSession(document,publicationSessionProfile,undefined,undefined,model);sessions.push(restarted);
 expect((await run(restarted)).status).toBe('complete');expect(fixture.counts.add).toBe(3);expect(fixture.counts.save).toBe(3);expect(fixture.counts.submit).toBe(0);
 // Three nine-control editors plus a full restart perform many synchronous jsdom scans.
},15_000);
it.each(['stop','replace','transient','manual','label','navigation'])('%s while inference is pending refuses the delayed candidate and does not save',async mode=>{
 const fixture=setup();let release!:(value:unknown)=>void;
 const model:SemanticProvider={propose:vi.fn(async(request:Parameters<SemanticProvider['propose']>[0])=>{await new Promise(resolve=>{release=resolve});return{requestId:request.requestId,status:'mapped',bindings:request.fields.map(field=>({ref:field.ref,fingerprint:field.fingerprint,path:'papers.title',certainty:'certain',evidence:'label'}))}})};
 const session=createPublicationRecordSession(document,publicationSessionProfile,undefined,undefined,model);sessions.push(session);
 expect((await session.advance()).status).toBe('advanced');const pending=session.advance();await vi.waitFor(()=>expect(model.propose).toHaveBeenCalled());
 const input=fixture.list.querySelector<HTMLInputElement>('[data-key="title"]')!;
 if(mode==='stop')session.stop();if(mode==='replace')input.replaceWith(input.cloneNode(true));
 if(mode==='transient'||mode==='manual'){input.value='用户手改';input.dispatchEvent(new Event('input',{bubbles:true}));if(mode==='transient')input.value='';}
 if(mode==='label')input.closest('label')!.firstChild!.textContent='另一个问题';if(mode==='navigation')window.history.replaceState({},'','/changed');
 release(undefined);expect((await pending).status).not.toBe('advanced');expect(fixture.counts.save).toBe(0);expect(input.value).toBe(mode==='manual'?'用户手改':'');
});
it('missing known facts do not trigger a model to reinterpret or invent the answer',async()=>{
 const fixture=setup(),model=provider();
 const projection={...publicationSessionProfile,publications:[{...publicationSessionProfile.publications[0]!,abstract:undefined}]};
 const session=createPublicationRecordSession(document,projection,undefined,undefined,model);sessions.push(session);
 expect((await run(session)).status).toBe('request-human');expect(model.propose).not.toHaveBeenCalled();expect(fixture.counts.save).toBe(0);
});
it('a known existing DOI conflict is preserved before any model request',async()=>{
 const fixture=installPublicationSessionPage(document),model=provider();
 fixture.add.addEventListener('click',()=>{fixture.list.querySelector<HTMLInputElement>('[data-key="title"]')!.closest('label')!.firstChild!.textContent='这篇成果具体叫什么';fixture.list.querySelector<HTMLInputElement>('[data-key="doi"]')!.value='网页已有其他DOI';});
 const session=createPublicationRecordSession(document,publicationSessionProfile,undefined,undefined,model);sessions.push(session);
 expect((await run(session)).status).toBe('request-human');expect(model.propose).not.toHaveBeenCalled();
 expect(fixture.list.querySelector<HTMLInputElement>('[data-key="doi"]')!.value).toBe('网页已有其他DOI');expect(fixture.counts.save).toBe(0);
});
it('the same unknown title survives a normal venue expansion without another model request',async()=>{
 const fixture=installPublicationSessionPage(document,[],{dynamicVenue:true}),model=provider();
 fixture.add.addEventListener('click',()=>{fixture.list.querySelector<HTMLInputElement>('[data-key="title"]')!.closest('label')!.firstChild!.textContent='这篇成果具体叫什么';});
 const projection={...publicationSessionProfile,publications:publicationSessionProfile.publications.slice(0,1)};
 const session=createPublicationRecordSession(document,projection,undefined,undefined,model);sessions.push(session);
 expect((await run(session)).status).toBe('complete');expect(model.propose).toHaveBeenCalledTimes(1);expect(fixture.saved[0]!.venue).toBe(projection.publications[0]!.venue);
});
