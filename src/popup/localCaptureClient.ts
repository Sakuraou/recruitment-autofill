import { z } from 'zod';
import { MV3_CAPTURE_PORT, type CapturePort } from '../visual/mv3CaptureBackgroundPort';
import { inspectLocalPng } from '../visual/localPngDecoder';
import type { VisualCaptureTarget } from './visualSemanticCapture';
const targetSchema=z.object({tabId:z.number().int().positive().safe(),windowId:z.number().int().nonnegative().safe(),url:z.string().max(4096).regex(/^https?:\/\//u)}).strict();
const replySchema=z.object({ok:z.literal(true),data:z.object({requestId:z.string(),dataUrl:z.string().max(11_184_812)}).strict()}).strict();
interface Options{target:VisualCaptureTarget;signal:AbortSignal;connect?:(name:string)=>CapturePort;deadlineMs?:number}
/** Raw capture is exclusively local. It has no redacted-image brand and cannot be passed to a visual provider. */
export function captureLocalPng(options:Options):Promise<string|undefined>{
 if(options.signal.aborted||!targetSchema.safeParse(options.target).success)return Promise.resolve(undefined);
 let port:CapturePort;try{port=(options.connect??(name=>chrome.runtime.connect({name})))(MV3_CAPTURE_PORT)}catch{return Promise.resolve(undefined)}
 const requestId='local-'+crypto.randomUUID();let done=false;
 return new Promise(resolve=>{
  const finish=(png?:string)=>{if(done)return;done=true;clearTimeout(timer);options.signal.removeEventListener('abort',abort);port.onMessage.removeListener?.(message);port.onDisconnect.removeListener?.(abort);try{port.disconnect()}catch{/* Port may already be disconnected; local cleanup still completes. */}resolve(png)};
  const abort=()=>finish();
  const message=(value:unknown)=>{if(done)return;const parsed=replySchema.safeParse(value);if(!parsed.success||parsed.data.data.requestId!==requestId||options.signal.aborted||!inspectLocalPng(parsed.data.data.dataUrl)){abort();return;}finish(parsed.data.data.dataUrl)};
  const timer=setTimeout(abort,options.deadlineMs??10_000);options.signal.addEventListener('abort',abort,{once:true});port.onMessage.addListener(message);port.onDisconnect.addListener(abort);
  if(options.signal.aborted){abort();return;}try{port.postMessage({type:'capture',requestId,target:options.target})}catch{abort()}
 });
}
