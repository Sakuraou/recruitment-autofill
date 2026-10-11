import{describe,it,expect}from'vitest';import{resolveActiveCaptureContext}from'../src/visual/activeCaptureContext';
const deps=()=>({revision:()=>1,getBrowserWindow:async()=>({id:2,type:'normal'}),getActiveTabs:async(windowId:number)=>[{id:3,windowId,active:true,url:'https://fixture.local',status:'complete'}]});
describe('active capture browser context',()=>{
 it('queries active tab in explicitly resolved normal browser window',async()=>{const d=deps();expect(await resolveActiveCaptureContext(d)).toEqual({tabId:3,windowId:2,url:'https://fixture.local',revision:1})});
 it('never captures an extension popup window',async()=>{const d=deps();d.getBrowserWindow=async()=>({id:2,type:'popup'});expect(await resolveActiveCaptureContext(d)).toBeUndefined()});
 it('rejects focus revision changes while resolving tabs',async()=>{const d=deps();let revision=1;d.revision=()=>revision;d.getActiveTabs=async(windowId)=>{revision++;return[{id:3,windowId,active:true,url:'https://fixture.local',status:'complete'}]};expect(await resolveActiveCaptureContext(d)).toBeUndefined()});
 it('rejects pending navigation and inconsistent window',async()=>{const d=deps();d.getActiveTabs=async()=>[{id:3,windowId:99,active:true,url:'https://fixture.local',status:'complete'}];expect(await resolveActiveCaptureContext(d)).toBeUndefined()});
});
