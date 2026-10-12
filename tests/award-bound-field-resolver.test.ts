import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { resolveAwardField, resolveBoundAwardField } from '../src/matching/awardFieldResolver';
import type { AwardProjectionEntry } from '../src/profile/awardProjection';
const first:AwardProjectionEntry={id:'fictional-a',name:'虚构竞赛奖',school:'虚构大学甲',level:'校级',date:'2022-11-15',description:'虚构竞赛的简短说明。'};
const second:AwardProjectionEntry={id:'fictional-b',name:'虚构奖学金',school:'虚构大学乙',level:'国家级',date:'2023-12',description:'虚构奖学金的简短说明。'};
function field(html='<label>这项荣誉具体叫什么<input></label>'){
  document.body.innerHTML='<section><h2>在校奖励</h2>'+html+'</section>';return scanDocument().result.fields[0]!;
}
afterEach(()=>{document.body.innerHTML='';});
it('reproduces an unknown visible award label and resolves only the supplied current record after a bounded meaning',()=>{
  const descriptor=field();expect(resolveAwardField(descriptor,first)).toEqual({status:'request-human',reason:'field-semantic-unknown'});
  expect(resolveBoundAwardField(descriptor,first,'awards.name')).toMatchObject({status:'known',key:'awards.name',value:first.name});
  expect(resolveBoundAwardField(descriptor,second,'awards.name')).toMatchObject({status:'known',key:'awards.name',value:second.name});
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('');
});
it.each(['awards.0.name','awards.id','awards.shortName','basic.name','projects.name','awards.__proto__'])('rejects noncatalogued logical path %s',path=>{
  expect(resolveBoundAwardField(field(),first,path).status).toBe('request-human');
});
it('does not let a proposed meaning reinterpret a known field or its missing fact',()=>{
  expect(resolveBoundAwardField(field('<label>所在学校<input></label>'),first,'awards.name')).toEqual({status:'request-human',reason:'field-semantic-ambiguous'});
  expect(resolveBoundAwardField(field('<label>奖励名称<input></label>'),{...first,name:undefined},'awards.description')).toEqual({status:'request-human',reason:'profile-value-missing'});
});
it('keeps conflicting labels and applicant facts outside model reinterpretation',()=>{
  expect(resolveBoundAwardField(field('<label>奖励名称<input aria-label="所在学校"></label>'),first,'awards.name')).toEqual({status:'request-human',reason:'field-semantic-ambiguous'});
  expect(resolveBoundAwardField(field('<label>是否学生干部<select><option value="">请选择</option><option value="no">否</option></select></label>'),first,'awards.level',{studentCadre:'否'}).status).toBe('request-human');
});
it.each(['验证码','上传附件','联系人姓名','我同意隐私协议'])('does not use a meaning to fill protected field %s',label=>{
  expect(resolveBoundAwardField(field('<label>'+label+'<input></label>'),first,'awards.name').status).toBe('request-human');
});
it('keeps missing scholarship facts missing instead of inferring them from an award title',()=>{
  expect(resolveBoundAwardField(field(),{...first,name:'校级二等奖学金'},'awards.scholarshipLevel')).toEqual({status:'request-human',reason:'profile-value-missing'});
});
it('shares native date precision, control compatibility and length validation',()=>{
  const date=field('<label>这项荣誉是哪天收到的<input type="date"></label>');
  expect(resolveBoundAwardField(date,second,'awards.date')).toEqual({status:'request-human',reason:'profile-date-precision'});
  expect(resolveBoundAwardField(date,first,'awards.date')).toMatchObject({status:'known',value:first.date});
  expect(resolveBoundAwardField(date,first,'awards.name')).toEqual({status:'request-human',reason:'field-unsupported'});
  expect(resolveBoundAwardField(field('<label>这项荣誉具体是什么<input maxlength="2"></label>'),first,'awards.name')).toEqual({status:'request-human',reason:'profile-value-too-long'});
});
it('requires a unique local option answer and never substitutes the first option',()=>{
  expect(resolveBoundAwardField(field('<label>这项荣誉适用哪个范围<select><option value="">请选择</option><option value="national">国家级</option><option value="campus">校级</option></select></label>'),first,'awards.level')).toMatchObject({status:'known',value:'campus'});
  expect(resolveBoundAwardField(field('<label>这项荣誉适用哪个范围<select><option value="a">校级</option><option value="b">校级</option></select></label>'),first,'awards.level')).toEqual({status:'request-human',reason:'field-options-unresolved'});
});
