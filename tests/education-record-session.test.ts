import { afterEach, expect, it } from 'vitest';
import { createEducationRecordSession, educationRecordAvailability } from '../src/content/educationRecordSession';
import { educationSessionProfile as profile, installEducationSessionPage } from './fixtures/education-session-page';

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; window.history.replaceState({}, '', '/'); });
async function finish(session: ReturnType<typeof createEducationRecordSession>) {
  for (let step = 0; step < 14; step++) {
    const result = await session.advance(); if (result.status === 'complete') return;
    expect(result.status).toBe('advanced');
  }
  throw new Error('education session did not complete');
}
it('源档案硕士在前，教育会话按本科、硕士各自事实逐条新增保存', async () => {
  const page = installEducationSessionPage(document); const before = JSON.stringify(profile);
  const session = createEducationRecordSession(document, profile); await finish(session);
  expect(page.saved.map(record => record.school)).toEqual([profile.education[1]!.school, profile.education[0]!.school]);
  for (const [index, source] of [profile.education[1]!, profile.education[0]!].entries()) {
    expect(page.saved[index]).toEqual(Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'id')));
  }
  expect(page.counts).toEqual({ add: 2, save: 2, submit: 0, remove: 0, cancel: 0 });
  expect(JSON.stringify(profile)).toBe(before);
}, 15_000);
it('可用性只返回教育栏目结论，不执行动作', () => {
  const page = installEducationSessionPage(document);
  expect(educationRecordAvailability(document)).toEqual({ eligible: true }); expect(page.counts.add).toBe(0);
});
it.each([[], [0], [1], [0, 1], [1, 0]].map(indices => ({ indices })))('已有教育卡片 $indices：仅新增缺少记录且重启不重复', async ({ indices: initial }) => {
  const page = installEducationSessionPage(document, profile, initial);
  await finish(createEducationRecordSession(document, profile));
  await finish(createEducationRecordSession(document, profile));
  expect(page.cards).toHaveLength(2);
  expect(page.counts).toEqual({ add: 2 - initial.length, save: 2 - initial.length, submit: 0, remove: 0, cancel: 0 });
}, 15_000);
it('同校本科和硕士按教育阶段区分，不重复已有硕士', async () => {
  const local = { ...profile, education: profile.education.map(record => ({ ...record, school: '虚构同校大学' })) };
  const page = installEducationSessionPage(document, local, [0]); await finish(createEducationRecordSession(document, local));
  expect(page.saved).toHaveLength(1); expect(page.saved[0]!.level).toBe('本科'); expect(page.counts.add).toBe(1);
});
it.each(['navigate', 'list', 'opened', 'two-lists', 'submit-add'])('启动前页面%s不执行教育动作', async mode => {
  const page = installEducationSessionPage(document);
  if (mode === 'opened') page.add.click();
  if (mode === 'two-lists') document.querySelector('main')!.append(document.querySelector('section')!.cloneNode(true));
  if (mode === 'submit-add') page.add.type = 'submit';
  if (['opened', 'two-lists', 'submit-add'].includes(mode)) {
    expect(() => createEducationRecordSession(document, profile)).toThrow(); expect(page.counts.save).toBe(0); return;
  }
  const session = createEducationRecordSession(document, profile);
  if (mode === 'navigate') window.history.replaceState({}, '', '/other-resume');
  else page.list.replaceWith(page.list.cloneNode(true));
  expect((await session.advance()).status).toBe('request-human'); expect(page.counts.add).toBe(0);
});
it.each(['manual', 'replace-field', 'replace-save', 'new-field'])('教育填写核验后%s时零保存且保留网页内容', async mode => {
  const page = installEducationSessionPage(document); const session = createEducationRecordSession(document, profile);
  await session.advance(); await session.advance();
  const field = page.list.querySelector<HTMLInputElement>('input')!;
  if (mode === 'manual') field.value = '用户手工修改';
  if (mode === 'replace-field') field.replaceWith(field.cloneNode(true));
  if (mode === 'replace-save') { const save = page.list.querySelector('form button')!; save.replaceWith(save.cloneNode(true)); }
  if (mode === 'new-field') page.list.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>院系<input></label>');
  expect((await session.advance()).status).toBe('request-human'); expect(page.counts.save).toBe(0);
  if (mode === 'manual') expect(field.value).toBe('用户手工修改');
});
it.each(['revision', 'same-revision', 'unavailable'])('可信教育资料%s时零动作停止', async mode => {
  const page = installEducationSessionPage(document);
  const refresh = async () => {
    if (mode === 'unavailable') throw new Error('offline');
    return mode === 'revision' ? { ...profile, profileRevision: 'new-revision' }
      : { ...profile, education: profile.education.map(record => ({ ...record, major: '已修改专业' })) };
  };
  const result = await createEducationRecordSession(document, profile, refresh).advance();
  expect(result).toMatchObject({ status: 'request-human', reason: mode === 'unavailable' ? 'profile-projection-unavailable' : 'profile-changed' });
  expect(page.counts.add).toBe(0); expect(page.counts.save).toBe(0);
});
it('停止打断本条后续字段，不保存或打开下一条', async () => {
  const page = installEducationSessionPage(document); const session = createEducationRecordSession(document, profile);
  await session.advance(); const inputs = page.list.querySelectorAll<HTMLInputElement>('input');
  inputs[0]!.addEventListener('input', () => session.stop());
  expect((await session.advance()).status).toBe('stopped');
  expect(inputs[1]!.value).toBe(''); expect(page.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0, cancel: 0 });
});
it('保存返回错误卡片时不开始硕士，不再次 Add/Save', async () => {
  const page = installEducationSessionPage(document);
  page.add.addEventListener('click', () => page.list.querySelector('form button')!.addEventListener('click', () => {
    page.cards[0]!.querySelector('h3')!.textContent = '虚构错误院校';
  }));
  const session = createEducationRecordSession(document, profile); await session.advance(); await session.advance();
  await session.advance(); expect((await session.advance()).status).toBe('request-human');
  expect(page.counts).toEqual({ add: 1, save: 1, submit: 0, remove: 0, cancel: 0 });
});
it('项目栏目并存时只操作教育列表', async () => {
  const page = installEducationSessionPage(document);
  const section = document.createElement('section'); section.setAttribute('aria-label', '项目经历');
  section.innerHTML = '<h2>项目经历</h2><div role="list"><article><h3>虚构项目</h3><p>项目简介：测试</p></article><button type="button">添加项目经历</button></div>';
  let projectClicks = 0; section.querySelector('button')!.addEventListener('click', () => projectClicks++); document.querySelector('main')!.append(section);
  await finish(createEducationRecordSession(document, profile)); expect(projectClicks).toBe(0); expect(page.counts.save).toBe(2);
}, 15_000);
it('教育类型选择后延迟出现学制，重新规划仍取当前本科和硕士的不同答案', async () => {
  const page = installEducationSessionPage(document);
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    form.querySelector('[data-test-key="durationYears"]')!.parentElement!.remove();
    form.querySelector('[data-test-key="educationType"]')!.addEventListener('change', () => {
      setTimeout(() => form.querySelector('button')!.insertAdjacentHTML('beforebegin', '<label>学制<input type="number" required data-test-key="durationYears"></label>'), 30);
    }, { once: true });
  });
  await finish(createEducationRecordSession(document, profile));
  expect(page.saved.map(record => record.durationYears)).toEqual(['4', '3']); expect(page.counts.save).toBe(2);
}, 15_000);
it('同一教育编辑器超过三批问题时停止，不省略新字段并保存', async () => {
  const page = installEducationSessionPage(document);
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!; const labels = form.querySelectorAll('label'); const school = labels[0]!;
    const buttons = Array.from(form.querySelectorAll('button')); form.replaceChildren(school, labels[1]!, ...buttons);
    school.querySelector('input')!.addEventListener('input', () => {
      buttons[0]!.insertAdjacentHTML('beforebegin', '<label>学历<select data-test-key="level"><option value="">请选择</option><option value="B">本科</option><option value="M">硕士研究生</option></select></label>');
      form.querySelector('[data-test-key="level"]')!.addEventListener('change', () => {
        buttons[0]!.insertAdjacentHTML('beforebegin', '<label>学位<select data-test-key="degree"><option value="">请选择</option><option>学士学位</option><option>硕士学位</option></select></label>');
        form.querySelector('[data-test-key="degree"]')!.addEventListener('change', () => {
          buttons[0]!.insertAdjacentHTML('beforebegin', '<label>教育类型<select><option value="">请选择</option><option>统招</option></select></label>');
        }, { once: true });
      }, { once: true });
    }, { once: true });
  });
  const session = createEducationRecordSession(document, profile);
  for (let step = 0; step < 3; step++) expect((await session.advance()).status).toBe('advanced');
  expect(await session.advance()).toMatchObject({ status: 'request-human', reason: 'editor-expansion-limit' });
  expect(page.counts.save).toBe(0); expect(page.counts.add).toBe(1);
});
it('添加后已有教育卡片事实变化时，在写入前停下', async () => {
  const page = installEducationSessionPage(document, profile, [0]); const session = createEducationRecordSession(document, profile);
  await session.advance(); page.cards[0]!.querySelectorAll('p')[1]!.textContent = '专业：其他专业';
  expect((await session.advance()).status).toBe('request-human'); expect(page.counts.save).toBe(0);
  expect(page.list.querySelector<HTMLInputElement>('input')!.value).toBe('');
});
it.each(['duplicate', 'insufficient'])('已有身份%s时零 Add，不猜测第一条', async mode => {
  const page = installEducationSessionPage(document, profile, mode === 'duplicate' ? [0, 0] : [0]);
  if (mode === 'insufficient') page.cards[0]!.querySelectorAll('p').forEach(node => node.remove());
  const result = await createEducationRecordSession(document, profile).advance();
  expect(result.status).toBe('request-human'); expect(page.counts.add).toBe(0); expect(page.counts.save).toBe(0);
});
it.each(['unknown', 'highest', 'missing'])('字段%s整条预检失败，不先写已知字段', async mode => {
  const page = installEducationSessionPage(document);
  const local = mode === 'missing' ? { ...profile, education: profile.education.map(record => ({ ...record, degree: undefined })) } : profile;
  page.add.addEventListener('click', () => {
    if (mode !== 'missing') page.list.querySelector('form')!.insertAdjacentHTML('beforeend', `<label>${mode === 'highest' ? '是否最高学位' : '陌生评估项'}<input></label>`);
  });
  const session = createEducationRecordSession(document, local); expect((await session.advance()).status).toBe('advanced');
  expect((await session.advance()).status).toBe('request-human');
  expect(Array.from(page.list.querySelectorAll('input')).every(node => !node.value)).toBe(true);
  expect(page.counts.save).toBe(0);
});
