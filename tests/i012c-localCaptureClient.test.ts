/* eslint-disable @typescript-eslint/no-explicit-any -- Adversarial wire fixtures intentionally construct malformed protocol messages. */
import{describe,it,expect,vi}from'vitest';import{captureLocalPng}from'../src/popup/localCaptureClient';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(){const messages=new Set<(v:unknown)=>void>(),disconnects=new Set<()=>void>(),sent:any[]=[];const controller=new AbortController();const port={name:'',onMessage:{addListener:(f:any)=>messages.add(f),removeListener:(f:any)=>messages.delete(f)},onDisconnect:{addListener:(f:any)=>disconnects.add(f),removeListener:(f:any)=>disconnects.delete(f)},postMessage:(v:any)=>sent.push(v),disconnect:vi.fn()};const task=captureLocalPng({target:{tabId:1,windowId:0,url:'https://fixture.local/'},signal:controller.signal,connect:()=>port});return{task,controller,port,sent,emit:(v:any)=>{for(const f of [...messages])f(v)},reply:()=>({ok:true,data:{requestId:sent[0].requestId,dataUrl:png}})}}
describe('local PNG capture transport',()=>{
 it('returns only matching valid local PNG',async()=>{const f=fixture();f.emit(f.reply());expect(await f.task).toBe(png);expect(f.port.disconnect).toHaveBeenCalledOnce()});
 it('wrong request cannot deliver a capture',async()=>{const f=fixture();const r=f.reply();r.data.requestId='other';f.emit(r);expect(await f.task).toBeUndefined()});
 it('rejects malformed PNG even when reply claims success',async()=>{const f=fixture();const r=f.reply();r.data.dataUrl='data:image/png;base64,AAAA';f.emit(r);expect(await f.task).toBeUndefined()});
 it('abort resolves locally without relying on own disconnect event',async()=>{const f=fixture();f.controller.abort();f.emit(f.reply());expect(await f.task).toBeUndefined();expect(f.port.disconnect).toHaveBeenCalledOnce()});
 it('strict reply rejects extra model or execution payload',async()=>{const f=fixture();f.emit({...f.reply(),script:'alert(1)'});expect(await f.task).toBeUndefined()});
});
