import {expect,it,afterEach} from 'vitest';
import {createInternshipSemanticContext,internshipSemanticContextCurrent,internshipSemanticFieldIds,resolveCurrentInternshipField} from '../src/ai/internshipSemanticContext';
import {createEmptyProfile,type UserProfile} from '../src/profile/schema';
import {internshipSessionProfile} from './fixtures/internship-session-page';
import {lifecycle} from './fixtures/record-editor-context';
import { bindRecordEditor } from '../src/planner/recordEditorBinder';
function setup(configure?:(profile:UserProfile,elements:HTMLInputElement[])=>void){const profile=createEmptyProfile();profile.updatedAt=internshipSessionProfile.profileRevision;profile.internships=internshipSessionProfile.internships.map(record=>({...record}));const elements=['当时服务的实体','归属的业务团队','承担的工作内容'].map(ariaLabel=>Object.assign(document.createElement('input'),{ariaLabel}));configure?.(profile,elements);const state=lifecycle(elements,undefined,undefined,1,'internship');const input={plan:state.populatePlan,capture:state.editing,activeTransaction:state.active,runContext:state.context,scanState:state.fixture.scanState,profile};return {state,input,profile,elements,scan:state.fixture.scanState.result,context:createInternshipSemanticContext(input)};}
afterEach(()=>{document.body.innerHTML='';document.head.innerHTML='';window.history.replaceState({},'', '/');});
it('第二条实习上下文分别读取自己的单位、部门和描述',()=>{const s=setup();expect(s.context).toBeDefined();expect(s.state.active.intentIndex).toBe(1);for(const [index,key] of [[0,'organization'],[1,'department'],[2,'description']] as const)expect(resolveCurrentInternshipField(s.context!,s.scan,s.profile,s.scan.fields[index]!.id,'internships.'+key)).toMatchObject({status:'known',value:s.profile.internships[1]![key]});expect(JSON.stringify(s.context)).toBe('{"recordType":"internship"}');expect(Object.isFrozen(s.context)).toBe(true);expect(s.elements.every(element=>!element.value)).toBe(true);});
it('复制上下文和非规划字段没有取值权限',()=>{const s=setup();expect(internshipSemanticFieldIds(s.context!,s.scan,s.profile)).toEqual(s.scan.fields.map(field=>field.id));expect(internshipSemanticFieldIds(structuredClone(s.context!),s.scan,s.profile)).toBeUndefined();expect(resolveCurrentInternshipField(s.context!,s.scan,s.profile,'outside','internships.organization')).toBeUndefined();});
it.each(['plan','capture','activeTransaction'] as const)('复制%s不能创建上下文',key=>{const s=setup();expect(createInternshipSemanticContext({...s.input,[key]:structuredClone(s.input[key])})).toBeUndefined();});
it.each(['stop','capture','revision','profile','reorder','replace','silent-value','label','limit','outside','editor-moved','list-replaced','control-map'])('%s使当前实习来源失效',change=>{const s=setup();expect(s.context).toBeDefined();if(change==='stop')s.state.context.stop();if(change==='capture')s.state.context.capture(s.state.fixture.source);if(change==='revision')s.state.context.bumpProfileRevision();if(change==='profile')s.profile.internships[1]!.organization='改后的虚构单位';if(change==='reorder')s.profile.internships.reverse();if(change==='replace')s.elements[0]!.replaceWith(s.elements[0]!.cloneNode(true));if(change==='silent-value')s.elements[0]!.value='人工已有值';if(change==='label')s.elements[0]!.ariaLabel='另一个问题';if(change==='limit')s.elements[0]!.maxLength=2;if(change==='outside')document.body.append(s.elements[0]!);if(change==='editor-moved')document.body.append(s.state.fixture.editor);if(change==='list-replaced'){const list=s.state.fixture.scanState.semanticTargets.get(s.state.populatePlan.recordListNodeId)!;const clone=list.cloneNode(false);list.replaceWith(clone);clone.appendChild(s.state.fixture.editor);}if(change==='control-map')s.state.fixture.scanState.controls.set(s.scan.fields[0]!.id,{node:s.elements[0]!.cloneNode(true) as HTMLInputElement,fingerprint:s.state.fixture.controls[0]!.fingerprint});expect(internshipSemanticContextCurrent(s.context!,s.scan,s.profile,[])).toBe(false);expect(resolveCurrentInternshipField(s.context!,s.scan,s.profile,s.scan.fields[0]!.id,'internships.organization')).toBeUndefined();});
it.each(['certifierName','certifierContact','cadreLevel'] as const)('上下文拒绝投影目录之外的%s',key=>{const s=setup();s.profile.internships[1]![key]='不该进入当前条语义投影';expect(createInternshipSemanticContext(s.input)).toBeUndefined();});
it('拒绝重复ID和缺失当前条',()=>{const s=setup();s.profile.internships[1]!.id=s.profile.internships[0]!.id;expect(createInternshipSemanticContext(s.input)).toBeUndefined();s.profile.internships=[];expect(createInternshipSemanticContext(s.input)).toBeUndefined();});
it.each(['basic','student-work','papers'])('当前条内部档案不接受其他栏目%s',mode=>{const s=setup();if(mode==='basic')s.profile.basic.name='虚构个人姓名';if(mode==='student-work')s.profile.studentWork=[{id:'foreign-student',role:'其他职责'}];if(mode==='papers')s.profile.research.papers=[{id:'foreign-paper',title:'其他论文'}];expect(createInternshipSemanticContext(s.input)).toBeUndefined();});

it('消费字段事务后，原上下文和原计划不能再产生答案', async () => {
 const s = setup();
 const result = await bindRecordEditor({ ...s.input, provideValue: () => '虚构填写值',
  rescan: () => s.state.context.capture(s.state.fixture.source) });
 expect(result).toMatchObject({ status: 'advanced', writtenFieldCount: 3 });
 expect(createInternshipSemanticContext(s.input)).toBeUndefined();
 expect(resolveCurrentInternshipField(s.context!,s.scan,s.profile,s.scan.fields[0]!.id,'internships.organization')).toBeUndefined();
});
it.each(['navigation','shadow','adopted','list-map','missing-revision','oversized-revision'])('%s不保留原实习上下文', mode => {
 const s = setup(); expect(s.context).toBeDefined();
 if (mode==='navigation') window.history.replaceState({},'', '/another-job');
 if (mode==='shadow') { const host=document.createElement('div');s.state.fixture.editor.append(host);host.attachShadow({mode:'open'}).append(s.elements[0]!); }
 if (mode==='adopted') document.implementation.createHTMLDocument('other').body.append(s.elements[0]!);
 if (mode==='list-map') s.state.fixture.scanState.semanticTargets.set(s.state.populatePlan.recordListNodeId,document.createElement('section'));
 if (mode==='missing-revision') delete s.profile.updatedAt;
 if (mode==='oversized-revision') s.profile.updatedAt='x'.repeat(101);
 expect(internshipSemanticContextCurrent(s.context!,s.scan,s.profile,[])).toBe(false);
 expect(resolveCurrentInternshipField(s.context!,s.scan,s.profile,s.scan.fields[0]!.id,'internships.organization')).toBeUndefined();
});
it.each(['outside-member','hidden-member','same-name-other-root'])('当前原生单选的%s使整组上下文失效', mode => {
 const profile=createEmptyProfile();profile.updatedAt=internshipSessionProfile.profileRevision;
 profile.internships=internshipSessionProfile.internships.map(record=>({...record}));
 const first=Object.assign(document.createElement('input'),{type:'radio',name:'current-proof',ariaLabel:'是'});
 const second=Object.assign(document.createElement('input'),{type:'radio',name:'current-proof',ariaLabel:'否'});
 const state=lifecycle([first],new Map([[first,[first,second]]]),undefined,1,'internship');
 const input={plan:state.populatePlan,capture:state.editing,activeTransaction:state.active,runContext:state.context,scanState:state.fixture.scanState,profile};
 const context=createInternshipSemanticContext(input);expect(context).toBeDefined();
 const extra=Object.assign(document.createElement('input'),{type:'radio',name:'current-proof',checked:true});
 if(mode==='outside-member')document.body.append(second);
 if(mode==='hidden-member'){extra.hidden=true;state.fixture.editor.append(extra);}
 if(mode==='same-name-other-root'){const host=document.createElement('div');document.body.append(host);host.attachShadow({mode:'open'}).append(second);}
 expect(internshipSemanticContextCurrent(context!,state.fixture.scanState.result,profile,[])).toBe(false);
});
