import {AgentPageLease} from '../../src/agent/pageLease';
import {OptionObservationSession} from '../../src/content/optionObservationSession';
import {scanDocument} from '../../src/content/scanner';

function check(value:unknown,reason:string):asserts value {if(!value)throw new Error(reason);}
export async function run(mode:string){
 const count=mode==='budget'?9:2;
 document.body.innerHTML=Array.from({length:count},(_,i)=>'<label for="c'+i+'">招聘选项'+i+'</label><button id="c'+i+'" type="button" role="combobox" aria-controls="l'+i+'" aria-expanded="false">请选择</button><div role="listbox" id="l'+i+'" hidden></div>').join('');
 const nodes=[...document.querySelectorAll<HTMLElement>('[role="combobox"]')],lists=[...document.querySelectorAll<HTMLElement>('[role="listbox"]')],opens=nodes.map(()=>0);let selections=0,occupied=false;
 nodes.forEach((node,i)=>node.addEventListener('click',()=>{opens[i]=(opens[i]??0)+1;node.setAttribute('aria-expanded','true');lists[i]!.hidden=false;if(i>0||mode==='budget')lists[i]!.innerHTML='<div role="option" data-value="opaque">选项'+i+'</div>';
  if(mode==='opening-manual'&&i===0)node.textContent='手动改变';if(mode==='opening-replace'&&i===0)node.replaceWith(node.cloneNode(true));
 }));
 lists.forEach(list=>list.addEventListener('click',()=>selections++));
 let scan=scanDocument();const lease=new AgentPageLease(()=>document.URL,()=>occupied);let token=lease.begin();
 const sender={id:'fixture-extension',url:'chrome-extension://fixture-extension/popup.html'};
 const session=new OptionObservationSession({extensionId:sender.id,popupUrl:sender.url,lease,getScan:()=>scan,occupied:()=>occupied});
 const id=(i:number)=>[...scan.controls].find(([,control])=>control.node===nodes[i])?.[0]??'missing';
 const request=(i:number)=>({type:'RA_OBSERVE_OPTIONS',agentRunToken:token,payload:{scanId:scan.result.scanId,fieldId:id(i)}});
 const take=()=>{const fresh=session.takeScan(token);if(fresh)scan=fresh;return fresh;};
 check(session.nextField(token,scan)===id(0),'initial original field absent');check(session.nextField(token,scan)===id(0),'preview consumed attempt');
 if(mode==='budget'){
  for(let i=0;i<8;i++){check(session.nextField(token,scan)===id(i),'wrong budget field');check((await session.run(request(i),sender)).status==='observed','budget observation missing');check(take(),'budget private scan absent');}
  check(session.nextField(token,scan)===undefined,'budget overrun preview');const denied=await session.run(request(8),sender);check(denied.status==='pending'&&denied.reason==='observation-budget-exhausted','budget did not reject ninth');
 }else{
  if(mode==='source'){
   check((await session.run(request(0),{...sender,id:'foreign'})).status==='pending','foreign sender accepted');check(opens[0]===0&&session.nextField(token,scan)===id(0),'foreign request consumed attempt');
  }
  if(mode==='occupied'){occupied=true;check(session.nextField(token,scan)===undefined,'occupied preview accepted');check((await session.run(request(0),sender)).status==='pending','occupied accepted');occupied=false;}
  const running=session.run(request(0),sender);
  if(mode==='stop')session.stop(token);if(mode==='close'){lease.end(token);session.stop(token);}if(mode==='busy')check((await session.run(request(1),sender)).status==='pending','parallel observation accepted');
  const result=await running;check(result.status==='pending','empty first list was reported observed');
  check(session.takeScan(crypto.randomUUID())===undefined,'wrong owner retrieved private proof');
  if(mode==='late')lists[0]!.innerHTML='<div role="option">迟到选项</div>';if(mode==='manual')nodes[0]!.textContent='手动改变';if(mode==='replace')nodes[0]!.replaceWith(nodes[0]!.cloneNode(true));
  if(mode==='unconsumed')check((await session.run(request(1),sender)).status==='pending'&&opens[1]===0,'second run erased unconsumed result');
  const invalid=['stop','close','late','manual','replace','opening-manual','opening-replace'].includes(mode);
  if(invalid){check(!take(),'invalid proof retrieved');scan=scanDocument();check(session.nextField(token,scan)===undefined,'invalid owner remainder resumed');check((await session.run(request(1),sender)).status==='pending'&&opens[1]===0,'invalid remainder opened second');}
  else{
   check(result.reason==='options-empty','private empty classification absent');check(take(),'empty proof did not survive execution lock release');check(!take(),'private scan replay accepted');
   if(mode==='old-owner-stop'){const old=token;session.cancelOwned();lease.end(token);token=lease.begin();scan=scanDocument();check(!session.stop(old),'old consumed owner stopped a new lease');}
   if(mode==='new-owner'){session.cancelOwned();lease.end(token);token=lease.begin();nodes[0]!.setAttribute('aria-expanded','false');lists[0]!.hidden=true;scan=scanDocument();check(session.nextField(token,scan)===id(0),'new owner unable to retry');check((await session.run(request(0),sender)).status==='pending','new owner empty result wrong');check(take(),'new owner proof absent');}
   if(mode==='rescan'){nodes[0]!.setAttribute('aria-expanded','false');lists[0]!.hidden=true;scan=scanDocument();check(session.nextField(token,scan)===id(1),'new UUID revived first attempt');const denied=await session.run(request(0),sender);check(denied.status==='pending'&&denied.reason==='observation-already-attempted','original field reopened');}
   check(session.nextField(token,scan)===id(1),'second original field absent');check((await session.run(request(1),sender)).status==='observed','second observation missing');check(take(),'second fresh scan absent');check(session.nextField(token,scan)===undefined,'attempted field returned again');
  }
 }
 check(selections===0,'observation selected an answer');check(!session.holdsPage(),'execution lock leaked');
 return {mode,opens,selections};
}
