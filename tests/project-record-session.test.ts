import { afterEach, expect, it, vi } from 'vitest';
import { createProjectRecordSession, projectRecordAvailability } from '../src/content/projectRecordSession';
import { ProjectRecordWorkflow } from '../src/content/projectRecordWorkflow';
import type { ProjectProjectionResponse } from '../src/profile/projection';
import type { SemanticProvider } from '../src/ai/semanticCandidates';

const projection: ProjectProjectionResponse = { recordType: 'project', profileRevision: 'fictional-project-revision',
  projects: Array.from({ length: 6 }, (_, index) => ({ id: `fictional-${index}`,
    name: `虚构通用项目 ${index + 1}`, description: `仅用于普通页面驱动验证的虚构项目说明 ${index + 1}。`, technologies: [] })) };

function installPage(addLabel = '+', english = false, initial = [1, 0], relation?: 'aria-controls' | 'aria-owns') {
  window.history.replaceState({}, '', '/careers/unfamiliar-projects?step=2');
  document.head.innerHTML = '';
  document.body.innerHTML = `<main><section aria-label="${english ? 'Project experience' : '项目经历'}"><h2>${english ? 'Project experience' : '项目经历'}</h2><div role="list"></div></section></main>`;
  const list = document.querySelector('[role="list"]')!;
  list.id = 'project-items';
  const counts = { add: 0, save: 0, submit: 0, remove: 0 };
  const saved: { name: string; description: string }[] = [];
  const cards: Element[] = [];
  const add = document.createElement('button'); add.type = 'button'; add.textContent = addLabel;
  if (relation) add.setAttribute(relation, list.id);
  function card(index: number) {
    const result = document.createElement('article'); result.setAttribute('role', 'listitem');
    result.innerHTML = `<h3>${projection.projects[index]!.name}</h3><p>项目描述：${projection.projects[index]!.description}</p><button type="button">编辑项目经历</button><button type="button">删除</button>`;
    result.querySelectorAll('button')[1]!.addEventListener('click', () => counts.remove++);
    return result;
  }
  cards.push(...initial.map(card));
  const empty = document.createElement('p'); empty.setAttribute('role', 'status'); empty.textContent = '暂无项目经历';
  const closed = () => list.replaceChildren(...cards, ...(cards.length ? [] : [empty]), add);
  add.addEventListener('click', () => {
    counts.add++;
    const editor = document.createElement('form'); editor.setAttribute('aria-label', '新增项目经历');
    editor.innerHTML = `<label>${english ? 'Project name' : '项目名称'}<input name="opaque-one"></label><label>${english ? 'Project description' : '项目简介'}<textarea name="opaque-two"></textarea></label><button type="button">Save</button><button type="button">Cancel</button>`;
    editor.querySelector('button')!.addEventListener('click', () => {
      counts.save++;
      const name = editor.querySelector('input')!.value;
      const index = projection.projects.findIndex(project => project.name === name);
      if (index < 0) return;
      saved.push({ name, description: editor.querySelector('textarea')!.value });
      cards.unshift(card(index)); closed();
    });
    list.append(editor);
  });
  closed();
  const final = document.createElement('button'); final.type = 'button'; final.textContent = '最终提交';
  final.addEventListener('click', () => counts.submit++); document.body.append(final);
  return { list, add, counts, saved };
}

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; window.history.replaceState({}, '', '/'); });

function unfamiliarProjects(mixed = false) {
  const page = installPage('+', false, [0], 'aria-controls');
  page.add.addEventListener('click', () => {
    const labels = page.list.querySelectorAll('form label');
    if (!mixed) labels[0]!.firstChild!.textContent = '这项工作叫什么';
    labels[1]!.firstChild!.textContent = '这项工作做了些什么';
  });
  const provider: SemanticProvider = { propose: vi.fn(async (request: Parameters<SemanticProvider['propose']>[0]) => ({ requestId: request.requestId, status: 'mapped',
    bindings: request.fields.map(field => ({ ref: field.ref, fingerprint: field.fingerprint,
      path: field.label.includes('叫什么') ? 'projects.name' : 'projects.description', certainty: 'certain', evidence: 'label' })) })) };
  return { ...page, provider };
}

it('项目角色选择展开新字段后重新规划、补齐，再保存同一项目一次', async () => {
  const page = installPage('+', false, [0, 1, 2, 3, 4], 'aria-controls');
  const local = { ...projection, projects: projection.projects.map(project => ({ ...project, role: '开发成员', technologies: ['TypeScript'] })) };
  let changes = 0;
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    form.querySelector('button')!.insertAdjacentHTML('beforebegin', '<label>项目角色<select><option value="">请选择</option><option value="developer">开发成员</option></select></label>');
    form.querySelector('select')!.addEventListener('change', () => {
      changes++;
      form.querySelector('button')!.insertAdjacentHTML('beforebegin', '<label>技术栈<input name="stack"></label>');
    });
  });
  const session = createProjectRecordSession(document, local);
  expect((await session.advance()).status).toBe('advanced');
  expect((await session.advance()).status).toBe('advanced');
  expect(page.counts.save).toBe(0);
  expect((await session.advance()).status).toBe('advanced');
  expect(page.list.querySelector<HTMLInputElement>('[name="stack"]')!.value).toBe('TypeScript');
  expect((await session.advance()).status).toBe('advanced');
  expect((await session.advance()).status).toBe('complete');
  expect(page.counts).toEqual({ add: 1, save: 1, submit: 0, remove: 0 }); expect(changes).toBe(1);
});

function dynamicProject(delay = 0, unknown = false) {
  const page = installPage('+', false, [0, 1, 2, 3, 4], 'aria-controls');
  const local = { ...projection, projects: projection.projects.map(project => ({ ...project, role: '开发成员', technologies: ['TypeScript'] })) };
  page.add.addEventListener('click', () => {
    const form = page.list.querySelector('form')!;
    if (unknown) {
      const labels = form.querySelectorAll('label'); labels[0]!.firstChild!.textContent = '这项工作叫什么';
      labels[1]!.firstChild!.textContent = '这项工作做了些什么';
    }
    form.querySelector('button')!.insertAdjacentHTML('beforebegin', '<label>项目角色<select><option value="">请选择</option><option value="developer">开发成员</option></select></label>');
    form.querySelector('select')!.addEventListener('change', () => {
      const reveal = () => { if (form.isConnected && form.querySelector('select')!.value === 'developer')
        form.querySelector('button')!.insertAdjacentHTML('beforebegin', `<label>${unknown ? '这项工作用了什么工具' : '技术栈'}<input name="stack"></label>`); };
      if (delay) setTimeout(reveal, delay); else reveal();
    });
  });
  const provider: SemanticProvider = { propose: vi.fn(async (request: Parameters<SemanticProvider['propose']>[0]) => ({ requestId: request.requestId, status: 'mapped',
    bindings: request.fields.map(field => ({ ref: field.ref, fingerprint: field.fingerprint,
      path: field.label.includes('叫什么') ? 'projects.name' : field.label.includes('工具') ? 'projects.technologies' : 'projects.description',
      certainty: 'certain', evidence: 'label' })) })) };
  return { ...page, local, provider };
}

it('600ms 延迟展开的陌生字段使用新捕获，旧含义只绑定当前原节点且只写一次', async () => {
  const p = dynamicProject(600, true); let originalChanges = 0;
  p.add.addEventListener('click', () => p.list.querySelector('textarea')!.addEventListener('input', () => originalChanges++));
  const session = createProjectRecordSession(document, p.local, undefined, undefined, p.provider);
  for (let step = 0; step < 8; step++) { const result = await session.advance(); if (result.status === 'complete') break; expect(result.status).toBe('advanced'); }
  expect(session.state).toBe('complete'); expect(p.provider.propose).toHaveBeenCalledTimes(2);
  expect(vi.mocked(p.provider.propose).mock.calls.map(([request]) => request.fields.length)).toEqual([2, 1]);
  expect(originalChanges).toBe(1); expect(p.saved).toEqual([{ name: p.local.projects[5]!.name, description: p.local.projects[5]!.description }]);
  expect(p.counts).toEqual({ add: 1, save: 1, submit: 0, remove: 0 });
}, 10_000);

it.each(['manual', 'replace', 'action', 'option', 'stop'])('联动等待期间%s不签发新规划或保存，保留手工内容', async mode => {
  const p = dynamicProject(50);
  const session = createProjectRecordSession(document, p.local);
  await session.advance();
  p.list.querySelector('select')!.addEventListener('change', () => {
    if (p.list.querySelector('select')?.value !== 'developer') return;
    setTimeout(() => {
      const field = p.list.querySelector('textarea')!;
      if (mode === 'manual') field.value = '手工保留的项目说明';
      if (mode === 'replace') field.replaceWith(field.cloneNode(true));
      if (mode === 'action') { const button = p.list.querySelector('form button')!; button.replaceWith(button.cloneNode(true)); }
      if (mode === 'option') p.list.querySelector('select option[value="developer"]')!.textContent = '另一个职责';
      if (mode === 'stop') session.stop();
    }, 100);
  });
  const result = await session.advance();
  expect(['request-human', 'stopped']).toContain(result.status);
  expect(p.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0 });
  if (mode === 'manual') expect(p.list.querySelector('textarea')!.value).toBe('手工保留的项目说明');
}, 10_000);

it('展开的新字段缺少事实时停在草稿，不回到第一条项目或重复新增', async () => {
  const p = dynamicProject(); p.local.projects[5]!.technologies = [];
  const session = createProjectRecordSession(document, p.local);
  await session.advance(); expect((await session.advance()).status).toBe('advanced');
  expect(await session.advance()).toMatchObject({ status: 'request-human', reason: 'profile-value-missing' });
  expect(p.list.querySelector('input')!.value).toBe(p.local.projects[5]!.name);
  expect(p.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0 });
});

it.each(['manual', 'new-field', 'profile'])('两轮之间%s不能借用上一轮保存的字段含义继续写入', async mode => {
  const p = dynamicProject(0, true); let latest = p.local;
  const session = createProjectRecordSession(document, p.local, async () => latest, undefined, p.provider);
  await session.advance(); expect((await session.advance()).status).toBe('advanced');
  if (mode === 'manual') p.list.querySelector('textarea')!.value = '两轮之间的手工草稿';
  if (mode === 'new-field') p.list.querySelector('form')!.insertAdjacentHTML('afterbegin', '<label>项目地址<input></label>');
  if (mode === 'profile') latest = { ...p.local, projects: p.local.projects.map(project => ({ ...project, name: '另一个项目' })) };
  expect((await session.advance()).status).toBe('request-human');
  expect(p.provider.propose).toHaveBeenCalledOnce(); expect(p.list.querySelector<HTMLInputElement>('[name="stack"]')!.value).toBe('');
  expect(p.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0 });
  if (mode === 'manual') expect(p.list.querySelector('textarea')!.value).toBe('两轮之间的手工草稿');
});

it.each([false, true])('陌生项目编辑器与已知字段混合=%s时逐条读取正确项目并只保存一次', async mixed => {
  const p = unfamiliarProjects(mixed);
  const session = createProjectRecordSession(document, projection, undefined, undefined, p.provider);
  for (let step = 0; step < 20; step++) { const result = await session.advance(); if (result.status === 'complete') break; expect(result.status).toBe('advanced'); }
  expect(session.state).toBe('complete');
  expect(p.saved).toEqual(projection.projects.slice(1).map(project => ({ name: project.name, description: project.description })));
  expect(p.counts).toEqual({ add: 5, save: 5, submit: 0, remove: 0 });
  expect(p.provider.propose).toHaveBeenCalledTimes(5);
  expect(vi.mocked(p.provider.propose).mock.calls.every(([request]) => request.fields.length === (mixed ? 1 : 2))).toBe(true);
  expect(JSON.stringify(vi.mocked(p.provider.propose).mock.calls)).not.toContain('虚构通用项目');
}, 15_000);

it.each(['stop', 'manual', 'replace', 'profile'])('模型等待期间%s不会写已知字段或保存', async change => {
  const p = unfamiliarProjects(true); let reply!: (response: unknown) => void;
  const original = p.provider.propose; p.provider.propose = vi.fn(() => new Promise(resolve => { reply = resolve; }));
  let latest = projection;
  const session = createProjectRecordSession(document, projection, async () => latest, undefined, p.provider);
  expect((await session.advance()).status).toBe('advanced');
  const pending = session.advance(); await vi.waitFor(() => expect(p.provider.propose).toHaveBeenCalledOnce());
  if (change === 'stop') session.stop();
  if (change === 'manual') p.list.querySelector('textarea')!.value = '保留手工草稿';
  if (change === 'replace') { const field = p.list.querySelector('textarea')!; field.replaceWith(field.cloneNode(true)); }
  if (change === 'profile') latest = { ...projection, projects: projection.projects.map(project => ({ ...project, description: '同修订号的新资料' })) };
  const [request, signal] = vi.mocked(p.provider.propose).mock.calls[0]!;
  reply(await original(request, new AbortController().signal)); await pending;
  expect(p.list.querySelector('input')!.value).toBe(''); expect(p.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0 });
  if (change === 'stop' || change === 'profile') expect(signal.aborted).toBe(true);
  if (change === 'manual') expect(p.list.querySelector('textarea')!.value).toBe('保留手工草稿');
});

it('已知字段缺事实时零模型调用、零写入与保存', async () => {
  const p = unfamiliarProjects(true);
  p.add.addEventListener('click', () => p.list.querySelector('form')!.insertAdjacentHTML('afterbegin', '<label>开始日期<input type="date"></label>'));
  const session = createProjectRecordSession(document, projection, undefined, undefined, p.provider);
  expect((await session.advance()).status).toBe('advanced'); expect((await session.advance()).status).toBe('request-human');
  expect(p.provider.propose).not.toHaveBeenCalled(); expect(p.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0 });
  expect([...p.list.querySelectorAll('input,textarea')].every(node => (node as HTMLInputElement).value === '')).toBe(true);
});

it.each(['partial', 'invalid'])('项目模型%s批次不能只写其中的已知或有效字段', async mode => {
  const p = unfamiliarProjects(); const original = p.provider.propose;
  p.provider.propose = vi.fn(async (request: Parameters<SemanticProvider['propose']>[0], signal: AbortSignal) => {
    const response = await original(request, signal) as { bindings: unknown[] };
    return mode === 'partial' ? { ...response, bindings: response.bindings.slice(0, 1) } : { ...response, answer: '不能生成答案' };
  });
  const session = createProjectRecordSession(document, projection, undefined, undefined, p.provider);
  expect((await session.advance()).status).toBe('advanced'); expect((await session.advance()).status).toBe('request-human');
  expect([...p.list.querySelectorAll('input,textarea')].every(node => (node as HTMLInputElement).value === '')).toBe(true);
  expect(p.counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0 });
});

it.each([
  [[], 'aria-controls', 6], [[], 'aria-owns', 6], [[0], 'aria-controls', 5], [[0], 'aria-owns', 5],
] as const)('明确列表关系支持从 %s 开始，%s 每个缺少项目只新增一次', async (initial, relation, missing) => {
  const { counts, list } = installPage('+', false, [...initial], relation);
  for (let run = 0; run < 2; run++) {
    const session = createProjectRecordSession(document, projection);
    for (let step = 0; step < 20; step++) {
      const result = await session.advance();
      if (result.status === 'complete') break;
      expect(result.status).toBe('advanced');
    }
    expect(session.state).toBe('complete');
    expect(list.querySelectorAll('article')).toHaveLength(6);
    expect(counts).toEqual({ add: missing, save: missing, submit: 0, remove: 0 });
  }
}, 15_000);

it.each(['unlinked', 'hidden-empty', 'no-empty', 'wrong-target', 'multiple-targets', 'duplicate-id'] as const)(
  '空项目列表不借不可靠证据执行添加：%s', mode => {
    const { add, list, counts } = installPage('+', false, [], 'aria-controls');
    if (mode === 'unlinked') add.removeAttribute('aria-controls');
    if (mode === 'hidden-empty') list.querySelector('[role="status"]')!.setAttribute('hidden', '');
    if (mode === 'no-empty') list.querySelector('[role="status"]')!.remove();
    if (mode === 'wrong-target') {
      const other = document.createElement('section'); other.id = 'education-items'; other.innerHTML = '<h2>教育经历</h2>';
      document.querySelector('main')!.append(other); add.setAttribute('aria-controls', other.id);
    }
    if (mode === 'multiple-targets') add.setAttribute('aria-controls', `${list.id} missing`);
    if (mode === 'duplicate-id') {
      const other = document.createElement('div'); other.id = list.id; list.after(other);
    }
    expect(() => createProjectRecordSession(document, projection)).toThrow();
    expect(counts).toEqual({ add: 0, save: 0, submit: 0, remove: 0 });
  });

it('唯一加号不能把身份未知的首张卡片当成空列表', async () => {
  const { list, counts } = installPage('+', false, [0], 'aria-controls');
  list.querySelector('h3')!.remove(); list.querySelector('p')!.remove();
  const session = createProjectRecordSession(document, projection);
  expect((await session.advance()).status).toBe('request-human');
  expect(counts).toEqual({ add: 0, save: 0, submit: 0, remove: 0 });
});

it.each([['+', false], ['添加项目经历', false], ['Add project', true]] as const)(
  '无夹具标记的陌生页面按项目语义执行六项目闭环：%s', async (caption, english) => {
    const { counts, list } = installPage(caption, english);
    const session = createProjectRecordSession(document, projection);
    for (let step = 0; step < 20; step++) {
      const result = await session.advance();
      if (result.status === 'complete') break;
      expect(result.status).toBe('advanced');
    }
    expect(session.state).toBe('complete');
    expect(list.querySelectorAll('article')).toHaveLength(6);
    expect(counts).toEqual({ add: 4, save: 4, submit: 0, remove: 0 });
  }, 10_000);

it('项目和教育栏目并存时只操作项目', async () => {
  const { counts } = installPage();
  const section = document.createElement('section'); section.setAttribute('aria-label', '教育经历');
  section.innerHTML = '<h2>教育经历</h2><div role="list"><button type="button">添加教育经历</button></div>';
  const otherActions: string[] = [];
  section.querySelector('button')!.addEventListener('click', () => otherActions.push('education'));
  document.querySelector('main')!.prepend(section);
  const session = createProjectRecordSession(document, projection);
  await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
  expect(counts.add).toBe(1); expect(otherActions).toEqual([]);
});

it('两个项目列表时在启动前拒绝，不选择第一处', () => {
  const { counts } = installPage();
  document.querySelector('main')!.append(document.querySelector('section')!.cloneNode(true));
  expect(() => createProjectRecordSession(document, projection)).toThrow();
  expect(counts.add).toBe(0);
});

it('手动打开的编辑器不能被新会话冒领', () => {
  const { counts, add } = installPage(); add.click();
  expect(() => createProjectRecordSession(document, projection)).toThrow();
  expect(counts.save).toBe(0);
});

it.each(['replace', 'navigate'] as const)('启动后列表替换或 URL 变化时零动作停止：%s', async mode => {
  const { counts, list } = installPage();
  const session = createProjectRecordSession(document, projection);
  if (mode === 'replace') list.replaceWith(list.cloneNode(true));
  else window.history.replaceState({}, '', '/another-application');
  await expect(session.advance()).resolves.toMatchObject({ status: 'request-human' });
  expect(counts).toEqual({ add: 0, save: 0, submit: 0, remove: 0 });
});

it('添加按钮实际为提交或禁用时不开放会话', () => {
  const { add, counts } = installPage(); add.type = 'submit';
  expect(() => createProjectRecordSession(document, projection)).toThrow();
  add.type = 'button'; add.disabled = true;
  expect(() => createProjectRecordSession(document, projection)).toThrow();
  expect(counts.add).toBe(0);
});

it('可用性探测仅返回无值结论，不能点击或读取档案', () => {
  const { counts, add } = installPage();
  expect(projectRecordAvailability(document)).toEqual({ eligible: true });
  add.click();
  expect(projectRecordAvailability(document)).toEqual({ eligible: false, reason: 'editor-already-open' });
  expect(counts.save).toBe(0);
});

it('开放 Shadow 内的项目列表不进入主文档试用', () => {
  installPage();
  const section = document.querySelector('section')!;
  const host = document.createElement('div'); document.querySelector('main')!.append(host);
  host.attachShadow({ mode: 'open' }).append(section);
  expect(projectRecordAvailability(document)).toEqual({ eligible: false, reason: 'record-root-unsupported' });
  expect(() => createProjectRecordSession(document, projection)).toThrow();
});

it.each([2, 3])('在真实项目步骤 %s 后协作暂停，保留收据且恢复后不重复添加', async version => {
  const { counts } = installPage(); let requested = false;
  const flow: ProjectRecordWorkflow = new ProjectRecordWorkflow(document, async () => projection, (doc, supplied, refresh) => {
    const session = createProjectRecordSession(doc, supplied, refresh);
    return { get state() { return session.state; }, get snapshotVersion() { return session.snapshotVersion; },
      advance: async () => {
        const result = await session.advance();
        if (!requested && result.status === 'advanced' && result.snapshotVersion === version) {
          requested = true; flow.pause();
        }
        return result;
      }, pause: () => session.pause(), resume: () => session.resume(), stop: () => session.stop() };
  });
  await flow.start();
  await vi.waitFor(() => expect(flow.status().phase).toBe('paused'), { timeout: 3_000 });
  expect(counts).toEqual({ add: 1, save: 0, submit: 0, remove: 0 });
  await flow.resume();
  await vi.waitFor(() => expect(flow.status().phase).toBe('complete'), { timeout: 10_000 });
  expect(counts).toEqual({ add: 4, save: 4, submit: 0, remove: 0 });
}, 15_000);
