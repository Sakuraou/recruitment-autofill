import { afterEach, expect, it, vi } from 'vitest';
import { createEducationRecordSession } from '../src/content/educationRecordSession';
import type { SemanticProvider } from '../src/ai/semanticCandidates';
import type { SemanticBindingPath, SemanticProposal } from '../src/ai/semanticProtocol';
import { educationSessionProfile as profile, installEducationSessionPage } from './fixtures/education-session-page';

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; window.history.replaceState({}, '', '/'); });
const captions: Record<string, string> = { school: '这一阶段在哪里学习', degree: '这段学习授予什么', gpa: '这一阶段的学业表现' };
type SemanticBindingRequest = Parameters<SemanticProvider['propose']>[0];
const paths: Record<string, SemanticBindingPath> = { '这一阶段在哪里学习': 'education.school', '这段学习授予什么': 'education.degree', '这一阶段的学业表现': 'education.gpa' };
function install(keys = ['school', 'degree', 'gpa']) {
  const page = installEducationSessionPage(document);
  page.add.addEventListener('click', () => {
    for (const key of keys) page.list.querySelector(`[data-test-key="${key}"]`)!.parentElement!.firstChild!.textContent = captions[key]!;
  });
  return page;
}
function proposal(request: SemanticBindingRequest): SemanticProposal {
  return { requestId: request.requestId, status: 'mapped', bindings: request.fields.map(field => ({ ref: field.ref,
    fingerprint: field.fingerprint, path: paths[field.label]!, certainty: 'certain', evidence: 'label' })) };
}
async function finish(session: ReturnType<typeof createEducationRecordSession>) {
  for (let step = 0; step < 16; step++) {
    const result = await session.advance(); if (result.status === 'complete') return;
    expect(result.status).toBe('advanced');
  }
  throw new Error('education model session did not complete');
}
it.each([['school'], ['school', 'degree', 'gpa']].map(keys => ({ keys })))('陌生字段 $keys 按本科和硕士各自事实填写全部教育记录，重启不重复', async ({ keys }) => {
  const page = install(keys); const before = JSON.stringify(profile);
  const propose = vi.fn(async (request: SemanticBindingRequest) => {
    expect(request.protocol).toBe(2); expect(request.fields).toHaveLength(keys.length);
    expect(request.fields.every(field => field.section === 'education' && field.record === 'creating')).toBe(true);
    expect(JSON.stringify(request)).not.toContain('虚构青岚学院'); expect(JSON.stringify(request)).not.toContain('虚构云川大学');
    return proposal(request);
  });
  await finish(createEducationRecordSession(document, profile, undefined, undefined, { propose }));
  expect(page.saved.map(record => record.school)).toEqual([profile.education[1]!.school, profile.education[0]!.school]);
  for (const [index, source] of [profile.education[1]!, profile.education[0]!].entries())
    expect(page.saved[index]).toEqual(Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'id')));
  await finish(createEducationRecordSession(document, profile, undefined, undefined, { propose }));
  expect(propose).toHaveBeenCalledTimes(2); expect(JSON.stringify(profile)).toBe(before);
  expect(page.counts).toEqual({ add: 2, save: 2, submit: 0, remove: 0, cancel: 0 });
}, 20_000);
it.each(['partial', 'wrong-domain', 'uncertain', 'wrong-fingerprint', 'unavailable'])('模型%s时整条零写入零保存', async mode => {
  const page = install();
  const provider: SemanticProvider = { propose: async request => {
    if (mode === 'unavailable') throw new Error('offline');
    const answer = proposal(request);
    if (mode === 'partial') answer.bindings.pop();
    if (mode === 'wrong-domain') answer.bindings[0]!.path = 'projects.name';
    if (mode === 'uncertain') answer.bindings[0]!.certainty = 'uncertain';
    if (mode === 'wrong-fingerprint') answer.bindings[0]!.fingerprint = 'not-current';
    return answer;
  } };
  const session = createEducationRecordSession(document, profile, undefined, undefined, provider);
  expect((await session.advance()).status).toBe('advanced'); expect((await session.advance()).status).toBe('request-human');
  expect(Array.from(page.list.querySelectorAll<HTMLInputElement>('input, select')).every(field => !field.value)).toBe(true);
  expect(page.counts.save).toBe(0);
});
it.each(['stop', 'manual', 'field', 'list', 'navigate', 'same-revision', 'revision'])('模型等待期间%s，迟到答案不覆盖已知或人工字段', async mode => {
  const page = install(); let latest = profile; let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); let release!: (answer: SemanticProposal) => void;
  let request!: SemanticBindingRequest; let signal: AbortSignal | undefined;
  const provider: SemanticProvider = { propose: async (input, abortSignal) => {
    request = input; signal = abortSignal; enter(); return new Promise<SemanticProposal>(resolve => { release = resolve; });
  } };
  const session = createEducationRecordSession(document, profile, async () => latest, undefined, provider);
  await session.advance(); const pending = session.advance(); await entered;
  const school = page.list.querySelector<HTMLInputElement>('[data-test-key="school"]')!;
  if (mode === 'stop') { session.stop(); expect(signal?.aborted).toBe(true); }
  if (mode === 'manual') school.value = '用户自己输入的学校';
  if (mode === 'field') school.replaceWith(school.cloneNode(true));
  if (mode === 'list') page.list.replaceWith(page.list.cloneNode(true));
  if (mode === 'navigate') window.history.replaceState({}, '', '/other-resume');
  if (mode === 'same-revision') latest = { ...profile, education: profile.education.map(record => ({ ...record, major: '用户已更新专业' })) };
  if (mode === 'revision') latest = { ...profile, profileRevision: 'new-revision' };
  release(proposal(request)); expect((await pending).status).toBe(mode === 'stop' ? 'stopped' : 'request-human');
  expect(page.counts.save).toBe(0); expect(page.counts.add).toBe(1);
  expect(page.list.querySelector<HTMLInputElement>('[data-test-key="major"]')!.value).toBe('');
  if (mode === 'manual') expect(school.value).toBe('用户自己输入的学校');
});
it.each(['missing', 'highest'])('已知字段%s时不请求模型也不先填可识别字段', async mode => {
  const page = install(); const local = mode === 'missing' ? { ...profile, education: profile.education.map(record => ({ ...record, major: undefined })) } : profile;
  if (mode === 'highest') page.add.addEventListener('click', () => page.list.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>是否最高学位<input></label>'));
  const propose = vi.fn(async (request: SemanticBindingRequest) => proposal(request));
  const session = createEducationRecordSession(document, local, undefined, undefined, { propose });
  await session.advance(); expect((await session.advance()).status).toBe('request-human'); expect(propose).not.toHaveBeenCalled();
  expect(Array.from(page.list.querySelectorAll<HTMLInputElement>('input,select')).every(field => !field.value)).toBe(true); expect(page.counts.save).toBe(0);
});
it('陌生学位选择后展开院系，只识别新问题且不重复写原字段，当前本科与硕士各自取值', async () => {
  const page = install(); const local = { ...profile, education: profile.education.map((record, index) => ({ ...record, college: index ? '虚构软件学院' : '虚构智能学院' })) };
  let schoolWrites = 0; let changes = 0;
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    form.querySelector('[data-test-key="school"]')!.addEventListener('input', () => schoolWrites++);
    form.querySelector('[data-test-key="degree"]')!.addEventListener('change', () => {
      changes++;
      setTimeout(() => form.querySelector('button')!.insertAdjacentHTML('beforebegin', '<label>这一阶段所在的教学单位<input required name="opaque-extra" data-test-key="college"></label>'), 50);
    }, { once: true });
  });
  const propose = vi.fn(async (request: SemanticBindingRequest) => {
    const answer = proposal(request);
    for (const [index, field] of request.fields.entries()) if (field.label === '这一阶段所在的教学单位') answer.bindings[index]!.path = 'education.college';
    return answer;
  });
  await finish(createEducationRecordSession(document, local, undefined, undefined, { propose }));
  expect(page.saved.map(record => record.college)).toEqual(['虚构软件学院', '虚构智能学院']);
  expect(propose.mock.calls.map(([request]) => request.fields.length)).toEqual([3, 1, 3, 1]);
  expect(schoolWrites).toBe(2); expect(changes).toBe(2); expect(page.counts.save).toBe(2);
}, 20_000);
