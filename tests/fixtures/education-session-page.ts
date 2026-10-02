import type { EducationProjectionResponse } from '../../src/profile/educationProjection';

export const educationSessionProfile: EducationProjectionResponse = {
  recordType: 'education', profileRevision: 'fictional-education-revision', education: [
    { id: 'fictional-master', school: '虚构云川大学', major: '人工智能', level: '硕士研究生', degree: '硕士学位',
      educationType: '统招', schoolProperty: '211', durationYears: '3', gpa: '3.9', ranking: '前80%', startDate: '2024-09', endDate: '2027-06' },
    { id: 'fictional-bachelor', school: '虚构青岚学院', major: '软件工程', level: '本科', degree: '学士学位',
      educationType: '统招', schoolProperty: '国内普通院校', durationYears: '4', gpa: '3.6', ranking: '前30%', startDate: '2020-09', endDate: '2024-06' },
  ],
};

/** Ordinary fictional markup; the driver receives no fixture identities or selectors. */
export function installEducationSessionPage(doc: Document, profile = educationSessionProfile, initial: readonly number[] = []) {
  doc.head.innerHTML = '';
  doc.body.innerHTML = '<main><section aria-label="教育经历"><h2>教育经历</h2><div role="list" id="education-items"></div></section></main>';
  const list = doc.querySelector<HTMLElement>('[role="list"]')!;
  const counts = { add: 0, save: 0, submit: 0, remove: 0, cancel: 0 };
  const saved: Record<string, string>[] = []; const cards: HTMLElement[] = [];
  const add = doc.createElement('button'); add.type = 'button'; add.textContent = '+'; add.setAttribute('aria-controls', list.id);
  const makeCard = (value: { school?: string; level?: string; major?: string; startDate?: string; endDate?: string }) => {
    const card = doc.createElement('article'); card.setAttribute('role', 'listitem');
    const heading = doc.createElement('h3'); heading.textContent = value.school ?? ''; card.append(heading);
    for (const [key, label] of [['level', '学历'], ['major', '专业'], ['startDate', '入学日期'], ['endDate', '毕业日期']] as const) {
      const paragraph = doc.createElement('p'); paragraph.textContent = `${label}：${value[key] ?? ''}`; card.append(paragraph);
    }
    for (const caption of ['编辑教育经历', '删除']) {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = caption; card.append(button);
      if (caption === '删除') button.addEventListener('click', () => counts.remove++);
    }
    return card;
  };
  cards.push(...initial.map(index => makeCard({ ...profile.education[index]! })));
  const empty = doc.createElement('p'); empty.setAttribute('role', 'status'); empty.textContent = '暂无教育经历';
  const closed = () => list.replaceChildren(...cards, ...(cards.length ? [] : [empty]), add);
  add.addEventListener('click', () => {
    counts.add++;
    const editor = doc.createElement('form'); editor.setAttribute('aria-label', '新增教育经历');
    const fields: readonly [string, string, string][] = [
      ['school', '学校名称', '<input required>'], ['major', '专业', '<input required>'],
      ['level', '学历', '<select required><option value="">请选择</option><option value="B">本科</option><option value="M">硕士研究生</option></select>'],
      ['degree', '学位', '<select required><option value="">请选择</option><option value="BD">学士学位</option><option value="MD">硕士学位</option></select>'],
      ['educationType', '教育类型', '<select required><option value="">请选择</option><option value="R">统招</option></select>'],
      ['schoolProperty', '院校性质', '<select required><option value="">请选择</option><option value="N">国内普通院校</option><option value="U">211</option></select>'],
      ['durationYears', '学制', '<input type="number" required>'], ['gpa', 'GPA', '<input>'], ['ranking', '年级排名', '<input>'],
      ['startDate', '入学日期', '<input type="month" required>'], ['endDate', '毕业日期', '<input type="month" required>'],
    ];
    fields.forEach(([key, caption, markup], index) => {
      const label = doc.createElement('label'); label.textContent = caption; label.insertAdjacentHTML('beforeend', markup);
      const field = label.querySelector<HTMLInputElement | HTMLSelectElement>('input,select')!;
      field.name = `opaque-${index}`; field.dataset.testKey = key; editor.append(label);
    });
    const save = doc.createElement('button'); save.type = 'button'; save.textContent = '保存'; editor.append(save);
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; editor.append(cancel);
    cancel.addEventListener('click', () => counts.cancel++);
    save.addEventListener('click', () => {
      counts.save++; if (!editor.checkValidity()) return;
      const values: Record<string, string> = {};
      for (const field of editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')) {
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
