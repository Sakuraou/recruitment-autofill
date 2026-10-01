import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRecordV2FixtureSession, isRecordV2FixtureEligible } from '../src/content/recordV2FixtureSession';
import type { ProjectProjectionResponse } from '../src/profile/projection';

const marker = 'record-v2-six-projects-v1';
const projection: ProjectProjectionResponse = {
  recordType: 'project', profileRevision: 'fixture-revision-v1',
  projects: Array.from({ length: 6 }, (_, index) => ({ id: `project-${index + 1}`,
    name: `虚构测试项目 ${index + 1}`, description: `仅用于测试的项目描述 ${index + 1}`, technologies: [] })),
};

interface FixtureCounters {
  add: number;
  save: number;
  delete: number;
  upload: number;
  next: number;
  submit: number;
}

function installFixture(existing: readonly number[] = [0, 1], layout: 'heading' | 'definitions' | 'table' = 'heading',
  editorLayout: 'labels' | 'english' | 'definitions' | 'table' | 'unknown' = 'labels') {
  window.history.replaceState({}, '', '/repeatable-records?case=happy');
  document.documentElement.dataset.raRecordV2Fixture = 'v1';
  document.head.innerHTML = `<meta name="ra-record-v2-fixture" content="${marker}">`;
  document.body.innerHTML = `
    <main id="ra-record-v2-fixture" data-schema="${marker}">
      <section aria-label="项目经历"><h2>项目经历</h2>
        <div role="list" aria-label="项目经历列表"></div>
      </section>
    </main>`;
  const list = document.querySelector<HTMLElement>('[role="list"]')!;
  const counters: FixtureCounters = { add: 0, save: 0, delete: 0, upload: 0, next: 0, submit: 0 };
  const cards: HTMLElement[] = existing.map(index => createCard(index));
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = '添加项目经历';

  function createCard(index: number): HTMLElement {
    const card = document.createElement('article');
    card.setAttribute('role', 'listitem');
    card.dataset.raV2Card = 'v1';
    card.dataset.raV2Intent = String(index);
    const heading = document.createElement('h3');
    heading.textContent = `虚构测试项目 ${index + 1}`;
    const description = document.createElement('p');
    description.textContent = `项目描述：${projection.projects[index]?.description ?? ''}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = '编辑项目经历';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除这段经历';
    remove.addEventListener('click', () => { counters.delete++; });
    if (layout === 'heading') card.append(heading, description);
    if (layout === 'definitions') card.innerHTML = `<dl><dt>项目名称</dt><dd>${heading.textContent}</dd><dt>项目简介</dt><dd>${projection.projects[index]?.description ?? ''}</dd></dl>`;
    if (layout === 'table') card.innerHTML = `<table><tr><th>项目名称</th><td>${heading.textContent}</td></tr><tr><th>项目描述</th><td>${projection.projects[index]?.description ?? ''}</td></tr></table>`;
    card.append(edit, remove);
    return card;
  }

  function renderClosed(): void { list.replaceChildren(...cards, add); }
  function renderCreating(): void {
    const form = document.createElement('form');
    form.setAttribute('aria-label', '新增项目经历编辑器');
    form.dataset.raV2Editor = 'v1';
    const fields = editorLayout === 'definitions' ? '<dl><dt>名称</dt><dd><input name="opaque-name"></dd><dt>简介</dt><dd><textarea name="opaque-description"></textarea></dd></dl>'
      : editorLayout === 'table' ? '<table><tr><th>课题名称</th><td><input name="opaque-name"></td></tr><tr><th>项目介绍</th><td><textarea name="opaque-description"></textarea></td></tr></table>'
        : editorLayout === 'english' ? '<label>Project name<input name="opaque-name"></label><label>Project description<textarea name="opaque-description"></textarea></label>'
          : '<label>项目名称<input name="fixture-project-name"></label><label>项目描述<textarea name="fixture-project-description"></textarea></label>';
    form.innerHTML = fields + (editorLayout === 'unknown' ? '<label>未知接口参数 X<input></label>' : '')
      + '<button type="button" data-save>保存</button><button type="button">取消</button>';
    form.querySelector<HTMLButtonElement>('[data-save]')!.addEventListener('click', () => {
      counters.save++;
      const name = form.querySelector<HTMLInputElement>('input')!.value;
      const match = /^虚构测试项目 (\d)$/u.exec(name);
      if (!match) return;
      const index = Number(match[1]) - 1;
      const card = createCard(index);
      cards.splice(1, 0, card);
      renderClosed();
    });
    list.replaceChildren(...cards, add, form);
  }
  add.addEventListener('click', () => { counters.add++; renderCreating(); });
  renderClosed();

  for (const key of ['upload', 'next', 'submit'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = key;
    button.addEventListener('click', () => { counters[key]++; });
    document.body.append(button);
  }
  return { counters, list };
}

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });
afterEach(() => {
  window.history.replaceState({}, '', '/');
  delete document.documentElement.dataset.raRecordV2Fixture;
});

describe('Record v2 固定虚构会话', () => {
  it('同时校验 URL、构建标记和页面指纹', () => {
    installFixture();
    expect(isRecordV2FixtureEligible(document)).toBe(true);
    document.querySelector('meta')?.remove();
    expect(isRecordV2FixtureEligible(document)).toBe(false);
    expect(() => createRecordV2FixtureSession(document, projection)).toThrow('当前页面不是通用多记录填写测试页');
  });

  it('识别两个已有项目，只逐步新增四个不同项目', async () => {
    const { counters, list } = installFixture();
    const session = createRecordV2FixtureSession(document, projection);
    const steps: string[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await session.advance();
      if (result.status === 'advanced') { steps.push(result.status); continue; }
      if (result.status !== 'complete') throw new Error(JSON.stringify(result));
      break;
    }

    expect(session.state).toBe('complete');
    expect(steps).toHaveLength(12);
    expect(counters).toEqual({ add: 4, save: 4, delete: 0, upload: 0, next: 0, submit: 0 });
    expect(Array.from(list.querySelectorAll<HTMLElement>('[data-ra-v2-card="v1"]'))
      .map(card => Number(card.dataset.raV2Intent)).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  }, 10_000);

  it.each(['heading', 'definitions', 'table'] as const)('卡片没有夹具编号且顺序改变时，仍按可见内容去重：%s', async layout => {
    const { counters, list } = installFixture([1, 0], layout);
    for (const card of list.querySelectorAll('[data-ra-v2-card]')) card.removeAttribute('data-ra-v2-intent');
    const session = createRecordV2FixtureSession(document, projection);
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await session.advance();
      if (result.status === 'complete') break;
      expect(result.status).toBe('advanced');
    }
    expect(session.state).toBe('complete');
    expect(counters).toEqual({ add: 4, save: 4, delete: 0, upload: 0, next: 0, submit: 0 });
  }, 10_000);

  it.each(['english', 'definitions', 'table'] as const)('跨编辑器标签和布局连续填写全部项目：%s', async editorLayout => {
    const { counters } = installFixture([0, 1], 'heading', editorLayout);
    const session = createRecordV2FixtureSession(document, projection);
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await session.advance();
      if (result.status === 'complete') break;
      expect(result.status).toBe('advanced');
    }
    expect(session.state).toBe('complete');
    expect(counters).toEqual({ add: 4, save: 4, delete: 0, upload: 0, next: 0, submit: 0 });
  }, 10_000);

  it('新编辑器含未知字段时明确语义缺口，已知字段也保持零写入', async () => {
    const { counters, list } = installFixture([0, 1], 'heading', 'unknown');
    const session = createRecordV2FixtureSession(document, projection);
    await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'field-semantic-unknown' });
    expect(Array.from(list.querySelectorAll<HTMLInputElement>('input, textarea')).every(node => node.value === '')).toBe(true);
    expect(counters.add).toBe(1); expect(counters.save).toBe(0);
  });

  it('已有重复卡片时停止，不再添加或保存', async () => {
    const { counters } = installFixture([0, 0]);
    const session = createRecordV2FixtureSession(document, projection);
    const result = await session.advance();
    expect(result.status).toBe('request-human');
    expect(counters.add).toBe(0);
    expect(counters.save).toBe(0);
  });

  it('同名卡片描述不一致时停止，不把原卡当作不存在而重新添加', async () => {
    const { counters, list } = installFixture();
    list.querySelector('p')!.textContent = '项目描述：原网页保存的不同描述内容，需要用户核对。';
    const session = createRecordV2FixtureSession(document, projection);
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'identity-insufficient' });
    expect(counters.add).toBe(0);
    expect(counters.save).toBe(0);
  });

  it('保存生成其它项目的卡片时只保存一次，并停止后续新增', async () => {
    const { counters, list } = installFixture();
    const session = createRecordV2FixtureSession(document, projection);
    await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    list.querySelector('[data-save]')!.addEventListener('click', () => {
      const created = Array.from(list.querySelectorAll('[data-ra-v2-card]')).find(card => card.querySelector('h3')?.textContent === '虚构测试项目 3')!;
      created.querySelector('h3')!.textContent = '虚构测试项目 5';
      created.querySelector('p')!.textContent = `项目描述：${projection.projects[4]!.description}`;
    });
    await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'save-result-uncertain' });
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human' });
    expect(counters).toEqual({ add: 1, save: 1, delete: 0, upload: 0, next: 0, submit: 0 });
  });

  it('已有卡片缺少可见身份时停止，不点击添加或保存', async () => {
    const { counters, list } = installFixture();
    list.querySelector('[data-ra-v2-card="v1"] h3')!.textContent = '';
    const session = createRecordV2FixtureSession(document, projection);

    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'identity-insufficient' });
    expect(counters.add).toBe(0);
    expect(counters.save).toBe(0);
  });

  it('投影修订变化时在后续动作前停止，不保存旧档案记录', async () => {
    const { counters } = installFixture();
    let latest = projection;
    const session = createRecordV2FixtureSession(document, projection, async () => latest);
    await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    latest = { ...projection, profileRevision: 'fixture-revision-v2' };
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'profile-changed' });
    expect(counters.add).toBe(1);
    expect(counters.save).toBe(0);
  });

  it('步骤间手动新增缺少项目后，不使用旧快照再次点击添加', async () => {
    const { counters, list } = installFixture();
    const session = createRecordV2FixtureSession(document, projection);
    for (let step = 0; step < 3; step++) await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    const manual = document.createElement('article'); manual.setAttribute('role', 'listitem');
    manual.innerHTML = `<h3>虚构测试项目 4</h3><p>项目描述：${projection.projects[3]!.description}</p><button type="button">编辑项目经历</button><button type="button">删除</button>`;
    list.prepend(manual);
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'snapshot-stale' });
    expect(counters.add).toBe(1);
    expect(counters.save).toBe(1);
  });

  it('步骤间新增必填字段时，在写其它字段前停止', async () => {
    const { counters, list } = installFixture();
    const session = createRecordV2FixtureSession(document, projection);
    await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    const label = document.createElement('label'); label.textContent = '未知必填项';
    const input = document.createElement('input'); input.required = true; label.append(input);
    list.querySelector('form')!.prepend(label);
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'snapshot-stale' });
    expect(Array.from(list.querySelectorAll<HTMLInputElement>('input')).every(node => node.value === '')).toBe(true);
    expect(counters.save).toBe(0);
  });

  it('步骤间新增按钮改为最终提交时不再点击', async () => {
    const { counters, list } = installFixture();
    const session = createRecordV2FixtureSession(document, projection);
    for (let step = 0; step < 3; step++) await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    const add = Array.from(list.querySelectorAll('button')).find(button => button.textContent === '添加项目经历')!;
    add.textContent = '最终提交';
    add.addEventListener('click', () => { counters.submit++; });
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'snapshot-stale' });
    expect(counters.add).toBe(1);
    expect(counters.save).toBe(1);
    expect(counters.submit).toBe(0);
  });

  it.each(['rename', 'reorder', 'remove', 'hidden'])('步骤间已有卡片变化时停止：%s', async mode => {
    const { counters, list } = installFixture();
    const session = createRecordV2FixtureSession(document, projection);
    for (let step = 0; step < 3; step++) await expect(session.advance()).resolves.toMatchObject({ status: 'advanced' });
    const card = list.querySelector<HTMLElement>('[data-ra-v2-card]')!;
    if (mode === 'rename') card.querySelector('h3')!.textContent = '改名后的虚构项目';
    if (mode === 'reorder') list.append(card);
    if (mode === 'remove') card.remove();
    if (mode === 'hidden') card.hidden = true;
    await expect(session.advance()).resolves.toMatchObject({ status: 'request-human', reason: 'snapshot-stale' });
    expect(counters.add).toBe(1);
    expect(counters.save).toBe(1);
  });
});
