import { describe, expect, it } from 'vitest';
import { classifyAction } from '../src/content/semantic/actionClassifier';
import { SEMANTIC_GRAPH_SCHEMA_VERSION, type PageSemanticGraph } from '../src/shared/semanticGraph';
import { isValidSemanticGraph, semanticGraphProblems } from '../src/shared/semanticGraphValidation';

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
