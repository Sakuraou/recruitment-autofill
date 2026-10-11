import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createEmptyProfile} from '../src/profile/schema';
import {studentWorkProfile} from '../src/profile/studentWorkProjection';
import {studentWorkSessionProfile} from './fixtures/student-work-session-page';
type Listener=(message:unknown,sender:chrome.runtime.MessageSender,respond:(response:unknown)=>void)=>boolean|undefined;
let listener:Listener;
const profile=createEmptyProfile();profile.studentWork=studentWorkSessionProfile.studentWork.map(studentWork=>({...studentWork}));profile.collectionFacts={studentWork:{state:'known',source:'user',confirmed:true}};profile.basic={studentCadre:'否',studentCadreDescription:'无',name:'不得返回的姓名',phone:'不得返回的号码'};
const get=vi.fn(async()=>({'recruitment.profile.v1':profile}));
const sender:chrome.runtime.MessageSender={id:'studentWork-test',url:'https://fictional.jobs.test/resume',tab:{id:7} as chrome.tabs.Tab,frameId:0};
beforeEach(async()=>{vi.resetModules();get.mockReset();get.mockResolvedValue({'recruitment.profile.v1':profile});vi.stubGlobal('chrome',{
 runtime:{id:'studentWork-test',onMessage:{addListener:(callback:Listener)=>{listener=callback;}},onConnect:{addListener:vi.fn()},onInstalled:{addListener:vi.fn()},onStartup:{addListener:vi.fn()}},
 storage:{local:{get,setAccessLevel:vi.fn()},onChanged:{addListener:vi.fn()}},
 });Object.assign(chrome, { tabs: { onActivated: { addListener: vi.fn() }, onUpdated: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } }, windows: { onFocusChanged: { addListener: vi.fn() } } });
  Object.assign(chrome.runtime, { getURL: (path: string) => 'chrome-extension://' + chrome.runtime.id + '/' + path });
  await import('../src/background/index'); await new Promise(resolve => setTimeout(resolve, 0)); get.mockClear();});
afterEach(()=>vi.unstubAllGlobals());
it('returns only campus-position facts and collection confirmation to the same-extension top frame',async()=>{
 const respond=vi.fn();expect(listener({type:'RA_PROFILE_STUDENT_WORK'},sender,respond)).toBe(true);await vi.waitFor(()=>expect(respond).toHaveBeenCalledOnce());
 expect(respond).toHaveBeenCalledWith({ok:true,data:studentWorkProfile(profile)});expect(JSON.stringify(respond.mock.calls)).not.toContain('不得返回');
});
it.each(['foreign','internal','no-tab','frame','missing-frame','negative-tab','fractional-tab'] as const)('rejects %s caller before reading storage',mode=>{
 const source={...sender,...(mode==='foreign'?{id:'foreign'}:mode==='internal'?{url:'chrome-extension://studentWork-test/options.html'}:{}),
  tab:mode==='no-tab'?undefined:{...sender.tab,id:mode==='negative-tab'?-7:mode==='fractional-tab'?1.5:7},frameId:mode==='missing-frame'?undefined:mode==='frame'?1:0};
 const respond=vi.fn();expect(listener({type:'RA_PROFILE_STUDENT_WORK'},source as chrome.runtime.MessageSender,respond)).toBe(false);expect(get).not.toHaveBeenCalled();
 expect(respond).toHaveBeenCalledWith({ok:false,error:'不可信的档案投影请求'});
});
it('rejects arbitrary message payload without revealing facts',()=>{
 const respond=vi.fn();for(const payload of [{path:'basic.name'},{selector:'button'},{index:0},{studentWork:profile.studentWork}]){
  expect(listener({type:'RA_PROFILE_STUDENT_WORK',...payload},sender,respond)).toBe(false);
 }expect(get).not.toHaveBeenCalled();expect(respond).not.toHaveBeenCalled();
});
it('storage failure reveals no private diagnostics',async()=>{
 get.mockRejectedValueOnce(new Error('private-diagnostic'));const respond=vi.fn();expect(listener({type:'RA_PROFILE_STUDENT_WORK'},sender,respond)).toBe(true);
 await vi.waitFor(()=>expect(respond).toHaveBeenCalledOnce());expect(respond).toHaveBeenCalledWith({ok:false,error:'无法读取本地档案'});
});
it('client sends only the fixed request and freezes independent nested facts',async()=>{
 const source=studentWorkProfile(profile);const sendMessage=vi.fn(async()=>({ok:true,data:source}));vi.stubGlobal('chrome',{runtime:{sendMessage}});
 const {requestStudentWorkProjection}=await import('../src/content/profileProjectionClient');const result=await requestStudentWorkProjection();
 expect(sendMessage).toHaveBeenCalledWith({type:'RA_PROFILE_STUDENT_WORK'});expect(result).toEqual(source);expect(result.studentWork).not.toBe(source.studentWork);
 expect(Object.isFrozen(result.fact)).toBe(true);expect(Object.isFrozen(result.studentWork[0])).toBe(true);
});
it.each(['basic','applicant','duplicate','envelope','wrong-collection'] as const)('invalid %s client reply cannot reach the record session',async mode=>{
 const source=studentWorkProfile(profile);const data=mode==='basic'?{...source,basic:{name:'private'}}:mode==='applicant'?{...source,applicant:{studentCadre:'否',phone:'private'}}:mode==='duplicate'?{...source,studentWork:[source.studentWork[0],source.studentWork[0]]}:mode==='wrong-collection'?{...source,recordType:'internship'}:source;
 vi.stubGlobal('chrome',{runtime:{sendMessage:vi.fn(async()=>({ok:mode!=='envelope',data}))}});
 const {requestStudentWorkProjection}=await import('../src/content/profileProjectionClient');await expect(requestStudentWorkProjection()).rejects.toThrow(/校内职务档案投影/);
});
it('ongoing nested fact is cloned and frozen without inventing a date',async()=>{
 const source=studentWorkProfile(profile);const fact={state:'ongoing',confirmed:true,source:'user'};
 const data={...source,studentWork:[{...source.studentWork[0],endDate:undefined,endDateFact:fact}]};
 vi.stubGlobal('chrome',{runtime:{sendMessage:vi.fn(async()=>({ok:true,data}))}});
 const {requestStudentWorkProjection}=await import('../src/content/profileProjectionClient');const result=await requestStudentWorkProjection();
 expect(result.studentWork[0]!.endDate).toBeUndefined();expect(Object.isFrozen(result.studentWork[0]!.endDateFact)).toBe(true);
 expect(result.studentWork[0]!.endDateFact).not.toBe(fact);expect(result.studentWork[0]!.endDateFact).toEqual(fact);
});

