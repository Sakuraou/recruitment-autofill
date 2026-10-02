import { afterEach, expect, it, vi } from 'vitest';
import { createEducationRecordSession } from '../src/content/educationRecordSession';
import type { SemanticProvider } from '../src/ai/semanticCandidates';
import { educationSessionProfile as profile, installEducationSessionPage } from './fixtures/education-session-page';

afterEach(() => { document.body.innerHTML = ''; window.history.replaceState({}, '', '/'); });
const localProfile = () => ({ ...profile, education: profile.education.map(record => ({ ...record, studyMode: '全日制' })) });
function install(kind: 'select' | 'radio' = 'select', labels = ['是否最高学历', '是否最高学位', '是否全日制最高学历']) {
  const page = installEducationSessionPage(document); const flags: string[][] = [];
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    for (const [index, caption] of labels.entries()) {
      const markup = kind === 'select' ? `<label>${caption}<select required name="flag-${index}"><option value="">请选择</option><option value="answer-yes">是</option><option value="answer-no">否</option></select></label>`
        : `<fieldset><legend>${caption}</legend><label><input required type="radio" name="flag-${index}" value="false">是</label><label><input type="radio" name="flag-${index}" value="true">否</label></fieldset>`;
      form.querySelector('button')!.insertAdjacentHTML('beforebegin', markup);
    }
    form.querySelector('button')!.addEventListener('click', () => flags.push(labels.map((_, index) => kind === 'select'
      ? form.querySelector<HTMLSelectElement>(`[name="flag-${index}"]`)!.value
      : form.querySelector<HTMLInputElement>(`[name="flag-${index}"]:checked`)?.value ?? 'unselected')), { capture: true });
  });
  return { ...page, flags };
}
async function finish(session: ReturnType<typeof createEducationRecordSession>) {
  for (let index = 0; index < 16; index++) {
    const result = await session.advance(); if (result.status === 'complete') return;
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'advanced' });
  }
  throw new Error('highest education session incomplete');
}
it.each(['select', 'radio'] as const)('当前%s按完整集合本科三个否、硕士三个是，各保存一次，重启不重复', async kind => {
  const page = install(kind); const local = localProfile(); const before = JSON.stringify(local);
  const propose = vi.fn(); const session = createEducationRecordSession(document, local, undefined, undefined, { propose });
  await finish(session); await finish(createEducationRecordSession(document, local));
  expect(page.flags).toEqual(kind === 'select' ? [['answer-no', 'answer-no', 'answer-no'], ['answer-yes', 'answer-yes', 'answer-yes']]
    : [['true', 'true', 'true'], ['false', 'false', 'false']]);
  expect(page.saved.map(record => record.school)).toEqual([local.education[1]!.school, local.education[0]!.school]);
  expect(page.counts).toEqual({ add: 2, save: 2, submit: 0, remove: 0, cancel: 0 }); expect(propose).not.toHaveBeenCalled(); expect(JSON.stringify(local)).toBe(before);
}, 15_000);
it('非全日制硕士只在全日制最高学历选否，不影响普通最高学历和学位', async () => {
  const page = install(); const local = localProfile(); local.education[0]!.studyMode = '非全日制';
  await finish(createEducationRecordSession(document, local));
  expect(page.flags).toEqual([['answer-no', 'answer-no', 'answer-yes'], ['answer-yes', 'answer-yes', 'answer-no']]);
}, 15_000);
it.each(['missing-degree', 'missing-mode', 'tied', 'earned', 'ambiguous-options'])('最高问题%s时整条零写入，不向模型猜测', async mode => {
  const local = localProfile();
  if (mode === 'missing-degree') local.education[0]!.degree = undefined;
  if (mode === 'missing-mode') local.education[0]!.studyMode = '';
  if (mode === 'tied') local.education = [local.education[1]!, { ...local.education[1]!, id: 'fictional-other-bachelor' }];
  const page = install('select', mode === 'earned' ? ['是否已取得最高学位'] : undefined);
  if (mode === 'ambiguous-options') page.add.addEventListener('click', () => page.list.querySelector('[name="flag-0"]')!.insertAdjacentHTML('beforeend', '<option value="another">是</option>'));
  const propose = vi.fn(); const session = createEducationRecordSession(document, local, undefined, undefined, { propose });
  await session.advance(); expect((await session.advance()).status).toBe('request-human');
  expect(Array.from(page.list.querySelectorAll<HTMLInputElement>('input,select')).every(control => !control.value)).toBe(true);
  expect(propose).not.toHaveBeenCalled(); expect(page.counts.save).toBe(0); expect(page.flags).toHaveLength(0);
});
it('已有人工最高选择与正确答案冲突时保留，零保存', async () => {
  const page = install(); const session = createEducationRecordSession(document, localProfile());
  await session.advance(); const flag = page.list.querySelector<HTMLSelectElement>('[name="flag-0"]')!; flag.value = 'answer-yes';
  expect((await session.advance()).status).toBe('request-human'); expect(flag.value).toBe('answer-yes'); expect(page.counts.save).toBe(0);
});
it('陌生学校由模型判断，最高标记按完整集合独立处理，不进入请求', async () => {
  const page = install(); page.add.addEventListener('click', () => page.list.querySelector('[data-test-key="school"]')!.parentElement!.firstChild!.textContent = '这一阶段在哪里学习');
  const propose = vi.fn(async (request: Parameters<SemanticProvider['propose']>[0]) => {
    expect(request.fields).toHaveLength(1); expect(request.fields[0]!.label).toBe('这一阶段在哪里学习');
    expect(request.allowedPaths.some(path => /highest/iu.test(path))).toBe(false);
    return { requestId: request.requestId, status: 'mapped', bindings: request.fields.map(field => ({ ref: field.ref, fingerprint: field.fingerprint,
      path: 'education.school', certainty: 'certain', evidence: 'label' })) };
  });
  await finish(createEducationRecordSession(document, localProfile(), undefined, undefined, { propose }));
  expect(propose).toHaveBeenCalledTimes(2); expect(page.flags).toEqual([['answer-no', 'answer-no', 'answer-no'], ['answer-yes', 'answer-yes', 'answer-yes']]);
}, 15_000);

it.each(['unknown', 'earned', 'conflicting-aria', 'multiple-groups', 'question-action'])('嵌套问题%s无法归属当前编辑器时整条零写入和保存', async mode => {
  const page = install(); let nestedClicks = 0;
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    const extra = mode === 'unknown' ? '<label>业务问题<input></label>'
      : '<label><input type="radio" name="extra" value="1">是</label><label><input type="radio" name="extra" value="0">否</label>';
    const legend = mode === 'earned' ? '是否已取得最高学位' : mode === 'unknown' ? '补充业务信息' : '是否最高学位';
    form.insertAdjacentHTML('beforeend', `<fieldset ${mode === 'conflicting-aria' ? 'aria-label="项目经历"' : ''}><legend>${legend}</legend>${extra}
      ${mode === 'multiple-groups' ? '<label><input type="radio" name="another">其他选项</label>' : ''}
      ${mode === 'question-action' ? '<button type="button">保存</button>' : ''}</fieldset>`);
    form.querySelector('fieldset button')?.addEventListener('click', () => nestedClicks++);
  });
  const propose = vi.fn(); const session = createEducationRecordSession(document, localProfile(), undefined, undefined, { propose });
  let result = await session.advance();
  if (result.status === 'advanced') result = await session.advance();
  expect(result.status).toBe('request-human'); expect(page.counts.save).toBe(0); expect(nestedClicks).toBe(0);
  expect(page.list.querySelector<HTMLInputElement>('[data-test-key="school"]')!.value).toBe('');
  expect(propose).not.toHaveBeenCalled();
});
it('选择后异步新增无法归属的可见字段时不签发保存权限', async () => {
  const page = install();
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    form.querySelector('[name="flag-0"]')!.addEventListener('change', () => {
      setTimeout(() => form.insertAdjacentHTML('beforeend', '<fieldset><legend>额外业务信息</legend><label>未知内容<input required></label></fieldset>'), 25);
    }, { once: true });
  });
  const session = createEducationRecordSession(document, localProfile()); await session.advance();
  expect((await session.advance()).status).toBe('request-human'); expect(page.counts.save).toBe(0);
  expect(page.list.querySelector('fieldset')).not.toBeNull();
});
it('隐藏的未归属输入不阻止填写，也不写入隐藏字段', async () => {
  const page = install(); const controls: HTMLInputElement[] = [];
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    form.insertAdjacentHTML('beforeend', '<fieldset hidden><legend>隐藏业务信息</legend><input value="网站内部值"></fieldset>');
    controls.push(form.querySelector('fieldset input')!);
  });
  await finish(createEducationRecordSession(document, localProfile()));
  expect(controls.map(control => control.value)).toEqual(['网站内部值', '网站内部值']); expect(page.counts.save).toBe(2);
}, 15_000);
