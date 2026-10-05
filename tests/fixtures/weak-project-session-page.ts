export function installWeakProjectSessionPage(doc:Document){
 doc.head.innerHTML='';doc.body.innerHTML='<main><section aria-label="项目经历"><h2>项目经历</h2><div role="list" id="project-items"></div></section></main>';
 const list=doc.querySelector<HTMLElement>('[role="list"]')!;const counts={add:0,save:0,submit:0,remove:0,cancel:0};const saved:Record<string,string>[]=[];const cards:HTMLElement[]=[];
 const add=doc.createElement('button');add.type='button';add.textContent='+';add.setAttribute('aria-controls',list.id);
 const empty=doc.createElement('p');empty.setAttribute('role','status');empty.textContent='暂无项目经历';const closed=()=>list.replaceChildren(...cards,...(cards.length?[]:[empty]),add);
 add.addEventListener('click',()=>{counts.add++;const form=doc.createElement('form');form.setAttribute('aria-label','新增项目经历');form.innerHTML='<label>项目名称<input required name="opaque-one" data-test-key="name"></label><label>项目描述<textarea required name="opaque-two" data-test-key="description"></textarea></label><button type="button">保存</button><button type="button">取消</button>';
 form.querySelectorAll('button')[1]!.addEventListener('click',()=>counts.cancel++);
 form.querySelector('button')!.addEventListener('click',()=>{counts.save++;if(!form.checkValidity())return;const values:Record<string,string>={};for(const f of form.querySelectorAll<HTMLInputElement>('input,textarea'))values[f.dataset.testKey!]=f.value;
 saved.push(values);const card=doc.createElement('article');card.setAttribute('role','listitem');const heading=doc.createElement('h3');heading.textContent=values.name!;card.append(heading);const desc=doc.createElement('p');desc.textContent='项目描述：'+values.description;card.append(desc);for(const caption of ['编辑项目经历','删除']){const b=doc.createElement('button');b.type='button';b.textContent=caption;if(caption==='删除')b.addEventListener('click',()=>counts.remove++);card.append(b);}cards.unshift(card);closed();});list.append(form);});
 closed();const submit=doc.createElement('button');submit.type='button';submit.textContent='最终提交';submit.addEventListener('click',()=>counts.submit++);doc.body.append(submit);return {list,add,counts,saved};
}
