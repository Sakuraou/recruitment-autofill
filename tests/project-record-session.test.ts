import { afterEach, expect, it, vi } from 'vitest';
import { createProjectRecordSession, projectRecordAvailability } from '../src/content/projectRecordSession';
import { ProjectRecordWorkflow } from '../src/content/projectRecordWorkflow';
import type { ProjectProjectionResponse } from '../src/profile/projection';

const projection: ProjectProjectionResponse = { recordType: 'project', profileRevision: 'fictional-project-revision',
  projects: Array.from({ length: 6 }, (_, index) => ({ id: `fictional-${index}`,
    name: `虚构通用项目 ${index + 1}`, description: `仅用于普通页面驱动验证的虚构项目说明 ${index + 1}。`, technologies: [] })) };

function installPage(addLabel = '+', english = false) {
  window.history.replaceState({}, '', '/careers/unfamiliar-projects?step=2');
  document.head.innerHTML = '';
  document.body.innerHTML = `<main><section aria-label="${english ? 'Project experience' : '项目经历'}"><h2>${english ? 'Project experience' : '项目经历'}</h2><div role="list"></div></section></main>`;
  const list = document.querySelector('[role="list"]')!;
  const counts = { add: 0, save: 0, submit: 0, remove: 0 };
  const cards: Element[] = [];
  const add = document.createElement('button'); add.type = 'button'; add.textContent = addLabel;
  function card(index: number) {
    const result = document.createElement('article'); result.setAttribute('role', 'listitem');
    result.innerHTML = `<h3>${projection.projects[index]!.name}</h3><p>项目描述：${projection.projects[index]!.description}</p><button type="button">编辑项目经历</button><button type="button">删除</button>`;
    result.querySelectorAll('button')[1]!.addEventListener('click', () => counts.remove++);
    return result;
  }
  cards.push(card(1), card(0));
  const closed = () => list.replaceChildren(...cards, add);
  add.addEventListener('click', () => {
    counts.add++;
    const editor = document.createElement('form'); editor.setAttribute('aria-label', '新增项目经历');
    editor.innerHTML = `<label>${english ? 'Project name' : '项目名称'}<input name="opaque-one"></label><label>${english ? 'Project description' : '项目简介'}<textarea name="opaque-two"></textarea></label><button type="button">Save</button><button type="button">Cancel</button>`;
    editor.querySelector('button')!.addEventListener('click', () => {
      counts.save++;
      const name = editor.querySelector('input')!.value;
      const index = projection.projects.findIndex(project => project.name === name);
      if (index < 0) return;
      cards.unshift(card(index)); closed();
    });
    list.append(editor);
  });
  closed();
  const final = document.createElement('button'); final.type = 'button'; final.textContent = '最终提交';
  final.addEventListener('click', () => counts.submit++); document.body.append(final);
  return { list, add, counts };
}

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; window.history.replaceState({}, '', '/'); });

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
