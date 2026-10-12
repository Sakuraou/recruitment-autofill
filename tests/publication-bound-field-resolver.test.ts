import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { resolvePublicationField, resolveBoundPublicationField } from '../src/matching/publicationFieldResolver';
import { publicationSessionProfile } from './fixtures/publication-session-page';
const paper=publicationSessionProfile.publications[0]!,second=publicationSessionProfile.publications[1]!;
function field(html='<label>这篇成果具体叫什么<input></label>'){
 document.body.innerHTML='<section><h2>专业论著</h2>'+html+'</section>';return scanDocument().result.fields[0]!;
}
afterEach(()=>{document.body.innerHTML='';});
it('reproduces the unknown paper label and reads only the supplied current paper after a meaning',()=>{
 const descriptor=field();expect(resolvePublicationField(descriptor,paper)).toEqual({status:'request-human',reason:'field-semantic-unknown'});
 expect(resolveBoundPublicationField(descriptor,paper,'papers.title')).toMatchObject({status:'known',value:paper.title});
 expect(resolveBoundPublicationField(descriptor,second,'papers.abstract')).toMatchObject({status:'known',value:second.abstract});
 expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('');
});
it.each(['papers.0.title','papers.id','papers.shortTitle','papers.description','papers.__proto__','awards.name','basic.name'])('rejects noncatalogued path %s',path=>{
 expect(resolveBoundPublicationField(field(),paper,path).status).toBe('request-human');
});
it.each(['项目名称','奖励名称','专利名称','联系人姓名','验证码','上传论文附件','是否有专业论著','授权声明'])('does not reinterpret unrelated or protected field %s',label=>{
 expect(resolveBoundPublicationField(field('<label>'+label+'<input></label>'),paper,'papers.title').status).toBe('request-human');
});
it('a known author order or missing abstract cannot be replaced by another paper fact',()=>{
 expect(resolveBoundPublicationField(field('<label>作者排序<input></label>'),paper,'papers.status')).toEqual({status:'request-human',reason:'field-semantic-ambiguous'});
 expect(resolveBoundPublicationField(field('<label>内容提要<textarea></textarea></label>'),{...paper,abstract:undefined,description:'内部备注',shortTitle:'缩略题目'},'papers.title')).toEqual({status:'request-human',reason:'profile-value-missing'});
 expect(resolveBoundPublicationField(field(),{...paper,abstract:undefined,description:'内部备注',shortTitle:'缩略题目'},'papers.abstract')).toEqual({status:'request-human',reason:'profile-value-missing'});
});
it('dates stay missing or imprecise, regardless of the website suggestion to use today',()=>{
 const descriptor=field('<label>这篇成果何时刊登<input type="date"></label>');
 expect(resolveBoundPublicationField(descriptor,{...paper,date:undefined},'papers.date')).toEqual({status:'request-human',reason:'profile-value-missing'});
 expect(resolveBoundPublicationField(descriptor,{...paper,date:'2026-01'},'papers.date')).toEqual({status:'request-human',reason:'profile-date-precision'});
 expect(resolveBoundPublicationField(descriptor,paper,'papers.title')).toEqual({status:'request-human',reason:'field-unsupported'});
});
it('requires a unique visible author-order option and never defaults to the first entry',()=>{
 const descriptor=field('<label>你在这篇成果中的署名位置<select><option value="">请选择</option><option value="one">第一作者</option><option value="two">第二作者</option><option value="three">第三作者</option></select></label>');
 expect(resolveBoundPublicationField(descriptor,second,'papers.authorOrder')).toMatchObject({status:'known',value:'three'});
 expect(resolveBoundPublicationField(field('<label>你在这篇成果中的署名位置<select><option value="a">第三作者</option><option value="b">第三作者</option></select></label>'),second,'papers.authorOrder')).toEqual({status:'request-human',reason:'field-options-unresolved'});
});
it('keeps conflicting visible labels and full factual text instead of truncating',()=>{
 expect(resolveBoundPublicationField(field('<label>内容提要<textarea aria-label="作者排序"></textarea></label>'),paper,'papers.abstract')).toEqual({status:'request-human',reason:'field-semantic-ambiguous'});
 expect(resolveBoundPublicationField(field('<label>这篇成果具体叫什么<input maxlength="2"></label>'),paper,'papers.title')).toEqual({status:'request-human',reason:'profile-value-too-long'});
});
