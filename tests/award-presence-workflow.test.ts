import {afterEach, expect, it, vi} from 'vitest';
import {AwardRecordWorkflow} from '../src/content/awardRecordWorkflow';
import type { RecordV2Session } from '../src/content/recordV2Gateway';
import {awardSessionProfile as profile, installAwardSessionPage} from './fixtures/award-session-page';
afterEach(()=>{ document.body.innerHTML='';document.head.innerHTML='';window.history.replaceState({},'', '/'); });
function install(kind:'select'|'radio'='select',caption='是否有在校奖励活动',delay: number | null=30){
 const page=installAwardSessionPage(document); page.list.hidden=true;
 const form=document.createElement('form');
 form.innerHTML=kind==='select'? '<label>'+caption+'<select name="opaque-presence"><option value="">请选择</option><option value="opaque-y">是</option><option value="opaque-n">否</option></select></label>'
 :'<fieldset><legend>'+caption+'</legend><label><input type="radio" required name="opaque-presence" value="opaque-y">是</label><label><input type="radio" name="opaque-presence" value="opaque-n">否</label></fieldset>';
 page.list.before(form);let answers=0;
 form.addEventListener('change',event=>{const control=event.target as HTMLInputElement|HTMLSelectElement;answers++;if(control.value==='opaque-y' && delay !== null)setTimeout(()=>{page.list.hidden=false;},delay);});
 return {...page,form,get answers(){return answers;}};
}
it.each(['select','radio'] as const)('只有存在性%s题时先答是、等待列表、按源顺序填完三条，重启不重答',async kind=>{
 const page=install(kind);const flow=new AwardRecordWorkflow(document,async()=>profile);
 expect(flow.status().canStart).toBe(true);await flow.start();
 await vi.waitFor(()=>expect(flow.status().phase).toBe('complete'),{timeout:12_000});
 expect(page.answers).toBe(1);expect(page.saved.map(record=>record.name)).toEqual(profile.awards.map(record=>record.name));
 await flow.start();await vi.waitFor(()=>expect(flow.status().phase).toBe('complete'),{timeout:5_000});
 expect(page.answers).toBe(1);expect(page.counts).toEqual({add:3,save:3,submit:0,remove:0,cancel:0});
},20_000);
it.each(['empty','manual-no','ambiguous-option','wrong-range','proof-question','external-radio','stop-load','navigation-load'])('存在性%s保持零答题／Add／Save',async mode=>{
 const page=install(mode==='external-radio'?'radio':'select',mode==='wrong-range'?'是否有在校奖励活动或项目经历':mode==='proof-question'?'是否有证明':undefined);
 if(mode==='manual-no')page.form.querySelector<HTMLSelectElement>('select')!.value='opaque-n';
 if(mode==='ambiguous-option')page.form.querySelector('select')!.insertAdjacentHTML('beforeend','<option value="another">是</option>');
 if(mode==='external-radio')page.form.insertAdjacentHTML('beforeend','<label hidden><input type="radio" name="opaque-presence" checked>外部选项</label>');
 let release!: (value:typeof profile)=>void;const gate=new Promise<typeof profile>(done=>{release=done;});
 const local=mode==='empty'?{...profile,awards:[]}:profile;
 const flow=new AwardRecordWorkflow(document,()=>mode.endsWith('-load')?gate:Promise.resolve(local));
 const started=flow.start();if(mode==='stop-load')flow.stop();if(mode==='navigation-load')window.history.replaceState({},'','/other-job');if(mode.endsWith('-load'))release(profile);
 await started;
 await vi.waitFor(()=>expect(['review','stopped']).toContain(flow.status().phase));
 expect(page.answers).toBe(0);expect(page.counts).toEqual({add:0,save:0,submit:0,remove:0,cancel:0});
 if(mode==='manual-no')expect(page.form.querySelector<HTMLSelectElement>('select')!.value).toBe('opaque-n');
 flow.stop();
});

it.each(['select','radio'] as const)('已选是的%s只等待列表，拒绝重复答题',async kind=>{
 const page=install(kind);const control=page.form.querySelector<HTMLInputElement|HTMLSelectElement>('input,select')!;
 if(kind==='radio')(control as HTMLInputElement).checked=true;else control.value='opaque-y';
 setTimeout(()=>{page.list.hidden=false;},100);
 const flow=new AwardRecordWorkflow(document,async()=>profile);await flow.start();
 await vi.waitFor(()=>expect(flow.status().phase).toBe('complete'),{timeout:12_000});
 expect(page.answers).toBe(0);expect(page.counts).toEqual({add:3,save:3,submit:0,remove:0,cancel:0});
},15_000);

it.each(['stop','navigation','manual-answer','replace-question','replace-section','multiple-lists','outside-section','never-list'])('已接受答题后%s保持答案或手改值，不再Add／Save',async mode=>{
 const page=install('select',undefined,null);const flow=new AwardRecordWorkflow(document,async()=>profile);
 const starting=flow.start();const select=page.form.querySelector<HTMLSelectElement>('select')!;
 await vi.waitFor(()=>expect(select.value).toBe('opaque-y'));
 if(mode==='stop')flow.stop();
 if(mode==='navigation')window.history.replaceState({},'','/new-job');
 if(mode==='manual-answer')select.value='opaque-n';
 if(mode==='replace-question')page.form.replaceWith(page.form.cloneNode(true));
 if(mode==='replace-section'){const section=page.list.closest('section')!;section.replaceWith(section.cloneNode(true));}
 if(mode==='multiple-lists'){page.list.hidden=false;page.list.after(page.list.cloneNode(true));}
 if(mode==='outside-section'){page.list.hidden=false;document.querySelector('main')!.append(page.list);}
 await starting;expect(['review','stopped']).toContain(flow.status().phase);
 expect(select.value).toBe(mode==='manual-answer'?'opaque-n':'opaque-y');
 expect(page.answers).toBe(1);expect(page.counts).toEqual({add:0,save:0,submit:0,remove:0,cancel:0});flow.stop();
},8_000);

it.each(['revision','same-revision','replace-list','move-list'])('稳定后最终刷新期间%s不把已观察的列表授权给新状态',async mode=>{
 const page=install();let release!:(value:typeof profile)=>void;
 const gate=new Promise<typeof profile>(done=>{release=done;});
 const load=vi.fn().mockResolvedValueOnce(profile).mockResolvedValueOnce(profile).mockImplementation(()=>gate);
 const flow=new AwardRecordWorkflow(document,load);const starting=flow.start();
 await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(3));
 if(mode==='replace-list')page.list.replaceWith(page.list.cloneNode(true));
 if(mode==='move-list')document.querySelector('main')!.append(page.list);
 release(mode==='revision'?{...profile,profileRevision:'changed'}:mode==='same-revision'?{...profile,awards:profile.awards.map(record=>({...record,description:'更改描述'}))}:profile);
 await starting;expect(flow.status().phase).toBe('review');expect(page.answers).toBe(1);
 expect(page.form.querySelector<HTMLSelectElement>('select')!.value).toBe('opaque-y');expect(page.counts.add+page.counts.save).toBe(0);flow.stop();
});

it('准备期间拒绝重复启动，Stop立即使迟到列表失效',async()=>{
 const page=install('select',undefined,null);const flow=new AwardRecordWorkflow(document,async()=>profile);
 const starting=flow.start();await vi.waitFor(()=>expect(page.answers).toBe(1));
 expect(flow.status().phase).toBe('preparing');expect(flow.holdsPage()).toBe(true);await expect(flow.start()).rejects.toThrow();
 flow.stop();page.list.hidden=false;await starting;expect(flow.status().phase).toBe('stopped');expect(flow.holdsPage()).toBe(false);
 expect(page.counts.add+page.counts.save).toBe(0);
});

it.each(['unknown-form','foreign-section','disabled-yes','label-conflict'])('原始%s题不授予存在性准备权限',async mode=>{
 const page=install();const select=page.form.querySelector<HTMLSelectElement>('select')!;
 if(mode==='unknown-form')page.form.setAttribute('aria-label','未知业务');
 if(mode==='foreign-section'){const section=document.createElement('section');section.setAttribute('aria-label','项目经历');page.form.replaceWith(section);section.append(page.form);}
 if(mode==='disabled-yes')select.options[1]!.disabled=true;
 if(mode==='label-conflict')select.setAttribute('aria-label','是否有证明');
 const flow=new AwardRecordWorkflow(document,async()=>profile);expect(flow.status().canStart).toBe(false);await flow.start();
 await vi.waitFor(()=>expect(flow.status().phase).toBe('review'));expect(page.answers).toBe(0);expect(page.counts.add+page.counts.save).toBe(0);flow.stop();
});

it('前置答题不消耗逐条会话的三批填写和最终核验上限',async()=>{
 const page=install();let calls=0;
 const session:RecordV2Session={state:'ready',snapshotVersion:0,pause:vi.fn(),resume:vi.fn(),stop:vi.fn(),
  advance:async()=>({status:++calls<=5?'advanced':'complete',snapshotVersion:calls})};
 const source={...profile,awards:[profile.awards[0]!]};
 const flow=new AwardRecordWorkflow(document,async()=>source,()=>session);await flow.start();
 await vi.waitFor(()=>expect(flow.status().phase).toBe('complete'));
 expect(page.answers).toBe(1);expect(calls).toBe(6);expect(session.stop).not.toHaveBeenCalled();
});

it.each(['replace-node','replace-section'])('加载前已捕获存在性目标，%s 不改用替换目标',async mode=>{
 const page=install();let release!:(value:typeof profile)=>void;const gate=new Promise<typeof profile>(done=>{release=done;});
 const flow=new AwardRecordWorkflow(document,()=>gate);const starting=flow.start();
 if(mode==='replace-node')page.form.replaceWith(page.form.cloneNode(true));
 else {const section=page.list.closest('section')!;section.replaceWith(section.cloneNode(true));}
 release(profile);await starting;await vi.waitFor(()=>expect(flow.status().phase).toBe('review'));
 expect(page.answers).toBe(0);expect(page.counts.add+page.counts.save).toBe(0);flow.stop();
});
it.each(['revision','same-revision'])('准备期间档案%s改变，在答题前停止',async mode=>{
 const page=install();let release!:(value:typeof profile)=>void;const gate=new Promise<typeof profile>(done=>{release=done;});
 const load=vi.fn().mockResolvedValueOnce(profile).mockImplementation(()=>gate);
 const flow=new AwardRecordWorkflow(document,load);const starting=flow.start();
 await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
 release(mode==='revision'?{...profile,profileRevision:'other-revision'}:{...profile,awards:profile.awards.map(record=>({...record,role:'用户改后的岗位'}))});
 await starting;await vi.waitFor(()=>expect(flow.status().phase).toBe('review'));
 expect(page.answers).toBe(0);expect(page.counts.add+page.counts.save).toBe(0);flow.stop();
});
