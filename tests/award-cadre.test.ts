import {afterEach,expect,it} from 'vitest';
import {createEmptyProfile} from '../src/profile/schema';
import {awardProfile,type AwardProjectionResponse} from '../src/profile/awardProjection';
import {resolveAwardField} from '../src/matching/awardFieldResolver';
import {scanDocument} from '../src/content/scanner';
import {createAwardRecordSession} from '../src/content/awardRecordSession';
import {awardSessionProfile,installAwardSessionPage} from './fixtures/award-session-page';
import {isAwardCadreQuestionGroup} from '../src/content/semantic/awardQuestionGroup';
const award=awardSessionProfile.awards[0]!;
afterEach(()=>{document.body.innerHTML='';document.head.innerHTML='';});
function descriptor(markup:string){document.body.innerHTML='<form aria-label="新增奖励经历">'+markup+'</form>';return scanDocument().result.fields[0]!;}
it('projects only explicit cadre facts while excluding other applicant identity',()=>{
 const profile=createEmptyProfile();profile.basic={name:'无关姓名',phone:'13800000000',studentCadre:'否',studentCadreDescription:'无'};profile.awards=[award];
 const result=awardProfile(profile);expect(result).toMatchObject({applicant:{studentCadre:'否',studentCadreDescription:'无'}});
 expect(JSON.stringify(result)).not.toMatch(/无关姓名|13800000000|phone|basic/);
});
it('never infers cadre status from an award or a student-work role',()=>{
 const profile=createEmptyProfile();profile.awards=[award];profile.studentWork=[{id:'assistant',role:'辅导员助理'}];
 expect(awardProfile(profile)).toMatchObject({applicant:{}});
});
it.each(['是','否'] as const)('maps explicit %s to a visible opaque native option',studentCadre=>{
 const field=descriptor('<fieldset><legend>是否学生干部</legend><select><option value="">请选择</option><option value="opaque-yes">是</option><option value="opaque-no">否</option></select></fieldset>');
 expect(resolveAwardField(field,award,{studentCadre})).toMatchObject({status:'known',key:'basic.studentCadre',value:studentCadre==='是'?'opaque-yes':'opaque-no'});
});
it('does not infer No when the local cadre fact is absent',()=>{
 const field=descriptor('<label>是否学生干部<select><option>是</option><option>否</option></select></label>');
 expect(resolveAwardField(field,award,{})).toEqual({status:'request-human',reason:'profile-value-missing'});
});
it('uses the explicit description without embedding internal context or guessing achievement text',()=>{
 const field=descriptor('<label>学生干部描述<textarea></textarea></label>');
 expect(resolveAwardField(field,award,{studentCadre:'是',studentCadreDescription:'协助组织学院迎新活动。'})).toMatchObject({status:'known',value:'协助组织学院迎新活动。'});
});
it.each(['是否学生干部并同意授权','是否学生干部或有工作经历','联系人是否学生干部'])('rejects mixed/protected question %s',label=>{
 const field=descriptor('<label>'+label+'<select><option>是</option><option>否</option></select></label>');
 expect(resolveAwardField(field,award,{studentCadre:'否'}).status).toBe('request-human');
});
it('does not choose the machine value when visible options cannot establish Yes/No',()=>{
 const field=descriptor('<label>是否学生干部<select><option value="是">未知A</option><option value="否">未知B</option></select></label>');
 expect(resolveAwardField(field,award,{studentCadre:'否'}).status).toBe('request-human');
});
it('conflicting primary labels cannot borrow the cadre fact',()=>{
 const field=descriptor('<label>是否学生干部<select aria-label="是否有证明"><option>是</option><option>否</option></select></label>');
 expect(resolveAwardField(field,award,{studentCadre:'否'}).status).toBe('request-human');
});
async function finish(source:AwardProjectionResponse){const session=createAwardRecordSession(document,source);try{
 let result=await session.advance();for(let step=0;step<30&&result.status==='advanced';step++)result=await session.advance();return result;
}finally{session.stop();}}
function fixture(mode:'select'|'radio'|'dynamic'|'conflict'|'foreign'='select'){
 const page=installAwardSessionPage(document);
 page.add.addEventListener('click',()=>{
  const form=page.list.querySelector('form')!;const group=document.createElement('fieldset');
  group.innerHTML='<legend>是否学生干部</legend>'+(mode==='radio'||mode==='foreign'?'<label><input name="cadre" type="radio" value="yes">是</label><label><input name="cadre" type="radio" value="no">否</label>':'<select><option value="">请选择</option><option value="yes">是</option><option value="no">否</option></select>');
  form.querySelector('button')!.before(group);
  if(mode==='conflict')group.querySelector('select')!.value='yes';
  if(mode==='foreign'){const other=document.createElement('form');other.id='foreign-cadre';document.body.append(other);group.querySelector('input')!.setAttribute('form',other.id);}
  if(mode==='dynamic')group.addEventListener('change',()=>{if(!form.querySelector('textarea[data-cadre]')){const label=document.createElement('label');label.textContent='学生干部描述';const text=document.createElement('textarea');text.required=true;text.setAttribute('data-cadre','');label.append(text);group.after(label);}});
 });return page;
}
it.each(['select','radio'] as const)('fills all three awards with explicit non-cadre %s and independent dates',async mode=>{
 const page=fixture(mode);expect(await finish({...awardSessionProfile,applicant:{studentCadre:'否'}})).toMatchObject({status:'complete'});
 expect(page.counts).toEqual({add:3,save:3,remove:0,submit:0,cancel:0});
});
it('linked description is observed and filled before a single Save per award',async()=>{
 const page=fixture('dynamic');expect(await finish({...awardSessionProfile,applicant:{studentCadre:'是',studentCadreDescription:'协助组织学院迎新活动。'}})).toMatchObject({status:'complete'});expect(page.counts.save).toBe(3);
},20_000);
it('missing cadre facts leave a draft without Save or fabricated No',async()=>{
 const page=fixture();expect((await finish(awardSessionProfile)).status).toBe('request-human');expect(page.counts.save).toBe(0);expect(page.list.querySelector<HTMLSelectElement>('fieldset select')?.value).not.toBe('no');
});
it('existing conflicting cadre value stays unchanged and blocks Save',async()=>{
 const page=fixture('conflict');expect((await finish({...awardSessionProfile,applicant:{studentCadre:'否'}})).status).toBe('request-human');expect(page.counts.save).toBe(0);expect(page.list.querySelector<HTMLSelectElement>('fieldset select')?.value).toBe('yes');
});
it('foreign radio membership does not become an owned award question',async()=>{
 const page=fixture('foreign');expect((await finish({...awardSessionProfile,applicant:{studentCadre:'否'}})).status).toBe('request-human');expect(page.counts.save).toBe(0);expect(page.list.querySelectorAll('input:checked')).toHaveLength(0);
});
it.each(['<input type="file">','<input type="checkbox">','<label>联系人姓名<input></label>','<section></section>','<button type="button">保存</button>','<div role="switch">其他题</div>'])('a mixed cadre group %s cannot become transparent editor content',extra=>{
 descriptor('<fieldset><legend>是否学生干部</legend><select><option>是</option><option>否</option></select>'+extra+'</fieldset>');
 expect(isAwardCadreQuestionGroup(document.querySelector('fieldset')!)).toBe(false);
});
it('a protected title cannot borrow a primary cadre label',()=>{
 const field=descriptor('<label>是否学生干部<select title="同意授权"><option>是</option><option>否</option></select></label>');
 expect(resolveAwardField(field,award,{studentCadre:'否'}).status).toBe('request-human');
});
it('an existing correct No is preserved while each reward still saves once',async()=>{
 const page=fixture();page.add.addEventListener('click',()=>page.list.querySelector<HTMLSelectElement>('fieldset select')!.value='no');
 expect((await finish({...awardSessionProfile,applicant:{studentCadre:'否'}})).status).toBe('complete');expect(page.counts.save).toBe(3);
});
it('new description with missing facts preserves the draft and does not Save',async()=>{
 const page=fixture('dynamic');expect((await finish({...awardSessionProfile,applicant:{studentCadre:'是'}})).status).toBe('request-human');expect(page.counts.save).toBe(0);expect(page.list.querySelector('textarea[data-cadre]')).not.toBeNull();
});
it('cadre facts updated without a revision change invalidate a pending record',async()=>{
 const page=fixture();let source:AwardProjectionResponse={...awardSessionProfile,applicant:{studentCadre:'否'}};
 const session=createAwardRecordSession(document,source,async()=>source);try{
 expect((await session.advance()).status).toBe('advanced');source={...source,applicant:{studentCadre:'是'}};
 expect((await session.advance()).status).toBe('request-human');expect(page.counts.save).toBe(0);expect(page.list.querySelectorAll('input:checked')).toHaveLength(0);
 }finally{session.stop();}
});
it('Stop during dynamic observation cancels Save and retains the draft',async()=>{
 const page=fixture('dynamic');const session=createAwardRecordSession(document,{...awardSessionProfile,applicant:{studentCadre:'是',studentCadreDescription:'协助组织学院迎新活动。'}});
 try{expect((await session.advance()).status).toBe('advanced');page.list.addEventListener('change',()=>session.stop(),{once:true});
 expect((await session.advance()).status).not.toBe('advanced');expect(page.counts.save).toBe(0);expect(page.list.querySelector('form')).not.toBeNull();
 }finally{session.stop();}
});
