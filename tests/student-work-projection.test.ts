import {expect,it} from 'vitest';
import {createEmptyProfile} from '../src/profile/schema';
import {studentWorkProfile,studentWorkProjectionRequestSchema,studentWorkProjectionResponseSchema} from '../src/profile/studentWorkProjection';
function source(){const profile=createEmptyProfile();profile.basic={name:'不得返回的本人姓名',studentCadre:'否'};
 profile.studentWork=[{id:'work-a',organization:'虚构学院',role:'辅导员助理',startDate:'2021-09-01',endDate:'2022-06-30',description:'协助整理通知和活动安排。',shortDuties:'整理通知',cadreLevel:'无',certifierName:'不得返回的证明人',monthlySalary:'不得返回的薪资'},
 {id:'work-b',organization:'虚构学院',role:'就业办助理',description:'协助整理招聘信息。'}];
 profile.internships=[{id:'intern',organization:'不得返回的实习'}];return profile;}
it('preserves all independent roles even in the same organization',()=>{
 const value=studentWorkProfile(source());expect(value.recordType).toBe('student-work');expect(value.studentWork.map(work=>work.role)).toEqual(['辅导员助理','就业办助理']);expect(value.presence).toBe('known');
 expect(value.studentWork[0]).toMatchObject({startDate:'2021-09-01',endDate:'2022-06-30',cadreLevel:'无',shortDuties:'整理通知'});
});
it('excludes applicant identity, cadre answers, proof contacts, salary and internships',()=>{expect(JSON.stringify(studentWorkProfile(source()))).not.toContain('不得返回');expect(studentWorkProfile(source())).not.toHaveProperty('applicant');});
it('unknown dates and cadre levels stay absent',()=>{const value=studentWorkProfile(source());expect(value.studentWork[1]).not.toHaveProperty('startDate');expect(value.studentWork[1]).not.toHaveProperty('cadreLevel');});
it('an old empty list is unknown, not an invented No answer',()=>{expect(studentWorkProfile(createEmptyProfile())).toMatchObject({presence:'unknown',studentWork:[]});});
it.each(['none','not_applicable','known'] as const)('preserves confirmed %s separately from details',state=>{
 const profile=createEmptyProfile();profile.collectionFacts={studentWork:{state,source:'user',confirmed:true}};expect(studentWorkProfile(profile)).toMatchObject({presence:state,studentWork:[]});
});
it('unconfirmed absence remains unknown',()=>{const profile=createEmptyProfile();profile.collectionFacts={studentWork:{state:'none',source:'user',confirmed:false}};expect(studentWorkProfile(profile).presence).toBe('unknown');});
it('freezes nested ongoing facts without inventing an end date',()=>{
 const profile=source();profile.studentWork[1]!.endDateFact={state:'ongoing',source:'user',confirmed:true};const value=studentWorkProfile(profile);
 expect(value.studentWork[1]).not.toHaveProperty('endDate');expect(Object.isFrozen(value.studentWork[1]!.endDateFact)).toBe(true);expect(Object.isFrozen(value.studentWork)).toBe(true);
});
it.each(['duplicate','invalid-date','reversed-date','contradiction'] as const)('rejects %s source',mode=>{
 const profile=source();if(mode==='duplicate')profile.studentWork[1]!.id=profile.studentWork[0]!.id;
 if(mode==='invalid-date')profile.studentWork[0]!.startDate='2021-02-30';if(mode==='reversed-date')profile.studentWork[0]!.endDate='2020-01-01';
 if(mode==='contradiction')profile.collectionFacts={studentWork:{state:'none',source:'user',confirmed:true}};expect(()=>studentWorkProfile(profile)).toThrow();
});
it('fixed empty requests accept no path, index, selector or supplied profile',()=>{
 expect(studentWorkProjectionRequestSchema.safeParse({type:'RA_PROFILE_STUDENT_WORK'}).success).toBe(true);
 for(const extra of [{path:'basic.name'},{index:0},{selector:'button'},{profile:source()}])expect(studentWorkProjectionRequestSchema.safeParse({type:'RA_PROFILE_STUDENT_WORK',...extra}).success).toBe(false);
});
it('strict responses reject extra facts and source absence contradictions',()=>{
 const value=studentWorkProfile(source());expect(studentWorkProjectionResponseSchema.safeParse({...value,basic:{name:'private'}}).success).toBe(false);
 expect(studentWorkProjectionResponseSchema.safeParse({...value,presence:'none'}).success).toBe(false);
});
