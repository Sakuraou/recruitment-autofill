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
            <button type="button">保存</button><button type="button">取消</button>
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
