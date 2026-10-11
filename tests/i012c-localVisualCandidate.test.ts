// @vitest-environment jsdom
import { describe,it,expect } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { createEmptyProfile } from '../src/profile/schema';
import { prepareLocalVisualCandidate } from '../src/popup/localVisualCandidate';
function fixture(){document.body.innerHTML='<form><section><h2>个人信息</h2><label for="opaque">陌生问题甲</label><input id="opaque"></section></form>';const context={scan:scanDocument().result,profile:createEmptyProfile()};context.profile.basic.name='本机虚构姓名';let live=true;const field=context.scan.fields[0]!.id;const attempt=prepareLocalVisualCandidate(context,field,()=>context,()=>live)!;expect(attempt).toBeDefined();const f=attempt.request.fields[0]!;const proposal={requestId:attempt.request.requestId,status:'mapped',bindings:[{ref:f.ref,fingerprint:f.fingerprint,path:'basic.name',certainty:'certain',evidence:'label'}]};return{context,attempt,proposal,stop:()=>{live=false}}}
describe('trusted popup local visual candidate',()=>{
 it('requires label authorization before accepting valid proposal',()=>{const f=fixture();expect(f.attempt.accept(f.proposal)).toEqual({state:'manual'})});
 it('refuses substituted label and duplicate authorization',()=>{const f=fixture();expect(f.attempt.authorizeLabel('其他字段')).toBe(false);expect(f.attempt.authorizeLabel('陌生问题甲')).toBe(true);expect(f.attempt.authorizeLabel('陌生问题甲')).toBe(false)});
 it('never authorizes label containing private fact from initial profile',()=>{const f=fixture();f.context.profile.basic.name='陌生问题甲';const attempt=prepareLocalVisualCandidate(f.context,f.context.scan.fields[0]!.id,()=>f.context,()=>true);expect(attempt?.authorizeLabel('陌生问题甲') ?? false).toBe(false)});

 it('exposes only semantic request and resolves real local value once',()=>{const f=fixture();expect(f.attempt.authorizeLabel('陌生问题甲')).toBe(true);expect(JSON.stringify(f.attempt.request)).not.toContain(f.context.profile.basic.name);expect(f.attempt.accept(f.proposal)).toMatchObject({state:'ready',matches:[{value:'本机虚构姓名',status:'review'}]});expect(f.attempt.accept(f.proposal)).toEqual({state:'manual'})});
 it('rejects local profile changed during image inference',()=>{const f=fixture();expect(f.attempt.authorizeLabel('陌生问题甲')).toBe(true);f.context.profile.basic.name='手改';expect(f.attempt.accept(f.proposal)).toEqual({state:'manual'})});
 it('rejects owner or consent ended',()=>{const f=fixture();expect(f.attempt.authorizeLabel('陌生问题甲')).toBe(true);f.stop();expect(f.attempt.accept(f.proposal)).toEqual({state:'manual'})});
 it('rejects replaced scan snapshot',()=>{const f=fixture();expect(f.attempt.authorizeLabel('陌生问题甲')).toBe(true);f.context.scan=scanDocument().result;expect(f.attempt.accept(f.proposal)).toEqual({state:'manual'})});
});

