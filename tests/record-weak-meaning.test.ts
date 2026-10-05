import {afterEach,expect,it} from 'vitest';
import {scanDocument} from '../src/content/scanner';
import {qualifyEducationWeakMeaning as education} from '../src/matching/educationFieldResolver';
import {qualifyProjectWeakMeaning as project} from '../src/matching/projectFieldResolver';
import type {EducationProjectionEntry} from '../src/profile/educationProjection';
import type {ProjectProjectionEntry} from '../src/profile/projection';
const bachelor:EducationProjectionEntry={id:'fictional-bachelor',level:'本科',school:'虚构青岚学院',major:'软件工程',degree:'学士学位',educationType:'统招',schoolProperty:'国内普通院校',durationYears:'4',gpa:'3.6',gpaScale:'4',startDate:'2020-09-01',endDate:'2024-06-30'};
const record:ProjectProjectionEntry={id:'fictional-project',name:'虚构校园检索',role:'开发成员',description:'检索与收藏校园资料。',responsibilities:'开发接口及测试。',technologies:['TypeScript'],startDate:'2026-01-01',endDate:'2026-06-30'};
function field(label:string,scope='教育经历',attributes='',tag='input'){document.body.innerHTML='<section><h2>'+scope+'</h2><label>'+label+'<'+tag+' '+attributes+'></'+tag+'></label></section>';return scanDocument(document).result.fields[0]!;}
afterEach(()=>{document.body.innerHTML='';});
it.each([['就读学校名称','school'],['所学的专业名称','major'],['学校名称 / 就读学校名称','school']] as const)('教育 %s 只提出弱含义而不生成答案',(label,key)=>{expect(education(field(label),bachelor)).toEqual({status:'confirm',path:'education.'+key});});
it.each([['这个项目的名称','name'],['这个项目的描述','description'],['承担的项目职责','responsibilities'],['项目名称 / 这个项目的名称','name']] as const)('项目 %s 只提出弱含义而不生成答案',(label,key)=>{expect(project(field(label,'项目经历'),record)).toEqual({status:'confirm',path:'projects.'+key});});
it.each(['就读学校名称 / 项目名称','学校名称 / 其他','就读学校名称或专业名称','本科的学校名称是否已取得','最高学校名称','不是就读学校名称','就读学校名称无需填写','学校名称 /','/ 学校名称','学校名称','绩点的大概成绩','学校学制的月份'])('教育 %s 不确认',label=>{expect(education(field(label),bachelor).status).toBe('blocked');});
it.each(['这个项目的名称 / 学校名称','这个项目的名称 / 其他','这个项目的名称和项目职责','是否有这个项目的名称','不是这个项目的名称','项目名称 /','项目名称','项目证明人名称','上传这个项目的描述','实习公司名称'])('项目 %s 不确认',label=>{expect(project(field(label,'项目经历'),record).status).toBe('blocked');});
it.each(['aria-label="项目名称"','aria-label="所学专业"','disabled','readonly','value="手填学校"','maxlength="2"','type="checkbox"'])('教育保护与冲突 %s 不确认',attributes=>{expect(education(field('就读学校名称','教育经历',attributes),bachelor).status).toBe('blocked');});
it.each(['aria-label="学校名称"','aria-label="项目职责"','disabled','readonly','value="手填项目"','maxlength="2"','type="checkbox"'])('项目保护与冲突 %s 不确认',attributes=>{expect(project(field('这个项目的名称','项目经历',attributes),record).status).toBe('blocked');});
it('硕士标签不能映射到当前本科',()=>{expect(education(field('硕士期间就读学校名称'),bachelor).status).toBe('blocked');});
it.each([{school:undefined},{school:''},{id:''},{id:'x'.repeat(201)}])('当前教育事实不完整或错误不确认',override=>{expect(education(field('就读学校名称'),{...bachelor,...override}).status).toBe('blocked');});
it.each([{name:undefined},{name:''},{id:''},{url:'javascript:alert(1)'}])('当前项目事实不完整或错误不确认',override=>{expect(project(field('这个项目的名称','项目经历'),{...record,...override}).status).toBe('blocked');});
it.each(['教育经历','项目经历'])('仅资源名和栏目 %s 不确认',scope=>{const f=field('',scope,'name="SchoolProjectName"');expect((scope==='教育经历'?education(f,bachelor):project(f,record)).status).toBe('blocked');});
it('只读资格不改变事实或描述符',()=>{const f=field('就读学校名称');const before=JSON.stringify({f,bachelor,record});education(f,bachelor);project({...f,label:'这个项目的名称'},record);expect(JSON.stringify({f,bachelor,record})).toBe(before);});

it.each(['date','month'])('教育弱日期在原生 %s 控件保留档案精度',type=>{expect(education(field('这段教育的入学日期','教育经历','type="'+type+'"'),bachelor)).toEqual({status:'confirm',path:'education.startDate'});});
it.each(['date','month'])('项目弱日期在原生 %s 控件保留档案精度',type=>{expect(project(field('这个项目的开始日期','项目经历','type="'+type+'"'),record)).toEqual({status:'confirm',path:'projects.startDate'});});
it('教育弱日期不补日也不猜文本格式',()=>{expect(education(field('这段教育的入学日期','教育经历','type="date"'),{...bachelor,startDate:'2020-09'}).status).toBe('blocked');expect(education(field('这段教育的入学日期'),bachelor).status).toBe('blocked');});
it('项目弱日期不补日也不猜文本格式',()=>{expect(project(field('这个项目的开始日期','项目经历','type="date"'),{...record,startDate:'2026-01'}).status).toBe('blocked');expect(project(field('这个项目的开始日期','项目经历'),record).status).toBe('blocked');});
it('教育弱学位只接受唯一可见选项',()=>{const f=field('这段学习的学位名称');f.kind='select';f.type='select-one';f.options=[{value:'B',label:'学士学位',disabled:false}];expect(education(f,bachelor)).toEqual({status:'confirm',path:'education.degree'});expect(education({...f,options:[...f.options,{value:'duplicate',label:'学士学位',disabled:false}]},bachelor).status).toBe('blocked');});
