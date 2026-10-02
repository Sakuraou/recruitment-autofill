import { afterEach, expect, it, vi } from 'vitest';
import { lifecycle } from './fixtures/record-editor-context';
import { educationSessionProfile } from './fixtures/education-session-page';
import { createEmptyProfile } from '../src/profile/schema';
import { createEducationSemanticContext } from '../src/ai/educationSemanticContext';
import { createSemanticBindingSession, validateSemanticBindings } from '../src/ai/semanticBinding';
import { inferSemanticCandidates, resolveSemanticCandidates, type SemanticProvider } from '../src/ai/semanticCandidates';
import type { SemanticRecipes } from '../src/ai/semanticRecipes';

afterEach(() => { document.body.innerHTML = ''; });
function setup() {
  const profile = createEmptyProfile(); profile.revision = crypto.randomUUID();
  profile.education = educationSessionProfile.education.map(record => ({ ...record }));
  const elements = ['这段学习发生在何处', '这段学习授予什么'].map(ariaLabel => Object.assign(document.createElement('input'), { ariaLabel }));
  const state = lifecycle(elements, undefined, undefined, 1, 'education');
  const input = { plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
    runContext: state.context, scanState: state.fixture.scanState, profile };
  const context = createEducationSemanticContext(input)!; expect(context).toBeDefined();
  return { state, profile, elements, input, scan: input.scanState.result, context };
}
const provider = (): SemanticProvider => ({ propose: vi.fn(async (request: Parameters<SemanticProvider['propose']>[0]) => ({ requestId: request.requestId, status: 'mapped',
  bindings: request.fields.map((field, index) => ({ ref: field.ref, fingerprint: field.fingerprint,
    path: index === 0 ? 'education.school' : 'education.degree', certainty: 'certain', evidence: 'label' })) })) });
it('教育私有范围生成独立协议，请求无值，取值只来自当前第二条本科', async () => {
  const s = setup(); const model = provider();
  expect(await inferSemanticCandidates(s.scan, s.profile, model, { educationContext: s.context })).toMatchObject({ state: 'ready', matches: [
    { value: '虚构青岚学院', source: 'llm', status: 'review' }, { value: '学士学位', source: 'llm', status: 'review' },
  ] });
  const request = vi.mocked(model.propose).mock.calls[0]![0];
  expect(request.protocol).toBe(2); expect(request.fields.every(field => field.section === 'education' && field.record === 'creating')).toBe(true);
  expect(JSON.stringify(request)).not.toMatch(/虚构|学士学位|硕士学位|intentIndex|schoolValue|profileRevision/);
  expect(s.elements.every(element => !element.value)).toBe(true);
});
it('普通本页 AI 没有教育所有权时不发送教育字段，也不默认第一条', async () => {
  const s = setup(); const model = provider();
  expect(await inferSemanticCandidates(s.scan, s.profile, model)).toEqual({ state: 'no-candidates', matches: [] });
  expect(model.propose).not.toHaveBeenCalled();
});
it('已核验教育含义没有当前教育上下文时仍无填写值', async () => {
  const s = setup(); const prepared = createSemanticBindingSession(s.scan, s.profile, undefined, s.context);
  expect(prepared.ok).toBe(true); if (!prepared.ok) throw new Error(prepared.reason);
  const response = await provider().propose(prepared.session.request, new AbortController().signal);
  const bindings = validateSemanticBindings(prepared.session, response, s.scan, s.profile); expect(bindings.ok).toBe(true);
  const values = resolveSemanticCandidates(bindings, s.scan, s.profile);
  expect(values.ok && values.matches.every(match => match.value === undefined)).toBe(true);
});
it.each(['clone', 'stop', 'replace'])('%s在调用模型之前拒绝教育上下文', async mode => {
  const s = setup(); const model = provider();
  if (mode === 'stop') s.state.context.stop();
  if (mode === 'replace') s.elements[0]!.replaceWith(s.elements[0]!.cloneNode(true));
  expect(await inferSemanticCandidates(s.scan, s.profile, model, { educationContext: mode === 'clone' ? structuredClone(s.context) : s.context }))
    .toEqual({ state: 'rejected', matches: [] });
  expect(model.propose).not.toHaveBeenCalled();
});
it.each(['stop', 'silent-value', 'profile', 'capture', 'replace', 'editor-moved', 'list-replaced'])('模型等待期间%s拒绝迟到结果，也不学习含义', async mode => {
  const s = setup(); let reply!: (value: unknown) => void;
  const model: SemanticProvider = { propose: vi.fn(() => new Promise(resolve => { reply = resolve; })) };
  const recipes: SemanticRecipes = { propose: vi.fn(), remember: vi.fn() };
  const pending = inferSemanticCandidates(s.scan, s.profile, model, { educationContext: s.context, recipes });
  await vi.waitFor(() => expect(model.propose).toHaveBeenCalledOnce());
  if (mode === 'stop') s.state.context.stop();
  if (mode === 'silent-value') s.elements[0]!.value = '保留手改';
  if (mode === 'profile') s.profile.education[1]!.school = '新资料';
  if (mode === 'capture') s.state.context.capture(s.state.fixture.source);
  if (mode === 'replace') s.elements[0]!.replaceWith(s.elements[0]!.cloneNode(true));
  if (mode === 'editor-moved') document.body.append(s.state.fixture.editor);
  if (mode === 'list-replaced') {
    const list = s.input.scanState.semanticTargets.get(s.state.populatePlan.recordListNodeId)!;
    const replacement = list.cloneNode(false); list.replaceWith(replacement); replacement.appendChild(s.state.fixture.editor);
  }
  reply(await provider().propose(vi.mocked(model.propose).mock.calls[0]![0], new AbortController().signal));
  expect(await pending).toEqual({ state: 'rejected', matches: [] }); expect(recipes.remember).not.toHaveBeenCalled();
  expect(s.elements[1]!.value).toBe('');
});
it('停止立即取消教育模型等待，迟到响应不产生候选或缓存', async () => {
  const s = setup(); const signal = s.state.context.beginStep(); let reply!: (value: unknown) => void;
  const model: SemanticProvider = { propose: vi.fn(() => new Promise(resolve => { reply = resolve; })) };
  const recipes: SemanticRecipes = { propose: vi.fn(), remember: vi.fn() };
  const pending = inferSemanticCandidates(s.scan, s.profile, model, { educationContext: s.context, recipes, signal });
  await vi.waitFor(() => expect(model.propose).toHaveBeenCalledOnce()); s.state.context.stop();
  expect(await pending).toEqual({ state: 'cancelled', matches: [] });
  const [request, aborted] = vi.mocked(model.propose).mock.calls[0]!; expect(aborted.aborted).toBe(true);
  reply(await provider().propose(request, new AbortController().signal)); await Promise.resolve(); await Promise.resolve();
  expect(recipes.remember).not.toHaveBeenCalled(); expect(s.elements.every(element => !element.value)).toBe(true);
});
