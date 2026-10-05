import type { PublicationProjectionResponse } from '../../src/profile/publicationProjection';
export const publicationSessionProfile: PublicationProjectionResponse = {
  recordType: 'publication', profileRevision: 'fictional-publication-revision', presence: 'known', publications: [
    { id: 'paper-a', title: '虚构红外检测方法', venue: 'Fictional Journal A', doi: '10.1234/fictional-a', date: '2026-01-17',
      authorOrder: '第二作者', status: '已发表', abstract: '研究红外目标的轻量化检测方法。', publicationSituation: '发表于虚构期刊甲。', coauthors: '合著' },
    { id: 'paper-b', title: '虚构红外检测方法', venue: 'Fictional Journal B', doi: '10.1234/fictional-b', date: '2026-02-17',
      authorOrder: '第三作者', status: '在投', abstract: '研究不同背景下的目标检测方法。', publicationSituation: '投稿至虚构期刊乙。', coauthors: '合著' },
    { id: 'paper-c', title: '虚构时序目标识别研究', venue: 'Fictional Conference C', doi: '10.1234/fictional-c', date: '2026-03-17',
      authorOrder: '第一作者', status: '已发表', abstract: '研究序列图像中的目标识别。', publicationSituation: '发表于虚构会议丙。', coauthors: '合著' },
  ],
};
type PageOptions = { unknown?: boolean; saveRefused?: boolean; existingConflict?: boolean; dynamicVenue?: boolean;
  dynamicUnknown?: boolean; corruptSummary?: boolean; onStatus?: () => void; onSave?: () => void };
export function installPublicationSessionPage(doc: Document, initial: readonly number[] = [], options: PageOptions = {}) {
  doc.head.innerHTML = '';
  doc.body.innerHTML = '<main><section aria-label="专业论著"><h2>专业论著</h2><div role="list" id="paper-items"></div></section></main>';
  const list = doc.querySelector<HTMLElement>('[role="list"]')!;
  const counts = { add: 0, save: 0, remove: 0, submit: 0, cancel: 0 };
  const saved: Record<string, string>[] = [], cards: Element[] = [];
  const add = doc.createElement('button'); add.type = 'button'; add.textContent = '+'; add.setAttribute('aria-controls', list.id);
  function summary(values: Record<string, string>) {
    const card = doc.createElement('article'); card.setAttribute('role', 'listitem');
    for (const [label, key] of [['论著名称', 'title'], ['DOI', 'doi'], ['期刊名称', 'venue'], ['发表日期', 'date'],
      ['作者排序', 'authorOrder'], ['发表状态', 'status'], ['内容提要', 'abstract']] as const) {
      const p = doc.createElement('p'); p.textContent = label + '：' + (values[key] ?? ''); card.append(p);
    }
    const edit = doc.createElement('button'); edit.type = 'button'; edit.textContent = '编辑专业论著'; card.append(edit);
    const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
    remove.addEventListener('click', () => counts.remove++); card.append(remove); return card;
  }
  for (const index of initial) {
    const paper = publicationSessionProfile.publications[index]!;
    const values = Object.fromEntries(Object.entries(paper).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    cards.push(summary(values));
  }
  const empty = doc.createElement('p'); empty.setAttribute('role', 'status'); empty.textContent = '暂无专业论著';
  const closed = () => list.replaceChildren(...cards, ...(cards.length ? [] : [empty]), add);
  add.addEventListener('click', () => {
    counts.add++; const form = doc.createElement('form'); form.setAttribute('aria-label', '新增专业论著');
    form.innerHTML = '<label>论著名称<input required data-key="title"></label><label>DOI<input required data-key="doi"></label>'
      + '<label>内容提要<textarea required maxlength="50" data-key="abstract"></textarea></label>'
      + '<label>成就/等级<select required data-key="status"><option value="">请选择</option><option value="published">已发表</option><option value="submitted">在投</option></select></label>'
      + '<label>日期<input type="date" required data-key="date"></label>'
      + '<label>作者排序<select required data-key="authorOrder"><option value="">请选择</option><option value="one">第一作者</option><option value="two">第二作者</option><option value="three">第三作者</option></select></label>'
      + '<label>出版、登载获奖在学术会议上交流情况<textarea required maxlength="50" data-key="publicationSituation"></textarea></label>'
      + '<label>合（独）著、译<input required data-key="coauthors"></label><button type="button">保存</button><button type="button">取消</button>';
    const venue = () => { const label = doc.createElement('label'); label.textContent = '期刊名称';
      const control = doc.createElement('input'); control.required = true; control.dataset.key = 'venue'; label.append(control); form.querySelector('button')!.before(label); };
    if (!options.dynamicVenue) venue();
    if (options.unknown) form.insertAdjacentHTML('beforeend', '<label>未知问题<input required></label>');
    if (options.existingConflict) form.querySelector<HTMLInputElement>('[data-key="title"]')!.value = '网页其他论文';
    form.querySelector('[data-key="status"]')!.addEventListener('change', () => {
      if (options.dynamicVenue && !form.querySelector('[data-key="venue"]')) venue();
      if (options.dynamicUnknown && !form.querySelector('[data-unknown]')) form.insertAdjacentHTML('beforeend', '<label>未知联动问题<input data-unknown required></label>');
      options.onStatus?.();
    });
    form.querySelectorAll('button')[1]!.addEventListener('click', () => counts.cancel++);
    form.querySelector('button')!.addEventListener('click', () => {
      counts.save++; options.onSave?.(); if (options.saveRefused || !form.checkValidity()) return;
      const values: Record<string, string> = {}, display: Record<string, string> = {};
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,select,textarea')) {
        if (!control.dataset.key) continue;
        values[control.dataset.key] = control.value;
        display[control.dataset.key] = control.tagName === 'SELECT' ? (control as HTMLSelectElement).selectedOptions[0]!.textContent! : control.value;
      }
      saved.push(values);
      if (options.corruptSummary) display.title = '保存后的错误标题';
      cards.unshift(summary(display)); closed();
    });
    list.append(form);
  });
  closed(); const submit = doc.createElement('button'); submit.type = 'button'; submit.textContent = '最终提交';
  submit.addEventListener('click', () => counts.submit++); doc.body.append(submit);
  return { list, add, counts, saved, cards };
}
