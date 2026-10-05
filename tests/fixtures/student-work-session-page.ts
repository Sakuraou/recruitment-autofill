import type { StudentWorkProjectionResponse } from '../../src/profile/studentWorkProjection';
export const studentWorkSessionProfile: StudentWorkProjectionResponse = {
  recordType: 'student-work', profileRevision: 'fictional-student-work-revision', presence: 'known', studentWork: [
    { id: 'fictional-work-a', organization: '虚构学院', role: '辅导员助理', startDate: '2021-09-01', endDate: '2022-06-30', cadreLevel: '无', shortDuties: '协助新生入学与资料整理。' },
    { id: 'fictional-work-b', organization: '虚构学院', role: '就业办助理', startDate: '2021-09-01', endDate: '2022-06-30', cadreLevel: '无', shortDuties: '协助就业事务与资料归档。' },
    { id: 'fictional-work-c', organization: '虚构学院', role: '就业办助理', startDate: '2022-09-01', endDate: '2023-06-30', cadreLevel: '无', shortDuties: '整理新一学年的就业资料。' },
  ],
};
type Options = { unknown?: boolean; existingConflict?: boolean; saveRefused?: boolean; corruptSummary?: boolean;
  dynamicDuties?: boolean; dynamicUnknown?: boolean; onRole?: () => void; onSave?: () => void };
export function installStudentWorkSessionPage(doc: Document, initial: readonly number[] = [], options: Options = {}) {
  doc.head.innerHTML = ''; doc.body.innerHTML = '<main><section aria-label="校内职务"><h2>校内职务</h2><div role="list" id="student-work-items"></div></section></main>';
  const list = doc.querySelector<HTMLElement>('[role="list"]')!;
  const counts = { add: 0, save: 0, remove: 0, submit: 0, cancel: 0 };
  const saved: Record<string,string>[] = [], cards: Element[] = [];
  const add = doc.createElement('button'); add.type = 'button'; add.textContent = '+'; add.setAttribute('aria-controls', list.id);
  function summary(values: Record<string,string>) {
    const card = doc.createElement('article'); card.setAttribute('role','listitem');
    for (const [label,key] of [['组织团体名称','organization'],['担任职务','role'],['开始日期','startDate'],['结束日期','endDate'],
      ['干部级别','cadreLevel'],['职责和成就','shortDuties']] as const) {
      const p = doc.createElement('p'); p.textContent = label + '：' + (values[key] ?? ''); card.append(p);
    }
    const edit = doc.createElement('button'); edit.type = 'button'; edit.textContent = '编辑校内职务'; card.append(edit);
    const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.addEventListener('click',()=>counts.remove++); card.append(remove);
    return card;
  }
  for (const index of initial) {
    const entry = studentWorkSessionProfile.studentWork[index]!;
    cards.push(summary(Object.fromEntries(Object.entries(entry).filter((pair):pair is [string,string]=>typeof pair[1] === 'string'))));
  }
  const empty = doc.createElement('p'); empty.setAttribute('role','status'); empty.textContent = '暂无校内职务';
  const closed = () => list.replaceChildren(...cards,...(cards.length ? [] : [empty]),add);
  add.addEventListener('click',()=>{
    counts.add++; const form = doc.createElement('form'); form.setAttribute('aria-label','新增校内职务');
    form.innerHTML = '<label>组织团体名称<input required data-key="organization"></label><label>担任职务<input required data-key="role"></label>'
      + '<label>开始日期<input type="date" required data-key="startDate"></label><label>结束日期<input type="date" required data-key="endDate"></label>'
      + '<label>干部级别<select required data-key="cadreLevel"><option value="">请选择</option><option value="none-value">无</option></select></label>'
      + '<button type="button">保存</button><button type="button">取消</button>';
    const duties = () => { const label = doc.createElement('label'); label.textContent = '职责和成就';
      const control = doc.createElement('input'); control.required = true; control.maxLength = 50; control.dataset.key = 'shortDuties'; label.append(control); form.querySelector('button')!.before(label); };
    if (!options.dynamicDuties) duties();
    if (options.unknown) form.insertAdjacentHTML('beforeend','<label>未知问题<input required></label>');
    if (options.existingConflict) form.querySelector<HTMLInputElement>('[data-key="role"]')!.value = '页面原有其他职务';
    form.querySelector('[data-key="role"]')!.addEventListener('change',()=>{
      if (options.dynamicDuties && !form.querySelector('[data-key="shortDuties"]')) duties();
      if (options.dynamicUnknown && !form.querySelector('[data-unknown]')) form.insertAdjacentHTML('beforeend','<label>未知联动题<input required data-unknown></label>');
      options.onRole?.();
    });
    form.querySelectorAll('button')[1]!.addEventListener('click',()=>counts.cancel++);
    form.querySelector('button')!.addEventListener('click',()=>{
      counts.save++; options.onSave?.(); if (options.saveRefused || !form.checkValidity()) return;
      const values: Record<string,string> = {}, display: Record<string,string> = {};
      for (const control of form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')) {
        if (!control.dataset.key) continue; values[control.dataset.key] = control.value;
        display[control.dataset.key] = control.tagName === 'SELECT' ? (control as HTMLSelectElement).selectedOptions[0]!.textContent! : control.value;
      }
      saved.push(values); if (options.corruptSummary) display.role = '错误保存的职务';
      cards.unshift(summary(display)); closed();
    });
    list.append(form);
  });
  closed(); const submit = doc.createElement('button'); submit.type = 'button'; submit.textContent = '最终提交';
  submit.addEventListener('click',()=>counts.submit++); doc.body.append(submit);
  return { list, add, counts, saved, cards };
}
