import { expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { awardProfile, awardProjectionRequestSchema, awardProjectionResponseSchema } from '../src/profile/awardProjection';
function source() {
 const profile=createEmptyProfile(); profile.basic={name:'无关私人姓名',phone:'13800000000',idNumber:'无关身份资料'};
 profile.awards=[{id:'award-a',name:'校二等奖学金',school:'虚构青岚学院',category:'奖学金',level:'校级',date:'2021-10-20',description:'完成课程学习并获校级奖学金。',scholarshipLevel:'二等奖'},
 {id:'award-b',name:'虚构程序设计竞赛二等奖',school:'虚构云川大学',category:'竞赛',level:'省级',date:'2025-04',description:'参加程序设计竞赛并获二等奖。'}];
 profile.research.papers=[{id:'unrelated-paper',title:'无关论文'}];profile.projects=[{id:'unrelated-project',name:'无关项目',technologies:[]}]; return profile;
}
it('keeps every scholarship and competition in source order with independent dates and descriptions',()=>{
 const profile=source(),result=awardProfile(profile);expect(result.awards).toEqual(profile.awards);expect(result.presence).toBe('known');
 expect(result.awards.map(award=>award.date)).toEqual(['2021-10-20','2025-04']);expect(result.awards[1]!.scholarshipLevel).toBeUndefined();
});
it('excludes applicant identity and unrelated collections',()=>{
 const encoded=JSON.stringify(awardProfile(source()));expect(encoded).not.toMatch(/无关|13800000000|basic|projects|papers|phone|idNumber/);
});
it('does not manufacture missing dates, schools or achievement text',()=>{
 const profile=source();profile.awards=[{id:'unfinished',name:'校二等奖学金'}];expect(awardProfile(profile).awards).toEqual(profile.awards);
});
it('an empty old array stays unknown, rather than choosing no awards',()=>{expect(awardProfile(createEmptyProfile())).toMatchObject({presence:'unknown',awards:[]});});
it.each(['none','not_applicable'] as const)('preserves explicit confirmed %s without fabricating a record',state=>{
 const profile=createEmptyProfile();profile.collectionFacts={awards:{state,source:'user',confirmed:true}};
 expect(awardProfile(profile)).toMatchObject({presence:state,awards:[],fact:{state,confirmed:true}});
});
it('legacy or unconfirmed absence cannot disable an award section',()=>{
 const profile=createEmptyProfile();profile.collectionFacts={awards:{state:'none',source:'legacy',confirmed:true}};expect(awardProfile(profile).presence).toBe('unknown');
 profile.collectionFacts.awards={state:'none',source:'user',confirmed:false};expect(awardProfile(profile).presence).toBe('unknown');
});
it('rejects duplicate source identities before any record planning',()=>{
 const profile=source();profile.awards[1]!.id=profile.awards[0]!.id;expect(()=>awardProfile(profile)).toThrow();
});
it('rejects impossible calendar dates and contradictory confirmed absence',()=>{
 const profile=source();profile.awards[0]!.date='2025-02-29';expect(()=>awardProfile(profile)).toThrow();
 const other=source();other.collectionFacts={awards:{state:'none',source:'user',confirmed:true}};expect(()=>awardProfile(other)).toThrow();
});
it('source changes cannot mutate an already issued projection',()=>{
 const profile=source(),result=awardProfile(profile);profile.awards[0]!.name='修改后的名称';expect(result.awards[0]!.name).toBe('校二等奖学金');
 expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.awards)).toBe(true);expect(Object.isFrozen(result.awards[0])).toBe(true);
});
it('strict payload-free request rejects profiles, selectors and arbitrary IDs',()=>{
 expect(awardProjectionRequestSchema.safeParse({type:'RA_PROFILE_AWARDS'}).success).toBe(true);
 for(const extra of [{profile:source()},{selector:'#anything'},{id:'award-a'}])expect(awardProjectionRequestSchema.safeParse({type:'RA_PROFILE_AWARDS',...extra}).success).toBe(false);
});
it('response rejects an injected basic profile and extra foreign keys',()=>{
 const result=awardProfile(source());expect(awardProjectionResponseSchema.safeParse({...result,basic:source().basic}).success).toBe(false);
 expect(awardProjectionResponseSchema.safeParse({...result,awards:[{...result.awards[0],phone:'13800000000'}]}).success).toBe(false);
});
