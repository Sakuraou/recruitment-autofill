import { matchField } from '../src/matching/ruleMatcher';
import {afterEach,expect,it} from 'vitest';
import {createEmptyProfile} from '../src/profile/schema';
import {scanDocument} from '../src/content/scanner';
import {qualifyScalarWeakMeaning as qualify} from '../src/matching/scalarWeakMeaning';
const profile=createEmptyProfile();profile.basic={name:'虚构申请人',gender:'男',birthday:'2002-04-15',phone:'13800138000',email:'fictional@example.test',nationality:'中国',heightCm:'175',weightKg:'70'};profile.links={github:'https://github.com/fictional-candidate'};
function field(label:string,attributes='',scope='个人信息'){document.body.innerHTML='<section><h2>'+scope+'</h2><label>'+label+'<input name="opaque" '+attributes+'></label></section>';return scanDocument(document).result.fields[0]!;}
afterEach(()=>{document.body.innerHTML='';});
it.each([['申请人的出生日期','type="date"','basic.birthday'],['申请人的电子邮箱','type="email"','basic.email'],['本人的联系电话信息','type="tel"','basic.phone'],['申请人的性别信息','','basic.gender'],['申请人的国籍信息','','basic.nationality'],['申请人的 github profile 信息','type="url"','links.github'],['申请人的身高（cm）','type="number"','basic.heightCm']] as const)('%s 是唯一当前标量弱含义',(label,attrs,path)=>{expect(qualify(field(label,attrs),profile)).toEqual({status:'confirm',path});});
it.each(['申请人的电子邮箱 / 项目名称','电子邮箱 / 其他','电子邮箱和联系电话','父亲的电子邮箱','证明人电子邮箱','联系人电子邮箱','是否已婚','最高学位信息','所学的专业名称','这个项目的名称','实习期间所在部门','学校奖学金名称','是否已经获得国籍','不是申请人的国籍','申请人的电子邮箱无需填写','电子邮箱 /','/ 电子邮箱','电子邮箱','姓名'])('%s 不确认',label=>{expect(qualify(field(label),profile).status).toBe('blocked');});
it.each(['disabled','readonly','value="自己填写"','maxlength="2"','type="checkbox"','type="password"','aria-label="联系电话"'])('标量保护或冲突 %s 不确认',attrs=>{expect(qualify(field('申请人的电子邮箱',attrs),profile).status).toBe('blocked');});
it('生日弱含义不补日、不猜文本日期格式',()=>{expect(qualify(field('申请人的出生日期','type="date"'),{...profile,basic:{...profile.basic,birthday:'2002-04'}}).status).toBe('blocked');expect(qualify(field('申请人的出生日期'),profile).status).toBe('blocked');});
it.each(['申请人的身高（inch）','申请人的体重（斤）','申请人的身高信息'])('弱测量单位 %s 不换算',label=>{expect(qualify(field(label,'type="number"'),profile).status).toBe('blocked');});
it('无当前标量事实不确认',()=>{expect(qualify(field('申请人的电子邮箱','type="email"'),{...profile,basic:{...profile.basic,email:undefined}}).status).toBe('blocked');});
it.each(['家庭成员','实习经历','项目经历'])('所在栏目 %s 不明确本人信息时不确认',scope=>{expect(qualify(field('联系电子邮箱信息','type="email"',scope),profile).status).toBe('blocked');});
it('仅资源名暂不按可见主标签确认',()=>{const f=field('','type="date"');f.name='RecruitmentPortalPersonProfile_Birthday';expect(qualify(f,profile).status).toBe('blocked');});
it('资格只返回含义，不修改档案与字段',()=>{const f=field('申请人的电子邮箱','type="email"');const before=JSON.stringify({f,profile});qualify(f,profile);expect(JSON.stringify({f,profile})).toBe(before);});

it('已知准确的GitHub主页走原规则',()=>{const f=field('GitHub主页','type="url"');expect(matchField(f,profile).status).toBe('auto');expect(qualify(f,profile).status).toBe('blocked');});

it.each([['<option value="m">男性</option>','confirm'],['<option value="m">男</option><option value="x">男性</option>','confirm'],['<option value="m">男性</option><option value="x">男性</option>','blocked'],['<option value="m" disabled>男</option>','blocked'],['<option value="m">男性及其他</option>','blocked']] as const)('下拉含义选项 %s 保留唯一可见值校验',(options,status)=>{document.body.innerHTML='<section><h2>个人信息</h2><label>申请人的性别信息<select><option value="">请选择</option>'+options+'</select></label></section>';expect(qualify(scanDocument(document).result.fields[0]!,profile).status).toBe(status);});
it('原生生日月份仅截取已有完整日期',()=>{expect(qualify(field('申请人的出生日期','type="month"'),profile)).toEqual({status:'confirm',path:'basic.birthday'});});
it('标题或提示词冲突不能借主标签升级为标量确认',()=>{expect(qualify(field('申请人的电子邮箱','title="联系人电子邮箱"'),profile).status).toBe('blocked');});
