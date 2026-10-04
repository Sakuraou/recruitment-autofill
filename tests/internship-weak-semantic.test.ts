import {afterEach,expect,it,vi} from 'vitest';
import {lifecycle} from './fixtures/record-editor-context';
import {internshipSessionProfile} from './fixtures/internship-session-page';
import {createEmptyProfile} from '../src/profile/schema';
import {createInternshipSemanticContext} from '../src/ai/internshipSemanticContext';
import {inferSemanticCandidates,type SemanticProvider} from '../src/ai/semanticCandidates';
function setup(label:string, overrides:Record<string,unknown>={}) {
 const profile=createEmptyProfile();profile.updatedAt=internshipSessionProfile.profileRevision;
 profile.internships=internshipSessionProfile.internships.map(record=>({...record}));Object.assign(profile.internships[1]!,overrides);
 const element=Object.assign(document.createElement('input'),{ariaLabel:label});
 const state=lifecycle([element],undefined,undefined,1,'internship');
 const context=createInternshipSemanticContext({plan:state.populatePlan,capture:state.editing,activeTransaction:state.active,runContext:state.context,scanState:state.fixture.scanState,profile})!;
 expect(context).toBeDefined();return {profile,element,state,context,scan:state.fixture.scanState.result};
}
const model=(path:string):SemanticProvider=>({propose:vi.fn(async (request:Parameters<SemanticProvider['propose']>[0])=>({requestId:request.requestId,status:'mapped',bindings:request.fields.map(field=>({ref:field.ref,fingerprint:field.fingerprint,path,certainty:'certain',evidence:'label'}))}))});
afterEach(()=>{document.body.innerHTML='';});
it.each([['工作单位名称','organization'],['承担的工作内容','description'],['实习期间所在部门','department'],['工作单位 / 公司名称','organization']] as const)('当前第二条%s经模型同义确认后只读当前事实',async(label,key)=>{
 const s=setup(label);const provider=model('internships.'+key);const result=await inferSemanticCandidates(s.scan,s.profile,provider,{internshipContext:s.context});
 expect(result).toMatchObject({state:'ready',matches:[{value:s.profile.internships[1]![key],confidence:.9,source:'llm'}]});expect(provider.propose).toHaveBeenCalledOnce();
 expect(s.element.value).toBe('');expect(JSON.stringify(vi.mocked(provider.propose).mock.calls[0]![0])).not.toMatch(/虚构|intentIndex|fictional-internship/);
});
it('弱公司被模型改成部门时不给值',async()=>{const s=setup('工作单位名称');const result=await inferSemanticCandidates(s.scan,s.profile,model('internships.department'),{internshipContext:s.context});expect(result).toEqual({state:'rejected',matches:[]});expect(s.element.value).toBe('');});
it.each(['工作单位 / 项目名称','工作单位 / 其他','工作单位名称或所在部门','工作单位名称是否已取得','证明人工作单位','工作单位名称 /'])('%s零模型请求',async label=>{const s=setup(label);const provider=model('internships.organization');expect(await inferSemanticCandidates(s.scan,s.profile,provider,{internshipContext:s.context})).toEqual({state:'no-candidates',matches:[]});expect(provider.propose).not.toHaveBeenCalled();});
it('当前弱单位缺事实时不请求，不借第一条',async()=>{const s=setup('工作单位名称',{organization:undefined});const provider=model('internships.organization');expect(await inferSemanticCandidates(s.scan,s.profile,provider,{internshipContext:s.context})).toEqual({state:'no-candidates',matches:[]});expect(provider.propose).not.toHaveBeenCalled();});
it('原未知模型路径没有当前条能力时仍不能请求弱标签',async()=>{const s=setup('工作单位名称');const provider=model('internships.organization');expect(await inferSemanticCandidates(s.scan,s.profile,provider)).toEqual({state:'no-candidates',matches:[]});expect(provider.propose).not.toHaveBeenCalled();});

it('弱含义改判不学习到含义缓存',async()=>{const s=setup('工作单位名称');const recipes={propose:vi.fn(),remember:vi.fn()};expect(await inferSemanticCandidates(s.scan,s.profile,model('internships.department'),{internshipContext:s.context,recipes})).toEqual({state:'rejected',matches:[]});expect(recipes.remember).not.toHaveBeenCalled();});
