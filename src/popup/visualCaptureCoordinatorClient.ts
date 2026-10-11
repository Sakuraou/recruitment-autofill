import { semanticRequestSchema, semanticProposalSchema, type SemanticRequest } from '../ai/semanticProtocol';
import { labelChallengeSchema, respondVisualLabelChallenge } from '../shared/visualLabelHandshake';
import { loadAiConnection } from '../ai/connection';
import { hasVisualRequestConsent, loadVisualConsent } from '../ai/visualSettings';
import { z } from 'zod';
import { VISUAL_CAPTURE_COORDINATOR_PORT } from '../content/visualCaptureCoordinator';
import type { AgentPageOwner } from './agentOwnerClient';
import type { MatchResult } from '../shared/types';
import { inspectLocalPng } from '../visual/localPngDecoder';
const id=z.string().regex(/^[A-Za-z\d_:-]{1,100}$/u);
const challenge=z.object({type:z.literal('capture'),token:z.string().uuid(),requestId:id,captureId:z.string().uuid()}).strict();
const match=z.object({fieldId:id,fieldName:z.string().max(500),matchedProfileKey:z.string().max(200).optional(),value:z.string().max(20000).optional(),confidence:z.number().min(0).max(1),source:z.literal('llm'),status:z.literal('review'),reason:z.string().max(2000),sensitive:z.boolean()}).strict();
const result=z.object({type:z.literal('result'),requestId:id,result:z.discriminatedUnion('state',[z.object({state:z.literal('ready'),matches:z.array(match).length(1)}).strict(),z.object({state:z.literal('proposal'),proposal:semanticProposalSchema}).strict(),z.object({state:z.literal('manual'),reason:z.enum(['disabled','stale-page','unavailable','invalid-proposal'])}).strict()])}).strict();
export interface CoordinatorClientPort {onMessage:{addListener(fn:(v:unknown)=>void):void;removeListener?(fn:(v:unknown)=>void):void};onDisconnect:{addListener(fn:()=>void):void;removeListener?(fn:()=>void):void};postMessage(v:unknown):void;disconnect():void}
interface Options {owner:AgentPageOwner;tabId:number;scanId:string;fieldId:string;capture(signal:AbortSignal):Promise<string|undefined>;authorizeLabel?(text:unknown):boolean;semanticRequest?:SemanticRequest;acceptProposal?(proposal:unknown):CoordinatedVisualResult;connect?:(tabId:number,name:string)=>CoordinatorClientPort;deadlineMs?:number}
export type CoordinatedVisualResult={state:'ready';matches:MatchResult[]}|{state:'manual';reason?:'disabled'|'stale-page'|'unavailable'|'invalid-proposal'};
/** One popup intent. Raw PNG stays local; this client never executes model or DOM actions. */
export function runVisualCaptureCoordinator(options:Options):Promise<CoordinatedVisualResult>{
 if(options.owner.signal.aborted||!Number.isSafeInteger(options.tabId)||options.tabId<=0||!id.safeParse(options.scanId).success||!id.safeParse(options.fieldId).success||!z.uuid().safeParse(options.owner.token).success)return Promise.resolve({state:'manual'});
 if(options.semanticRequest&&(!options.authorizeLabel||!options.acceptProposal||!semanticRequestSchema.safeParse(options.semanticRequest).success||options.semanticRequest.fields.length!==1))return Promise.resolve({state:'manual'});
 let port:CoordinatorClientPort;try{port=(options.connect??((tabId,name)=>chrome.tabs.connect(tabId,{name,frameId:0})))(options.tabId,VISUAL_CAPTURE_COORDINATOR_PORT)}catch{return Promise.resolve({state:'manual'})}
 const requestId='visual-'+crypto.randomUUID(),controller=new AbortController();let used=false,delivered=false,done=false,labelAuthorized=false;
 return new Promise(resolve=>{
 const finish=(value:CoordinatedVisualResult)=>{if(done)return;done=true;clearTimeout(timer);controller.abort();options.owner.signal.removeEventListener('abort',abort);port.onMessage.removeListener?.(message);port.onDisconnect.removeListener?.(abort);try{port.disconnect()}catch{/* Port may already be disconnected; local cleanup still completes. */}options.owner.close();resolve(value)};
 const abort=()=>finish({state:'manual'});
 const message=(value:unknown)=>{
  if(done)return;
  const label=labelChallengeSchema.safeParse(value);
  if(label.success){if(used||labelAuthorized||!options.authorizeLabel){abort();return;}
   const receipt=respondVisualLabelChallenge(value,{token:options.owner.token,requestId,scanId:options.scanId,fieldId:options.fieldId},()=>!done&&!options.owner.signal.aborted,options.authorizeLabel);
   if(!receipt||!receipt.allowed){abort();return;}labelAuthorized=true;try{port.postMessage(receipt)}catch{abort()}return;
  }
  const capture=challenge.safeParse(value);
  if(capture.success){if((options.authorizeLabel&&!labelAuthorized)||used||capture.data.token!==options.owner.token||capture.data.requestId!==requestId){abort();return;}used=true;
   void Promise.resolve().then(()=>{if(controller.signal.aborted)throw Error('cancelled');return options.capture(controller.signal)}).then(png=>{if(done)return;if(options.owner.signal.aborted||!png||!inspectLocalPng(png)){abort();return;}delivered=true;port.postMessage({type:'image',token:options.owner.token,requestId,captureId:capture.data.captureId,png})}).catch(abort);return;
  }
  const parsed=result.safeParse(value);if(!parsed.success||parsed.data.requestId!==requestId){abort();return;}
  if(parsed.data.result.state==='proposal'){
    if(!delivered||!labelAuthorized||!options.semanticRequest||!options.acceptProposal||parsed.data.result.proposal.requestId!==options.semanticRequest.requestId){abort();return;}
    const local=options.acceptProposal(parsed.data.result.proposal);if(local.state==='ready'&&local.matches.length===1&&local.matches[0]?.fieldId===options.fieldId)finish(local);else abort();return;
  }
  if(parsed.data.result.state==='ready'){if(options.semanticRequest){abort();return;}if(!delivered||parsed.data.result.matches[0]!.fieldId!==options.fieldId){abort();return;}finish(parsed.data.result)}else finish({state:'manual',reason:parsed.data.result.reason});
 };
 const timer=setTimeout(abort,options.deadlineMs??15_000);options.owner.signal.addEventListener('abort',abort,{once:true});port.onMessage.addListener(message);port.onDisconnect.addListener(abort);
 if(options.owner.signal.aborted){abort();return;}try{port.postMessage({type:'begin',token:options.owner.token,requestId,scanId:options.scanId,fieldId:options.fieldId,...(options.semanticRequest?{semanticRequest:options.semanticRequest}:{})})}catch{abort()}
 });
}

/** Trusted popup preflight: disabled or unreadable local consent creates no capture/semantic port. */
export async function runVisualCaptureWithLocalConsent(options: Options): Promise<CoordinatedVisualResult> {
  try {
    const [connection, visual] = await Promise.all([loadAiConnection(), loadVisualConsent()]);
    if (options.owner.signal.aborted || !hasVisualRequestConsent(connection, visual)) {
      const reason = options.owner.signal.aborted ? 'stale-page' : 'disabled';
      options.owner.close(); return { state: 'manual', reason };
    }
    return runVisualCaptureCoordinator(options);
  } catch { options.owner.close(); return { state: 'manual' }; }
}
