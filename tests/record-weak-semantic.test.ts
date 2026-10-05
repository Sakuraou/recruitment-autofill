import {afterEach,expect,it,vi} from 'vitest';
import {lifecycle} from './fixtures/record-editor-context';
import {educationSessionProfile} from './fixtures/education-session-page';
import {createEmptyProfile} from '../src/profile/schema';
import {createEducationSemanticContext} from '../src/ai/educationSemanticContext';
import {createProjectSemanticContext} from '../src/ai/projectSemanticContext';
import {inferSemanticCandidates,type SemanticProvider} from '../src/ai/semanticCandidates';
const scopes=['education','project'] as const;
function setup(scope:typeof scopes[number],label:string,missing=false){
 const profile=createEmptyProfile();profile.revision=crypto.randomUUID();profile.education=educationSessionProfile.education.map(record=>({...record}));
 profile.projects=[{id:'fictional-p1',name:'虚构项目甲',description:'第一项描述',responsibilities:'开发第一项接口',technologies:[]},{id:'fictional-p2',name:'虚构项目乙',description:'第二项描述',responsibilities:'开发第二项接口',technologies:[]}];
 if(missing){if(scope==='education')delete profile.education[1]!.school;else delete profile.projects[1]!.name;}
 const element=Object.assign(document.createElement('input'),{ariaLabel:label});const state=lifecycle([element],undefined,undefined,1,scope);
 const input={plan:state.populatePlan,capture:state.editing,activeTransaction:state.active,runContext:state.context,scanState:state.fixture.scanState,profile};
 const context=scope==='education'?createEducationSemanticContext(input)!:createProjectSemanticContext(input)!;expect(context).toBeDefined();
 const options=scope==='education'?{educationContext:context as ReturnType<typeof createEducationSemanticContext>}:{projectContext:context as ReturnType<typeof createProjectSemanticContext>};
 return {profile,state,element,context,options,scan:input.scanState.result};
}
const provider=(path:string):SemanticProvider=>({propose:vi.fn(async(request:Parameters<SemanticProvider['propose']>[0])=>({requestId:request.requestId,status:'mapped',bindings:request.fields.map(field=>({ref:field.ref,fingerprint:field.fingerprint,path,certainty:'certain',evidence:'label'}))}))});
afterEach(()=>{document.body.innerHTML='';});
it.each([['education','就读学校名称','school'],['education','所学的专业名称','major'],['education','学校名称 / 就读学校名称','school'],['project','这个项目的名称','name'],['project','这个项目的描述','description'],['project','承担的项目职责','responsibilities'],['project','项目名称 / 这个项目的名称','name']] as const)('%s %s 确认后只读第二条事实',async(scope,label,key)=>{
 const s=setup(scope,label);const model=provider((scope==='project'?'projects':scope)+'.'+key);const result=await inferSemanticCandidates(s.scan,s.profile,model,s.options);
 const record=scope==='education'?s.profile.education[1]!:s.profile.projects[1]!;
 expect(result).toMatchObject({state:'ready',matches:[{value:(record as Record<string,unknown>)[key],source:'llm',confidence:.9}]});expect(s.element.value).toBe('');expect(model.propose).toHaveBeenCalledOnce();
 const request=vi.mocked(model.propose).mock.calls[0]![0];expect(request.protocol).toBe(scope==='education'?2:1);expect(JSON.stringify(request)).not.toMatch(/虚构|fictional-p|intentIndex|profileRevision|expectedPath/);
});
it.each(scopes)('%s 模型改义时拒绝整个回执且不学习',async scope=>{const s=setup(scope,scope==='education'?'就读学校名称':'这个项目的名称');const cache={propose:vi.fn(),remember:vi.fn()};expect(await inferSemanticCandidates(s.scan,s.profile,provider(scope==='education'?'education.major':'projects.description'),{...s.options,recipes:cache})).toEqual({state:'rejected',matches:[]});expect(cache.remember).not.toHaveBeenCalled();expect(s.element.value).toBe('');});
it.each(scopes)('%s 无当前能力不能确认弱标签',async scope=>{const s=setup(scope,scope==='education'?'就读学校名称':'这个项目的名称');const model=provider(scope==='education'?'education.school':'projects.name');expect(await inferSemanticCandidates(s.scan,s.profile,model)).toEqual({state:'no-candidates',matches:[]});expect(model.propose).not.toHaveBeenCalled();});
it.each(scopes)('%s 当前条缺资料不借第一条也不请求',async scope=>{const s=setup(scope,scope==='education'?'就读学校名称':'这个项目的名称',true);const model=provider(scope==='education'?'education.school':'projects.name');expect(await inferSemanticCandidates(s.scan,s.profile,model,s.options)).toEqual({state:'no-candidates',matches:[]});expect(model.propose).not.toHaveBeenCalled();});
it.each([['education','就读学校名称 / 项目名称'],['education','学校名称 / 其他'],['education','学校名称或专业名称'],['education','最高学校名称'],['education','硕士期间就读学校名称'],['education','已经获得的学位名称'],['project','这个项目的名称 / 学校名称'],['project','这个项目的名称 / 其他'],['project','这个项目的名称和项目职责'],['project','是否有这个项目的名称'],['project','这个项目的上传附件'],['project','项目名称 /']] as const)('%s 组合或保护字段 %s 零请求',async(scope,label)=>{const s=setup(scope,label);const model=provider(scope==='education'?'education.school':'projects.name');expect(await inferSemanticCandidates(s.scan,s.profile,model,s.options)).toEqual({state:'no-candidates',matches:[]});expect(model.propose).not.toHaveBeenCalled();});
it.each(scopes)('%s 等待确认时静默手改保留，迟到回执不学习',async scope=>{const s=setup(scope,scope==='education'?'就读学校名称':'这个项目的名称');let reply!:(value:unknown)=>void;const model:SemanticProvider={propose:vi.fn(()=>new Promise(resolve=>{reply=resolve;}))};const cache={propose:vi.fn(),remember:vi.fn()};const pending=inferSemanticCandidates(s.scan,s.profile,model,{...s.options,recipes:cache});await vi.waitFor(()=>expect(model.propose).toHaveBeenCalledOnce());s.element.value='自行填写';reply(await provider(scope==='education'?'education.school':'projects.name').propose(vi.mocked(model.propose).mock.calls[0]![0],new AbortController().signal));expect(await pending).toEqual({state:'rejected',matches:[]});expect(cache.remember).not.toHaveBeenCalled();expect(s.element.value).toBe('自行填写');});
it.each(scopes)('%s Stop取消弱含义请求',async scope=>{const s=setup(scope,scope==='education'?'就读学校名称':'这个项目的名称');const signal=s.state.context.beginStep();const model:SemanticProvider={propose:vi.fn(()=>new Promise(()=>{}))};const pending=inferSemanticCandidates(s.scan,s.profile,model,{...s.options,signal});await vi.waitFor(()=>expect(model.propose).toHaveBeenCalledOnce());s.state.context.stop();expect(await pending).toEqual({state:'cancelled',matches:[]});expect(vi.mocked(model.propose).mock.calls[0]![1].aborted).toBe(true);});
