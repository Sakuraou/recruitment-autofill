import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { resolveAwardField } from '../src/matching/awardFieldResolver';
import type { AwardProjectionEntry } from '../src/profile/awardProjection';
const record:AwardProjectionEntry={id:'fictional-award',name:'校级二等奖学金',school:'虚构工程大学',category:'奖学金',
  level:'校级',issuer:'虚构工程大学',date:'2022-11-15',description:'获校级二等奖学金。',scholarshipLevel:'二等'};
function field(html:string){document.body.innerHTML='<section><h2>在校奖励</h2>'+html+'</section>';return scanDocument().result.fields[0]!;}
afterEach(()=>{document.body.innerHTML='';});
it.each([
  ['奖励名称','name'],['获奖名称','name'],['所在学校','school'],['学校名称','school'],['奖项类别','category'],
  ['奖励级别','level'],['获奖级别','level'],['颁奖单位','issuer'],['获奖时间','date'],['奖学金等级','scholarshipLevel'],['简要描述','description'],
] as const)('reads only the current award fact for %s',(label,key)=>{
  expect(resolveAwardField(field('<label>'+label+'<input></label>'),record)).toMatchObject({status:'known',key:'awards.'+key,value:record[key]});
});
it('uses visible school label instead of a misleading machine identifier',()=>{
  expect(resolveAwardField(field('<label>所在学校<input name="BasicName"></label>'),record)).toMatchObject({status:'known',key:'awards.school',value:record.school});
});
it.each(['姓名','项目名称','是否学生干部','上传奖项附件','验证码','联系人姓名','我同意隐私协议','未知问题X'])('does not borrow unrelated or protected labels %s',label=>{
  expect(resolveAwardField(field('<label>'+label+'<input></label>'),record).status).toBe('request-human');
});
it('rejects conflicting current-editor labels',()=>{
  expect(resolveAwardField(field('<label>所在学校<input aria-label="奖励名称"></label>'),record)).toEqual({status:'request-human',reason:'field-semantic-ambiguous'});
});
it('does not let an enclosing award heading explain an unknown control',()=>{
  expect(resolveAwardField(field('<label>未知字段X<input></label>'),record).status).toBe('request-human');
});
it('local meaning may be resolved for a populated field; only the atomic binder can decide preservation',()=>{
  const descriptor=field('<label>奖励名称<input value="网页原值"></label>');
  expect(resolveAwardField(descriptor,record)).toMatchObject({status:'known',value:record.name});
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('网页原值');
});
it('missing scholarship level stays missing and is never inferred from the award title',()=>{
  expect(resolveAwardField(field('<label>奖学金级别<input></label>'),{...record,scholarshipLevel:undefined})).toEqual({status:'request-human',reason:'profile-value-missing'});
});
it('full dates fit native dates and months without fabricating a day',()=>{
  expect(resolveAwardField(field('<label>获奖时间<input type="date"></label>'),record)).toMatchObject({status:'known',value:'2022-11-15'});
  expect(resolveAwardField(field('<label>获奖时间<input type="month"></label>'),record)).toMatchObject({status:'known',value:'2022-11'});
  expect(resolveAwardField(field('<label>获奖时间<input type="date"></label>'),{...record,date:'2022-11'})).toEqual({status:'request-human',reason:'profile-date-precision'});
});
it('invalid calendar facts are rejected',()=>{
  expect(resolveAwardField(field('<label>获奖时间<input type="date"></label>'),{...record,date:'2022-02-30'})).toEqual({status:'request-human',reason:'profile-value-invalid'});
});
it('does not truncate a factual description to fit a limit',()=>{
  expect(resolveAwardField(field('<label>简要描述<textarea maxlength="3"></textarea></label>'),record)).toEqual({status:'request-human',reason:'profile-value-too-long'});
});
it('matches a visible option label rather than its opaque machine value',()=>{
  expect(resolveAwardField(field('<label>奖励级别<select><option value="">请选择</option><option value="opaque">校级</option></select></label>'),record)).toMatchObject({status:'known',value:'opaque'});
});
it.each([
  '<option value="wrong">opaque校级</option>',
  '<option value="first">校级</option><option value="second">校级</option>',
  '<option disabled value="only">校级</option>',
])('unresolved or duplicate option labels stay pending',options=>{
  expect(resolveAwardField(field('<label>奖励级别<select><option value="">请选择</option>'+options+'</select></label>'),record)).toEqual({status:'request-human',reason:'field-options-unresolved'});
});
