import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPageSemanticGraph, type SemanticGraphBuildResult } from '../src/content/semantic/graphBuilder';
import { scanDocument, type ScanState } from '../src/content/scanner';
import type {
  ActionSemanticNode, PageSemanticGraph, RecordSemanticNode, SemanticNode,
} from '../src/shared/semanticGraph';
import { semanticGraphProblems } from '../src/shared/semanticGraphValidation';

beforeEach(() => {
  document.title = '';
  document.body.innerHTML = '';
});

interface BuiltFixture {
  state: ScanState;
  built: SemanticGraphBuildResult;
}

function buildFixture(html: string): BuiltFixture {
  document.body.innerHTML = html;
  const state = scanDocument(document);
  return { state, built: buildPageSemanticGraph(document, state.result.fields, state.controls) };
}

function nodeMap(graph: PageSemanticGraph): Map<string, SemanticNode> {
  return new Map(graph.nodes.map(node => [node.id, node]));
}

function hasAncestor(node: SemanticNode, ancestorId: string, byId: ReadonlyMap<string, SemanticNode>): boolean {
  const seen = new Set<string>();
  let current: SemanticNode | undefined = node;
  while (current?.parentId && !seen.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return false;
}

function nearestSectionId(node: SemanticNode, byId: ReadonlyMap<string, SemanticNode>): string | undefined {
  const seen = new Set<string>();
  let current: SemanticNode | undefined = node;
  while (current && !seen.has(current.id)) {
    if (current.kind === 'section') return current.id;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}

function isRecordNode(node: SemanticNode): node is RecordSemanticNode {
  return node.kind === 'record';
}

function isTargetedActionNode(node: SemanticNode): node is ActionSemanticNode & { targetId: string } {
  return node.kind === 'action' && typeof node.targetId === 'string';
}

const projectListFixture = `
  <section aria-labelledby="project-heading">
    <h2 id="project-heading">项目经历</h2>
    <div role="list" aria-label="项目经历列表">
      <article role="listitem">
        <h3>脱敏项目甲</h3>
        <p>脱敏摘要甲</p>
        <button type="button">编辑项目经历</button>
        <button type="button">删除这段经历</button>
      </article>
      <article role="listitem">
        <h3>脱敏项目乙</h3>
        <p>脱敏摘要乙</p>
        <button type="button">编辑项目经历</button>
        <button type="button">删除这段经历</button>
      </article>
      <button type="button">添加项目经历</button>
      <form aria-label="新增项目经历编辑器">
        <label>项目名称<input name="project-name"></label>
        <label>项目描述<textarea name="project-description"></textarea></label>
        <button type="button">保存</button>
        <button type="button">取消</button>
      </form>
    </div>
  </section>
`;

describe('I-002B record-list topology', () => {
  it('models two summary records, one creating editor, and every scoped action', () => {
    const { state, built } = buildFixture(projectListFixture);
    const { graph } = built;
    const project = graph.nodes.find(node => node.kind === 'section' && node.role === 'project');
    expect(project).toBeDefined();

    const lists = graph.nodes.filter(node => node.kind === 'record-list' && node.parentId === project?.id);
    expect(lists).toHaveLength(1);
    const list = lists[0]!;
    expect(list).toMatchObject({ recordType: 'project', existingRecordCount: 2, editorState: 'creating' });

    const records = graph.nodes.filter(isRecordNode).filter(node => node.parentId === list.id);
    const summaries = records.filter(node => node.state === 'summary');
    const editors = records.filter(node => node.state === 'creating');
    expect(summaries).toHaveLength(2);
    expect(editors).toHaveLength(1);

    for (const record of summaries) {
      const actions = graph.nodes.filter(node => node.kind === 'action' && node.parentId === record.id);
      expect(actions).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'edit-record', risk: 'reversible', targetId: record.id }),
        expect.objectContaining({ action: 'delete-record', risk: 'restricted', targetId: record.id }),
      ]));
    }

    const add = graph.nodes.find(node => node.kind === 'action' && node.action === 'add-record');
    expect(add).toMatchObject({ parentId: list.id, targetId: list.id, risk: 'reversible' });

    const editor = editors[0]!;
    const editorFields = graph.nodes.filter(node => node.kind === 'field' && node.parentId === editor.id);
    expect(editorFields.map(node => node.kind === 'field' ? node.fieldId : ''))
      .toEqual(state.result.fields.map(field => field.id));
    expect(graph.nodes.filter(node => node.kind === 'action' && node.parentId === editor.id))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'save-record', risk: 'commit', targetId: editor.id }),
        expect.objectContaining({ action: 'cancel-record', risk: 'restricted', targetId: editor.id }),
      ]));
    expect(built.omittedTargetedActionCount).toBe(0);
    expect(semanticGraphProblems(graph, state.result.fields.map(field => field.id))).toHaveLength(0);
  });

  it('keeps two same-name project sections and all targets structurally isolated', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list" aria-label="项目经历列表">
        <article role="listitem"><h3>脱敏项目甲</h3><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
      </div></section>
      <section><h2>项目经历</h2><div role="list" aria-label="项目经历列表">
        <article role="listitem"><h3>脱敏项目乙</h3><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
      </div></section>
    `);
    const graph = built.graph;
    const byId = nodeMap(graph);
    const sections = graph.nodes.filter(node => node.kind === 'section' && node.role === 'project');
    expect(sections).toHaveLength(2);

    for (const section of sections) {
      const lists = graph.nodes.filter(node => node.kind === 'record-list' && node.parentId === section.id);
      expect(lists).toHaveLength(1);
      const list = lists[0]!;
      expect(graph.nodes.filter(node => node.kind === 'record' && node.parentId === list.id)).toHaveLength(1);
      const scopedActions = graph.nodes.filter(isTargetedActionNode)
        .filter(node => nearestSectionId(node, byId) === section.id);
      expect(scopedActions).toHaveLength(3);
      for (const action of scopedActions) {
        expect(hasAncestor(action, action.targetId, byId)).toBe(true);
        expect(nearestSectionId(byId.get(action.targetId)!, byId)).toBe(section.id);
      }
    }
  });

  it('does not turn an ordinary basic fieldset into record topology', () => {
    const { state, built } = buildFixture(`
      <fieldset>
        <legend>基本信息</legend>
        <label>姓名<input></label>
        <button type="button">编辑</button>
        <button type="button">保存</button>
      </fieldset>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
    expect(built.graph.nodes.filter(node => node.kind === 'action'
      && ['edit-record', 'save-record'].includes(node.action))).toHaveLength(0);
    expect(built.omittedTargetedActionCount).toBe(2);
    const field = built.graph.nodes.find(node => node.kind === 'field');
    const basic = built.graph.nodes.find(node => node.kind === 'section' && node.role === 'basic');
    expect(field?.parentId).toBe(basic?.id);
    expect(semanticGraphProblems(built.graph, state.result.fields.map(item => item.id))).toHaveLength(0);
  });

  it('does not invent targets for isolated add or save controls', () => {
    const { built } = buildFixture(`
      <div><button type="button">添加项目经历</button></div>
      <div><button type="button">保存</button></div>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
    expect(built.graph.nodes.filter(node => node.kind === 'action'
      && ['add-record', 'save-record'].includes(node.action))).toHaveLength(0);
    expect(built.omittedTargetedActionCount).toBe(2);
  });

  it('fails closed for navigation lists, two ambiguous lists, and multiple visible editors', () => {
    const fixtures = [
      `<section><h2>项目经历</h2><nav><ul>
        <li><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></li>
        <button type="button">添加项目经历</button>
      </ul></nav></section>`,
      `<section><h2>项目经历</h2>
        <div role="list"><article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article><button type="button">添加项目经历</button></div>
        <div role="list"><article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article><button type="button">添加项目经历</button></div>
      </section>`,
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
        <form><label>项目名称<input></label><label>项目描述<textarea></textarea></label><button type="button">保存</button><button type="button">取消</button></form>
        <form><label>项目名称<input></label><label>项目描述<textarea></textarea></label><button type="button">保存</button><button type="button">取消</button></form>
      </div></section>`,
    ];

    for (const fixture of fixtures) {
      const { state, built } = buildFixture(fixture);
      expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
      expect(semanticGraphProblems(built.graph, state.result.fields.map(field => field.id))).toHaveLength(0);
    }
  });

  it('requires every emitted targeted action to point to an ancestor in the same section', () => {
    const { built } = buildFixture(projectListFixture);
    const { graph } = built;
    const byId = nodeMap(graph);
    const actions = graph.nodes.filter(isTargetedActionNode);
    expect(actions).toHaveLength(7);
    for (const action of actions) {
      const target = byId.get(action.targetId);
      expect(target).toBeDefined();
      expect(hasAncestor(action, action.targetId, byId)).toBe(true);
      expect(nearestSectionId(action, byId)).toBe(nearestSectionId(target!, byId));
    }
  });

  it('marks an editor as editing only when one summary explicitly controls it', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list" aria-label="项目经历列表">
        <article role="listitem"><h3>脱敏项目</h3>
          <button type="button" aria-controls="private-editor-id">编辑项目经历</button>
          <button type="button">删除这段经历</button>
        </article>
        <button type="button">添加项目经历</button>
        <form id="private-editor-id" aria-label="编辑项目经历编辑器">
          <label>项目名称<input></label><label>项目描述<textarea></textarea></label>
          <button type="button">保存</button><button type="button">取消</button>
        </form>
      </div></section>
    `);
    const list = built.graph.nodes.find(node => node.kind === 'record-list');
    const editor = built.graph.nodes.find(node => node.kind === 'record' && node.state === 'editing');
    expect(list).toMatchObject({ editorState: 'editing' });
    expect(editor).toMatchObject({ index: 0 });
    expect(JSON.stringify(built.graph)).not.toContain('private-editor-id');
  });

  it('keeps an unassociated edit-looking editor unknown instead of guessing a record', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list" aria-label="项目经历列表">
        <article role="listitem"><h3>脱敏项目</h3>
          <button type="button">编辑项目经历</button><button type="button">删除这段经历</button>
        </article>
        <button type="button">添加项目经历</button>
        <form aria-label="编辑项目经历编辑器">
          <label>项目名称<input></label><label>项目描述<textarea></textarea></label>
          <button type="button">保存</button><button type="button">取消</button>
        </form>
      </div></section>
    `);
    const list = built.graph.nodes.find(node => node.kind === 'record-list');
    const editor = built.graph.nodes.find(node => node.kind === 'record' && node.state === 'unknown');
    expect(list).toMatchObject({ editorState: 'unknown' });
    expect(editor).toMatchObject({ index: 1 });
  });
});

describe('I-002B record topology safety', () => {
  it('remains read-only and excludes values, visible record text, URL, title, and dynamic DOM identifiers', () => {
    document.title = 'private-candidate-title';
    const { state } = buildFixture(`
      <section aria-label="项目经历">
        <h2>项目经历</h2>
        <div role="list" aria-label="项目经历列表">
          <article role="listitem"><h3>private-visible-project</h3>
            <button type="button">编辑项目经历</button><button type="button">删除这段经历</button>
          </article>
          <button type="button">添加项目经历</button>
          <form action="/private-submit?candidate=private-url-token" aria-label="新增项目经历编辑器">
            <label>项目名称<input id="private-dynamic-id" name="private-dynamic-name" value="private-input-value"></label>
            <label>项目描述<textarea id="private-textarea-id" name="private-textarea-name">private-textarea-value</textarea></label>
            <button>保存</button><button type="button">取消</button>
          </form>
          <a href="/private-details?candidate=private-link-token">查看详情</a>
        </div>
      </section>
    `);
    const input = document.querySelector<HTMLInputElement>('input')!;
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    const beforeHtml = document.body.innerHTML;
    const beforeActive = document.activeElement;
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    Object.defineProperty(input, 'value', { configurable: true, get: () => { throw new Error('input value read'); } });
    Object.defineProperty(textarea, 'value', { configurable: true, get: () => { throw new Error('textarea value read'); } });
    let interactions = 0;
    const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => { interactions++; });
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => { interactions++; });
    const dispatch = vi.spyOn(EventTarget.prototype, 'dispatchEvent').mockImplementation(() => {
      interactions++;
      return true;
    });

    try {
      const first = buildPageSemanticGraph(document, state.result.fields, state.controls).graph;
      const second = buildPageSemanticGraph(document, state.result.fields, state.controls).graph;
      const serialized = JSON.stringify(first);

      expect(second).toEqual(first);
      expect(interactions).toBe(0);
      expect(observer.takeRecords()).toHaveLength(0);
      expect(document.body.innerHTML).toBe(beforeHtml);
      expect(document.activeElement).toBe(beforeActive);
      expect(serialized).not.toMatch(/private-candidate-title|private-visible-project|private-dynamic|private-input-value|private-textarea-value|private-url-token|private-link-token/u);
    } finally {
      observer.disconnect();
      click.mockRestore();
      focus.mockRestore();
      dispatch.mockRestore();
    }
  });
});

describe('I-002C contextual record topology', () => {
  it('recognizes a bare add icon and native submit save only inside a proven list and editor', () => {
    const { state, built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list" aria-label="项目经历列表">
        <article role="listitem"><h3>脱敏项目甲</h3><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <article role="listitem"><h3>脱敏项目乙</h3><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button" aria-label="+"></button>
        <form aria-label="新增项目经历编辑器">
          <label>项目名称<input></label><label>项目描述<textarea></textarea></label>
          <button>保存</button><button type="button">取消</button>
        </form>
      </div></section>
    `);
    const list = built.graph.nodes.find(node => node.kind === 'record-list');
    const editor = built.graph.nodes.find(node => node.kind === 'record' && node.state === 'creating');
    expect(list).toMatchObject({ existingRecordCount: 2, editorState: 'creating' });
    expect(built.graph.nodes.find(node => node.kind === 'action' && node.action === 'add-record'))
      .toMatchObject({ parentId: list?.id, targetId: list?.id, risk: 'reversible' });
    expect(built.graph.nodes.find(node => node.kind === 'action' && node.action === 'save-record'))
      .toMatchObject({ parentId: editor?.id, targetId: editor?.id, risk: 'restricted' });
    expect(built.graph.nodes.filter(node => node.kind === 'action' && node.action === 'submit')).toHaveLength(0);
    expect(semanticGraphProblems(built.graph, state.result.fields.map(field => field.id))).toHaveLength(0);
  });

  it('models two standard summary cards that expose edit but not delete', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list" aria-label="项目经历列表">
        <article role="listitem"><h3>脱敏项目甲</h3><button type="button">编辑项目经历</button></article>
        <article role="listitem"><h3>脱敏项目乙</h3><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
      </div></section>
    `);
    const list = built.graph.nodes.find(node => node.kind === 'record-list');
    const records = built.graph.nodes.filter(node => node.kind === 'record' && node.state === 'summary');
    expect(list).toMatchObject({ existingRecordCount: 2, editorState: 'closed' });
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(built.graph.nodes.filter(node => node.kind === 'action' && node.parentId === record.id))
        .toEqual([expect.objectContaining({ action: 'edit-record', targetId: record.id })]);
    }
  });

  it('models an explicitly empty semantic list but not a bare add control by itself', () => {
    const empty = buildFixture(`
      <section><h2>项目经历</h2><div role="list" aria-label="项目经历列表">
        <p role="status">暂无项目经历</p><button type="button">添加项目经历</button>
      </div></section>
    `).built;
    expect(empty.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ existingRecordCount: 0, editorState: 'closed' });
    expect(empty.graph.nodes.filter(node => node.kind === 'record')).toHaveLength(0);
    expect(empty.graph.nodes.find(node => node.kind === 'action' && node.action === 'add-record'))
      .toMatchObject({ targetId: expect.stringMatching(/^record-list:/u) });
    expect(JSON.stringify(empty.graph)).not.toContain('暂无项目经历');

    const ambiguous = buildFixture(`
      <section><h2>项目经历</h2><div role="list"><button type="button">添加项目经历</button></div></section>
    `).built;
    expect(ambiguous.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);

    const bare = buildFixture(`
      <section><h2>项目经历</h2><div role="list"><button type="button" aria-label="+"></button></div></section>
    `).built;
    expect(bare.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
  });

  it.each(['aria-controls', 'aria-owns'])('recognizes an external plus only with a unique %s relation to an explicit empty list', attribute => {
    const { built } = buildFixture(`<section><h2>项目经历</h2><header><button type="button" ${attribute}="items">+</button></header>
      <div id="items" role="list"><p role="status">暂无项目经历</p></div></section>`);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ existingRecordCount: 0, editorState: 'closed' });
    expect(built.graph.nodes.find(node => node.kind === 'action' && node.action === 'add-record'))
      .toMatchObject({ targetId: expect.stringMatching(/^record-list:/u) });
  });

  it('ignores a hidden editor template while retaining the proven closed list', () => {
    const { state, built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
        <form style="display: none" aria-label="新增项目经历编辑器">
          <label>项目名称<input></label><label>项目描述<textarea></textarea></label>
          <button type="submit">保存</button><button type="button">取消</button>
        </form>
      </div></section>
    `);
    const list = built.graph.nodes.find(node => node.kind === 'record-list');
    expect(list).toMatchObject({ existingRecordCount: 1, editorState: 'closed' });
    expect(built.graph.nodes.filter(node => node.kind === 'action'
      && ['save-record', 'cancel-record'].includes(node.action))).toHaveLength(0);
    expect(built.graph.nodes.filter(node => node.kind === 'field')).toHaveLength(state.result.fields.length);
    expect(semanticGraphProblems(built.graph, state.result.fields.map(field => field.id))).toHaveLength(0);
  });

  it('does not reinterpret final submission wording as an editor save', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
        <form aria-label="新增项目经历编辑器">
          <label>项目名称<input></label><label>项目描述<textarea></textarea></label>
          <button>保存并提交</button><button type="button">取消</button>
        </form>
      </div></section>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'action' && node.action === 'save-record')).toHaveLength(0);
    expect(built.graph.nodes.find(node => node.kind === 'action' && node.action === 'submit'))
      .toMatchObject({ risk: 'restricted' });
  });

  it('rejects add and empty-state evidence that names a different record type', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list" aria-label="项目经历列表">
        <p role="status">暂无教育经历</p><button type="button">添加教育经历</button>
      </div></section>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
  });

  it('does not claim an exact list when pagination or a larger ARIA set is present', () => {
    const fixtures = [
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button><nav><button type="button">下一页</button></nav>
      </div></section>`,
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem" aria-setsize="8" aria-posinset="1"><button type="button">编辑项目经历</button></article>
        <article role="listitem" aria-setsize="8" aria-posinset="2"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
      </div></section>`,
      `<section><h2>项目经历</h2><div role="list" aria-rowcount="8">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
      </div></section>`,
      `<section><h2>项目经历</h2><div role="list" aria-busy="true">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
      </div></section>`,
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem" aria-posinset="3"><button type="button">编辑项目经历</button></article>
        <article role="listitem" aria-posinset="4"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
      </div></section>`,
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
        <div role="group" aria-label="分页"><button type="button">1</button><button type="button">2</button></div>
      </div></section>`,
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
        <div role="group" aria-label="页码"><button type="button">上一页</button><button type="button">下一页</button></div>
      </div></section>`,
    ];
    for (const fixture of fixtures) {
      const { built } = buildFixture(fixture);
      expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
    }

    const complete = buildFixture(`
      <section><h2>项目经历</h2><div role="list" aria-rowcount="2">
        <article role="listitem" aria-setsize="2" aria-posinset="1"><button type="button">编辑项目经历</button></article>
        <article role="listitem" aria-setsize="2" aria-posinset="2"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
      </div></section>
    `).built;
    expect(complete.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ existingRecordCount: 2 });
  });

  it('supports a heading-delimited range inside one shared form', () => {
    const { built } = buildFixture(`
      <form>
        <h2>项目经历</h2>
        <div role="list"><article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article><button type="button">添加项目经历</button></div>
        <h2>教育经历</h2><label>学校<input></label>
      </form>
    `);
    const project = built.graph.nodes.find(node => node.kind === 'section' && node.role === 'project');
    const list = built.graph.nodes.find(node => node.kind === 'record-list');
    expect(project).toBeDefined();
    expect(list).toMatchObject({ parentId: project?.id, recordType: 'project', existingRecordCount: 1 });
  });

  it('supports repeated generic div cards and a unique external add action', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2>
        <header><button type="button">添加项目经历</button></header>
        <div>
          <div><h3>脱敏项目甲</h3><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></div>
          <div><h3>脱敏项目乙</h3><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></div>
        </div>
      </section>
    `);
    const list = built.graph.nodes.find(node => node.kind === 'record-list');
    expect(list).toMatchObject({ existingRecordCount: 2, editorState: 'closed' });
    expect(built.graph.nodes.filter(node => node.kind === 'record' && node.parentId === list?.id)).toHaveLength(2);
    expect(built.graph.nodes.find(node => node.kind === 'action' && node.action === 'add-record'))
      .toMatchObject({ parentId: list?.id, targetId: list?.id });
  });

  it('keeps a section-level native save as submit without discarding the proven list', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
      </div><button>保存</button></section>
    `);
    expect(built.graph.nodes.find(node => node.kind === 'record-list')).toBeDefined();
    expect(built.graph.nodes.find(node => node.kind === 'action' && node.action === 'submit'))
      .toMatchObject({ risk: 'restricted' });
  });

  it('does not promote disclosure, picker, or stepper plus controls to record additions', () => {
    const plusVariants = [
      '<button type="button" aria-label="+" aria-expanded="false"></button>',
      '<div role="combobox"><button type="button" aria-label="+"></button></div>',
      '<div role="spinbutton"><button type="button" aria-label="+"></button></div>',
    ];
    for (const plus of plusVariants) {
      const { built } = buildFixture(`
        <section><h2>项目经历</h2><div role="list">
          <article role="listitem"><button type="button">编辑项目经历</button></article>
          <article role="listitem"><button type="button">编辑项目经历</button></article>
          ${plus}
        </div></section>
      `);
      expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
      expect(built.graph.nodes.filter(node => node.kind === 'action' && node.action === 'add-record')).toHaveLength(0);
    }
  });

  it('ignores content-visibility hidden editor actions', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
        <form style="content-visibility: hidden" aria-label="新增项目经历编辑器">
          <label>项目名称<input></label><label>项目描述<textarea></textarea></label>
          <button type="submit">保存</button><button type="button">取消</button>
        </form>
      </div></section>
    `);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ existingRecordCount: 1, editorState: 'closed' });
    expect(built.graph.nodes.filter(node => node.kind === 'action'
      && ['save-record', 'cancel-record'].includes(node.action))).toHaveLength(0);
  });

  it('does not turn an unrelated final confirmation form into a record editor', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
        <form aria-label="最终确认申请">
          <label>同意声明<input type="checkbox"></label><label>确认真实<input type="checkbox"></label>
          <button type="submit">保存</button><button type="button">取消</button>
        </form>
      </div></section>
    `);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ existingRecordCount: 2, editorState: 'closed' });
    expect(built.graph.nodes.filter(node => node.kind === 'record' && node.state !== 'summary')).toHaveLength(0);
    expect(built.graph.nodes.filter(node => node.kind === 'action' && node.action === 'save-record')).toHaveLength(0);
    expect(built.graph.nodes.find(node => node.kind === 'action' && node.action === 'submit'))
      .toMatchObject({ risk: 'restricted' });
  });

  it('keeps ordinary save and cancel controls outside an editor from discarding a proven list', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <button type="button">添加项目经历</button>
        <div role="toolbar"><button type="button">保存</button><button type="button">取消</button></div>
      </div></section>
    `);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ existingRecordCount: 2, editorState: 'closed' });
  });

  it('requires editor semantics to match the surrounding record type', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
        <form aria-label="新增教育经历编辑器">
          <label>学校<input></label><label>专业<input></label>
          <button type="button">保存</button><button type="button">取消</button>
        </form>
      </div></section>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
  });

  it('uses a unique add-to-editor relationship as independent editor identity', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button" aria-controls="detached-editor">添加项目经历</button>
      </div>
      <form id="detached-editor"><label>项目名称<input></label><label>项目描述<textarea></textarea></label>
        <button type="button">保存</button><button type="button">取消</button>
      </form></section>
    `);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ existingRecordCount: 1, editorState: 'creating' });
    expect(built.graph.nodes.find(node => node.kind === 'record' && node.state === 'creating')).toBeDefined();
  });

  it('keeps two heading-delimited record sections isolated inside a shared form', () => {
    const { built } = buildFixture(`
      <form>
        <h2>项目经历</h2><div role="list"><article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article><button type="button">添加项目经历</button></div>
        <h2>教育经历</h2><div role="list"><article role="listitem"><button type="button">编辑教育经历</button><button type="button">删除这段经历</button></article><button type="button">添加教育经历</button></div>
      </form>
    `);
    const sections = built.graph.nodes.filter(node => node.kind === 'section');
    const lists = built.graph.nodes.filter(node => node.kind === 'record-list');
    expect(sections.map(section => section.role)).toEqual(['project', 'education']);
    expect(lists).toHaveLength(2);
    expect(lists.map(list => list.parentId)).toEqual(sections.map(section => section.id));
  });

  it('accepts student-work wording without confusing it with internship experience', () => {
    const { built } = buildFixture(`
      <section><h2>校内职务</h2><div role="list">
        <article role="listitem"><button type="button">编辑校内职务</button><button type="button">删除这段经历</button></article>
        <button type="button">添加学生工作经历</button>
      </div></section>
    `);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ recordType: 'student-work', existingRecordCount: 1 });
  });

  it('omits navigating add and edit links from record topology', () => {
    const fixtures = [
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <a href="/private-add">添加项目经历</a>
      </div></section>`,
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem"><a href="/private-edit-1">编辑项目经历</a></article>
        <article role="listitem"><a href="/private-edit-2">编辑项目经历</a></article>
        <button type="button">添加项目经历</button>
      </div></section>`,
    ];
    for (const fixture of fixtures) {
      const { built } = buildFixture(fixture);
      expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
      expect(JSON.stringify(built.graph)).not.toContain('private-');
    }
  });

  it('rejects a plus control that owns a picker instead of a record editor', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <article role="listitem"><button type="button">编辑项目经历</button></article>
        <button type="button" aria-label="+" aria-controls="private-picker"></button>
        <div id="private-picker" role="listbox"><div role="option">1</div></div>
      </div></section>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
  });

  it('rejects conflicting, unresolved, and cross-section add control relationships', () => {
    const fixtures = [
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button" aria-controls="private-editor">添加项目经历</button>
        <div role="dialog" id="private-editor" aria-label="教育经历"><label>学校<input></label><label>专业<input></label><button type="button">保存</button><button type="button">取消</button></div>
      </div></section>`,
      `<section><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button" aria-controls="private-editor missing-editor">添加项目经历</button>
        <div role="dialog" id="private-editor"><label>名称<input></label><label>描述<input></label><button type="button">保存</button><button type="button">取消</button></div>
      </div></section>`,
      `<form><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button" aria-controls="private-education-editor">添加项目经历</button>
      </div><h2>教育经历</h2><div role="dialog" id="private-education-editor"><label>学校<input></label><label>专业<input></label><button type="button">保存</button><button type="button">取消</button></div></form>`,
    ];
    for (const fixture of fixtures) {
      const { built } = buildFixture(fixture);
      expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
    }
  });

  it('does not steal an external add action from a different partial list', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2>
        <div><div><button type="button">编辑项目经历</button></div><div><button type="button">编辑项目经历</button></div></div>
        <div><button type="button">添加项目经历</button><div><button type="button">编辑项目经历</button></div></div>
      </section>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
  });

  it('fails closed when a generic repeated card is missing its edit action', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><header><button type="button">添加项目经历</button></header>
        <div>
          <div><h3>脱敏项目甲</h3><button type="button">编辑项目经历</button></div>
          <div><h3>脱敏项目乙</h3><button type="button">编辑项目经历</button></div>
          <div><h3>脱敏项目丙</h3></div>
        </div>
      </section>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
  });

  it('ends semantic ownership at an unknown peer heading', () => {
    const { built } = buildFixture(`
      <form><h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
      </div><h2>其他资料</h2><button type="button">继续</button></form>
    `);
    const byId = nodeMap(built.graph);
    const project = built.graph.nodes.find(node => node.kind === 'section' && node.role === 'project');
    const next = built.graph.nodes.find(node => node.kind === 'action' && node.action === 'next-step');
    expect(project).toBeDefined();
    expect(next).toBeDefined();
    expect(nearestSectionId(next!, byId)).not.toBe(project?.id);
  });

  it('keeps lower-level headings inside generic cards under the governing section', () => {
    const { built } = buildFixture(`
      <form><h2>项目经历</h2><header><button type="button">添加项目经历</button></header>
        <div>
          <div><h3>项目经历</h3><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></div>
          <div><h3>项目经历</h3><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></div>
        </div>
        <h2>教育经历</h2><label>学校<input></label>
      </form>
    `);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ recordType: 'project', existingRecordCount: 2 });
  });

  it('keeps repeated same-level headings inside generic cards under the governing section', () => {
    const { built } = buildFixture(`
      <form><h2>项目经历</h2><header><button type="button">添加项目经历</button></header>
        <div>
          <div><h2>项目经历</h2><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></div>
          <div><h2>项目经历</h2><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></div>
        </div>
        <h2>教育经历</h2><label>学校<input></label>
      </form>
    `);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ recordType: 'project', existingRecordCount: 2 });
  });

  it('fails closed for a visible inline editor inside a summary card', () => {
    const { built } = buildFixture(`
      <section><h2>项目经历</h2><div role="list"><article role="listitem">
        <button type="button" aria-controls="private-inline-editor">编辑项目经历</button>
        <button type="button">删除这段经历</button>
        <form id="private-inline-editor" aria-label="编辑项目经历编辑器">
          <label>名称<input></label><label>描述<textarea></textarea></label>
          <button type="button">保存</button><button type="button">取消</button>
        </form>
      </article><button type="button">添加项目经历</button></div></section>
    `);
    expect(built.graph.nodes.filter(node => node.kind === 'record-list' || node.kind === 'record')).toHaveLength(0);
  });

  it('supports a heading-delimited record list directly inside an open shadow root', () => {
    document.body.innerHTML = '<div id="shadow-host"></div>';
    const host = document.querySelector<HTMLElement>('#shadow-host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <h2>项目经历</h2><div role="list">
        <article role="listitem"><button type="button">编辑项目经历</button><button type="button">删除这段经历</button></article>
        <button type="button">添加项目经历</button>
      </div><h2>教育经历</h2><label>学校<input></label>
    `;
    const state = scanDocument(document);
    const built = buildPageSemanticGraph(document, state.result.fields, state.controls);
    expect(built.graph.nodes.find(node => node.kind === 'record-list'))
      .toMatchObject({ recordType: 'project', existingRecordCount: 1 });
  });
});
