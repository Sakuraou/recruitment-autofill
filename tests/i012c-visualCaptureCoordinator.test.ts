/* eslint-disable @typescript-eslint/no-explicit-any -- Adversarial wire fixtures intentionally construct malformed protocol messages. */
import {describe,it,expect,vi} from 'vitest';
import{createVisualCaptureCoordinator,VISUAL_CAPTURE_COORDINATOR_PORT}from'../src/content/visualCaptureCoordinator';
import{AgentPageLease}from'../src/agent/pageLease';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(gated=false){const messages=new Set<(v:unknown)=>void>(),disconnects=new Set<()=>void>();const sent:any[]=[];let url='https://fixture.local/';const lease=new AgentPageLease(()=>url,()=>false),token=lease.begin();let fresh=true;
 const port={name:VISUAL_CAPTURE_COORDINATOR_PORT,sender:{id:'extension',url:'chrome-extension://extension/popup.html',frameId:0},onMessage:{addListener:(f:any)=>messages.add(f),removeListener:(f:any)=>messages.delete(f)},onDisconnect:{addListener:(f:any)=>disconnects.add(f),removeListener:(f:any)=>disconnects.delete(f)},postMessage:(v:any)=>sent.push(v),disconnect:vi.fn(()=>{for(const f of [...disconnects])f()})};
 const run=vi.fn(async(_intent:any,capture:any,signal:AbortSignal)=>{const image=await capture(signal);return image?{safe:true}:{safe:false}});
 const handler=createVisualCaptureCoordinator({extensionId:'extension',popupUrl:'chrome-extension://extension/popup.html',lease,current:()=>fresh,...(gated?{label:()=>"陌生问题甲"}:{}),run});handler(port);
 const intent={type:'begin',token,scanId:crypto.randomUUID(),fieldId:'scan-1:0',requestId:'intent-1'};
 const emit=(v:any)=>{for(const f of [...messages])f(v)};
 return{port,lease,token,intent,emit,sent,run,stale:()=>{fresh=false},navigate:()=>{url+='next'},image:()=>({type:'image',token,requestId:intent.requestId,captureId:sent[0]?.captureId,png})};}
describe('content local capture coordinator',()=>{
 it('requires scoped label receipt before starting workflow or PNG',async()=>{const f=fixture(true);f.emit(f.intent);await tick();expect(f.run).not.toHaveBeenCalled();expect(f.sent[0].type).toBe('label-check');const scope={...f.sent[0]};delete scope.label;f.emit({...scope,type:'label-receipt',allowed:true});await tick();expect(f.sent[1].type).toBe('capture');f.port.disconnect()});
 it('negative label receipt never starts capture',async()=>{const f=fixture(true);f.emit(f.intent);await tick();const scope={...f.sent[0]};delete scope.label;f.emit({...scope,type:'label-receipt',allowed:false});await tick();expect(f.run).not.toHaveBeenCalled();expect(f.lease.holdsPage()).toBe(false)});

 it('requires current owner and one local PNG challenge',async()=>{const f=fixture();f.emit(f.intent);await tick();expect(f.sent[0].type).toBe('capture');f.emit(f.image());await tick();expect(f.sent[1]).toMatchObject({type:'result',result:{safe:true}});expect(f.lease.holdsPage()).toBe(false);});
 it.each(['captureId','token','requestId'])('rejects a foreign %s and ends owned work',async key=>{const f=fixture();f.emit(f.intent);await tick();const image=f.image();(image as any)[key]=key==='requestId'?'other':crypto.randomUUID();f.emit(image);await tick();expect(f.sent).toHaveLength(1);expect(f.lease.holdsPage()).toBe(false)});
 it('rejects stale scan before starting or capturing',async()=>{const f=fixture();f.stale();f.emit(f.intent);await tick();expect(f.run).not.toHaveBeenCalled();expect(f.sent).toHaveLength(0)});
 it('disconnect cancels pending image and forbids late reply',async()=>{const f=fixture();f.emit(f.intent);await tick();const image=f.image();f.port.disconnect();f.emit(image);await tick();expect(f.sent).toHaveLength(1);expect(f.lease.holdsPage()).toBe(false)});
 it('navigation invalidates challenged image',async()=>{const f=fixture();f.emit(f.intent);await tick();f.navigate();f.emit(f.image());await tick();expect(f.sent).toHaveLength(1);expect(f.lease.holdsPage()).toBe(false)});
 it('strict intent rejects injected selectors without running',async()=>{const f=fixture();f.emit({...f.intent,selector:'#unknown'});await tick();expect(f.run).not.toHaveBeenCalled()});
 it('invalid PNG is never delivered to workflow',async()=>{const f=fixture();f.emit(f.intent);await tick();f.emit({...f.image(),png:'data:image/png;base64,AAAA'});await tick();expect(f.sent).toHaveLength(1)});
});
