import {expect,it,vi} from 'vitest';
import {createVisualLoopbackProvider} from '../src/ai/visualLoopbackProvider';
import {SEMANTIC_BINDING_PATHS,semanticRequestSchema} from '../src/ai/semanticProtocol';
import {AgentPageLease} from '../src/agent/pageLease';
import {requestVisualSemanticFromContent,type VisualContentPort} from '../src/content/visualSemanticClient';
const request=semanticRequestSchema.parse({protocol:1,requestId:'00000000-0000-4000-8000-000000000001',allowedPaths:[...SEMANTIC_BINDING_PATHS],fields:[{ref:'field-0',fingerprint:'abcdef0123456789',kind:'input',type:'text',section:'basic',record:'none',label:'陌生问题甲',ariaLabel:'',tableHeader:'',title:'',placeholder:'',options:[]}]});
const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,73,72,68,82]);
const image={mime:'image/png' as const,redacted:true as const,bytes};
const connection={protocol:1,token:'a'.repeat(64)};
it.each([
 ['unavailable','unavailable'],['timeout','unavailable'],['busy','unavailable'],['invalid-output','invalid-output'],['refused','invalid-output'],['cancelled','cancelled'],['disabled','unavailable'],
])('preserves local provider state %s as fixed %s',async(state,expected)=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({state,proposal:null}),{status:200}));
 expect(await createVisualLoopbackProvider(connection,fetcher)(request,image,new AbortController().signal)).toEqual({state:expected,proposal:null});
 expect(fetcher).toHaveBeenCalledOnce();
});
it.each([
 {},{state:'ready',proposal:{answer:'私人答案'}},{state:'invalid-output',proposal:null,reason:'私人解释'},{state:'unknown-private-reason',proposal:null},
])('rejects invalid or extra envelope contents without exposing prose',async value=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(value),{status:200}));
 expect(await createVisualLoopbackProvider(connection,fetcher)(request,image,new AbortController().signal)).toEqual({state:'invalid-output',proposal:null});
});
it('keeps HTTP service failure separate from invalid model output',async()=>{
 const fetcher=vi.fn(async()=>new Response('{}',{status:503}));
 expect((await createVisualLoopbackProvider(connection,fetcher)(request,image,new AbortController().signal)).state).toBe('unavailable');
});
it.each([['invalid-output','invalid-output'],['disabled','unavailable'],['timeout','unavailable'],['unavailable','unavailable']])('preserves local 503 %s as %s without allowing a proposal',async(state,expected)=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({state,proposal:null}),{status:503}));
 expect((await createVisualLoopbackProvider(connection,fetcher)(request,image,new AbortController().signal)).state).toBe(expected);
});
it('never accepts a ready proposal on a non-success HTTP response',async()=>{
 const proposal={requestId:request.requestId,status:'mapped',bindings:[{ref:'field-0',fingerprint:'abcdef0123456789',path:'basic.name',certainty:'certain',evidence:'label'}]};
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({state:'ready',proposal}),{status:503}));
 expect((await createVisualLoopbackProvider(connection,fetcher)(request,image,new AbortController().signal)).state).toBe('unavailable');
});
it('does not infer or fetch after an already ended owner',async()=>{
 const controller=new AbortController();controller.abort();const fetcher=vi.fn();
 expect((await createVisualLoopbackProvider(connection,fetcher)(request,image,controller.signal)).state).toBe('cancelled');expect(fetcher).not.toHaveBeenCalled();
});
it.each([['rejected','invalid-output'],['unavailable','unavailable'],['disabled','disabled'],['cancelled','cancelled']])('content preserves fixed background %s as %s',async(state,expected)=>{
 const lease=new AgentPageLease(()=> 'https://fictional.invalid/form',()=>false),token=lease.begin();let listener:((value:unknown)=>void)|undefined;
 const port:VisualContentPort={onMessage:{addListener:f=>{listener=f},removeListener:()=>{listener=undefined}},onDisconnect:{addListener:()=>{},removeListener:()=>{}},postMessage:vi.fn(),disconnect:vi.fn()};
 const task=requestVisualSemanticFromContent({lease,token,request,image:{mime:'image/png',redacted:true,data:'data:image/png;base64,'+btoa(String.fromCharCode(...bytes))},userConfirmed:true,connect:()=>port});
 listener?.({state});expect(await task).toEqual({state:'manual',reason:expected});expect(port.disconnect).toHaveBeenCalledOnce();
});
