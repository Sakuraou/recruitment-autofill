import { beforeEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { buildPageSemanticGraph } from '../src/content/semantic/graphBuilder';
import { semanticGraphProblems } from '../src/shared/semanticGraphValidation';
import type { FieldDescriptor } from '../src/shared/types';

beforeEach(() => {
  document.title = '';
  document.body.innerHTML = '';
});

function minimalField(id: string, sectionText = ''): FieldDescriptor {
  return {
    id, kind: 'input', type: 'text', label: '', placeholder: '', name: '', htmlId: '', ariaLabel: '', title: '',
    parentText: '', previousText: '', tableHeader: '', sectionText, options: [], maxLength: null, required: false,
    hasValue: false, disabled: false, readOnly: false,
  };
}

describe('read-only page semantic graph builder', () => {
  it('追加原生字段不会因扫描器分组而改变原 ARIA 字段的语义编号', () => {
    document.body.innerHTML = '<section aria-label="项目经历"><h2>项目经历</h2><label>项目名称<input id="name"></label><button type="button" id="role" role="combobox" aria-label="项目角色" aria-controls="choices">请选择</button><div id="choices" role="listbox" hidden><div role="option">开发成员</div></div></section>';
    const before = scanDocument(); const role = document.querySelector('#role')!;
    const originalId = [...before.semanticTargets].find(([id, node]) => id.startsWith('field:') && node === role)![0];
    document.querySelector('section')!.insertAdjacentHTML('beforeend', '<label>技术栈<input id="stack"></label>');
    const after = scanDocument();
    expect(after.semanticTargets.get(originalId)).toBe(role);
    const fields = after.result.semanticGraph!.nodes.filter(node => node.kind === 'field');
    expect(fields.map(node => after.semanticTargets.get(node.id)?.id)).toEqual(['name', 'role', 'stack']);
    expect(semanticGraphProblems(after.result.semanticGraph!, after.result.fields.map(field => field.id))).toEqual([]);
  });
  it('groups fields under canonical sections and retains only untargeted actions', () => {
    document.title = 'private-candidate-title';
    document.body.innerHTML = `
      <section id="private-project-section" aria-label="项目经历">
        <h2>项目经历</h2>
        <label>项目名称<input id="private-project-id" name="private-project-name" value="private-project-value"></label>
        <textarea name="private-description">private-description-value</textarea>
        <button type="button">添加项目经历</button>
        <button type="button" aria-expanded="false">展开更多</button>
      </section>
      <form><button>保存</button></form>
      <a href="https://example.invalid/path?private=token">查看详情</a>
      <input type="file" name="private-upload-name">
      <button type="button">删除这段经历</button>
    `;

    const state = scanDocument(document);
    const built = buildPageSemanticGraph(document, state.result.fields, state.controls);
    const graphText = JSON.stringify(built.graph);
    const section = built.graph.nodes.find(node => node.kind === 'section' && node.role === 'project');
    const fieldNodes = built.graph.nodes.filter(node => node.kind === 'field');
    const actions = built.graph.nodes.filter(node => node.kind === 'action');

    expect(section).toMatchObject({ heading: '项目经历', role: 'project' });
    expect(fieldNodes.map(node => node.kind === 'field' ? node.fieldId : '')).toEqual(state.result.fields.map(field => field.id));
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'expand', risk: 'inspect', canonicalLabel: '展开或收起' }),
      expect.objectContaining({ action: 'submit', risk: 'restricted', canonicalLabel: '最终提交' }),
      expect.objectContaining({ action: 'upload', risk: 'restricted', canonicalLabel: '上传文件' }),
    ]));
    expect(built.omittedTargetedActionCount).toBe(2);
    expect(semanticGraphProblems(built.graph, state.result.fields.map(field => field.id))).toHaveLength(0);
    expect(graphText).not.toMatch(/private-candidate-title|private-project-id|private-project-name|private-project-value|private-description-value|private-upload-name|example\.invalid|token/u);
    expect([...built.targets.values()].every(value => value instanceof Element)).toBe(true);
    expect(graphText).not.toContain('semanticTargets');
  });

  it('does not read live field values, dispatch events, focus, scroll or mutate the DOM', () => {
    document.body.innerHTML = `
      <section><h2>教育经历</h2>
        <label>学校<input id="school" value="private-school-value"></label>
        <label>说明<textarea id="description">private-textarea-value</textarea></label>
        <button type="button" aria-expanded="false">展开更多</button>
      </section>
    `;
    const state = scanDocument(document);
    const input = document.querySelector<HTMLInputElement>('#school')!;
    const textarea = document.querySelector<HTMLTextAreaElement>('#description')!;
    const button = document.querySelector<HTMLButtonElement>('button')!;
    const before = document.body.innerHTML;
    const activeBefore = document.activeElement;
    let interactionCount = 0;
    button.click = () => { interactionCount++; };
    button.focus = () => { interactionCount++; };
    button.scrollIntoView = () => { interactionCount++; };
    button.dispatchEvent = () => { interactionCount++; return true; };
    Object.defineProperty(input, 'value', { configurable: true, get: () => { throw new Error('input value read'); } });
    Object.defineProperty(textarea, 'value', { configurable: true, get: () => { throw new Error('textarea value read'); } });

    const first = buildPageSemanticGraph(document, state.result.fields, state.controls).graph;
    const second = buildPageSemanticGraph(document, state.result.fields, state.controls).graph;

    expect(second).toEqual(first);
    expect(interactionCount).toBe(0);
    expect(document.body.innerHTML).toBe(before);
    expect(document.activeElement).toBe(activeBefore);
    expect(JSON.stringify(first)).not.toMatch(/private-school-value|private-textarea-value/u);
  });

  it('maps open shadow roots and accessible iframes to deterministic numeric frame paths', () => {
    document.body.innerHTML = '<iframe id="private-light-frame"></iframe><div id="host"></div>';
    const lightFrame = document.querySelector<HTMLIFrameElement>('iframe')!;
    lightFrame.contentDocument!.body.innerHTML = '<section><h2>教育经历</h2><label>学校<input></label><iframe></iframe></section>';
    const nestedFrame = lightFrame.contentDocument!.querySelector<HTMLIFrameElement>('iframe')!;
    nestedFrame.contentDocument!.body.innerHTML = '<label>专业<input></label>';
    const shadow = document.querySelector<HTMLElement>('#host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<section><h2>项目经历</h2><label>项目名称<input></label><iframe id="private-shadow-frame"></iframe></section>';
    const shadowFrame = shadow.querySelector<HTMLIFrameElement>('iframe')!;
    // jsdom does not attach a browsing context to iframes created inside ShadowRoot.
    const shadowFrameDocument = document.implementation.createHTMLDocument('private-shadow-frame-title');
    Object.defineProperty(shadowFrame, 'contentDocument', { configurable: true, value: shadowFrameDocument });
    shadowFrameDocument.body.innerHTML = '<label>项目职责<input></label>';

    const state = scanDocument(document);
    const graph = state.result.semanticGraph!;
    const paths = graph.nodes.filter(node => node.kind === 'field').map(node => node.framePath ?? []);

    expect(paths).toEqual(expect.arrayContaining([[], [0], [0, 0], [1]]));
    expect(paths.flat().every(part => Number.isInteger(part) && part >= 0)).toBe(true);
    expect(JSON.stringify(graph)).not.toMatch(/private-light-frame|private-shadow-frame|private-shadow-frame-title/u);
  });

  it('fails closed when the field-to-DOM registry is incomplete or fields are duplicated', () => {
    document.body.innerHTML = '<label>姓名<input></label>';
    const state = scanDocument(document);
    expect(() => buildPageSemanticGraph(document, state.result.fields, new Map())).toThrow(/控件引用/u);
    expect(() => buildPageSemanticGraph(document, [...state.result.fields, ...state.result.fields], state.controls))
      .toThrow(/结构校验/u);
  });

  it('keeps multiple headings in one form as separate sections', () => {
    document.body.innerHTML = `
      <form>
        <h2>基本信息</h2><div><label>姓名<input name="first"></label></div>
        <h2>教育经历</h2><div><label>学校<input name="second"></label></div>
      </form>
    `;
    const graph = scanDocument(document).result.semanticGraph!;
    const sections = graph.nodes.filter(node => node.kind === 'section');
    const fields = graph.nodes.filter(node => node.kind === 'field');

    expect(sections.map(node => node.kind === 'section' ? node.role : '')).toEqual(['basic', 'education']);
    expect(fields.map(node => graph.nodes.find(parent => parent.id === node.parentId)))
      .toEqual([expect.objectContaining({ kind: 'section', role: 'basic' }), expect.objectContaining({ kind: 'section', role: 'education' })]);
  });

  it('stops at a conflicting inner section instead of inheriting an outer role', () => {
    document.body.innerHTML = `
      <form aria-label="基本信息">
        <section aria-label="项目经历"><h2>教育经历</h2><label>学校<input></label></section>
      </form>
    `;
    const graph = scanDocument(document).result.semanticGraph!;
    const field = graph.nodes.find(node => node.kind === 'field')!;
    expect(field.parentId).toBe(graph.rootId);
    expect(graph.nodes.filter(node => node.kind === 'section')).toHaveLength(0);
  });

  it('does not merge two independent same-role heading regions', () => {
    document.body.innerHTML = `
      <form>
        <h2>项目经历</h2><div><label>项目一<input></label></div>
        <h2>项目经历</h2><div><label>项目二<input></label></div>
      </form>
    `;
    const graph = scanDocument(document).result.semanticGraph!;
    const sections = graph.nodes.filter(node => node.kind === 'section' && node.role === 'project');
    expect(sections).toHaveLength(2);
    expect(new Set(graph.nodes.filter(node => node.kind === 'field').map(node => node.parentId)).size).toBe(2);
  });

  it('groups multiple wrappers under one heading while separating nested heading regions', () => {
    document.body.innerHTML = `
      <form>
        <h2>教育经历</h2>
        <div><label>学校<input></label></div>
        <div><label>专业<input></label></div>
      </form>
    `;
    const oneHeading = scanDocument(document).result.semanticGraph!;
    expect(oneHeading.nodes.filter(node => node.kind === 'section' && node.role === 'education')).toHaveLength(1);
    expect(new Set(oneHeading.nodes.filter(node => node.kind === 'field').map(node => node.parentId)).size).toBe(1);

    document.body.innerHTML = `
      <section>
        <div><h2>基本信息</h2><label>姓名<input></label></div>
        <div><h2>教育经历</h2><label>学校<input></label></div>
      </section>
    `;
    const nestedHeadings = scanDocument(document).result.semanticGraph!;
    expect(nestedHeadings.nodes.filter(node => node.kind === 'section').map(node => node.kind === 'section' ? node.role : ''))
      .toEqual(['basic', 'education']);
  });

  it('does not inherit a heading from a closed sibling section', () => {
    document.body.innerHTML = `
      <form>
        <section><h2>教育经历</h2><label>学校<input></label></section>
        <div><label>备注<input></label></div>
        <button type="button">下一步</button>
      </form>
    `;
    const graph = scanDocument(document).result.semanticGraph!;
    const fields = graph.nodes.filter(node => node.kind === 'field');
    const education = graph.nodes.find(node => node.kind === 'section' && node.role === 'education');
    const other = graph.nodes.find(node => node.kind === 'section' && node.role === 'other');
    const next = graph.nodes.find(node => node.kind === 'action' && node.action === 'next-step');

    expect(fields[0]?.parentId).toBe(education?.id);
    expect(fields[1]?.parentId).toBe(graph.rootId);
    expect(next?.parentId).toBe(other?.id);
    expect(next?.parentId).not.toBe(education?.id);
  });

  it('keeps a bare plus restricted outside a verified record list and inherits ancestor disabled state', () => {
    document.body.innerHTML = `
      <section><h2>基本信息</h2><button type="button">+</button></section>
      <fieldset disabled><legend>教育经历</legend><button type="button" aria-expanded="false">展开更多</button></fieldset>
    `;
    const actions = scanDocument(document).result.semanticGraph!.nodes.filter(node => node.kind === 'action');
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'unknown', risk: 'restricted' }),
      expect.objectContaining({ action: 'expand', risk: 'inspect', disabled: true }),
    ]));
  });

  it('preserves a valid graph when a page or section already has 500 field children', () => {
    const inputs = Array.from({ length: 500 }, () => document.createElement('input'));
    const fields = inputs.map((_, index) => minimalField(`scan:${index}`));
    const controls = new Map(fields.map((field, index) => [field.id, { node: inputs[index]! }]));
    document.body.append(...inputs, Object.assign(document.createElement('button'), { type: 'button', textContent: '确认' }));
    const pageGraph = buildPageSemanticGraph(document, fields, controls).graph;
    expect(pageGraph).toBeDefined();
    expect(semanticGraphProblems(pageGraph, pageGraph.nodes.filter(node => node.kind === 'field').map(node => node.fieldId))).toHaveLength(0);
    expect(pageGraph.nodes.filter(node => node.kind === 'action')).toHaveLength(0);

    const section = document.createElement('section');
    section.innerHTML = '<h2>教育经历</h2><button type="button" aria-expanded="false">展开更多</button>';
    section.append(...inputs);
    document.body.replaceChildren(section);
    const sectionFields = fields.map(field => ({ ...field, sectionText: '教育经历' }));
    const sectionGraph = buildPageSemanticGraph(document, sectionFields, controls).graph;
    expect(sectionGraph).toBeDefined();
    expect(sectionGraph.nodes.filter(node => node.kind === 'action')).toHaveLength(0);
    expect(sectionGraph.nodes.find(node => node.kind === 'section')?.childIds).toHaveLength(500);
  }, 40_000);

  it('rejects a field whose DOM root is not registered', () => {
    document.body.innerHTML = '<label>姓名<input></label>';
    const state = scanDocument(document);
    const detached = document.createElement('input');
    const controls = new Map(state.controls);
    controls.set(state.result.fields[0]!.id, { node: detached, fingerprint: 'private-only' });
    expect(() => buildPageSemanticGraph(document, state.result.fields, controls)).toThrow(/页面根节点/u);
  });
});
