import type {AgentPageLease} from '../agent/pageLease';
import type {ScanState} from './scanner';
import {z} from 'zod';
import {agentOptionFieldIds} from '../agent/optionFieldScope';
import {captureOptionObservation,observeOptions,readOptionObservation,type OptionObservationResult} from './optionObservation';
export interface OptionSessionDependencies {
 extensionId: string; popupUrl: string; lease: AgentPageLease;
 getScan(): ScanState | undefined; occupied(): boolean;
}
export const optionObservationRequestSchema=z.object({type:z.literal('RA_OBSERVE_OPTIONS'),agentRunToken:z.uuid(),
 payload:z.object({scanId:z.uuid(),fieldId:z.string().min(1).max(160)}).strict()}).strict();
const pending=(reason:string):OptionObservationResult=>Object.freeze({status:'pending',reason});
interface OwnedObservation {token:string;scan:ScanState;result:OptionObservationResult}
export class OptionObservationSession {
 readonly #deps:OptionSessionDependencies;
 #active?:{token:string;scan:ScanState;stop:AbortController};
 #observed?:OwnedObservation;
 constructor(deps: OptionSessionDependencies) {this.#deps=deps;}
 holdsPage(): boolean {return this.#active!==undefined;}
 cancelOwned(): void {
  this.#active?.stop.abort();this.#observed=undefined;
 }
 stop(token: string): boolean {
  const active=this.#active,observed=this.#observed;
  if(active?.token!==token&&observed?.token!==token)return false;
  if(active?.token===token)active.stop.abort();
  if(observed?.token===token)this.#observed=undefined;
  return true;
 }
 #current(token:string,scan:ScanState):boolean {
  return this.#deps.lease.holdsPage()&&this.#deps.lease.mayWrite(token)
   &&this.#deps.getScan()===scan&&!this.#deps.occupied();
 }
 takeScan(token: string): ScanState | undefined {
  const observed=this.#observed;if(!observed||observed.token!==token)return undefined;
  this.#observed=undefined;
  try{return this.#current(token,observed.scan)?readOptionObservation(observed.result):undefined;}catch{return undefined;}
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
   const cap=captureOptionObservation(scan,parsed.data.payload.fieldId);if(!cap)return pending('observation-unavailable');
   this.#observed=undefined;
   const active={token,scan,stop:new AbortController()};this.#active=active;
   try{
    const result=await observeOptions(cap,active.stop.signal,()=>this.#active===active&&this.#current(token,scan));
    if(active.stop.signal.aborted||!this.#current(token,scan))return pending('observation-cancelled');
    if(result.status==='observed')this.#observed={token,scan,result};
    return result;
   }finally{if(this.#active===active)this.#active=undefined;}
  }catch{return pending('observation-unavailable');}
 }
}
