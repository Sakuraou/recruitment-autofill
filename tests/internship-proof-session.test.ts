import { afterEach, expect, it } from 'vitest';
import { createInternshipRecordSession } from '../src/content/internshipRecordSession';
import { internshipSessionProfile as profile, installInternshipSessionPage } from './fixtures/internship-session-page';

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; });
function install(kind: 'select' | 'radio' = 'select') {
  const page = installInternshipSessionPage(document);
  page.add.addEventListener('click', () => {
    const select = page.list.querySelector<HTMLSelectElement>('[data-test-key="hasProof"]')!;
    const label = select.parentElement!; const group = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = '是否有证明';
    label.firstChild!.textContent = ''; label.replaceWith(group); group.append(legend);
    if (kind === 'select') group.append(label);
    else group.insertAdjacentHTML('beforeend', '<label><input type="radio" required name="proof" value="opaque-yes" data-test-key="hasProof">是</label><label><input type="radio" name="proof" value="opaque-no" data-test-key="hasProof">否</label>');
  });
  return page;
}
async function finish(session: ReturnType<typeof createInternshipRecordSession>) {
  for (let step = 0; step < 15; step++) {
    const result = await session.advance(); if (result.status === 'complete') return;
    expect(result.status, JSON.stringify(result)).toBe('advanced');
  }
  throw new Error('fictional proof session did not complete');
}
it.each(['select', 'radio'] as const)('实习原生证明 %s 每条取自己的否／是，重启不重复', async kind => {
  const page = install(kind);
  await finish(createInternshipRecordSession(document, profile));
  await finish(createInternshipRecordSession(document, profile));
  expect(page.saved.map(record => record.hasProof)).toEqual(['否', '是']);
  expect(page.counts).toEqual({ add: 2, save: 2, submit: 0, remove: 0, cancel: 0 });
}, 15_000);
it.each(['新建实习经历', '新增工作经历', 'Create internship', 'New work experience'])('创建框名称 %s 仍须从明确实习栏目继承归属', async caption => {
  const local = { ...profile, internships: [profile.internships[0]!] }; const page = install();
  page.add.addEventListener('click', () => page.list.querySelector('form')!.setAttribute('aria-label', caption));
  await finish(createInternshipRecordSession(document, local));
  expect(page.saved[0]!.hasProof).toBe('否');
  expect(page.counts).toEqual({ add: 1, save: 1, submit: 0, remove: 0, cancel: 0 });
}, 15_000);
it.each(['编辑实习经历', 'Edit work experience', 'Add internship'])('缺少新建状态证据的框 %s 不能凭证明问题推成新建记录', async caption => {
  const page = install(); page.add.addEventListener('click', () => page.list.querySelector('form')!.setAttribute('aria-label', caption));
  const result = await createInternshipRecordSession(document, profile).advance();
  expect(result.status).toBe('request-human'); expect(page.counts.save).toBe(0);
  expect(page.list.querySelector<HTMLInputElement>('input')!.value).toBe('');
});
it.each(['missing', 'default-no', 'manual-no', 'foreign-aria', 'unknown-legend', 'action', 'contact', 'nested', 'foreign-section', 'unknown-section', 'unlabelled-section', 'unknown-editor-name', 'foreign-form', 'external-member'])('证明组 %s 时保留草稿，不先写已知字段或保存', async mode => {
  const local = mode === 'missing' || mode === 'default-no' ? { ...profile, internships: profile.internships.map(record => ({ ...record, hasProof: undefined })) }
    : mode === 'manual-no' ? { ...profile, internships: [profile.internships[1]!] } : profile;
  const page = install();
  page.add.addEventListener('click', () => {
    const group = page.list.querySelector('fieldset')!; const select = group.querySelector('select')!;
    if (mode === 'manual-no' || mode === 'default-no') select.selectedIndex = 2;
    if (mode === 'foreign-aria') group.setAttribute('aria-label', '教育经历');
    if (mode === 'unknown-legend') group.querySelector('legend')!.textContent = '补充业务问题';
    if (mode === 'action') group.insertAdjacentHTML('beforeend', '<button type="button">保存</button>');
    if (mode === 'contact') group.insertAdjacentHTML('beforeend', '<label>证明人电话<input></label>');
    if (mode === 'nested') group.insertAdjacentHTML('beforeend', '<fieldset><legend>其他信息</legend></fieldset>');
    if (mode === 'foreign-section' || mode === 'unknown-section' || mode === 'unlabelled-section') {
      const wrapper = document.createElement('section');
      if (mode !== 'unlabelled-section') wrapper.setAttribute('aria-label', mode === 'foreign-section' ? '教育经历' : '未知业务区域');
      group.replaceWith(wrapper); wrapper.append(group);
    }
    if (mode === 'unknown-editor-name') group.closest('form')!.setAttribute('aria-label', '未知业务表单');
    if (mode === 'foreign-form') {
      document.body.insertAdjacentHTML('beforeend', '<form id="other-proof"></form>'); select.setAttribute('form', 'other-proof');
    }
    if (mode === 'external-member') {
      select.remove(); group.insertAdjacentHTML('beforeend', '<label><input type="radio" name="proof">是</label><label><input type="radio" name="proof">否</label>');
      group.parentElement!.insertAdjacentHTML('beforeend', '<label hidden><input type="radio" name="proof" checked>外部选项</label>');
    }
  });
  const session = createInternshipRecordSession(document, local);
  let result = await session.advance(); if (result.status === 'advanced') result = await session.advance();
  expect(result.status).toBe('request-human'); expect(page.counts.save).toBe(0);
  expect(page.list.querySelector<HTMLInputElement>('input')!.value).toBe('');
  if (mode === 'manual-no') expect(page.list.querySelector<HTMLSelectElement>('fieldset select')!.selectedOptions[0]!.textContent).toBe('否');
  if (mode === 'default-no') expect(page.list.querySelector<HTMLSelectElement>('fieldset select')!.selectedOptions[0]!.textContent).toBe('否');
  if (mode === 'external-member') expect(page.list.querySelector<HTMLInputElement>('label[hidden] input')!.checked).toBe(true);
});

it.each(['select', 'radio'] as const)('证明%s选择是后展开已知部门，继续同条填写并保存，事实不跨记录', async kind => {
  const page = install(kind);
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    const department = form.querySelector('[data-test-key="department"]')!.parentElement!; department.remove();
    const group = form.querySelector('fieldset')!;
    group.addEventListener('change', () => setTimeout(() => {
      if (!department.isConnected) form.querySelector('button')!.before(department);
    }, 30));
  });
  await finish(createInternshipRecordSession(document, profile));
  expect(page.saved.map(record => record.department)).toEqual(profile.internships.map(record => record.department));
  expect(page.saved.map(record => record.hasProof)).toEqual(['否', '是']);
  expect(page.counts).toEqual({ add: 2, save: 2, submit: 0, remove: 0, cancel: 0 });
}, 15_000);

it.each(['contact', 'upload', 'unknown', 'manual', 'stop'])('证明选择是后 %s 保留已接受的选择与草稿，不能漏字段保存或新增下一条', async mode => {
  const local = { ...profile, internships: [profile.internships[1]!] }; const page = install();
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    const department = form.querySelector('[data-test-key="department"]')!.parentElement!;
    if (mode === 'manual' || mode === 'stop') department.remove();
    form.querySelector('fieldset select')!.addEventListener('change', () => {
      setTimeout(() => {
        if (mode === 'manual' || mode === 'stop') form.querySelector('button')!.before(department);
        else {
          const markup = mode === 'upload' ? '<label>上传实习证明<input type="file"></label>'
            : `<label>${mode === 'contact' ? '证明人电话' : '陌生评估项'}<input></label>`;
          form.querySelector('button')!.insertAdjacentHTML('beforebegin', markup);
        }
      }, 30);
    }, { once: true });
  });
  const session = createInternshipRecordSession(document, local); expect((await session.advance()).status).toBe('advanced');
  let result = await session.advance();
  if (mode === 'manual' || mode === 'stop') {
    expect(result.status).toBe('advanced');
    if (mode === 'stop') session.stop();
    else page.list.querySelector<HTMLInputElement>('[data-test-key="organization"]')!.value = '用户修改的单位';
  }
  if (result.status === 'advanced') result = await session.advance();
  expect(result.status).toBe(mode === 'stop' ? 'stopped' : 'request-human');
  expect(page.list.querySelector<HTMLSelectElement>('fieldset select')!.selectedOptions[0]!.textContent).toBe('是');
  expect(page.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0, cancel: 0 });
  if (mode === 'manual') expect(page.list.querySelector<HTMLInputElement>('[data-test-key="organization"]')!.value).toBe('用户修改的单位');
});
