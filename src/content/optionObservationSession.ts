import type {AgentPageLease} from '../agent/pageLease';
import type {ScanState} from './scanner';
import {z} from 'zod';
import {agentOptionFieldIds} from '../agent/optionFieldScope';
import {captureOptionObservation,observeOptions,readOptionObservation,readEmptyOptionObservation,type OptionObservationResult} from './optionObservation';
export interface OptionSessionDependencies {
 extensionId: string; popupUrl: string; lease: AgentPageLease;
 getScan(): ScanState | undefined; occupied(): boolean;
}
export const optionObservationRequestSchema=z.object({type:z.literal('RA_OBSERVE_OPTIONS'),agentRunToken:z.uuid(),
 payload:z.object({scanId:z.uuid(),fieldId:z.string().min(1).max(160)}).strict()}).strict();
const pending=(reason:string):OptionObservationResult=>Object.freeze({status:'pending',reason});
interface OwnedObservation {token:string;scan:ScanState;result:OptionObservationResult;stop:AbortController}
interface OwnedAttempts {token:string;nodes:WeakSet<Element>;count:number;revoked:boolean}
const MAX_OBSERVATIONS=8;
export class OptionObservationSession {
 readonly #deps:OptionSessionDependencies;
 #active?:{token:string;scan:ScanState;stop:AbortController};
 #observed?:OwnedObservation;
 #attempts?:OwnedAttempts;
 constructor(deps: OptionSessionDependencies) {this.#deps=deps;}
 holdsPage(): boolean {return this.#active!==undefined;}
 cancelOwned(): void {
  this.#active?.stop.abort();this.#observed?.stop.abort();this.#observed=undefined;
  if(this.#attempts)this.#attempts.revoked=true;
 }
 stop(token: string): boolean {
  const active=this.#active,observed=this.#observed;
  const ownsAttempts=this.#attempts?.token===token&&!this.#attempts.revoked&&this.#deps.lease.mayWrite(token);
  if(active?.token!==token&&observed?.token!==token&&!ownsAttempts)return false;
  if(active?.token===token)active.stop.abort();
  if(observed?.token===token){observed.stop.abort();this.#observed=undefined;}
  if(this.#attempts?.token===token)this.#attempts.revoked=true;
  return true;
 }
 #current(token:string,scan:ScanState):boolean {
  return this.#deps.lease.holdsPage()&&this.#deps.lease.mayWrite(token)
   &&this.#deps.getScan()===scan&&!this.#deps.occupied();
 }
 #ownedAttempts(token:string):OwnedAttempts {
  if(this.#attempts?.token!==token){
   this.#observed?.stop.abort();this.#observed=undefined;
   this.#attempts={token,nodes:new WeakSet(),count:0,revoked:false};
  }
  return this.#attempts;
 }
 /** Preview uses original DOM identity and never consumes the bounded attempt. */
 nextField(token:string,scan:ScanState):string|undefined {
  try{
   if(this.#active||this.#observed||!this.#current(token,scan))return undefined;
   const attempts=this.#ownedAttempts(token);
   if(attempts.revoked||attempts.count>=MAX_OBSERVATIONS)return undefined;
   return [...agentOptionFieldIds(scan.result)].find(id=>{
    const node=scan.controls.get(id)?.node;
    return node&&!attempts.nodes.has(node)&&captureOptionObservation(scan,id);
   });
  }catch{return undefined;}
 }
 takeScan(token: string): ScanState | undefined {
  const observed=this.#observed;if(!observed||observed.token!==token)return undefined;
  this.#observed=undefined;
  try{
   const fresh=this.#current(token,observed.scan)&&this.#attempts?.token===token&&!this.#attempts.revoked
    ?readOptionObservation(observed.result)??readEmptyOptionObservation(observed.result):undefined;
   if(!fresh&&this.#attempts?.token===token)this.#attempts.revoked=true;
   return fresh;
  }catch{if(this.#attempts?.token===token)this.#attempts.revoked=true;return undefined;}finally{observed.stop.abort();}
 }
 /** Sender and exact scan/field references are checked locally before acquiring a one-shot capability. */
 async run(request: unknown, sender: {id?:string;url?:string}): Promise<OptionObservationResult> {
  try{
   if(sender.id!==this.#deps.extensionId||sender.url?.split(/[?#]/u)[0]!==this.#deps.popupUrl)return pending('untrusted-source');
   const parsed=optionObservationRequestSchema.safeParse(request);if(!parsed.success)return pending('invalid-request');
   if(this.#active)return pending('observation-busy');
   const token=parsed.data.agentRunToken,scan=this.#deps.getScan();
   if(!scan||scan.result.scanId!==parsed.data.payload.scanId||!this.#current(token,scan)
    ||!agentOptionFieldIds(scan.result).has(parsed.data.payload.fieldId))return pending('stale-owner-or-scan');
   const attempts=this.#ownedAttempts(token);
   if(attempts.revoked)return pending('observation-cancelled');
   if(this.#observed)return pending('observation-result-pending');
   const node=scan.controls.get(parsed.data.payload.fieldId)?.node;
   if(node&&attempts.nodes.has(node))return pending('observation-already-attempted');
   if(attempts.count>=MAX_OBSERVATIONS)return pending('observation-budget-exhausted');
   const cap=captureOptionObservation(scan,parsed.data.payload.fieldId);if(!cap)return pending('observation-unavailable');
   if(!node)return pending('observation-unavailable');
   attempts.nodes.add(node);attempts.count++;
   const active={token,scan,stop:new AbortController()};this.#active=active;
   try{
    // Keep the owner/scan/stop evidence valid until private takeScan, including
    // after finally releases the execution lock. The aborted signal and revoked
    // ledger prevent an ended or replaced owner from reviving this proof.
    const result=await observeOptions(cap,active.stop.signal,()=>this.#attempts===attempts&&!attempts.revoked&&this.#current(token,scan));
    if(active.stop.signal.aborted||!this.#current(token,scan)){attempts.revoked=true;return pending('observation-cancelled');}
    if(readOptionObservation(result)??readEmptyOptionObservation(result))this.#observed={token,scan,result,stop:active.stop};
    else{attempts.revoked=true;active.stop.abort();if(result.status==='observed')return pending('observation-invalidated');}
    return result;
   }finally{if(this.#active===active)this.#active=undefined;}
  }catch{return pending('observation-unavailable');}
 }
}
