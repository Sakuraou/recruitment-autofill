import { createVisualCaptureCoordinator } from './visualCaptureCoordinator';
import { requestVisualSemanticFromContent } from './visualSemanticClient';
import { verifyScanObservation } from './scanFreshness';
import type { ScanState } from './scanner';
import type { AgentPageLease } from '../agent/pageLease';
import { SemanticCropAdmission } from '../visual/semanticCropAdmission';
import { SemanticRedactionPipeline } from '../visual/semanticRedactionPipeline';
import { createLocalPngEncoder } from '../visual/localPngEncoder';
import { runSemanticVisualImage } from '../visual/semanticVisualImageWorkflow';
import { currentShadowPaintAbsent } from '../visual/shadowPaint';
interface Dependencies {lease:AgentPageLease;getScan():ScanState|undefined;occupied():boolean;extensionId:string;popupUrl:string}
/** Production composition: only semantic request and redacted pixels cross content; profiles stay trusted. */
export function createProfileFreeVisualCoordinator(deps:Dependencies){
 const current=(intent:{token:string;scanId:string;fieldId:string})=>!deps.occupied()&&deps.lease.mayWrite(intent.token)
  &&deps.getScan()?.result.scanId===intent.scanId&&!!deps.getScan()?.controls.has(intent.fieldId)&&!!verifyScanObservation(deps.getScan()!);
 return createVisualCaptureCoordinator({...deps,current,label:intent=>deps.getScan()?.result.fields.find(f=>f.id===intent.fieldId)?.label,
  run:async(intent,capture,signal)=>{
   const scan=deps.getScan();if(!scan||!intent.semanticRequest||intent.semanticRequest.fields.length!==1||!current(intent))return {state:'manual',reason:'unavailable'};
   let changed=false;const cancel=()=>{changed=true;deps.lease.end(intent.token)};
   const observer=new MutationObserver(cancel);observer.observe(scan.document.documentElement,{subtree:true,attributes:true,characterData:true,childList:true});
   scan.document.addEventListener('input',cancel,true);scan.document.addEventListener('change',cancel,true);signal.addEventListener('abort',cancel,{once:true});
   const live=()=>!changed&&!signal.aborted&&!observer.takeRecords().length&&deps.getScan()===scan&&current(intent)&&currentShadowPaintAbsent();
   const shadowWatch=setInterval(()=>{if(!live())cancel()},250);
   try{
    const admission=new SemanticCropAdmission({lease:deps.lease,getScan:deps.getScan,occupied:deps.occupied,privateFacts:()=>[],
     labelPermission:(token,id,label)=>live()&&token===intent.token&&id===intent.fieldId&&label===scan.result.fields.find(f=>f.id===id)?.label,
     viewport:()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollX,scrollY,visualScale:visualViewport?.scale??1,offsetLeft:visualViewport?.offsetLeft??0,offsetTop:visualViewport?.offsetTop??0})});
    const pixels=await runSemanticVisualImage({lease:deps.lease,token:intent.token,fieldId:intent.fieldId,getScan:deps.getScan,admission,pipeline:new SemanticRedactionPipeline(admission),encoder:createLocalPngEncoder(),enabled:true,userConfirmed:true,capture,signal});
    if(pixels.state!=='ready')return {state:'manual',reason:pixels.reason};
    if(!live())return {state:'manual',reason:'stale-page'};
    const result=await requestVisualSemanticFromContent({lease:deps.lease,token:intent.token,request:intent.semanticRequest,image:pixels.image,userConfirmed:true});
    if(!live())return {state:'manual',reason:'stale-page'};
    if(result.state==='ready')return {state:'proposal',proposal:result.proposal};
    return {state:'manual',reason:result.reason==='invalid-output'?'invalid-proposal':result.reason==='disabled'?'disabled':result.reason==='owner-ended'||result.reason==='cancelled'?'stale-page':'unavailable'};
   }finally{clearInterval(shadowWatch);observer.disconnect();scan.document.removeEventListener('input',cancel,true);scan.document.removeEventListener('change',cancel,true);signal.removeEventListener('abort',cancel)}
  }});
}

