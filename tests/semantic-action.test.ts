import { describe, expect, it } from 'vitest';
import { classifyAction } from '../src/content/semantic/actionClassifier';
import { SEMANTIC_GRAPH_SCHEMA_VERSION, type PageSemanticGraph, type SemanticNode } from '../src/shared/semanticGraph';
import { isValidSemanticGraph, semanticGraphProblems } from '../src/shared/semanticGraphValidation';

const validRecordTopologyGraph = (): PageSemanticGraph => ({
  schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
  rootId: 'page:0',
  nodes: [
    { id: 'page:0', kind: 'page', parentId: null, childIds: ['section:0'], order: 0,
      structuralFingerprint: '0123456789abcdef', evidence: [], framePath: [] },
    { id: 'section:0', kind: 'section', parentId: 'page:0', childIds: ['list:0'], order: 0,
      structuralFingerprint: '0123456789abcdea', evidence: ['heading'], framePath: [],
      heading: '项目经历', role: 'project', confidence: 1 },
    { id: 'list:0', kind: 'record-list', parentId: 'section:0',
      childIds: ['record:0', 'record:1', 'editor:0', 'action:add'], order: 0,
      structuralFingerprint: '0123456789abcdeb', evidence: ['repeated-structure'], framePath: [],
      recordType: 'project', existingRecordCount: 2, editorState: 'creating' },
    { id: 'record:0', kind: 'record', parentId: 'list:0', childIds: ['action:edit', 'action:delete'], order: 0,
      structuralFingerprint: '0123456789abcdec', evidence: ['repeated-structure'], framePath: [], index: 0, state: 'summary' },
    { id: 'action:edit', kind: 'action', parentId: 'record:0', childIds: [], order: 0,
      structuralFingerprint: '0123456789abcded', evidence: ['edit-action'], framePath: [],
      action: 'edit-record', risk: 'reversible', disabled: false, canonicalLabel: '编辑记录', targetId: 'record:0' },
    { id: 'action:delete', kind: 'action', parentId: 'record:0', childIds: [], order: 1,
      structuralFingerprint: '0123456789abcdee', evidence: ['edit-action'], framePath: [],
      action: 'delete-record', risk: 'restricted', disabled: false, canonicalLabel: '删除记录', targetId: 'record:0' },
    { id: 'record:1', kind: 'record', parentId: 'list:0', childIds: [], order: 1,
      structuralFingerprint: '0123456789abcdef', evidence: ['repeated-structure'], framePath: [], index: 1, state: 'summary' },
    { id: 'editor:0', kind: 'record', parentId: 'list:0', childIds: ['action:save', 'action:cancel'], order: 2,
      structuralFingerprint: '1123456789abcdef', evidence: ['editor-actions'], framePath: [], index: 2, state: 'creating' },
    { id: 'action:save', kind: 'action', parentId: 'editor:0', childIds: [], order: 0,
      structuralFingerprint: '2123456789abcdef', evidence: ['editor-actions'], framePath: [],
      action: 'save-record', risk: 'commit', disabled: false, canonicalLabel: '保存记录', targetId: 'editor:0' },
    { id: 'action:cancel', kind: 'action', parentId: 'editor:0', childIds: [], order: 1,
      structuralFingerprint: '3123456789abcdef', evidence: ['editor-actions'], framePath: [],
      action: 'cancel-record', risk: 'restricted', disabled: false, canonicalLabel: '取消编辑', targetId: 'editor:0' },
    { id: 'action:add', kind: 'action', parentId: 'list:0', childIds: [], order: 3,
      structuralFingerprint: '4123456789abcdef', evidence: ['add-action'], framePath: [],
      action: 'add-record', risk: 'reversible', disabled: false, canonicalLabel: '添加记录', targetId: 'list:0' },
  ],
});

describe('semantic action classification', () => {
  it.each([
    ['添加项目经历', 'add-record', 'reversible'],
    ['新增教育经历', 'add-record', 'reversible'],
    ['编辑', 'edit-record', 'reversible'],
    ['保存', 'save-record', 'commit'],
    ['取消', 'cancel-record', 'restricted'],
    ['展开更多', 'expand', 'restricted'],
    ['下一步', 'next-step', 'commit'],
    ['保存并下一步', 'next-step', 'commit'],
    ['删除这条经历', 'delete-record', 'restricted'],
    ['提交申请', 'submit', 'restricted'],
    ['保存并提交', 'submit', 'restricted'],
    ['下一步并提交', 'submit', 'restricted'],
    ['继续投递', 'submit', 'restricted'],
    ['取消申请', 'withdraw', 'restricted'],
    ['撤回申请', 'withdraw', 'restricted'],
    ['编辑并保存', 'save-record', 'restricted'],
    ['修改并保存', 'save-record', 'restricted'],
    ['新增并保存', 'save-record', 'restricted'],
    ['取消编辑', 'cancel-record', 'restricted'],
    ['关闭编辑', 'cancel-record', 'restricted'],
    ['放弃修改', 'cancel-record', 'restricted'],
    ['cancel modification', 'cancel-record', 'restricted'],
    ['不保存', 'save-record', 'restricted'],
    ['放弃保存', 'save-record', 'restricted'],
    ['do not save', 'save-record', 'restricted'],
    ["don't save", 'save-record', 'restricted'],
    ['同意并继续', 'next-step', 'restricted'],
    ['agree and continue', 'next-step', 'restricted'],
    ['授权并继续', 'next-step', 'restricted'],
    ['验证并继续', 'next-step', 'restricted'],
    ['发送验证码并继续', 'next-step', 'restricted'],
    ['verify and continue', 'next-step', 'restricted'],
    ['保存并完成', 'save-record', 'restricted'],
    ['下一步并完成', 'next-step', 'restricted'],
    ['save and finish', 'save-record', 'restricted'],
    ['上传附件', 'upload', 'restricted'],
    ['无法判断', 'unknown', 'restricted'],
  ] as const)('classifies %s as %s with %s risk', (accessibleName, action, risk) => {
    expect(classifyAction({ accessibleName })).toMatchObject({ action, risk });
  });

  it('never lowers native submit, file or navigation controls to a reversible risk', () => {
    expect(classifyAction({ accessibleName: '保存', tagName: 'button', inputType: 'submit' })).toMatchObject({ action: 'submit', risk: 'restricted' });
    expect(classifyAction({ accessibleName: '确认', tagName: 'input', inputType: 'submit' })).toMatchObject({ action: 'submit', risk: 'restricted' });
    expect(classifyAction({ accessibleName: '项目经历', role: 'tab' })).toMatchObject({ action: 'select-tab', risk: 'inspect' });
    expect(classifyAction({ accessibleName: '选择文件', inputType: 'file', disabled: true })).toMatchObject({ action: 'upload', risk: 'restricted', disabled: true });
    expect(classifyAction({ accessibleName: '查看详情', tagName: 'a', href: '/application/details' })).toMatchObject({ action: 'expand', risk: 'restricted' });
    expect(classifyAction({ accessibleName: '提交申请', role: 'tab' })).toMatchObject({ action: 'submit', risk: 'restricted' });
    expect(classifyAction({ accessibleName: '下一步', tagName: 'input', inputType: 'image' })).toMatchObject({ action: 'submit', risk: 'restricted' });
    expect(classifyAction({ accessibleName: '展开更多', ariaExpanded: false })).toMatchObject({ action: 'expand', risk: 'inspect' });
    expect(classifyAction({ accessibleName: '保存', tagName: 'button' })).toMatchObject({ action: 'save-record', risk: 'restricted' });
    expect(classifyAction({ accessibleName: '保存', tagName: 'a', href: '' })).toMatchObject({ action: 'save-record', risk: 'restricted' });
    expect(classifyAction({ accessibleName: '保存', tagName: 'a' })).toMatchObject({ action: 'save-record', risk: 'commit' });
    expect(classifyAction({ accessibleName: '保存', tagName: 'a', href: '#' })).toMatchObject({ action: 'save-record', risk: 'commit' });
    expect(classifyAction({ accessibleName: '保存', tagName: 'a', href: 'javascript:void(0)' })).toMatchObject({ action: 'save-record', risk: 'commit' });
  });

  it('recognizes a bare add icon only inside a known record context', () => {
    expect(classifyAction({ accessibleName: '+', recordContext: true })).toMatchObject({ action: 'add-record', risk: 'reversible' });
    expect(classifyAction({ accessibleName: '+', recordContext: false })).toMatchObject({ action: 'unknown', risk: 'restricted' });
  });

  it('does not copy private source labels into the classified action', () => {
    const result = classifyAction({ accessibleName: '编辑 私密项目名称' });
    expect(result).toMatchObject({ action: 'edit-record', canonicalLabel: '编辑记录' });
    expect(JSON.stringify(result)).not.toContain('私密项目名称');
  });
});

describe('semantic graph contract', () => {
  it('accepts a precise record-list topology with direct, same-frame action targets', () => {
    expect(semanticGraphProblems(validRecordTopologyGraph(), [])).toHaveLength(0);
  });

  it('accepts an unknown editor only when its list state and stable index agree', () => {
    const graph = validRecordTopologyGraph();
    const list = graph.nodes.find(node => node.id === 'list:0');
    const editor = graph.nodes.find(node => node.id === 'editor:0');
    if (list?.kind !== 'record-list' || editor?.kind !== 'record') throw new Error('missing topology fixture');
    list.editorState = 'unknown';
    editor.state = 'unknown';

    expect(semanticGraphProblems(graph, [])).toHaveLength(0);
  });

  it('accepts an editing editor only when it references an existing summary index', () => {
    const graph = validRecordTopologyGraph();
    const list = graph.nodes.find(node => node.id === 'list:0');
    const editor = graph.nodes.find(node => node.id === 'editor:0');
    if (list?.kind !== 'record-list' || editor?.kind !== 'record') throw new Error('missing topology fixture');
    list.editorState = 'editing';
    editor.state = 'editing';
    editor.index = 1;

    expect(semanticGraphProblems(graph, [])).toHaveLength(0);
  });

  it('rejects inconsistent record-list counts, indexes, editor state, roles and frame paths', () => {
    const graph = validRecordTopologyGraph();
    const section = graph.nodes.find(node => node.id === 'section:0');
    const list = graph.nodes.find(node => node.id === 'list:0');
    const secondRecord = graph.nodes.find(node => node.id === 'record:1');
    const editor = graph.nodes.find(node => node.id === 'editor:0');
    if (section?.kind !== 'section' || list?.kind !== 'record-list'
      || secondRecord?.kind !== 'record' || editor?.kind !== 'record') throw new Error('missing topology fixture');

    section.role = 'basic';
    list.recordType = 'basic';
    list.existingRecordCount = 1;
    secondRecord.index = 3;
    list.editorState = 'editing';
    editor.index = 9;
    editor.framePath = [1];

    expect(semanticGraphProblems(graph, []).map(problem => problem.code)).toContain('record-topology');
  });

  it('requires records and targeted actions to be direct children of compatible targets', () => {
    const graph = validRecordTopologyGraph();
    const list = graph.nodes.find(node => node.id === 'list:0');
    const summary = graph.nodes.find(node => node.id === 'record:0');
    const editor = graph.nodes.find(node => node.id === 'editor:0');
    const edit = graph.nodes.find(node => node.id === 'action:edit');
    const save = graph.nodes.find(node => node.id === 'action:save');
    if (list?.kind !== 'record-list' || summary?.kind !== 'record' || editor?.kind !== 'record'
      || edit?.kind !== 'action' || save?.kind !== 'action') throw new Error('missing topology fixture');

    edit.parentId = editor.id;
    edit.targetId = editor.id;
    summary.childIds = summary.childIds.filter(id => id !== edit.id);
    editor.childIds.push(edit.id);
    save.parentId = summary.id;
    save.targetId = summary.id;
    editor.childIds = editor.childIds.filter(id => id !== save.id);
    summary.childIds.push(save.id);
    list.parentId = graph.rootId;

    const codes = semanticGraphProblems(graph, []).map(problem => problem.code);
    expect(codes).toEqual(expect.arrayContaining(['record-topology', 'action-target']));
  });

  it('rejects target IDs on actions that do not operate on records', () => {
    const graph = validRecordTopologyGraph();
    const section = graph.nodes.find(node => node.id === 'section:0');
    if (section?.kind !== 'section') throw new Error('missing section fixture');
    const action: SemanticNode = {
      id: 'action:expand', kind: 'action' as const, parentId: section.id, childIds: [], order: section.childIds.length,
      structuralFingerprint: '5123456789abcdef', evidence: [], framePath: [],
      action: 'expand' as const, risk: 'inspect' as const, disabled: false, canonicalLabel: '展开或收起' as const,
      targetId: section.id,
    };
    section.childIds.push(action.id);
    graph.nodes.push(action);

    expect(semanticGraphProblems(graph, []).map(problem => problem.code)).toContain('action-target');
  });

  it('references fields without copying their private values', () => {
    const graph: PageSemanticGraph = {
      schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
      rootId: 'page:0',
      nodes: [
        { id: 'page:0', kind: 'page', parentId: null, childIds: ['field:0'], order: 0,
          structuralFingerprint: '0123456789abcdef', evidence: [] },
        { id: 'field:0', kind: 'field', parentId: 'page:0', childIds: [], order: 0,
          structuralFingerprint: 'fedcba9876543210', evidence: ['visible-label'], fieldId: 'scan:0' },
      ],
    };
    expect(JSON.stringify(graph)).not.toContain('private value');
    expect(graph.nodes[1]).toMatchObject({ kind: 'field', fieldId: 'scan:0' });
    expect(isValidSemanticGraph(graph, ['scan:0'])).toBe(true);
  });

  it('rejects cycles, raw fingerprints, duplicate fields and lowered action risk', () => {
    const graph: PageSemanticGraph = {
      schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
      rootId: 'page:0',
      nodes: [
        { id: 'page:0', kind: 'page', parentId: null, childIds: ['list:0', 'field:0', 'field:1'], order: 0,
          structuralFingerprint: 'raw private page title', evidence: [] },
        { id: 'list:0', kind: 'record-list', parentId: 'page:0', childIds: ['action:0'], order: 0,
          structuralFingerprint: '0123456789abcdef', evidence: [], recordType: 'project', existingRecordCount: 0, editorState: 'closed' },
        { id: 'action:0', kind: 'action', parentId: 'list:0', childIds: ['list:0'], order: 0,
          structuralFingerprint: 'abcdef0123456789', evidence: ['add-action'], action: 'add-record', risk: 'inspect', disabled: false,
          canonicalLabel: '添加记录', targetId: 'page:0' },
        { id: 'field:0', kind: 'field', parentId: 'page:0', childIds: ['action:shape'], order: 1,
          structuralFingerprint: 'fedcba9876543210', evidence: [], fieldId: 'scan:0' },
        { id: 'action:shape', kind: 'action', parentId: 'field:0', childIds: [], order: 0,
          structuralFingerprint: '8899aabbccddeeff', evidence: [], action: 'unknown', risk: 'restricted', disabled: false,
          canonicalLabel: '未知动作' },
        { id: 'field:1', kind: 'field', parentId: 'page:0', childIds: [], order: 2,
          structuralFingerprint: '0011223344556677', evidence: [], fieldId: 'scan:0' },
      ],
    };
    const codes = semanticGraphProblems(graph, ['scan:0', 'scan:missing']).map(problem => problem.code);
    expect(codes).toEqual(expect.arrayContaining(['fingerprint', 'cycle', 'duplicate-field', 'missing-field', 'risk', 'action-target', 'node-shape']));
    expect(isValidSemanticGraph(graph, ['scan:0', 'scan:missing'])).toBe(false);
  });

  it('requires the graph field set to equal the scanned field set', () => {
    const graph: PageSemanticGraph = {
      schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
      rootId: 'page:0',
      nodes: [
        { id: 'page:0', kind: 'page', parentId: null, childIds: ['field:0'], order: 0,
          structuralFingerprint: '0123456789abcdef', evidence: [] },
        { id: 'field:0', kind: 'field', parentId: 'page:0', childIds: [], order: 0,
          structuralFingerprint: 'fedcba9876543210', evidence: [], fieldId: 'scan:extra' },
      ],
    };
    expect(semanticGraphProblems(graph, ['scan:expected']).map(problem => problem.code))
      .toEqual(expect.arrayContaining(['missing-field', 'unexpected-field']));
  });

  it('rejects action targets in another section or a sibling record list', () => {
    const graph: PageSemanticGraph = {
      schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
      rootId: 'page:0',
      nodes: [
        { id: 'page:0', kind: 'page', parentId: null, childIds: ['section:0', 'section:1'], order: 0,
          structuralFingerprint: '0123456789abcdef', evidence: [] },
        { id: 'section:0', kind: 'section', parentId: 'page:0', childIds: ['list:0', 'list:1'], order: 0,
          structuralFingerprint: '0123456789abcdea', evidence: ['heading'], heading: '项目经历', role: 'project', confidence: 1 },
        { id: 'list:0', kind: 'record-list', parentId: 'section:0', childIds: ['action:0'], order: 0,
          structuralFingerprint: '0123456789abcdeb', evidence: ['repeated-structure'], recordType: 'project', existingRecordCount: 0, editorState: 'closed' },
        { id: 'action:0', kind: 'action', parentId: 'list:0', childIds: [], order: 0,
          structuralFingerprint: '0123456789abcdec', evidence: ['add-action'], action: 'add-record', risk: 'reversible', disabled: false,
          canonicalLabel: '添加记录', targetId: 'list:1' },
        { id: 'list:1', kind: 'record-list', parentId: 'section:0', childIds: [], order: 1,
          structuralFingerprint: '0123456789abcded', evidence: ['repeated-structure'], recordType: 'project', existingRecordCount: 0, editorState: 'closed' },
        { id: 'section:1', kind: 'section', parentId: 'page:0', childIds: ['list:2'], order: 1,
          structuralFingerprint: '0123456789abcdee', evidence: ['heading'], heading: '实习经历', role: 'internship', confidence: 1 },
        { id: 'list:2', kind: 'record-list', parentId: 'section:1', childIds: [], order: 0,
          structuralFingerprint: '0123456789abcdef', evidence: ['repeated-structure'], recordType: 'internship', existingRecordCount: 0, editorState: 'closed' },
      ],
    };
    expect(semanticGraphProblems(graph, []).filter(problem => problem.code === 'action-target')).toHaveLength(1);

    const action = graph.nodes.find(node => node.id === 'action:0');
    if (!action || action.kind !== 'action') throw new Error('missing test action');
    action.targetId = 'list:2';
    expect(semanticGraphProblems(graph, []).filter(problem => problem.code === 'action-target')).toHaveLength(1);
  });
});
