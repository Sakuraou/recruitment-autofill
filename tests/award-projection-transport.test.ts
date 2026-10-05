import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createEmptyProfile} from '../src/profile/schema';
import {awardProfile} from '../src/profile/awardProjection';
import {awardSessionProfile} from './fixtures/award-session-page';
type Listener=(message:unknown,sender:chrome.runtime.MessageSender,respond:(response:unknown)=>void)=>boolean|undefined;
let listener:Listener;
const profile=createEmptyProfile();profile.awards=awardSessionProfile.awards.map(award=>({...award}));profile.basic={studentCadre:'否',studentCadreDescription:'无',name:'不得返回的姓名',phone:'不得返回的号码'};
const get=vi.fn(async()=>({'recruitment.profile.v1':profile}));
const sender:chrome.runtime.MessageSender={id:'award-test',url:'https://fictional.jobs.test/resume',tab:{id:7} as chrome.tabs.Tab,frameId:0};
beforeEach(async()=>{vi.resetModules();get.mockReset();get.mockResolvedValue({'recruitment.profile.v1':profile});vi.stubGlobal('chrome',{
 runtime:{id:'award-test',onMessage:{addListener:(callback:Listener)=>{listener=callback;}},onConnect:{addListener:vi.fn()},onInstalled:{addListener:vi.fn()},onStartup:{addListener:vi.fn()}},
 storage:{local:{get,setAccessLevel:vi.fn()},onChanged:{addListener:vi.fn()}},
 });await import('../src/background/index');});
afterEach(()=>vi.unstubAllGlobals());
it('returns only all award facts and the two explicit applicant facts to the same-extension top frame',async()=>{
 const respond=vi.fn();expect(listener({type:'RA_PROFILE_AWARDS'},sender,respond)).toBe(true);await vi.waitFor(()=>expect(respond).toHaveBeenCalledOnce());
 expect(respond).toHaveBeenCalledWith({ok:true,data:awardProfile(profile)});expect(JSON.stringify(respond.mock.calls)).not.toContain('不得返回');
});
it.each(['foreign','internal','no-tab','frame','missing-frame','negative-tab','fractional-tab'] as const)('rejects %s caller before reading storage',mode=>{
 const source={...sender,...(mode==='foreign'?{id:'foreign'}:mode==='internal'?{url:'chrome-extension://award-test/options.html'}:{}),
  tab:mode==='no-tab'?undefined:{...sender.tab,id:mode==='negative-tab'?-7:mode==='fractional-tab'?1.5:7},frameId:mode==='missing-frame'?undefined:mode==='frame'?1:0};
 const respond=vi.fn();expect(listener({type:'RA_PROFILE_AWARDS'},source as chrome.runtime.MessageSender,respond)).toBe(false);expect(get).not.toHaveBeenCalled();
 expect(respond).toHaveBeenCalledWith({ok:false,error:'不可信的档案投影请求'});
});
it('rejects arbitrary message payload without revealing facts',()=>{
 const respond=vi.fn();for(const payload of [{path:'basic.name'},{selector:'button'},{index:0},{awards:profile.awards}]){
  expect(listener({type:'RA_PROFILE_AWARDS',...payload},sender,respond)).toBe(false);
 }expect(get).not.toHaveBeenCalled();expect(respond).not.toHaveBeenCalled();
});
it('storage failure reveals no private diagnostics',async()=>{
 get.mockRejectedValueOnce(new Error('private-diagnostic'));const respond=vi.fn();expect(listener({type:'RA_PROFILE_AWARDS'},sender,respond)).toBe(true);
 await vi.waitFor(()=>expect(respond).toHaveBeenCalledOnce());expect(respond).toHaveBeenCalledWith({ok:false,error:'无法读取本地档案'});
});
it('client sends only the fixed request and freezes independent nested facts',async()=>{
 const source=awardProfile(profile);const sendMessage=vi.fn(async()=>({ok:true,data:source}));vi.stubGlobal('chrome',{runtime:{sendMessage}});
 const {requestAwardProjection}=await import('../src/content/profileProjectionClient');const result=await requestAwardProjection();
 expect(sendMessage).toHaveBeenCalledWith({type:'RA_PROFILE_AWARDS'});expect(result).toEqual(source);expect(result.awards).not.toBe(source.awards);
 expect(Object.isFrozen(result.applicant)).toBe(true);expect(Object.isFrozen(result.awards[0])).toBe(true);
});
it.each(['basic','applicant','duplicate','envelope'] as const)('invalid %s client reply cannot reach the record session',async mode=>{
 const source=awardProfile(profile);const data=mode==='basic'?{...source,basic:{name:'private'}}:mode==='applicant'?{...source,applicant:{studentCadre:'否',phone:'private'}}:mode==='duplicate'?{...source,awards:[source.awards[0],source.awards[0]]}:source;
 vi.stubGlobal('chrome',{runtime:{sendMessage:vi.fn(async()=>({ok:mode!=='envelope',data}))}});
 const {requestAwardProjection}=await import('../src/content/profileProjectionClient');await expect(requestAwardProjection()).rejects.toThrow(/奖励档案投影/);
});
