import {afterEach,expect,it} from 'vitest';
import {AgentPageLease} from '../src/agent/pageLease';
import {scanDocument} from '../src/content/scanner';
import {OptionObservationSession} from '../src/content/optionObservationSession';
afterEach(()=>{document.body.innerHTML='';});
function setup(delay=15){
 document.body.innerHTML='<label for="c">招聘选项</label><button id="c" type="button" role="combobox" aria-expanded="false" aria-controls="l">请选择</button><div role="listbox" id="l" hidden></div>';
 const node=document.querySelector<HTMLElement>('#c')!,list=document.querySelector<HTMLElement>('#l')!;let clicks=0,occupied=false;
 node.addEventListener('click',()=>{clicks++;node.setAttribute('aria-expanded','true');list.hidden=false;setTimeout(()=>{list.innerHTML='<div role="option" data-value="private">选项</div>';},delay);});
 const scan=scanDocument(),id=[...scan.controls].find(([,control])=>control.node===node)?.[0]??'';let current=scan;
 const lease=new AgentPageLease(()=>document.URL,()=>occupied),token=lease.begin(),sender={id:'fixture-extension',url:'chrome-extension://fixture-extension/popup.html'};
 const session=new OptionObservationSession({extensionId:sender.id,popupUrl:sender.url,lease,getScan:()=>current,occupied:()=>occupied});
 const request={type:'RA_OBSERVE_OPTIONS',agentRunToken:token,payload:{scanId:scan.result.scanId,fieldId:id}};
 return {session,lease,token,request,sender,scan,node,list,count:()=>clicks,block:()=>{occupied=true;},rescan:()=>{current=scanDocument();}};
}
it('fixed owned observation yields one fresh private scan and no serialized labels',async()=>{
 const s=setup(),result=await s.session.run(s.request,s.sender);expect(result).toEqual({status:'observed',optionCount:1});expect(s.count()).toBe(1);expect(s.session.holdsPage()).toBe(false);
 const fresh=s.session.takeScan(s.token);expect(fresh?.result.scanId).not.toBe(s.scan.result.scanId);expect(fresh?.controls.size).toBe(1);expect(s.session.takeScan(s.token)).toBeUndefined();expect(JSON.stringify(result)).not.toMatch(/选项|private/u);
});
it.each(['source-id','source-url','selector','answer','extra-payload','wrong-token','missing-token','wrong-scan','wrong-field','occupied'] as const)('rejects %s without opening',async mode=>{
 const s=setup();const request:Record<string,unknown>={...s.request,payload:{...s.request.payload}};const sender={...s.sender};
 if(mode==='source-id')sender.id='foreign';if(mode==='source-url')sender.url='https://website.invalid/';if(mode==='selector')request.selector='button';if(mode==='answer')request.answer='yes';
 if(mode==='extra-payload')request.payload={...s.request.payload,value:'yes'};if(mode==='wrong-token')request.agentRunToken=crypto.randomUUID();if(mode==='missing-token')delete request.agentRunToken;
 if(mode==='wrong-scan')request.payload={...s.request.payload,scanId:crypto.randomUUID()};if(mode==='wrong-field')request.payload={...s.request.payload,fieldId:'#c'};if(mode==='occupied')s.block();
 expect((await s.session.run(request,sender)).status).toBe('pending');expect(s.count()).toBe(0);expect(s.session.takeScan(s.token)).toBeUndefined();
});
it.each(['stop','owner-close','rescan','other-flow'] as const)('cancels %s and discards late options',async mode=>{
 const s=setup(100);const running=s.session.run(s.request,s.sender);expect(s.session.holdsPage()).toBe(true);
 expect((await s.session.run(s.request,s.sender)).status).toBe('pending');expect(s.count()).toBe(1);
 expect(s.session.stop(crypto.randomUUID())).toBe(false);
 if(mode==='stop')expect(s.session.stop(s.token)).toBe(true);if(mode==='owner-close'){s.lease.end(s.token);s.session.stop(s.token);}if(mode==='rescan')s.rescan();if(mode==='other-flow')s.block();
 expect((await running).status).toBe('pending');expect(s.session.takeScan(s.token)).toBeUndefined();expect(s.count()).toBe(1);expect(s.session.holdsPage()).toBe(false);
});
it('stale private result or a different owner cannot retrieve a fresh scan',async()=>{
 const s=setup();expect((await s.session.run(s.request,s.sender)).status).toBe('observed');expect(s.session.takeScan(crypto.randomUUID())).toBeUndefined();
 s.list.firstElementChild!.replaceWith(s.list.firstElementChild!.cloneNode(true));expect(s.session.takeScan(s.token)).toBeUndefined();
});
