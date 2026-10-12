import { afterEach, expect, it, vi } from 'vitest';
import { createAwardRecordSession } from '../src/content/awardRecordSession';
import { createPublicationRecordSession } from '../src/content/publicationRecordSession';
import { createStudentWorkRecordSession } from '../src/content/studentWorkRecordSession';
import { installAwardSessionPage, awardSessionProfile } from './fixtures/award-session-page';
import { installPublicationSessionPage, publicationSessionProfile } from './fixtures/publication-session-page';
import { installStudentWorkSessionPage, studentWorkSessionProfile } from './fixtures/student-work-session-page';
import type { SemanticProvider } from '../src/ai/semanticCandidates';
import type { RecordV2Session } from '../src/content/recordV2Gateway';
import { scanDocument } from '../src/content/scanner';
import { resolveAwardField } from '../src/matching/awardFieldResolver';
import { resolvePublicationField } from '../src/matching/publicationFieldResolver';
import { resolveStudentWorkField } from '../src/matching/studentWorkFieldResolver';
const sessions:RecordV2Session[]=[];
afterEach(()=>{sessions.splice(0).forEach(session=>session.stop());document.body.innerHTML='';document.head.innerHTML='';});
it.each(['award','publication','student-work'] as const)('%s cannot reinterpret an explicit salary question as a record name, even if a model would propose it',async kind=>{
 const key=kind==='award'?'name':kind==='publication'?'title':'role';
 const path=kind==='award'?'awards.name':kind==='publication'?'papers.title':'studentWork.role';
 const page=kind==='award'?installAwardSessionPage(document):kind==='publication'?installPublicationSessionPage(document):installStudentWorkSessionPage(document);
 page.add.addEventListener('click',()=>{page.list.querySelector(`[data-key="${key}"]`)!.closest('label')!.firstChild!.textContent='税前月薪';});
 const propose=vi.fn(async(request:Parameters<SemanticProvider['propose']>[0])=>({requestId:request.requestId,status:'mapped',bindings:request.fields.map(field=>({ref:field.ref,fingerprint:field.fingerprint,path,certainty:'certain',evidence:'label'}))}));
 const provider:SemanticProvider={propose};
 const session=kind==='award'?createAwardRecordSession(document,awardSessionProfile,undefined,undefined,provider)
  :kind==='publication'?createPublicationRecordSession(document,publicationSessionProfile,undefined,undefined,provider)
   :createStudentWorkRecordSession(document,studentWorkSessionProfile,undefined,undefined,provider);
 sessions.push(session);let result=await session.advance();for(let i=0;i<30&&result.status==='advanced';i++)result=await session.advance();
 expect(result.status).toBe('request-human');expect(propose).not.toHaveBeenCalled();expect(page.counts.save).toBe(0);
 expect(page.list.querySelector<HTMLInputElement>(`[data-key="${key}"]`)!.value).toBe('');
});
it.each(['award','publication','student-work'] as const)('%s keeps an explicit narrative field usable when its hint mentions financial work',kind=>{
 const label=kind==='award'?'简要描述':kind==='publication'?'内容提要':'职责和成就';
 document.body.innerHTML=`<label>${label}<textarea placeholder="可概述金额或工资相关的工作"></textarea></label>`;
 const field=scanDocument().result.fields[0]!;
 const result=kind==='award'?resolveAwardField(field,awardSessionProfile.awards[0]!)
  :kind==='publication'?resolvePublicationField(field,publicationSessionProfile.publications[0]!)
   :resolveStudentWorkField(field,studentWorkSessionProfile.studentWork[0]!);
 expect(result.status).toBe('known');expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
});
