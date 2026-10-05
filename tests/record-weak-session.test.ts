import {afterEach,expect,it,vi} from 'vitest';
import {installWeakProjectSessionPage} from './fixtures/weak-project-session-page';
import {educationSessionProfile as educationSource,installEducationSessionPage} from './fixtures/education-session-page';
import {createEducationRecordSession} from '../src/content/educationRecordSession';
import {createProjectRecordSession} from '../src/content/projectRecordSession';
import type {ProjectProjectionResponse} from '../src/profile/projection';
import type {SemanticProvider} from '../src/ai/semanticCandidates';
const scopes=['education','project'] as const;
const projectSource:ProjectProjectionResponse={recordType:'project',profileRevision:'fictional-weak-project',projects:[1,2].map(index=>({id:'fictional-weak-'+index,name:'虚构项目 '+index,description:'第'+index+'项虚构校园资料检索平台的开发和测试说明。',technologies:[]}))};

function setup(scope:typeof scopes[number],scenario='happy'){
 const local=scope==='education'?structuredClone(educationSource):structuredClone(projectSource);
 if(scenario==='missing'){if(local.recordType==='education')delete local.education[1]!.major;else delete local.projects[0]!.description;}
 if(local.recordType==='education')for(const [index,record] of local.education.entries())record.college='虚构学院'+index;
 if(local.recordType==='project' && scenario==='dynamic')for(const [index,record] of local.projects.entries())record.responsibilities='开发第'+index+'项接口并完成测试。';
 const page=local.recordType==='education'?installEducationSessionPage(document,local):installWeakProjectSessionPage(document);
 let foreignAdds=0;for(const caption of scope==='education'?['项目经历','在校奖励活动']:['教育经历','实习经历']){const section=document.createElement('section');section.setAttribute('aria-label',caption);section.innerHTML='<h2>'+caption+'</h2><div role="list"><p role="status">暂无经历</p><button type="button">+</button></div>';section.querySelector('button')!.addEventListener('click',()=>foreignAdds++);document.body.append(section);}
 page.add.addEventListener('click',()=>{const form=page.list.querySelector('form')!;const captions=scope==='education'?{school:scenario==='mixed'?'就读学校名称 / 项目名称':'就读学校名称',major:'所学的专业名称'}:{name:scenario==='mixed'?'这个项目的名称 / 学校名称':'这个项目的名称',description:'这个项目的描述'};
 for(const [key,caption] of Object.entries(captions))form.querySelector('[data-test-key="'+key+'"]')!.parentElement!.firstChild!.textContent=caption;
 if(scope==='education'){form.querySelector('button')!.insertAdjacentHTML('beforebegin','<label>是否最高学位<select data-test-key="highest"><option value="">请选择</option><option value="Y">是</option><option value="N">否</option></select></label>');}
 if(scenario==='dynamic'){
 const trigger=scope==='education'?form.querySelector('[data-test-key="degree"]')!:form.querySelector('[data-test-key="name"]')!;
 trigger.addEventListener(scope==='education'?'change':'input',()=>setTimeout(()=>{if(form.isConnected)form.querySelector('button')!.insertAdjacentHTML('beforebegin',scope==='education'?'<label>就读的学院名称<input required data-test-key="college" name="opaque-extra"></label>':'<label>承担的项目职责<textarea required data-test-key="responsibilities" name="opaque-extra"></textarea></label>');},600),{once:true});
 }
 });
 const create=(model:SemanticProvider)=>local.recordType==='education'?createEducationRecordSession(document,local,undefined,undefined,model):createProjectRecordSession(document,local,undefined,undefined,model);
 return {local,page,create,foreign:()=>foreignAdds};
}
const paths:Record<string,string>={'就读学校名称':'education.school','所学的专业名称':'education.major','就读的学院名称':'education.college','这个项目的名称':'projects.name','这个项目的描述':'projects.description','承担的项目职责':'projects.responsibilities'};
function proposal(request:Parameters<SemanticProvider['propose']>[0]){return {requestId:request.requestId,status:'mapped',bindings:request.fields.map(f=>({ref:f.ref,fingerprint:f.fingerprint,path:paths[f.label],certainty:'certain',evidence:'label'}))};}
const provider=():SemanticProvider=>({propose:vi.fn(async(request:Parameters<SemanticProvider['propose']>[0])=>proposal(request))});
async function finish(session:ReturnType<typeof createProjectRecordSession>){for(let i=0;i<20;i++){const r=await session.advance();if(r.status==='complete')return;expect(r.status,JSON.stringify(r)).toBe('advanced');}throw Error('unfinished');}
const empty=(page:{list:HTMLElement})=>Array.from(page.list.querySelectorAll<HTMLInputElement>('input,textarea,select')).every(f=>!f.value);
afterEach(()=>{document.body.innerHTML='';document.head.innerHTML='';window.history.replaceState({},'','/');});
it.each(scopes)('%s 两条弱含义分别确认、保存、重启跳过，其他栏目零动作',async scope=>{const s=setup(scope);const before=JSON.stringify(s.local);const model=provider();await finish(s.create(model));await finish(s.create(model));expect(model.propose).toHaveBeenCalledTimes(2);expect(s.page.counts).toEqual({add:2,save:2,submit:0,remove:0,cancel:0});expect(s.foreign()).toBe(0);expect(JSON.stringify(s.local)).toBe(before);
 if(s.local.recordType==='education'){expect(s.page.saved.map(r=>r.school)).toEqual([s.local.education[1]!.school,s.local.education[0]!.school]);expect(s.page.saved.map(r=>r.highest)).toEqual(['否','是']);expect(s.page.saved.map(r=>r.degree)).toEqual(['学士学位','硕士学位']);}else expect(s.page.saved).toEqual(s.local.projects.map(r=>({name:r.name,description:r.description})));},15000);
it.each(scopes)('%s 模型改义阻止整条写入和保存',async scope=>{const s=setup(scope);const model:SemanticProvider={propose:vi.fn(async(request:Parameters<SemanticProvider['propose']>[0])=>{const response=proposal(request);response.bindings[0]!.path=scope==='education'?'education.major':'projects.description';return response;})};const session=s.create(model);expect((await session.advance()).status).toBe('advanced');expect((await session.advance()).status).toBe('request-human');expect(model.propose).toHaveBeenCalledOnce();expect(empty(s.page)).toBe(true);expect(s.page.counts.save).toBe(0);expect(s.foreign()).toBe(0);});
it.each(scopes)('%s 组合字段零模型请求、零其他值写入',async scope=>{const s=setup(scope,'mixed');const model=provider();const session=s.create(model);await session.advance();expect((await session.advance()).status).toBe('request-human');expect(model.propose).not.toHaveBeenCalled();expect(empty(s.page)).toBe(true);expect(s.page.counts.save).toBe(0);});
it.each(scopes)('%s 当前条弱事实缺失时不借另一条',async scope=>{const s=setup(scope,'missing');const model=provider();const session=s.create(model);expect((await session.advance()).status).toBe('advanced');expect((await session.advance()).status).toBe('request-human');expect(model.propose).not.toHaveBeenCalled();expect(empty(s.page)).toBe(true);expect(s.page.counts.save).toBe(0);});
it.each(scopes)('%s 动态弱字段再次确认，旧字段不重复请求',async scope=>{const s=setup(scope,'dynamic');const model=provider();await finish(s.create(model));expect(vi.mocked(model.propose).mock.calls.map(([r])=>r.fields.length)).toEqual([2,1,2,1]);expect(s.page.counts.save).toBe(2);expect(s.foreign()).toBe(0);if(s.local.recordType==='education')expect(s.page.saved.map(r=>r.college)).toEqual([s.local.education[1]!.college,s.local.education[0]!.college]);else expect(s.page.saved.map(r=>r.responsibilities)).toEqual(s.local.projects.map(r=>r.responsibilities));},15000);
it.each(scopes)('%s 模型等待时手改保留',async scope=>{const s=setup(scope);let reply!:(value:unknown)=>void;const model:SemanticProvider={propose:vi.fn(()=>new Promise(done=>{reply=done;}))};const session=s.create(model);await session.advance();const pending=session.advance();await vi.waitFor(()=>expect(model.propose).toHaveBeenCalledOnce());const f=s.page.list.querySelector<HTMLInputElement>('input')!;f.value='自己的内容';reply(proposal(vi.mocked(model.propose).mock.calls[0]![0]));expect((await pending).status).toBe('request-human');expect(f.value).toBe('自己的内容');expect(s.page.counts.save).toBe(0);});

it.each(['manual','stop'])('纯文本展开观察期间 %s 保留守卫且零保存',async mode=>{const s=setup('project');const model=provider();const session=s.create(model);await session.advance();const field=s.page.list.querySelector<HTMLInputElement>('input')!;field.addEventListener('input',()=>setTimeout(()=>{if(mode==='stop')session.stop();else field.value='观察期间手动填写';},500),{once:true});const r=await session.advance();expect(r.status).toBe(mode==='stop'?'stopped':'request-human');expect(s.page.counts.save).toBe(0);if(mode==='manual')expect(field.value).toBe('观察期间手动填写');expect(s.foreign()).toBe(0);},10000);
