import type { InternshipProjectionResponse } from '../../src/profile/internshipProjection';
import { firstInternship, secondInternship } from './internship-facts';

export const internshipSessionProfile: InternshipProjectionResponse = {
  recordType: 'internship', profileRevision: 'fictional-internship-revision',
  internships: [{ ...firstInternship }, { ...secondInternship }],
};

/** Fictional ordinary markup; test keys belong to the fake site's save handler only. */
export function installInternshipSessionPage(doc: Document, profile = internshipSessionProfile, initial: readonly number[] = []) {
  doc.head.innerHTML = '';
  doc.body.innerHTML = '<main><section aria-label="实习经历"><h2>实习经历</h2><div role="list" id="internship-items"></div></section></main>';
  const list = doc.querySelector<HTMLElement>('[role="list"]')!;
  const counts = { add: 0, save: 0, submit: 0, remove: 0, cancel: 0 };
  const saved: Record<string, string>[] = []; const cards: HTMLElement[] = [];
  const add = doc.createElement('button'); add.type = 'button'; add.textContent = '+'; add.setAttribute('aria-controls', list.id);
  const makeCard = (value: { organization?: string; role?: string; startDate?: string; endDate?: string }) => {
    const card = doc.createElement('article'); card.setAttribute('role', 'listitem');
    const heading = doc.createElement('h3'); heading.textContent = value.organization ?? ''; card.append(heading);
    for (const [key, caption] of [['role', '岗位'], ['startDate', '入职日期'], ['endDate', '离职日期']] as const) {
      const paragraph = doc.createElement('p'); paragraph.textContent = `${caption}：${value[key] ?? ''}`; card.append(paragraph);
    }
    for (const caption of ['编辑实习经历', '删除']) {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = caption; card.append(button);
      if (caption === '删除') button.addEventListener('click', () => counts.remove++);
    }
    return card;
  };
  cards.push(...initial.map(index => makeCard(profile.internships[index]!)));
  const empty = doc.createElement('p'); empty.setAttribute('role', 'status'); empty.textContent = '暂无实习经历';
  const closed = () => list.replaceChildren(...cards, ...(cards.length ? [] : [empty]), add);
  add.addEventListener('click', () => {
    counts.add++;
    const editor = doc.createElement('form'); editor.setAttribute('aria-label', '新增实习经历');
    const fields: readonly [string, string, string][] = [
      ['organization', '工作单位', '<input required>'], ['department', '所在部门', '<input required>'],
      ['role', '职务', '<input required>'], ['description', '工作描述', '<textarea required></textarea>'],
      ['achievements', '工作业绩', '<textarea></textarea>'],
      ['startDate', '入职日期', '<input type="date" required>'], ['endDate', '离职日期', '<input type="date" required>'],
      ['experienceType', '活动经历类型', '<select required><option value="">请选择</option><option value="I">实习经历</option><option value="S">社会实践</option></select>'],
      ['workType', '工作类型', '<select required><option value="">请选择</option><option value="I">实习</option><option value="P">兼职</option></select>'],
      ['companyProperty', '企业性质', '<select required><option value="">请选择</option><option value="P">民营企业</option><option value="S">事业单位</option></select>'],
      ['monthlySalary', '税前月薪范围', '<select required><option value="">请选择</option><option value="A">1000-2000/月</option><option value="B">2000-3000/月</option></select>'],
      ['hasProof', '是否有证明', '<select required><option value="">请选择</option><option value="unrelated-y">是</option><option value="unrelated-n">否</option></select>'],
    ];
    fields.forEach(([key, caption, markup], index) => {
      const label = doc.createElement('label'); label.textContent = caption; label.insertAdjacentHTML('beforeend', markup);
      const field = label.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')!;
      field.name = `opaque-${index}`; field.dataset.testKey = key; editor.append(label);
    });
    const save = doc.createElement('button'); save.type = 'button'; save.textContent = '保存'; editor.append(save);
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; editor.append(cancel);
    cancel.addEventListener('click', () => counts.cancel++);
    save.addEventListener('click', () => {
      counts.save++; if (!editor.checkValidity()) return;
      const values: Record<string, string> = {};
      for (const field of editor.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')) {
        const key = field.dataset.testKey; if (!key) continue;
        values[key] = field.tagName === 'SELECT' ? (field as HTMLSelectElement).selectedOptions[0]!.textContent! : field.value;
      }
      saved.push(values); cards.unshift(makeCard(values)); closed();
    });
    list.append(editor);
  });
  closed();
  const submit = doc.createElement('button'); submit.type = 'button'; submit.textContent = '最终提交';
  submit.addEventListener('click', () => counts.submit++); doc.body.append(submit);
  return { list, add, counts, saved, cards };
}
