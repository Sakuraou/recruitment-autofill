import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { resolveStudentWorkField, resolveBoundStudentWorkField } from '../src/matching/studentWorkFieldResolver';
import { studentWorkSessionProfile } from './fixtures/student-work-session-page';
const first=studentWorkSessionProfile.studentWork[0]!,second=studentWorkSessionProfile.studentWork[1]!;
function field(html='<label>这段校园经历中的头衔是啥<input></label>'){
 document.body.innerHTML='<section><h2>校内职务</h2>'+html+'</section>';return scanDocument().result.fields[0]!;
}
afterEach(()=>{document.body.innerHTML='';});
it('reproduces an unknown campus-role label and reads only the supplied record',()=>{
 const descriptor=field();expect(resolveStudentWorkField(descriptor,first)).toEqual({status:'request-human',reason:'field-semantic-unknown'});
 expect(resolveBoundStudentWorkField(descriptor,first,'studentWork.role')).toMatchObject({status:'known',value:first.role});
 expect(resolveBoundStudentWorkField(descriptor,second,'studentWork.role')).toMatchObject({status:'known',value:second.role});
 expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('');
});
it.each(['studentWork.0.role','studentWork.id','studentWork.endDateFact','internships.role','papers.title','basic.studentCadre'])('rejects noncatalogued meaning %s',path=>{
 expect(resolveBoundStudentWorkField(field(),first,path).status).toBe('request-human');
});
it.each(['是否学生干部','税前月薪','获奖名称','联系人姓名','验证码','上传附件','授权声明','时间','任期','起止日期'])('keeps unrelated or protected field %s outside inference',label=>{
 expect(resolveBoundStudentWorkField(field('<label>'+label+'<input></label>'),first,'studentWork.role').status).toBe('request-human');
});
it('keeps short duties and cadre level missing rather than deriving them from a title or internal description',()=>{
 expect(resolveBoundStudentWorkField(field(),{...first,shortDuties:undefined,description:'内部资料备注'},'studentWork.shortDuties')).toEqual({status:'request-human',reason:'profile-value-missing'});
 expect(resolveBoundStudentWorkField(field(),{...first,cadreLevel:undefined},'studentWork.cadreLevel')).toEqual({status:'request-human',reason:'profile-value-missing'});
 expect(resolveBoundStudentWorkField(field('<label>职责和成就<input></label>'),{...first,shortDuties:undefined},'studentWork.role')).toEqual({status:'request-human',reason:'profile-value-missing'});
});
it('preserves explicit full dates and never manufactures precision or an end date',()=>{
 const descriptor=field('<label>这段校园经历何时开始<input type="date"></label>');
 expect(resolveBoundStudentWorkField(descriptor,first,'studentWork.startDate')).toMatchObject({status:'known',value:'2021-09-01'});
 expect(resolveBoundStudentWorkField(descriptor,{...first,startDate:'2021-09'},'studentWork.startDate')).toEqual({status:'request-human',reason:'profile-date-precision'});
 expect(resolveBoundStudentWorkField(descriptor,{...first,startDate:undefined},'studentWork.startDate')).toEqual({status:'request-human',reason:'profile-value-missing'});
 expect(resolveBoundStudentWorkField(descriptor,first,'studentWork.role')).toEqual({status:'request-human',reason:'field-unsupported'});
});
it('ongoing must be explicit with one visible option, and does not imply today',()=>{
 const record={...first,endDate:undefined,endDateFact:{state:'ongoing' as const,source:'user' as const,confirmed:true}};
 expect(resolveBoundStudentWorkField(field('<label>这段校园经历何时结束<select><option value="">请选择</option><option value="present">至今</option></select></label>'),record,'studentWork.endDate')).toMatchObject({status:'known',value:'present'});
 expect(resolveBoundStudentWorkField(field('<label>这段校园经历何时结束<input type="date"></label>'),record,'studentWork.endDate')).toEqual({status:'request-human',reason:'field-options-unresolved'});
});
it('known fields, conflicting labels, length and duplicate visible options remain guarded',()=>{
 expect(resolveBoundStudentWorkField(field('<label>担任职务<input></label>'),first,'studentWork.organization')).toEqual({status:'request-human',reason:'field-semantic-ambiguous'});
 expect(resolveBoundStudentWorkField(field('<label>担任职务<input aria-label="组织名称"></label>'),first,'studentWork.role')).toEqual({status:'request-human',reason:'field-semantic-ambiguous'});
 expect(resolveBoundStudentWorkField(field('<label>这段校园经历中的头衔是啥<input maxlength="2"></label>'),first,'studentWork.role')).toEqual({status:'request-human',reason:'profile-value-too-long'});
 expect(resolveBoundStudentWorkField(field('<label>这段校园经历的级别是哪种<select><option value="a">无</option><option value="b">无</option></select></label>'),first,'studentWork.cadreLevel')).toEqual({status:'request-human',reason:'field-options-unresolved'});
});
