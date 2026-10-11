import { z } from 'zod';
const id=z.string().regex(/^[A-Za-z\d_:-]{1,100}$/u);
const scope=z.object({token:z.uuid(),requestId:id,scanId:z.uuid(),fieldId:id}).strict();
export type VisualLabelScope=z.infer<typeof scope>;
export const labelChallengeSchema=scope.extend({type:z.literal('label-check'),challengeId:z.uuid(),label:z.string().min(1).max(120)}).strict();
export const labelReceiptSchema=scope.extend({type:z.literal('label-receipt'),challengeId:z.uuid(),allowed:z.boolean()}).strict();
/** One-use local handshake. No profile, selector, image, model path or applicant value. */
export function createVisualLabelHandshake(input:VisualLabelScope,label:string,live:()=>boolean){
 const base=scope.safeParse(input);if(!base.success||!live())return undefined;
 const parsed=labelChallengeSchema.safeParse({...base.data,type:'label-check',challengeId:crypto.randomUUID(),label});
 if(!parsed.success)return undefined;let consumed=false;
 return Object.freeze({challenge:Object.freeze(parsed.data),accept(value:unknown){
  if(consumed)return false;consumed=true;const response=labelReceiptSchema.safeParse(value);
  return live()&&response.success&&response.data.allowed&&Object.entries(base.data).every(([key,v])=>response.data[key as keyof VisualLabelScope]===v)
   &&response.data.challengeId===parsed.data.challengeId;
 }});
}
/** Trusted popup supplies only a scoped boolean; local profile stays in authorizeLabel closure. */
export function respondVisualLabelChallenge(value:unknown,expected:VisualLabelScope,live:()=>boolean,authorizeLabel:(text:unknown)=>boolean){
 const parsed=labelChallengeSchema.safeParse(value),base=scope.safeParse(expected);
 if(!parsed.success||!base.success||!live()||!Object.entries(base.data).every(([key,v])=>parsed.data[key as keyof VisualLabelScope]===v))return undefined;
 const allowed=authorizeLabel(parsed.data.label)&&live();
 return Object.freeze({...base.data,type:'label-receipt' as const,challengeId:parsed.data.challengeId,allowed});
}
