import { expect, it } from 'vitest';
import { qualifyInternshipWeakMeaning as qualify } from '../src/matching/internshipFieldResolver';
import { firstInternship, secondInternship, internshipField as field } from './fixtures/internship-facts';

it.each([
 ['工作单位名称','organization'], ['承担的工作内容','description'], ['实习期间所在部门','department'],
 ['工作单位（公司名称）','organization'], ['工作单位 / 公司名称','organization'], ['work performed company','organization'],
] as const)('%s 可请求确认同一弱含义但不生成答案', (label,key) => {
 const result=qualify(field(label),secondInternship);
 expect(result).toEqual({status:'confirm',path:`internships.${key}`});
 expect(JSON.stringify(result)).not.toContain(secondInternship[key]!);
});
it.each([
 '工作单位 / 项目名称','工作单位和项目名称','工作单位、学校名称','工作单位 / 其他',
 '工作单位是否已取得','税前月薪大概范围','证明人工作单位','是否有实习经历','未知业务编号','工作单位',
 '企业性质 / 工作单位名称','工作单位名称或所在部门','工作单位名称／单位名称／project name',
])('%s 不授权弱含义确认',label=>expect(qualify(field(label),firstInternship).status).not.toBe('confirm'));
it.each([
 {organization:undefined},{organization:''},{organization:'字'.repeat(101)},
])('当前条缺失或超过长度不能借另一条确认',override=>expect(qualify(field('工作单位名称',{maxLength:100}),{...firstInternship,...override}).status).not.toBe('confirm'));
it.each([
 {ariaLabel:'项目名称'},{tableHeader:'学校名称'},{ariaLabel:'所在部门'},{disabled:true},{hasValue:true},{readOnly:true},
])('不同主来源或受保护状态不确认',override=>expect(qualify(field('工作单位名称',override),firstInternship).status).not.toBe('confirm'));

it.each(['是否为工作单位名称','不是工作单位名称','工作单位名称无需填写','company not employer','工作单位名称 /','/ 工作单位名称'])('条件或不完整组合问题 %s 不确认',label=>expect(qualify(field(label),firstInternship).status).not.toBe('confirm'));
it('主标签冲突不能被长的弱标签压过',()=>expect(qualify(field('工作单位名称',{ariaLabel:'公司名称或项目名称'}),firstInternship).status).not.toBe('confirm'));
it('只读资格不改变原字段或当前条',()=>{const descriptor=field('工作单位名称');const record=structuredClone(secondInternship);const before=JSON.stringify({descriptor,record});qualify(descriptor,record);expect(JSON.stringify({descriptor,record})).toBe(before);});
it('仅资源名不触发弱含义确认',()=>expect(qualify(field('',{name:'InternshipCompany'}),firstInternship).status).not.toBe('confirm'));
