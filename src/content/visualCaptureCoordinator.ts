import { semanticRequestSchema } from '../ai/semanticProtocol';
import { createVisualLabelHandshake } from '../shared/visualLabelHandshake';
import { z } from 'zod';
import type { AgentPageLease } from '../agent/pageLease';
import { inspectLocalPng } from '../visual/localPngDecoder';
export const VISUAL_CAPTURE_COORDINATOR_PORT = 'recruitment.visual-capture-owner.v1';
const id = z.string().regex(/^[A-Za-z\d_:-]{1,100}$/u);
const startSchema = z.object({ type:z.literal('begin'), token:z.string().uuid(), scanId:id, fieldId:id, requestId:id, semanticRequest:semanticRequestSchema.optional() }).strict();
const imageSchema = z.object({ type:z.literal('image'), token:z.string().uuid(), requestId:id, captureId:z.string().uuid(), png:z.string().max(11_184_812) }).strict();
export type CaptureIntent = z.infer<typeof startSchema>;
interface Port {name:string;sender?:{id?:string;url?:string;frameId?:number};onMessage:{addListener(fn:(v:unknown)=>void):void;removeListener?(fn:(v:unknown)=>void):void};onDisconnect:{addListener(fn:()=>void):void;removeListener?(fn:()=>void):void};postMessage(v:unknown):void;disconnect():void}
interface Dependencies {extensionId:string;popupUrl:string;lease:AgentPageLease; current(intent:CaptureIntent):boolean; label?(intent:CaptureIntent):string|undefined; run(intent:CaptureIntent,capture:(signal:AbortSignal)=>Promise<string|undefined>,signal:AbortSignal):Promise<unknown>;deadlineMs?:number}
/** Local-only port. A current content scan chooses the field; popup supplies exactly one challenged PNG. */
export function createVisualCaptureCoordinator(deps:Dependencies):(port:Port)=>void {
 const owners=new Set<string>();
 return port=>{
  if(port.name!==VISUAL_CAPTURE_COORDINATOR_PORT)return;
  if(port.sender?.id!==deps.extensionId||port.sender.url?.split(/[?#]/u)[0]!==deps.popupUrl||(port.sender.frameId!==undefined&&port.sender.frameId!==0)){port.disconnect();return;}
  let intent:CaptureIntent|undefined,closed=false,pending:{id:string;resolve:(png:string|undefined)=>void;remove:()=>void}|undefined;
  const controller=new AbortController();
  const live=()=>!closed&&!!intent&&deps.lease.mayWrite(intent.token)&&deps.current(intent);
  const finish=()=>{if(closed)return;closed=true;clearTimeout(timer);controller.abort();pending?.remove();pending?.resolve(undefined);pending=undefined;removeEnd();port.onMessage.removeListener?.(message);port.onDisconnect.removeListener?.(finish);if(intent){owners.delete(intent.token);deps.lease.end(intent.token,'disconnect');}try{port.disconnect();}catch{/* Port may already be disconnected; local cleanup still completes. */}};
  const removeEnd=deps.lease.onEnd(()=>{if(intent&&!deps.lease.mayWrite(intent.token))finish();});
  const capture=(signal:AbortSignal)=>new Promise<string|undefined>(resolve=>{
   if(!live()||signal.aborted||pending||captured){resolve(undefined);return;}
   captured=true;const captureId=crypto.randomUUID();const abort=()=>finish();signal.addEventListener('abort',abort,{once:true});pending={id:captureId,resolve,remove:()=>signal.removeEventListener('abort',abort)};
   try{port.postMessage({type:'capture',token:intent!.token,requestId:intent!.requestId,captureId});}catch{finish();}
  });
  let captured=false;let labelGate:ReturnType<typeof createVisualLabelHandshake>;
  const execute=()=>{void Promise.resolve().then(()=>{if(!live())throw Error('stale');return deps.run(intent!,capture,controller.signal)}).then(result=>{if(live())port.postMessage({type:'result',requestId:intent!.requestId,result});}).catch(()=>{}).finally(finish)};
  const message=(value:unknown)=>{
   if(closed)return;
   if(!intent){const parsed=startSchema.safeParse(value);if(!parsed.success||!deps.lease.mayWrite(parsed.data.token)||owners.has(parsed.data.token)||!deps.current(parsed.data)){finish();return;}
    intent=parsed.data;owners.add(intent.token);
    if(deps.label){const label=deps.label(intent);labelGate=label===undefined?undefined:createVisualLabelHandshake({token:intent.token,requestId:intent.requestId,scanId:intent.scanId,fieldId:intent.fieldId},label,live);if(!labelGate){finish();return;}try{port.postMessage(labelGate.challenge)}catch{finish()}}else execute();return;
   }
   if(labelGate){const gate=labelGate;labelGate=undefined;if(!gate.accept(value)){finish();return;}execute();return;}
   const parsed=imageSchema.safeParse(value);
   if(!parsed.success||!live()||!pending||parsed.data.token!==intent.token||parsed.data.requestId!==intent.requestId||parsed.data.captureId!==pending.id||!inspectLocalPng(parsed.data.png)){finish();return;}
   const current=pending;pending=undefined;current.remove();current.resolve(parsed.data.png);
  };
  const timer=setTimeout(finish,deps.deadlineMs??15_000);port.onMessage.addListener(message);port.onDisconnect.addListener(finish);
 };
}
