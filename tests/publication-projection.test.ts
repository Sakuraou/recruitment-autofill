import {expect,it} from 'vitest';
import {createEmptyProfile} from '../src/profile/schema';
import {publicationProfile,publicationProjectionRequestSchema,publicationProjectionResponseSchema} from '../src/profile/publicationProjection';
function profile(){const source=createEmptyProfile();source.basic={name:'不得返回的本人姓名',phone:'不得返回的号码'};
 source.research.papers=[{id:'paper-a',title:'虚构红外目标检测研究甲',status:'已发表',venue:'Fictional Journal A',date:'2026-01-17',abstract:'研究红外目标的轻量化检测方法。',authorOrder:'第二作者'},
 {id:'paper-b',title:'虚构检测研究乙',status:'在投',venue:'Fictional Journal B',authorOrder:'第三作者'}];
 source.research.patents=[{id:'patent',title:'不得返回的专利'}];source.projects=[{id:'project',name:'不得返回的项目',technologies:[]}];return source;}
it('preserves every independent publication and its actual status/order rather than making all papers published or first-author',()=>{
 const source=profile(),value=publicationProfile(source);expect(value.publications).toEqual(source.research.papers);expect(value.presence).toBe('known');
 expect(value.publications.map(paper=>paper.status)).toEqual(['已发表','在投']);expect(value.publications.map(paper=>paper.authorOrder)).toEqual(['第二作者','第三作者']);
});
it('excludes applicant identity, patents, projects and unrelated research context',()=>{expect(JSON.stringify(publicationProfile(profile()))).not.toContain('不得返回');});
it('missing dates and summaries remain missing, including papers currently under review',()=>{
 const value=publicationProfile(profile());expect(value.publications[1]).not.toHaveProperty('date');expect(value.publications[1]).not.toHaveProperty('abstract');
});
it('does not turn an old empty list into No or invent a first paper',()=>{expect(publicationProfile(createEmptyProfile())).toMatchObject({presence:'unknown',publications:[]});});
it.each(['none','not_applicable','known'] as const)('preserves confirmed %s facts separately from paper records',state=>{
 const source=createEmptyProfile();source.collectionFacts={papers:{state,confirmed:true,source:'user'}};expect(publicationProfile(source)).toMatchObject({presence:state,publications:[]});
});
it('legacy or unconfirmed absence stays unknown',()=>{
 const source=createEmptyProfile();source.collectionFacts={papers:{state:'none',source:'legacy',confirmed:true}};expect(publicationProfile(source).presence).toBe('unknown');
});
it('source updates cannot mutate a frozen issued publication snapshot',()=>{
 const source=profile(),value=publicationProfile(source);source.research.papers[0]!.status='修改';expect(value.publications[0]!.status).toBe('已发表');expect(Object.isFrozen(value.publications[0])).toBe(true);
});
it.each(['duplicate','invalid-date','extra','contradiction'] as const)('rejects %s source without granting a record operation',mode=>{
 const source=profile();if(mode==='duplicate')source.research.papers[1]!.id=source.research.papers[0]!.id;
 if(mode==='invalid-date')source.research.papers[0]!.date='2026-02-30';if(mode==='extra')Object.assign(source.research.papers[0]!,{phone:'private'});
 if(mode==='contradiction')source.collectionFacts={papers:{state:'none',source:'user',confirmed:true}};expect(()=>publicationProfile(source)).toThrow();
});
it('strict payload-free requests accept no index, selector or profile',()=>{
 expect(publicationProjectionRequestSchema.safeParse({type:'RA_PROFILE_PUBLICATIONS'}).success).toBe(true);
 for(const extra of [{index:0},{selector:'button'},{profile:profile()}])expect(publicationProjectionRequestSchema.safeParse({type:'RA_PROFILE_PUBLICATIONS',...extra}).success).toBe(false);
});
it('strict responses reject applicant identity and facts from a different collection',()=>{
 const value=publicationProfile(profile());expect(publicationProjectionResponseSchema.safeParse({...value,basic:{name:'private'}}).success).toBe(false);
 expect(publicationProjectionResponseSchema.safeParse({...value,recordType:'award'}).success).toBe(false);
});
