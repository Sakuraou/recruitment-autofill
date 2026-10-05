import type {AwardProjectionResponse} from '../../src/profile/awardProjection';
export const awardSessionProfile:AwardProjectionResponse={recordType:'award',profileRevision:'fictional-awards',presence:'known',awards:[
  {id:'award-2021',name:'虚构校级二等奖学金',school:'虚构大学',level:'校级',date:'2021-11-15',description:'获虚构校级二等奖学金。'},
  {id:'award-2022',name:'虚构校级二等奖学金',school:'虚构大学',level:'校级',date:'2022-11-15',description:'获虚构校级二等奖学金。'},
  {id:'award-competition',name:'虚构程序设计竞赛二等奖',school:'虚构大学',level:'校级',date:'2023-04-18',description:'获虚构程序设计竞赛二等奖。'},
]};
export function installAwardSessionPage(doc:Document,initial:readonly number[]=[],options:{unknown?:boolean;saveRefused?:boolean;existingConflict?:boolean;cadre?:'select'|'radio';dynamicCadre?:boolean;cadreConflict?:boolean;stopOnCadre?:()=>void}={}){
  doc.head.innerHTML='';doc.body.innerHTML='<main><section aria-label="在校奖励活动"><h2>在校奖励活动</h2><div role="list" id="award-items"></div></section></main>';
  const list=doc.querySelector<HTMLElement>('[role="list"]')!;const counts={add:0,save:0,submit:0,remove:0,cancel:0};
  const saved:Record<string,string>[]=[];const cards:Element[]=[];const add=doc.createElement('button');add.type='button';add.textContent='+';add.setAttribute('aria-controls',list.id);
  const summary=(index:number)=>{const award=awardSessionProfile.awards[index]!;const card=doc.createElement('article');card.setAttribute('role','listitem');
    card.innerHTML=`<h3>${award.name}</h3><p>获奖时间：${award.date}</p><p>所在学校：${award.school}</p><p>奖励级别：${award.level}</p><button type="button">编辑奖励经历</button><button type="button">删除</button>`;
    card.querySelectorAll('button')[1]!.addEventListener('click',()=>counts.remove++);return card;};
  cards.push(...initial.map(summary));const empty=doc.createElement('p');empty.setAttribute('role','status');empty.textContent='暂无奖励经历';
  const closed=()=>list.replaceChildren(...cards,...(cards.length?[]:[empty]),add);
  add.addEventListener('click',()=>{counts.add++;const form=doc.createElement('form');form.setAttribute('aria-label','新增奖励经历');
    form.innerHTML='<label>奖励名称<input name="opaque-one" required data-key="name"></label><label>所在学校<input name="opaque-two" required data-key="school"></label><label>获奖时间<input type="date" required data-key="date"></label><label>奖励级别<select required data-key="level"><option value="">请选择</option><option value="campus">校级</option><option value="national">国家级</option></select></label><label>简要描述<textarea required data-key="description"></textarea></label><button type="button">保存</button><button type="button">取消</button>';
    if(options.unknown)form.insertAdjacentHTML('beforeend','<label>未知业务问题<input required></label>');
    if(options.existingConflict)form.querySelector<HTMLInputElement>('[data-key="school"]')!.value='网页已有其他学校';
    if(options.cadre){const group=doc.createElement('fieldset');
      group.innerHTML='<legend>是否学生干部</legend>'+(options.cadre==='radio'?'<label><input name="cadre" type="radio" value="yes" data-key="cadre">是</label><label><input name="cadre" type="radio" value="no" data-key="cadre">否</label>':'<select data-key="cadre"><option value="">请选择</option><option value="yes">是</option><option value="no">否</option></select>');
      if(options.cadreConflict){if(options.cadre==='radio')group.querySelector('input')!.checked=true;else group.querySelector('select')!.value='yes';}
      group.addEventListener('change',()=>{if(options.dynamicCadre&&!form.querySelector('[data-key="cadreDescription"]')){
        const label=doc.createElement('label');label.textContent='学生干部描述';const control=doc.createElement('textarea');control.required=true;control.dataset.key='cadreDescription';label.append(control);group.after(label);
      }options.stopOnCadre?.();});form.querySelector('button')!.before(group);
    }
    form.querySelectorAll('button')[1]!.addEventListener('click',()=>counts.cancel++);
    form.querySelector('button')!.addEventListener('click',()=>{counts.save++;if(options.saveRefused||!form.checkValidity())return;
      const values:Record<string,string>={};for(const control of form.querySelectorAll<HTMLInputElement>('input,select,textarea'))if(control.dataset.key&&(control.type!=='radio'||control.checked))values[control.dataset.key]=control.value;
      const index=awardSessionProfile.awards.findIndex(award=>award.name===values.name&&award.date===values.date);if(index<0)return;
      saved.push(values);cards.unshift(summary(index));closed();});list.append(form);
  });
  closed();const submit=doc.createElement('button');submit.type='button';submit.textContent='最终提交';submit.addEventListener('click',()=>counts.submit++);doc.body.append(submit);
  return {list,add,counts,saved};
}
