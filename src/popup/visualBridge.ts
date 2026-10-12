import type { VisualOutcome, VisualSkipReason } from './visualOutcome';
import { UNKNOWN_FIELD_REASON } from '../matching/ruleMatcher';
import { currentTab, type PagePlan } from './bridge';
import { loadProfile, PROFILE_STORAGE_KEY } from '../profile/storage';
import { AI_CONNECTION_KEY } from '../ai/connection';
import { openAgentPageOwner } from './agentOwnerClient';
import { captureLocalPng } from './localCaptureClient';
import { runVisualCaptureWithLocalConsent } from './visualCaptureCoordinatorClient';
import { prepareLocalVisualCandidate } from './localVisualCandidate';
/** Bounded screenshot fallback. Produces review candidates; does not apply or submit. */
export async function identifyVisualUnknowns(plan:PagePlan,signal:AbortSignal,allowedFieldIds?:ReadonlySet<string>):Promise<{plan:PagePlan;identified:number;outcome:VisualOutcome}>{
 const tab=await currentTab();if(tab.id!==plan.tabId||tab.url!==plan.scan.url||tab.windowId===undefined)throw Error('网页已变化，请重新扫描');
 const profile=await loadProfile();if(JSON.stringify(profile)!==JSON.stringify(plan.profile))throw Error('档案已变化，请重新扫描');
 let dirty=false;const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
 const changed=(changes:Record<string,chrome.storage.StorageChange>,area:string)=>{if(area==='local'&&[PROFILE_STORAGE_KEY,AI_CONNECTION_KEY,'recruitment.visual.consent.v1'].some(key=>key in changes)){dirty=true;controller.abort()}};
 chrome.storage.onChanged.addListener(changed);const matches=[...plan.matches];let identified=0;const skipped:VisualOutcome['skipped']={};const skip=(reason:VisualSkipReason)=>{skipped[reason]=(skipped[reason]??0)+1};
 const eligible=plan.scan.fields.filter(f=>(!allowedFieldIds||allowedFieldIds.has(f.id))&&!f.hasValue&&!f.disabled&&!f.readOnly&&!f.blockedReason).filter(f=>plan.matches.find(m=>m.fieldId===f.id)?.reason===UNKNOWN_FIELD_REASON);
 if(eligible.length>3)skipped.budget=eligible.length-3;
 try{
  for(const field of eligible.slice(0,3)){
   if(signal.aborted||controller.signal.aborted||dirty)break;
   const verified=await chrome.tabs.sendMessage(tab.id,{type:'RA_VERIFY_SCAN',payload:{scanId:plan.scan.scanId}});if(!verified?.ok)throw Error('网页已变化，请重新扫描');
   const owner=await openAgentPageOwner(tab.id,controller.signal);
   try{
    const context={scan:plan.scan,profile};const local=prepareLocalVisualCandidate(context,field.id,()=>dirty?undefined:context,()=>!owner.signal.aborted&&!controller.signal.aborted);
    if(!local){skip('local-scope');continue;}
    const result=await runVisualCaptureWithLocalConsent({owner,tabId:tab.id,scanId:plan.scan.scanId,fieldId:field.id,
     semanticRequest:local.request as import('../ai/semanticProtocol').SemanticRequest,authorizeLabel:local.authorizeLabel,acceptProposal:local.accept,
     capture:s=>captureLocalPng({target:{tabId:tab.id,windowId:tab.windowId,url:tab.url!},signal:s})});
    if(result.state==='ready'&&!dirty&&!signal.aborted){const candidate=result.matches[0]!;const index=matches.findIndex(m=>m.fieldId===field.id);if(index>=0)matches[index]=candidate;else matches.push(candidate);identified++}else if(result.state==='manual'){skip(result.reason??'unavailable')}
   }finally{owner.close()}
  }
  if(dirty||signal.aborted)throw Error('识别已取消或档案设置已变化，请重新扫描');
  return{plan:{...plan,matches},identified,outcome:{identified,eligible:eligible.length,skipped}};
 }finally{chrome.storage.onChanged.removeListener(changed);signal.removeEventListener('abort',abort);controller.abort()}
}

