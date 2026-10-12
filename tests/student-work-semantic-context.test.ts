import { afterEach, expect, it } from 'vitest';
import { lifecycle } from './fixtures/record-editor-context';
import { studentWorkSessionProfile } from './fixtures/student-work-session-page';
import { studentWorkSemanticProfile, createStudentWorkSemanticContext, studentWorkSemanticContextCurrent, resolveCurrentStudentWorkField } from '../src/ai/studentWorkSemanticContext';
import { inferSemanticCandidates } from '../src/ai/semanticCandidates';
afterEach(()=>{document.body.innerHTML='';document.head.innerHTML='';window.history.replaceState({},'','/');});
function setup(){
 const profile=studentWorkSemanticProfile(studentWorkSessionProfile),element=Object.assign(document.createElement('input'),{ariaLabel:'这段校园经历具体协助了什么'});
 const state=lifecycle([element],undefined,undefined,1,'student-work');
 const input={plan:state.populatePlan,capture:state.editing,activeTransaction:state.active,runContext:state.context,scanState:state.fixture.scanState,profile};
 return{profile,element,state,input,scan:state.fixture.scanState.result,context:createStudentWorkSemanticContext(input)};
}
it('binds the second studentWork to its own facts, with no serializable index or write authority',async()=>{
 const s=setup();expect(s.context).toBeDefined();expect(s.state.active.intentIndex).toBe(1);
 expect(JSON.stringify(s.context)).toBe('{"recordType":"student-work"}');expect(Object.isFrozen(s.context)).toBe(true);
 expect(resolveCurrentStudentWorkField(s.context!,s.scan,s.profile,s.scan.fields[0]!.id,'studentWork.shortDuties')).toMatchObject({status:'known',value:s.profile.studentWork[1]!.shortDuties});
 const result=await inferSemanticCandidates(s.scan,s.profile,{propose:async request=>{
  expect(request.protocol).toBe(6);expect(JSON.stringify(request)).not.toContain(s.profile.studentWork[1]!.shortDuties!);
  return{requestId:request.requestId,status:'mapped',bindings:request.fields.map(field=>({ref:field.ref,fingerprint:field.fingerprint,path:'studentWork.shortDuties',certainty:'certain',evidence:'label'}))};
 }},{studentWorkContext:s.context});
 expect(result).toMatchObject({state:'ready',matches:[{value:s.profile.studentWork[1]!.shortDuties,source:'llm',status:'review'}]});expect(s.element.value).toBe('');
});
it.each(['plan','capture','activeTransaction'] as const)('does not issue a context from a copied %s',key=>{
 const s=setup();expect(createStudentWorkSemanticContext({...s.input,[key]:structuredClone(s.input[key])})).toBeUndefined();
});
it.each(['stop','capture','profile','reorder','revision','node','label','value','limit','editor','list','outside','navigation','foreign'])('%s invalidates the original studentWork context before local value resolution',mode=>{
 const s=setup();expect(s.context).toBeDefined();
 if(mode==='stop')s.state.context.stop();if(mode==='capture')s.state.context.capture(s.state.fixture.source);
 if(mode==='profile')s.profile.studentWork[1]!.shortDuties='另一条事实';if(mode==='reorder')s.profile.studentWork.reverse();
 if(mode==='revision')s.state.context.bumpProfileRevision();if(mode==='node')s.element.replaceWith(s.element.cloneNode(true));
 if(mode==='label')s.element.ariaLabel='另一个问题';if(mode==='value')s.element.value='用户手改';if(mode==='limit')s.element.maxLength=1;
 if(mode==='editor')document.body.append(s.state.fixture.editor);if(mode==='list')s.state.fixture.editor.parentElement!.replaceWith(document.createElement('section'));
 if(mode==='outside')document.body.append(s.element);if(mode==='navigation')window.history.replaceState({},'','/another-page');
 if(mode==='foreign')s.profile.basic.name='不应进入奖励投影的个人姓名';
 expect(studentWorkSemanticContextCurrent(s.context!,s.scan,s.profile,[])).toBe(false);
 expect(resolveCurrentStudentWorkField(s.context!,s.scan,s.profile,s.scan.fields[0]!.id,'studentWork.shortDuties')).toBeUndefined();
});
it('copied context, duplicate IDs and noncurrent references do not resolve studentWorks',()=>{
 const s=setup();expect(resolveCurrentStudentWorkField(structuredClone(s.context!),s.scan,s.profile,s.scan.fields[0]!.id,'studentWork.shortDuties')).toBeUndefined();
 expect(resolveCurrentStudentWorkField(s.context!,s.scan,s.profile,'foreign','studentWork.shortDuties')).toBeUndefined();
 s.profile.studentWork[1]!.id=s.profile.studentWork[0]!.id;expect(createStudentWorkSemanticContext(s.input)).toBeUndefined();
});
