import type { ActionSemanticNode, PageSemanticGraph, SemanticActionRisk, SemanticNode } from './semanticGraph';
import { SEMANTIC_CANONICAL_ACTION_LABELS, SEMANTIC_GRAPH_SCHEMA_VERSION } from './semanticGraph';

export interface SemanticGraphProblem {
  code: 'schema-version' | 'duplicate-id' | 'root' | 'parent' | 'child' | 'cycle' | 'orphan'
    | 'duplicate-field' | 'missing-field' | 'unexpected-field' | 'action-target' | 'node-shape' | 'node-value'
    | 'record-topology' | 'risk' | 'canonical-label' | 'fingerprint' | 'frame-path' | 'bounds' | 'size';
  message: string;
  nodeId?: string;
}

const riskRank: Record<SemanticActionRisk, number> = { inspect: 0, reversible: 1, commit: 2, restricted: 3 };

function minimumRisk(action: ActionSemanticNode['action']): SemanticActionRisk {
  if (action === 'expand' || action === 'select-tab') return 'inspect';
  if (action === 'add-record' || action === 'edit-record') return 'reversible';
  if (action === 'save-record' || action === 'next-step') return 'commit';
  return 'restricted';
}

function validateNodeShape(node: SemanticNode, problems: SemanticGraphProblem[]): void {
  if (!/^[a-f\d]{16,64}$/iu.test(node.structuralFingerprint)) {
    problems.push({ code: 'fingerprint', nodeId: node.id,
      message: '结构指纹必须是 16–64 位十六进制摘要，不能包含页面文本或个人值。' });
  }
  if (node.framePath?.some(part => !Number.isInteger(part) || part < 0) || (node.framePath?.length ?? 0) > 10) {
    problems.push({ code: 'frame-path', nodeId: node.id, message: 'framePath 只能包含最多 10 级非负整数索引。' });
  }
  if (node.bounds && (![node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height].every(Number.isFinite)
    || node.bounds.width < 0 || node.bounds.height < 0)) {
    problems.push({ code: 'bounds', nodeId: node.id, message: '节点坐标必须是有限数值，宽高不能为负。' });
  }
  if (!Number.isInteger(node.order) || node.order < 0 || node.childIds.length > 500) {
    problems.push({ code: 'node-value', nodeId: node.id, message: '节点顺序必须是非负整数，子节点数量不能超过 500。' });
  }
  if (node.kind === 'section' && (node.heading.length > 120 || node.confidence < 0 || node.confidence > 1 || !Number.isFinite(node.confidence))) {
    problems.push({ code: 'node-value', nodeId: node.id, message: '栏目标题或置信度超出允许范围。' });
  }
  if (node.kind === 'record-list' && (!Number.isInteger(node.existingRecordCount) || node.existingRecordCount < 0)) {
    problems.push({ code: 'node-value', nodeId: node.id, message: '已有记录数量必须是非负整数。' });
  }
  if (node.kind === 'record' && (!Number.isInteger(node.index) || node.index < 0)) {
    problems.push({ code: 'node-value', nodeId: node.id, message: '记录序号必须是非负整数。' });
  }
}

const allowedChildren: Record<SemanticNode['kind'], ReadonlySet<SemanticNode['kind']>> = {
  page: new Set(['section', 'field', 'action']),
  section: new Set(['record-list', 'field', 'action']),
  'record-list': new Set(['record', 'field', 'action']),
  record: new Set(['field', 'action']),
  field: new Set(),
  action: new Set(),
};

const nonRepeatableSectionRoles = new Set(['basic', 'job-intent', 'other']);

function sameFramePath(left?: readonly number[], right?: readonly number[]): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((part, index) => part === normalizedRight[index]);
}

function validateRecordTopology(node: SemanticNode, byId: ReadonlyMap<string, SemanticNode>,
  problems: SemanticGraphProblem[]): void {
  if (node.kind === 'record-list') {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || parent.kind !== 'section') {
      problems.push({ code: 'record-topology', nodeId: node.id, message: '记录列表必须直属一个语义栏目。' });
      return;
    }
    if (node.recordType !== parent.role || nonRepeatableSectionRoles.has(parent.role)) {
      problems.push({ code: 'record-topology', nodeId: node.id,
        message: '记录列表类型必须与可重复的父栏目类型一致。' });
    }
    if (!sameFramePath(node.framePath, parent.framePath)) {
      problems.push({ code: 'record-topology', nodeId: node.id, message: '记录列表与父栏目必须位于同一文档框架。' });
    }

    const records = node.childIds
      .map(childId => byId.get(childId))
      .filter((child): child is Extract<SemanticNode, { kind: 'record' }> => child?.kind === 'record');
    const summaries = records.filter(record => record.state === 'summary');
    const editors = records.filter(record => record.state !== 'summary');
    const summaryIndexes = summaries.map(record => record.index).sort((left, right) => left - right);
    const indexesAreContiguous = summaryIndexes.length === new Set(summaryIndexes).size
      && summaryIndexes.every((index, position) => index === position);

    if (node.existingRecordCount !== summaries.length || !indexesAreContiguous) {
      problems.push({ code: 'record-topology', nodeId: node.id,
        message: '已有记录数量必须等于序号从 0 连续排列的摘要记录数量。' });
    }
    if (editors.length > 1) {
      problems.push({ code: 'record-topology', nodeId: node.id, message: '一个记录列表最多只能包含一个编辑器记录。' });
    }

    const editor = editors[0];
    const editorMatchesState = node.editorState === 'closed'
      ? editors.length === 0
      : editors.length === 1 && editor?.state === node.editorState;
    if (!editorMatchesState) {
      problems.push({ code: 'record-topology', nodeId: node.id, message: '记录列表的编辑器状态必须与直属编辑器记录严格一致。' });
    }
    if (editor && (editor.state === 'creating' || editor.state === 'unknown')
      && editor.index !== summaries.length) {
      problems.push({ code: 'record-topology', nodeId: editor.id,
        message: '新增或未知编辑器必须使用摘要记录数量作为稳定序号。' });
    }
    if (editor?.state === 'editing' && !summaryIndexes.includes(editor.index)) {
      problems.push({ code: 'record-topology', nodeId: editor.id,
        message: '编辑器必须引用列表中一个已确认的摘要记录序号。' });
    }
    return;
  }

  if (node.kind === 'record') {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || parent.kind !== 'record-list') {
      problems.push({ code: 'record-topology', nodeId: node.id, message: '记录必须直属一个记录列表。' });
    } else if (!sameFramePath(node.framePath, parent.framePath)) {
      problems.push({ code: 'record-topology', nodeId: node.id, message: '记录与所属列表必须位于同一文档框架。' });
    }
  }
}

function nearestSection(node: SemanticNode, byId: ReadonlyMap<string, SemanticNode>): string | undefined {
  let current: SemanticNode | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.kind === 'section') return current.id;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}

export function semanticGraphProblems(graph: PageSemanticGraph, expectedFieldIds: Iterable<string>): SemanticGraphProblem[] {
  const problems: SemanticGraphProblem[] = [];
  if (graph.schemaVersion !== SEMANTIC_GRAPH_SCHEMA_VERSION) {
    problems.push({ code: 'schema-version', message: '不支持的页面语义图版本。' });
  }
  if (graph.nodes.length > 1500) problems.push({ code: 'size', message: '页面语义图最多包含 1500 个节点。' });

  const byId = new Map<string, SemanticNode>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) problems.push({ code: 'duplicate-id', nodeId: node.id, message: '语义图节点 ID 重复。' });
    else byId.set(node.id, node);
    validateNodeShape(node, problems);
  }

  const root = byId.get(graph.rootId);
  if (!root || root.kind !== 'page' || root.parentId !== null) {
    problems.push({ code: 'root', nodeId: graph.rootId, message: 'rootId 必须唯一指向没有父节点的 page 节点。' });
  }

  const fieldIds = new Set<string>();
  for (const node of byId.values()) {
    if (node.id !== graph.rootId) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (!parent || !parent.childIds.includes(node.id)) {
        problems.push({ code: 'parent', nodeId: node.id, message: '非根节点必须有一个有效且双向一致的父节点。' });
      } else if (parent.kind !== 'page' && !sameFramePath(node.framePath, parent.framePath)) {
        problems.push({ code: 'frame-path', nodeId: node.id, message: '同一语义子树的直属节点必须位于同一文档框架。' });
      }
    }
    const uniqueChildren = new Set(node.childIds);
    if (uniqueChildren.size !== node.childIds.length) {
      problems.push({ code: 'child', nodeId: node.id, message: '同一父节点不能重复引用子节点。' });
    }
    for (const childId of uniqueChildren) {
      const child = byId.get(childId);
      if (!child || child.parentId !== node.id) {
        problems.push({ code: 'child', nodeId: node.id, message: '子节点引用必须存在并与 parentId 对称。' });
      } else if (!allowedChildren[node.kind].has(child.kind)
        || (node.kind === 'page' && child.kind === 'action' && child.risk !== 'restricted')) {
        problems.push({ code: 'node-shape', nodeId: child.id, message: '父子节点类型不符合页面语义图语法。' });
      }
    }
    if (node.kind === 'field') {
      if (fieldIds.has(node.fieldId)) problems.push({ code: 'duplicate-field', nodeId: node.id, message: '每个字段只能在语义图中出现一次。' });
      fieldIds.add(node.fieldId);
    }
    validateRecordTopology(node, byId, problems);
    if (node.kind === 'action') {
      if (node.canonicalLabel !== SEMANTIC_CANONICAL_ACTION_LABELS[node.action]) {
        problems.push({ code: 'canonical-label', nodeId: node.id, message: '动作名称与动作类型不一致。' });
      }
      if (riskRank[node.risk] < riskRank[minimumRisk(node.action)]) {
        problems.push({ code: 'risk', nodeId: node.id, message: '动作风险被降到了安全策略允许值以下。' });
      }
      const isTargeted = node.action === 'add-record' || node.action === 'edit-record'
        || node.action === 'save-record' || node.action === 'cancel-record' || node.action === 'delete-record';
      if (isTargeted) {
        const target = byId.get(node.targetId!);
        const wrongTargetKind = node.action === 'add-record'
          ? target?.kind !== 'record-list'
          : target?.kind !== 'record';
        const wrongRecordState = target?.kind === 'record'
          && ((node.action === 'edit-record' || node.action === 'delete-record')
            ? target.state !== 'summary'
            : (node.action === 'save-record' || node.action === 'cancel-record') && target.state === 'summary');
        const wrongRelationship = node.parentId !== node.targetId
          || (target !== undefined && nearestSection(node, byId) !== nearestSection(target, byId));
        const wrongFrame = target !== undefined && !sameFramePath(node.framePath, target.framePath);
        if (wrongTargetKind || wrongRecordState || wrongRelationship || wrongFrame) {
          problems.push({ code: 'action-target', nodeId: node.id,
            message: '记录动作必须直属其同框架目标；添加指向列表，编辑/删除指向摘要，保存/取消指向编辑器。' });
        }
      } else if (node.targetId) {
        problems.push({ code: 'action-target', nodeId: node.id,
          message: '只有记录级添加、编辑、保存、取消和删除动作可以声明目标。' });
      }
    }
  }

  const expectedSet = new Set(expectedFieldIds);
  for (const expected of expectedSet) {
    if (!fieldIds.has(expected)) problems.push({ code: 'missing-field', message: '扫描字段没有出现在页面语义图中。', nodeId: expected });
  }
  for (const actual of fieldIds) {
    if (!expectedSet.has(actual)) problems.push({ code: 'unexpected-field', message: '语义图引用了扫描结果中不存在的字段。', nodeId: actual });
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) { problems.push({ code: 'cycle', nodeId: id, message: '语义图不能包含循环。' }); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const childId of byId.get(id)?.childIds ?? []) if (byId.has(childId)) walk(childId);
    visiting.delete(id);
    visited.add(id);
  };
  if (root) walk(root.id);
  for (const id of byId.keys()) {
    if (!visited.has(id)) problems.push({ code: 'orphan', nodeId: id, message: '所有节点都必须能从页面根节点到达。' });
  }
  return problems;
}

export function isValidSemanticGraph(graph: PageSemanticGraph, expectedFieldIds: Iterable<string>): boolean {
  return semanticGraphProblems(graph, expectedFieldIds).length === 0;
}
