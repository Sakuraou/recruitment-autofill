import {afterEach, expect, it} from 'vitest';
import {AgentPageLease} from '../src/agent/pageLease';
import {scanDocument, type ScanState} from '../src/content/scanner';
import {OptionObservationSession} from '../src/content/optionObservationSession';

afterEach(()=>{document.body.innerHTML='';});
function setup(count=2, emptyFirst=true){
 document.body.innerHTML=Array.from({length:count},(_,i)=>'<label for="c'+i+'">招聘选项'+i+'</label><button id="c'+i+'" type="button" role="combobox" aria-expanded="false" aria-controls="l'+i+'">请选择</button><div role="listbox" id="l'+i+'" hidden></div>').join('');
 const nodes=[...document.querySelectorAll<HTMLElement>('[role="combobox"]')],lists=[...document.querySelectorAll<HTMLElement>('[role="listbox"]')],clicks=nodes.map(()=>0);
 nodes.forEach((node,i)=>node.addEventListener('click',()=>{clicks[i]=(clicks[i]??0)+1;node.setAttribute('aria-expanded','true');lists[i]!.hidden=false;if(!emptyFirst||i>0)lists[i]!.innerHTML='<div role="option" data-value="local">选项'+i+'</div>';}));
 let current:ScanState=scanDocument(),occupied=false;
 const lease=new AgentPageLease(()=>document.URL,()=>occupied);let token=lease.begin();
 const sender={id:'fixture-extension',url:'chrome-extension://fixture-extension/popup.html'};
 const session=new OptionObservationSession({extensionId:sender.id,popupUrl:sender.url,lease,getScan:()=>current,occupied:()=>occupied});
 const id=(i:number)=>[...current.controls].find(([,c])=>c.node===nodes[i])![0];
 const request=(i:number)=>({type:'RA_OBSERVE_OPTIONS',agentRunToken:token,payload:{scanId:current.result.scanId,fieldId:id(i)}});
 const run=(i:number)=>session.run(request(i),sender);
 const preview=(owner=token,scan=current)=>session.nextField(owner,scan);
 const install=(owner=token)=>{const fresh=session.takeScan(owner);if(fresh)current=fresh;return fresh;};
 const collapse=(i:number)=>{nodes[i]!.setAttribute('aria-expanded','false');lists[i]!.hidden=true;lists[i]!.innerHTML='';};
 return {session,lease,nodes,lists,clicks,id,request,run,preview,install,collapse,sender,token:()=>token,scan:()=>current,
  rescan:()=>{current=scanDocument();},setOccupied:(value:boolean)=>{occupied=value;},newOwner:()=>{lease.end(token);token=lease.begin();return token;}};
}
it('repeated preview is side effect free and returns the first original field',()=>{
 const s=setup();expect(s.preview()).toBe(s.id(0));expect(s.preview()).toBe(s.id(0));expect(s.clicks).toEqual([0,0]);
});
it('an empty original list hands back exactly one private unanswered scan after run finally',async()=>{
 const s=setup();const old=s.scan(),result=await s.run(0);expect(result).toEqual({status:'pending',reason:'options-empty'});expect(s.session.holdsPage()).toBe(false);
 expect(s.session.takeScan(crypto.randomUUID())).toBeUndefined();const fresh=s.install();expect(fresh).toBeDefined();expect(fresh?.result.scanId).not.toBe(old.result.scanId);expect(s.install()).toBeUndefined();
 expect(JSON.stringify(result)).not.toMatch(/选项|local/u);expect(s.clicks).toEqual([1,0]);
});
it('stable empty first field stays pending while the second original field can be observed',async()=>{
 const s=setup();expect(s.preview()).toBe(s.id(0));expect((await s.run(0)).status).toBe('pending');expect(s.install()).toBeDefined();
 expect(s.preview()).toBe(s.id(1));expect(await s.run(1)).toEqual({status:'observed',optionCount:1});expect(s.install()).toBeDefined();expect(s.preview()).toBeUndefined();
 expect(s.clicks).toEqual([1,1]);expect(s.scan().result.fields.find(f=>f.id===s.id(0))?.hasValue).toBe(false);
});
it('a rescan UUID and a collapsed original field do not renew its attempt',async()=>{
 const s=setup(),old=s.id(0);await s.run(0);expect(s.install()).toBeDefined();s.collapse(0);s.rescan();expect(s.id(0)).not.toBe(old);
 expect(s.preview()).toBe(s.id(1));expect(await s.run(0)).toEqual({status:'pending',reason:'observation-already-attempted'});expect(s.clicks).toEqual([1,0]);
});
it('a second run cannot erase a fresh result before its owner consumes it',async()=>{
 const s=setup();await s.run(0);expect(await s.run(1)).toEqual({status:'pending',reason:'observation-result-pending'});expect(s.install()).toBeDefined();expect(s.clicks).toEqual([1,0]);
});
it.each(['wrong-owner','old-scan','occupied'] as const)('invalid %s preview does not create or consume an attempt',async mode=>{
 const s=setup(),old=s.scan();if(mode==='occupied')s.setOccupied(true);if(mode==='old-scan')s.rescan();
 expect(s.preview(mode==='wrong-owner'?crypto.randomUUID():s.token(),mode==='old-scan'?old:s.scan())).toBeUndefined();
 s.setOccupied(false);expect(s.preview()).toBe(s.id(0));await s.run(0);expect(s.clicks).toEqual([1,0]);
});
it.each(['sender','wrong-owner','wrong-scan','wrong-field','occupied','extra'] as const)('invalid %s request does not consume the previewed field',async mode=>{
 const s=setup();expect(s.preview()).toBe(s.id(0));const request:Record<string,unknown>={...s.request(0)},sender={...s.sender};
 if(mode==='sender')sender.id='foreign';if(mode==='wrong-owner')request.agentRunToken=crypto.randomUUID();
 if(mode==='wrong-scan')request.payload={...s.request(0).payload,scanId:crypto.randomUUID()};if(mode==='wrong-field')request.payload={...s.request(0).payload,fieldId:'foreign'};
 if(mode==='occupied')s.setOccupied(true);if(mode==='extra')request.value='local';
 expect((await s.session.run(request,sender)).status).toBe('pending');expect(s.clicks).toEqual([0,0]);s.setOccupied(false);expect(s.preview()).toBe(s.id(0));await s.run(0);expect(s.clicks).toEqual([1,0]);
});
it.each(['stop','cancel','close','rescan','occupied','manual','replace','late','collapse'] as const)('empty scan proof expires before take on %s',async mode=>{
 const s=setup();await s.run(0);
 if(mode==='stop')expect(s.session.stop(s.token())).toBe(true);if(mode==='cancel')s.session.cancelOwned();if(mode==='close')s.lease.end(s.token());
 if(mode==='rescan')s.rescan();if(mode==='occupied')s.setOccupied(true);if(mode==='manual')s.nodes[0]!.textContent='manual';
 if(mode==='replace')s.nodes[0]!.replaceWith(s.nodes[0]!.cloneNode(true));if(mode==='late')s.lists[0]!.innerHTML='<div role="option">迟到</div>';if(mode==='collapse')s.collapse(0);
 expect(s.install()).toBeUndefined();expect(s.clicks).toEqual([1,0]);
});
it.each(['stop','cancel'] as const)('%s revokes same-owner preview even after all current results were consumed',async mode=>{
 const s=setup();await s.run(0);s.install();if(mode==='stop')expect(s.session.stop(s.token())).toBe(true);else s.session.cancelOwned();
 expect(s.preview()).toBeUndefined();expect((await s.run(1)).status).toBe('pending');expect(s.clicks).toEqual([1,0]);
});
it('a wrong-owner stop cannot erase attempted nodes or invalidate the original result',async()=>{
 const s=setup();await s.run(0);expect(s.session.stop(crypto.randomUUID())).toBe(false);expect(s.install()).toBeDefined();s.collapse(0);s.rescan();expect(s.preview()).toBe(s.id(1));
});
it('a newly leased owner can retry an untouched collapsed field without reviving the old result',async()=>{
 const s=setup();await s.run(0);const old=s.token();s.session.cancelOwned();s.newOwner();s.collapse(0);s.rescan();
 expect(s.session.takeScan(old)).toBeUndefined();expect(s.preview()).toBe(s.id(0));await s.run(0);expect(s.clicks).toEqual([2,0]);
});
it('an old consumed owner cannot stop a new lease before that lease previews its first field',async()=>{
 const s=setup();await s.run(0);expect(s.install()).toBeDefined();const old=s.token();s.session.cancelOwned();s.newOwner();s.rescan();
 expect(s.session.stop(old)).toBe(false);expect(s.preview()).toBe(s.id(1));expect((await s.run(1)).status).toBe('observed');expect(s.clicks).toEqual([1,1]);
});
it('eight original controls exhaust the private attempt budget despite fresh UUIDs and repeated previews',async()=>{
 const s=setup(9,false);for(let i=0;i<8;i++){expect(s.preview()).toBe(s.id(i));expect(s.preview()).toBe(s.id(i));expect((await s.run(i)).status).toBe('observed');expect(s.install()).toBeDefined();}
 expect(s.preview()).toBeUndefined();expect(await s.run(8)).toEqual({status:'pending',reason:'observation-budget-exhausted'});expect(s.clicks).toEqual([1,1,1,1,1,1,1,1,0]);
});
it.each(['manual','replace','late','collapse','rescan','occupied','owner-close'] as const)('failed %s proof consumption revokes the same-owner remainder',async mode=>{
 const s=setup();await s.run(0);
 if(mode==='manual')s.nodes[0]!.textContent='manual';if(mode==='replace')s.nodes[0]!.replaceWith(s.nodes[0]!.cloneNode(true));
 if(mode==='late')s.lists[0]!.innerHTML='<div role="option">迟到</div>';if(mode==='collapse')s.collapse(0);if(mode==='rescan')s.rescan();
 if(mode==='occupied')s.setOccupied(true);if(mode==='owner-close')s.lease.end(s.token());
 expect(s.install()).toBeUndefined();s.setOccupied(false);s.rescan();expect(s.preview()).toBeUndefined();expect((await s.run(1)).status).toBe('pending');expect(s.clicks).toEqual([1,0]);
});
it.each(['manual','replace','foreign'] as const)('invalid %s during opening revokes the same-owner remainder',async mode=>{
 const s=setup();s.nodes[0]!.addEventListener('click',()=>{
  if(mode==='manual')s.nodes[0]!.textContent='manual';if(mode==='replace')s.nodes[0]!.replaceWith(s.nodes[0]!.cloneNode(true));if(mode==='foreign')document.body.append(document.createElement('aside'));
 });
 expect((await s.run(0)).status).toBe('pending');expect(s.install()).toBeUndefined();s.rescan();expect(s.preview()).toBeUndefined();expect((await s.run(1)).status).toBe('pending');expect(s.clicks).toEqual([1,0]);
});
