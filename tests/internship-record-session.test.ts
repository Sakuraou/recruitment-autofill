import { afterEach, expect, it } from 'vitest';
import { createInternshipRecordSession, internshipRecordAvailability } from '../src/content/internshipRecordSession';
import { internshipSessionProfile as profile, installInternshipSessionPage } from './fixtures/internship-session-page';

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; window.history.replaceState({}, '', '/'); });
it.each(['软件开发实习生', '实习经历', '未标注公司'])('已有卡片仅有岗位或泛标题 %s，不能判成另一家公司再新增', async caption => {
  const page = installInternshipSessionPage(document, profile, [0]);
  page.cards[0]!.querySelector('h3')!.textContent = caption;
  const result = await createInternshipRecordSession(document, profile).advance();
  expect(result.status).toBe('request-human');
  expect(page.counts).toEqual({ add: 0, save: 0, submit: 0, remove: 0, cancel: 0 });
});
it.each(['role', 'generic'])('已有卡片以%s作标题、有明确公司，只补另一条且重启不重复', async mode => {
  const page = installInternshipSessionPage(document, profile, [0]); const first = page.cards[0]!;
  first.querySelector('h3')!.textContent = mode === 'role' ? profile.internships[0]!.role! : '实习经历';
  const employer = document.createElement('p'); employer.textContent = `工作单位：${profile.internships[0]!.organization}`; first.append(employer);
  await finish(createInternshipRecordSession(document, profile)); await finish(createInternshipRecordSession(document, profile));
  expect(page.saved).toHaveLength(1); expect(page.saved[0]!.organization).toBe(profile.internships[1]!.organization);
  expect(page.counts).toEqual({ add: 1, save: 1, submit: 0, remove: 0, cancel: 0 });
}, 15_000);
async function finish(session: ReturnType<typeof createInternshipRecordSession>) {
  for (let step = 0; step < 15; step++) {
    const result = await session.advance(); if (result.status === 'complete') return;
    expect(result.status, JSON.stringify(result)).toBe('advanced');
  }
  throw new Error('internship session did not complete');
}
it('按源顺序逐条新增两次实习并保存各自十二项事实', async () => {
  const page = installInternshipSessionPage(document); const before = JSON.stringify(profile);
  await finish(createInternshipRecordSession(document, profile));
  expect(page.saved).toEqual(profile.internships.map(record => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'id'))));
  expect(page.counts).toEqual({ add: 2, save: 2, submit: 0, remove: 0, cancel: 0 });
  expect(JSON.stringify(profile)).toBe(before);
}, 15_000);
it('可用性检查无动作且无事实泄露', () => {
  const page = installInternshipSessionPage(document);
  expect(internshipRecordAvailability(document)).toEqual({ eligible: true }); expect(page.counts.add).toBe(0);
});
it.each([[], [0], [1], [0, 1], [1, 0]].map(indices => ({ indices })))('已有实习 $indices 只补缺少项，重新启动不重复', async ({ indices }) => {
  const page = installInternshipSessionPage(document, profile, indices);
  await finish(createInternshipRecordSession(document, profile)); await finish(createInternshipRecordSession(document, profile));
  expect(page.cards).toHaveLength(2);
  expect(page.counts).toEqual({ add: 2 - indices.length, save: 2 - indices.length, submit: 0, remove: 0, cancel: 0 });
}, 15_000);
it.each(['role', 'dates'])('同公司多次实习按不同%s区分，已有第二条只补第一条', async mode => {
  const local = { ...profile, internships: profile.internships.map(record => ({ ...record, organization: '虚构共同公司',
    ...(mode === 'dates' ? { role: '软件实习生' } : {}) })) };
  const page = installInternshipSessionPage(document, local, [1]); await finish(createInternshipRecordSession(document, local));
  expect(page.saved).toHaveLength(1); expect(page.saved[0]!.startDate).toBe(local.internships[0]!.startDate);
  expect(page.saved[0]!.role).toBe(local.internships[0]!.role);
}, 15_000);
it.each(['navigate', 'list', 'opened', 'two-lists', 'submit-add'])('页面%s拒绝动作', async mode => {
  const page = installInternshipSessionPage(document);
  if (mode === 'opened') page.add.click();
  if (mode === 'two-lists') document.querySelector('main')!.append(document.querySelector('section')!.cloneNode(true));
  if (mode === 'submit-add') page.add.type = 'submit';
  if (['opened', 'two-lists', 'submit-add'].includes(mode)) {
    expect(() => createInternshipRecordSession(document, profile)).toThrow(); expect(page.counts.save).toBe(0); return;
  }
  const session = createInternshipRecordSession(document, profile);
  if (mode === 'navigate') window.history.replaceState({}, '', '/another-application');
  else page.list.replaceWith(page.list.cloneNode(true));
  expect((await session.advance()).status).toBe('request-human'); expect(page.counts.add).toBe(0);
});
it.each(['manual', 'replace-field', 'replace-save', 'new-field'])('填写核验后%s拒绝保存，保留草稿', async mode => {
  const page = installInternshipSessionPage(document); const session = createInternshipRecordSession(document, profile);
  await session.advance(); await session.advance();
  const field = page.list.querySelector<HTMLInputElement>('input')!;
  if (mode === 'manual') field.value = '用户手工修改';
  if (mode === 'replace-field') field.replaceWith(field.cloneNode(true));
  if (mode === 'replace-save') { const save = page.list.querySelector('form button')!; save.replaceWith(save.cloneNode(true)); }
  if (mode === 'new-field') page.list.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>所在部门<input></label>');
  expect((await session.advance()).status).toBe('request-human'); expect(page.counts.save).toBe(0);
  if (mode === 'manual') expect(field.value).toBe('用户手工修改');
});
it.each(['revision', 'same-revision', 'unavailable'])('资料%s拒绝继续操作', async mode => {
  const page = installInternshipSessionPage(document);
  const refresh = async () => {
    if (mode === 'unavailable') throw new Error('offline');
    return mode === 'revision' ? { ...profile, profileRevision: 'new-revision' }
      : { ...profile, internships: profile.internships.map(record => ({ ...record, description: '新工作描述' })) };
  };
  const result = await createInternshipRecordSession(document, profile, refresh).advance();
  expect(result).toMatchObject({ status: 'request-human', reason: mode === 'unavailable' ? 'profile-projection-unavailable' : 'profile-changed' });
  expect(page.counts.add + page.counts.save).toBe(0);
});
it('停止打断当前填写，不再保存或新增下一条', async () => {
  const page = installInternshipSessionPage(document); const session = createInternshipRecordSession(document, profile);
  await session.advance(); const inputs = page.list.querySelectorAll<HTMLInputElement>('input');
  inputs[0]!.addEventListener('input', () => session.stop());
  expect((await session.advance()).status).toBe('stopped'); expect(inputs[1]!.value).toBe('');
  expect(page.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0, cancel: 0 });
});
it('保存错误公司卡片后不能进入下一条或重试保存', async () => {
  const page = installInternshipSessionPage(document);
  page.add.addEventListener('click', () => page.list.querySelector('form button')!.addEventListener('click', () => {
    page.cards[0]!.querySelector('h3')!.textContent = '虚构错误公司';
  }));
  const session = createInternshipRecordSession(document, profile);
  await session.advance(); await session.advance(); await session.advance();
  expect((await session.advance()).status).toBe('request-human');
  expect(page.counts).toEqual({ add: 1, save: 1, submit: 0, remove: 0, cancel: 0 });
});
it.each(['duplicate', 'insufficient', 'month-only'])('已有身份%s零新增，不猜第一条', async mode => {
  const page = installInternshipSessionPage(document, profile, mode === 'duplicate' ? [0, 0] : [0]);
  if (mode === 'insufficient') page.cards[0]!.querySelectorAll('p').forEach(node => node.remove());
  if (mode === 'month-only') page.cards[0]!.querySelectorAll('p')[1]!.textContent = '入职日期：2025-07';
  expect((await createInternshipRecordSession(document, profile).advance()).status).toBe('request-human');
  expect(page.counts.add + page.counts.save).toBe(0);
});
it.each(['unknown', 'contact', 'missing-description', 'missing-proof', 'orphan'])('字段%s整条预检失败，已知字段也不先写', async mode => {
  const local = { ...profile, internships: profile.internships.map(record => ({ ...record,
    ...(mode === 'missing-description' ? { description: undefined } : {}),
    ...(mode === 'missing-proof' ? { hasProof: undefined } : {}) })) };
  const page = installInternshipSessionPage(document, local);
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    if (mode === 'unknown') form.insertAdjacentHTML('beforeend', '<label>陌生评估项<input></label>');
    if (mode === 'contact') form.insertAdjacentHTML('beforeend', '<label>证明人电话<input></label>');
    if (mode === 'orphan') form.insertAdjacentHTML('beforeend', '<fieldset><legend>其他问题</legend><label>所在部门<input></label></fieldset>');
  });
  const session = createInternshipRecordSession(document, local); await session.advance();
  expect((await session.advance()).status).toBe('request-human');
  expect(Array.from(page.list.querySelectorAll<HTMLInputElement>('input,textarea')).every(field => !field.value)).toBe(true);
  expect(page.counts.save).toBe(0);
});
it('联动延迟新增部门字段，重新取当前条事实后保存', async () => {
  const page = installInternshipSessionPage(document);
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    form.querySelector('[data-test-key="department"]')!.parentElement!.remove();
    form.querySelector('[data-test-key="workType"]')!.addEventListener('change', () => {
      setTimeout(() => form.querySelector('button')!.insertAdjacentHTML('beforebegin', '<label>所在部门<input required data-test-key="department"></label>'), 30);
    }, { once: true });
  });
  await finish(createInternshipRecordSession(document, profile));
  expect(page.saved.map(record => record.department)).toEqual(profile.internships.map(record => record.department));
}, 15_000);
it('添加后既有卡片岗位被改动，在写入前停止', async () => {
  const page = installInternshipSessionPage(document, profile, [1]); const session = createInternshipRecordSession(document, profile);
  await session.advance(); page.cards[0]!.querySelector('p')!.textContent = '岗位：用户改动岗位';
  expect((await session.advance()).status).toBe('request-human');
  expect(page.list.querySelector<HTMLInputElement>('input')!.value).toBe(''); expect(page.counts.save).toBe(0);
});
it.each(['unknown', 'contact', 'missing', 'stop'])('联动后%s保留当前草稿，不能保存或新增下一条', async mode => {
  const local = { ...profile, internships: profile.internships.map(record => ({ ...record,
    ...(mode === 'missing' ? { department: undefined } : {}) })) };
  const page = installInternshipSessionPage(document, local);
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    form.querySelector('[data-test-key="department"]')!.parentElement!.remove();
    form.querySelector('[data-test-key="workType"]')!.addEventListener('change', () => {
      const caption = mode === 'unknown' ? '陌生评估项' : mode === 'contact' ? '证明人电话' : '所在部门';
      setTimeout(() => form.querySelector('button')!.insertAdjacentHTML('beforebegin', `<label>${caption}<input></label>`), 30);
    }, { once: true });
  });
  const session = createInternshipRecordSession(document, local);
  expect((await session.advance()).status).toBe('advanced');
  expect((await session.advance()).status).toBe('advanced');
  if (mode === 'stop') session.stop();
  expect((await session.advance()).status).toBe(mode === 'stop' ? 'stopped' : 'request-human');
  expect(page.list.querySelector<HTMLInputElement>('input')!.value).toBe(local.internships[0]!.organization);
  expect(page.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0, cancel: 0 });
});
it('其他项目栏目并存时只操作实习列表', async () => {
  const page = installInternshipSessionPage(document);
  const section = document.createElement('section'); section.setAttribute('aria-label', '项目经历');
  section.innerHTML = '<h2>项目经历</h2><div role="list"><article><h3>虚构项目</h3><p>项目简介：测试</p></article><button type="button">添加项目经历</button></div>';
  let clicks = 0; section.querySelector('button')!.addEventListener('click', () => clicks++); document.querySelector('main')!.append(section);
  await finish(createInternshipRecordSession(document, profile)); expect(clicks).toBe(0); expect(page.counts.save).toBe(2);
}, 15_000);
it.each(['after-add', 'after-fill', 'manual'])('直接中断暂停%s不写，恢复不能复用失效的 Add 快照', async mode => {
  const page = installInternshipSessionPage(document); const session = createInternshipRecordSession(document, profile);
  await session.advance(); if (mode !== 'after-add') await session.advance();
  session.pause(); const before = { ...page.counts };
  expect((await session.advance()).status).toBe('paused'); expect(page.counts).toEqual(before);
  if (mode === 'manual') page.list.querySelector<HTMLInputElement>('input')!.value = '用户手改';
  session.resume();
  if (mode === 'after-add') {
    expect(await session.advance()).toMatchObject({ status: 'request-human', reason: 'active-transaction-mismatch' });
    expect(page.counts.save).toBe(0);
  } else if (mode === 'manual') {
    expect((await session.advance()).status).toBe('request-human'); expect(page.counts.save).toBe(0);
    expect(page.list.querySelector<HTMLInputElement>('input')!.value).toBe('用户手改');
  } else { await finish(session); expect(page.counts.save).toBe(2); }
}, 15_000);
it('同一会话在途调用只允许一次 Add', async () => {
  const page = installInternshipSessionPage(document); const session = createInternshipRecordSession(document, profile);
  const first = session.advance(); expect((await session.advance()).status).toBe('busy');
  expect((await first).status).toBe('advanced'); expect(page.counts.add).toBe(1); expect(page.counts.save).toBe(0);
});
it('联动超过三批问题停止，不省略剩余字段保存', async () => {
  const page = installInternshipSessionPage(document);
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!; const save = form.querySelector('button')!;
    const labels = ['companyProperty', 'monthlySalary', 'hasProof'].map(key => form.querySelector(`[data-test-key="${key}"]`)!.parentElement!);
    labels.forEach(label => label.remove());
    const reveal = (trigger: Element, index: number) => trigger.addEventListener('change', () => {
      save.before(labels[index]!);
      if (index < 2) reveal(labels[index]!.querySelector('select')!, index + 1);
    }, { once: true });
    reveal(form.querySelector('[data-test-key="workType"]')!, 0);
  });
  const session = createInternshipRecordSession(document, profile);
  for (let step = 0; step < 3; step++) expect((await session.advance()).status).toBe('advanced');
  expect(await session.advance()).toMatchObject({ status: 'request-human', reason: 'editor-expansion-limit' });
  expect(page.counts.add).toBe(1); expect(page.counts.save).toBe(0);
});
