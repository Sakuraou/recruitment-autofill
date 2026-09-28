import { describe, expect, it } from 'vitest';
import {
  createRecordPlannerSnapshot,
  planRepeatableRecords,
  recordAddInvoked,
  recordFieldsVerified,
  recordSaveInvoked,
  type ActiveRecordTransaction,
  type PageRecordCandidate,
  type ProfileRecordIntent,
  type RecordIdentityComparison,
  type RepeatableRecordPlannerInput,
} from '../src/planner/recordPlanner';
import {
  SEMANTIC_CANONICAL_ACTION_LABELS,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ActionSemanticNode,
  type PageSemanticGraph,
  type RecordSemanticNode,
  type SemanticNode,
} from '../src/shared/semanticGraph';

const fingerprint = '0123456789abcdef';
const runToken = '11111111-1111-4111-8111-111111111111';
const snapshotToken = '22222222-2222-4222-8222-222222222222';
const sourceSnapshotToken = '33333333-3333-4333-8333-333333333333';

function versionToken(version: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(version).padStart(12, '0')}`;
}

interface GraphFixtureOptions {
  summaries?: number;
  editorState?: 'closed' | 'creating' | 'editing' | 'unknown';
  addActions?: number;
  saveActions?: number;
  disabledAdd?: boolean;
  disabledSave?: boolean;
  addRisk?: 'reversible' | 'commit' | 'restricted';
  saveRisk?: 'commit' | 'restricted';
  secondList?: boolean;
  includeRestrictedActions?: boolean;
}

function graphFixture(options: GraphFixtureOptions = {}): {
  graph: PageSemanticGraph;
  expectedFieldIds: string[];
  candidateNodeIds: string[];
  editorNodeId?: string;
} {
  const summaries = options.summaries ?? 0;
  const editorState = options.editorState ?? 'closed';
  const addActions = options.addActions ?? (editorState === 'closed' ? 1 : 0);
  const saveActions = options.saveActions ?? (editorState === 'creating' ? 1 : 0);
  const pageId = 'page:0';
  const sectionId = 'section:0';
  const listId = 'record-list:0';
  const nodes: SemanticNode[] = [];
  const pageChildren = [sectionId];
  nodes.push({
    kind: 'page', id: pageId, parentId: null, childIds: pageChildren, order: 0,
    structuralFingerprint: fingerprint, evidence: [],
  });

  const sectionChildren = [listId];
  nodes.push({
    kind: 'section', id: sectionId, parentId: pageId, childIds: sectionChildren, order: 0,
    structuralFingerprint: fingerprint, evidence: ['heading'], heading: '项目经历', role: 'project', confidence: 1,
  });

  const candidateNodeIds = Array.from({ length: summaries }, (_, index) => `record:${index}`);
  const listChildren = [...candidateNodeIds];
  for (let index = 0; index < summaries; index++) {
    nodes.push({
      kind: 'record', id: candidateNodeIds[index]!, parentId: listId, childIds: [], order: index,
      structuralFingerprint: fingerprint, evidence: ['repeated-structure'], index, state: 'summary',
    });
  }

  let editorNodeId: string | undefined;
  const expectedFieldIds: string[] = [];
  if (editorState !== 'closed') {
    editorNodeId = 'record:99';
    const fieldNodeId = 'field:99';
    const fieldId = 'scanned-field:0';
    expectedFieldIds.push(fieldId);
    const editorChildren = [fieldNodeId];
    const editor: RecordSemanticNode = {
      kind: 'record', id: editorNodeId, parentId: listId, childIds: editorChildren,
      order: summaries, structuralFingerprint: fingerprint, evidence: ['editor-actions'],
      index: editorState === 'editing' ? Math.max(0, summaries - 1) : summaries, state: editorState,
    };
    nodes.push(editor, {
      kind: 'field', id: fieldNodeId, parentId: editorNodeId, childIds: [], order: 0,
      structuralFingerprint: fingerprint, evidence: ['visible-label'], fieldId,
    });
    listChildren.push(editorNodeId);
    for (let index = 0; index < saveActions; index++) {
      const actionId = `action:${20 + index}`;
      editor.childIds.push(actionId);
      nodes.push(actionNode({
        id: actionId, parentId: editorNodeId, order: index + 1, action: 'save-record',
        targetId: editorNodeId, disabled: options.disabledSave ?? false, risk: options.saveRisk,
      }));
    }
  }

  for (let index = 0; index < addActions; index++) {
    const actionId = `action:${10 + index}`;
    listChildren.push(actionId);
    nodes.push(actionNode({
      id: actionId, parentId: listId, order: summaries + index + 1, action: 'add-record',
      targetId: listId, disabled: options.disabledAdd ?? false, risk: options.addRisk,
    }));
  }

  if (options.includeRestrictedActions && summaries > 0) {
    const deleteId = 'action:30';
    const submitId = 'action:31';
    const summary = nodes.find((node): node is RecordSemanticNode => node.kind === 'record' && node.id === candidateNodeIds[0]);
    summary!.childIds.push(deleteId);
    nodes.push(actionNode({ id: deleteId, parentId: summary!.id, order: 1, action: 'delete-record', targetId: summary!.id }));
    pageChildren.push(submitId);
    nodes.push(actionNode({ id: submitId, parentId: pageId, order: 2, action: 'submit' }));
  }

  nodes.push({
    kind: 'record-list', id: listId, parentId: sectionId, childIds: listChildren, order: 0,
    structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
    existingRecordCount: summaries, editorState,
  });

  if (options.secondList) {
    const secondSectionId = 'section:1';
    const secondListId = 'record-list:1';
    pageChildren.push(secondSectionId);
    nodes.push({
      kind: 'section', id: secondSectionId, parentId: pageId, childIds: [secondListId], order: 1,
      structuralFingerprint: fingerprint, evidence: ['heading'], heading: '其他项目', role: 'project', confidence: 1,
    }, {
      kind: 'record-list', id: secondListId, parentId: secondSectionId, childIds: [], order: 0,
      structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
      existingRecordCount: 0, editorState: 'closed',
    });
  }

  return {
    graph: { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: pageId, nodes },
    expectedFieldIds,
    candidateNodeIds,
    editorNodeId,
  };
}

function actionNode(input: {
  id: string;
  parentId: string;
  order: number;
  action: 'add-record' | 'save-record' | 'delete-record' | 'submit';
  targetId?: string;
  disabled?: boolean;
  risk?: 'reversible' | 'commit' | 'restricted';
}): ActionSemanticNode {
  const risk = input.risk ?? (input.action === 'add-record' ? 'reversible'
    : input.action === 'save-record' ? 'commit' : 'restricted');
  return {
    kind: 'action', id: input.id, parentId: input.parentId, childIds: [], order: input.order,
    structuralFingerprint: fingerprint, evidence: [], action: input.action, risk,
    disabled: input.disabled ?? false, canonicalLabel: SEMANTIC_CANONICAL_ACTION_LABELS[input.action],
    ...(input.targetId ? { targetId: input.targetId } : {}),
  } as ActionSemanticNode;
}

function intents(count: number, shuffled = false): ProfileRecordIntent[] {
  const rows = Array.from({ length: count }, (_, intentIndex) => ({
    intentIndex, recordType: 'project' as const, identityReady: true,
  }));
  return shuffled ? [...rows].reverse() : rows;
}

function candidates(nodeIds: readonly string[], shuffled = false, currentSnapshotToken = snapshotToken,
  handles?: readonly number[]): PageRecordCandidate[] {
  const rows = nodeIds.map((recordNodeId, index) => ({
    runToken, snapshotToken: currentSnapshotToken,
    recordNodeId, recordListNodeId: 'record-list:0', recordType: 'project' as const,
    index, candidateHandle: handles?.[index] ?? index, identityReady: true,
  }));
  return shuffled ? [...rows].reverse() : rows;
}

function comparisonMatrix(intentCount: number, recordNodeIds: readonly string[], samePairs: readonly [number, string][],
  shuffled = false, currentSnapshotToken = snapshotToken): RecordIdentityComparison[] {
  const same = new Set(samePairs.map(([intentIndex, recordNodeId]) => `${intentIndex}|${recordNodeId}`));
  const rows = Array.from({ length: intentCount }, (_, intentIndex) => recordNodeIds.map((recordNodeId) => ({
    runToken,
    snapshotToken: currentSnapshotToken,
    intentIndex,
    recordNodeId,
    verdict: same.has(`${intentIndex}|${recordNodeId}`) ? 'same' as const : 'different' as const,
    signals: same.has(`${intentIndex}|${recordNodeId}`)
      ? ['primary', 'start-date'] as const
      : ['primary'] as const,
    provenance: 'rule' as const,
  }))).flat();
  return shuffled ? [...rows].reverse() : rows;
}

function plannerInput(options: GraphFixtureOptions & {
  intentCount?: number;
  samePairs?: readonly [number, string][];
  active?: ActiveRecordTransaction;
  shuffled?: boolean;
  snapshotVersion?: number;
  currentSnapshotToken?: string;
  candidateHandles?: readonly number[];
} = {}): RepeatableRecordPlannerInput {
  const fixture = graphFixture(options);
  const intentCount = options.intentCount ?? 1;
  const currentSnapshotToken = options.currentSnapshotToken ?? snapshotToken;
  const snapshotVersion = options.snapshotVersion ?? 7;
  const snapshotResult = createRecordPlannerSnapshot({
    runToken,
    snapshotToken: currentSnapshotToken,
    snapshotVersion,
    graph: fixture.graph,
    expectedFieldIds: fixture.expectedFieldIds,
    recordType: 'project',
    recordListNodeId: 'record-list:0',
  });
  if (snapshotResult.status !== 'ready') throw new Error(`测试快照无效：${snapshotResult.reason}`);
  return {
    snapshot: snapshotResult.snapshot,
    intents: intents(intentCount, options.shuffled),
    candidates: candidates(fixture.candidateNodeIds, options.shuffled, currentSnapshotToken, options.candidateHandles),
    editorCandidate: fixture.editorNodeId ? {
      runToken, snapshotToken: currentSnapshotToken, recordNodeId: fixture.editorNodeId, editorHandle: 700,
    } : undefined,
    identityComparisons: comparisonMatrix(intentCount, fixture.candidateNodeIds, options.samePairs ?? [],
      options.shuffled, currentSnapshotToken),
    activeTransaction: options.active,
  };
}

function requireReadyPlan(input: RepeatableRecordPlannerInput, expectedKind: 'open-create' | 'populate-editor' | 'save-created') {
  const plan = planRepeatableRecords(input);
  if (plan.status !== 'ready' || plan.nextStep.kind !== expectedKind) {
    throw new Error(`无法签发测试事务：${plan.status === 'request-human' ? plan.reason : plan.status}`);
  }
  return plan;
}

function lifecycleInput(snapshotVersion: number, editorState: 'closed' | 'creating',
  baselineExistingRecordCount: number, baselineCandidateHandles: readonly number[], active?: ActiveRecordTransaction) {
  const intentCount = Math.max(1, baselineExistingRecordCount + 1);
  const samePairs = Array.from({ length: baselineExistingRecordCount }, (_, index) => (
    [index + 1, `record:${index}`] as [number, string]
  ));
  return plannerInput({
    intentCount,
    summaries: baselineExistingRecordCount,
    samePairs,
    editorState,
    saveActions: editorState === 'creating' ? 1 : 0,
    active,
    snapshotVersion,
    currentSnapshotToken: versionToken(snapshotVersion),
    candidateHandles: baselineCandidateHandles,
  });
}

function activeTransaction(phase: ActiveRecordTransaction['phase'], baselineExistingRecordCount = 0,
  baselineCandidateHandles = Array.from({ length: baselineExistingRecordCount }, (_, index) => index)):
  ActiveRecordTransaction {
  const targetVersion = 7;
  const openVersion = phase === 'add-invoked' ? targetVersion - 1
    : phase === 'fields-verified' ? targetVersion - 2 : targetVersion - 3;
  const openPlan = requireReadyPlan(
    lifecycleInput(openVersion, 'closed', baselineExistingRecordCount, baselineCandidateHandles),
    'open-create',
  );
  const add = recordAddInvoked(openPlan);
  if ('status' in add) throw new Error(`无法签发 add 事务：${add.reason}`);
  if (phase === 'add-invoked') return add;

  const populatePlan = requireReadyPlan(
    lifecycleInput(openVersion + 1, 'creating', baselineExistingRecordCount, baselineCandidateHandles, add),
    'populate-editor',
  );
  const verified = recordFieldsVerified(populatePlan, add);
  if ('status' in verified) throw new Error(`无法签发 fields 事务：${verified.reason}`);
  if (phase === 'fields-verified') return verified;

  const savePlan = requireReadyPlan(
    lifecycleInput(openVersion + 2, 'creating', baselineExistingRecordCount, baselineCandidateHandles, verified),
    'save-created',
  );
  const saved = recordSaveInvoked(savePlan, verified);
  if ('status' in saved) throw new Error(`无法签发 save 事务：${saved.reason}`);
  return saved;
}

describe('通用重复记录规划器', () => {
  it('对明确空列表按档案序号规划六条记录，但当前快照只授权一次添加', () => {
    const result = planRepeatableRecords(plannerInput({ intentCount: 6, summaries: 0 }));
    expect(result).toMatchObject({
      status: 'ready',
      snapshotVersion: 7,
      assignments: [],
      pendingIntentIndexes: [0, 1, 2, 3, 4, 5],
      unmatchedRecordNodeIds: [],
      nextStep: {
        kind: 'open-create', intentIndex: 0, recordListNodeId: 'record-list:0', actionNodeId: 'action:10',
        postcondition: { kind: 'editor-opened', expectedExistingRecordCount: 0, expectedEditorState: 'creating' },
      },
    });
    expect(result.status === 'ready' ? result.nextStep.preconditions : []).toEqual([
      { kind: 'snapshot-current', runToken, snapshotToken, snapshotVersion: 7 },
      { kind: 'record-list-state', recordListNodeId: 'record-list:0', existingRecordCount: 0, editorState: 'closed' },
      { kind: 'action-enabled', actionNodeId: 'action:10' },
      { kind: 'identity-unmatched', intentIndex: 0 },
    ]);
  });

  it('已有记录顺序与档案顺序无关，并只把未匹配记录放入新增队列', () => {
    const input = plannerInput({
      intentCount: 6, summaries: 2, shuffled: true,
      samePairs: [[4, 'record:0'], [1, 'record:1']],
    });
    const result = planRepeatableRecords(input);
    expect(result).toMatchObject({
      status: 'ready',
      assignments: [
        { intentIndex: 1, recordNodeId: 'record:1', recordListNodeId: 'record-list:0' },
        { intentIndex: 4, recordNodeId: 'record:0', recordListNodeId: 'record-list:0' },
      ],
      pendingIntentIndexes: [0, 2, 3, 5],
      nextStep: { kind: 'open-create', intentIndex: 0 },
    });
  });

  it('六条网页记录倒序对应六条档案记录时完成且不产生动作', () => {
    const nodeIds = graphFixture({ summaries: 6 }).candidateNodeIds;
    const samePairs = nodeIds.map((recordNodeId, index) => [5 - index, recordNodeId] as [number, string]);
    const result = planRepeatableRecords(plannerInput({
      intentCount: 6, summaries: 6, samePairs, shuffled: true,
    }));
    expect(result.status).toBe('complete');
    if (result.status !== 'complete') return;
    expect(result.assignments.map(item => [item.intentIndex, item.recordNodeId])).toEqual([
      [0, 'record:5'], [1, 'record:4'], [2, 'record:3'], [3, 'record:2'], [4, 'record:1'], [5, 'record:0'],
    ]);
    expect(result.pendingIntentIndexes).toEqual([]);
  });

  it('保留网页上的额外无关记录，只新增缺少的档案记录', () => {
    const result = planRepeatableRecords(plannerInput({
      intentCount: 2, summaries: 3, samePairs: [[0, 'record:2']],
    }));
    expect(result).toMatchObject({
      status: 'ready', pendingIntentIndexes: [1], unmatchedRecordNodeIds: ['record:0', 'record:1'],
      nextStep: { kind: 'open-create', intentIndex: 1 },
    });
  });

  it.each([
    {
      name: '一个档案意图匹配两张网页卡片', intentCount: 1, summaries: 2,
      pairs: [[0, 'record:0'], [0, 'record:1']] as [number, string][], reason: 'duplicate-page-record',
    },
    {
      name: '两个档案意图匹配同一张网页卡片', intentCount: 2, summaries: 1,
      pairs: [[0, 'record:0'], [1, 'record:0']] as [number, string][], reason: 'duplicate-intent-identity',
    },
    {
      name: '两边同时存在多重匹配', intentCount: 2, summaries: 2,
      pairs: [[0, 'record:0'], [0, 'record:1'], [1, 'record:0'], [1, 'record:1']] as [number, string][],
      reason: 'ambiguous-assignment',
    },
  ])('$name 时失败关闭', ({ intentCount, summaries, pairs, reason }) => {
    const result = planRepeatableRecords(plannerInput({ intentCount, summaries, samePairs: pairs }));
    expect(result).toMatchObject({ status: 'request-human', reason });
    expect('nextStep' in result).toBe(false);
  });

  it('行列歧义分属不同边时仍报告完整歧义端点', () => {
    const result = planRepeatableRecords(plannerInput({
      intentCount: 3,
      summaries: 3,
      samePairs: [[0, 'record:0'], [0, 'record:1'], [1, 'record:2'], [2, 'record:2']],
    }));
    expect(result).toMatchObject({
      status: 'request-human',
      reason: 'ambiguous-assignment',
      intentIndexes: [0, 1, 2],
      nodeIds: ['record:0', 'record:1', 'record:2'],
    });
  });

  it('身份矩阵缺少任意一对时不能把缺项当作不同', () => {
    const input = plannerInput({ intentCount: 2, summaries: 2 });
    input.identityComparisons = input.identityComparisons.slice(1);
    expect(planRepeatableRecords(input)).toMatchObject({
      status: 'request-human', reason: 'identity-evidence-incomplete',
    });
  });

  it('运行时数组中的 null 元素失败关闭而不抛异常', () => {
    const badIntent = plannerInput({ intentCount: 1 });
    badIntent.intents = [null as unknown as ProfileRecordIntent];
    expect(() => planRepeatableRecords(badIntent)).not.toThrow();
    expect(planRepeatableRecords(badIntent)).toMatchObject({
      status: 'request-human', reason: 'invalid-intent-set',
    });

    const badCandidate = plannerInput({ intentCount: 1, summaries: 1 });
    badCandidate.candidates = [null as unknown as PageRecordCandidate];
    expect(() => planRepeatableRecords(badCandidate)).not.toThrow();
    expect(planRepeatableRecords(badCandidate)).toMatchObject({
      status: 'request-human', reason: 'candidate-topology-mismatch',
    });

    const badComparison = plannerInput({ intentCount: 1, summaries: 1 });
    badComparison.identityComparisons = [null as unknown as RecordIdentityComparison];
    expect(() => planRepeatableRecords(badComparison)).not.toThrow();
    expect(planRepeatableRecords(badComparison)).toMatchObject({
      status: 'request-human', reason: 'identity-evidence-incomplete',
    });
  });

  it('身份矩阵和网页候选必须绑定当前运行与当前快照', () => {
    const staleEvidence = plannerInput({ intentCount: 1, summaries: 1 });
    staleEvidence.identityComparisons = staleEvidence.identityComparisons.map(comparison => ({
      ...comparison, snapshotToken: sourceSnapshotToken,
    }));
    expect(planRepeatableRecords(staleEvidence)).toMatchObject({
      status: 'request-human', reason: 'identity-evidence-incomplete',
    });

    const staleCandidate = plannerInput({ intentCount: 1, summaries: 1 });
    staleCandidate.candidates = staleCandidate.candidates.map(candidate => ({
      ...candidate, snapshotToken: sourceSnapshotToken,
    }));
    expect(planRepeatableRecords(staleCandidate)).toMatchObject({
      status: 'request-human', reason: 'candidate-topology-mismatch',
    });
  });

  it('身份比较重复、明确不足或同一判断证据过弱时均失败关闭', () => {
    const duplicate = plannerInput({ intentCount: 1, summaries: 1 });
    duplicate.identityComparisons = [...duplicate.identityComparisons, duplicate.identityComparisons[0]!];
    expect(planRepeatableRecords(duplicate)).toMatchObject({
      status: 'request-human', reason: 'identity-evidence-conflict',
    });

    const insufficient = plannerInput({ intentCount: 1, summaries: 1 });
    insufficient.identityComparisons = [{
      runToken, snapshotToken,
      intentIndex: 0, recordNodeId: 'record:0', verdict: 'insufficient', signals: ['primary'], provenance: 'rule',
    }];
    expect(planRepeatableRecords(insufficient)).toMatchObject({
      status: 'request-human', reason: 'identity-insufficient',
    });

    const weakSame = plannerInput({ intentCount: 1, summaries: 1 });
    weakSame.identityComparisons = [{
      runToken, snapshotToken,
      intentIndex: 0, recordNodeId: 'record:0', verdict: 'same', signals: ['primary'], provenance: 'rule',
    }];
    expect(planRepeatableRecords(weakSame)).toMatchObject({
      status: 'request-human', reason: 'identity-insufficient',
    });

    const invalidVerdict = plannerInput({ intentCount: 1, summaries: 1 });
    invalidVerdict.identityComparisons = [{
      runToken, snapshotToken,
      intentIndex: 0, recordNodeId: 'record:0', verdict: 'untrusted' as RecordIdentityComparison['verdict'],
      signals: ['primary', 'start-date'], provenance: 'rule',
    }];
    expect(planRepeatableRecords(invalidVerdict)).toMatchObject({
      status: 'request-human', reason: 'identity-insufficient',
    });
  });

  it('唯一站点记录号或人工确认可以构成单项唯一证据', () => {
    for (const comparison of [
      { runToken, snapshotToken, intentIndex: 0, recordNodeId: 'record:0', verdict: 'same' as const,
        signals: ['site-record-id'] as const, provenance: 'site-recipe' as const },
      { runToken, snapshotToken, intentIndex: 0, recordNodeId: 'record:0', verdict: 'same' as const,
        signals: ['primary'] as const, provenance: 'human-confirmed' as const },
    ]) {
      const input = plannerInput({ intentCount: 1, summaries: 1 });
      input.identityComparisons = [comparison];
      expect(planRepeatableRecords(input).status).toBe('complete');
    }
  });

  it('档案或网页候选尚未具备可核验身份时不开始新增', () => {
    const intentMissing = plannerInput({ intentCount: 1, summaries: 0 });
    intentMissing.intents = [{ ...intentMissing.intents[0]!, identityReady: false }];
    expect(planRepeatableRecords(intentMissing)).toMatchObject({
      status: 'request-human', reason: 'identity-insufficient', intentIndexes: [0],
    });

    const candidateMissing = plannerInput({ intentCount: 1, summaries: 1 });
    candidateMissing.candidates = [{ ...candidateMissing.candidates[0]!, identityReady: false }];
    expect(planRepeatableRecords(candidateMissing)).toMatchObject({
      status: 'request-human', reason: 'identity-insufficient', nodeIds: ['record:0'],
    });
  });

  it('候选必须与列表中的每张摘要卡片一一对应', () => {
    const missing = plannerInput({ intentCount: 1, summaries: 2 });
    missing.candidates = missing.candidates.slice(0, 1);
    expect(planRepeatableRecords(missing)).toMatchObject({
      status: 'request-human', reason: 'candidate-topology-mismatch',
    });

    const duplicate = plannerInput({ intentCount: 1, summaries: 1 });
    duplicate.candidates = [duplicate.candidates[0]!, duplicate.candidates[0]!];
    expect(planRepeatableRecords(duplicate)).toMatchObject({
      status: 'request-human', reason: 'candidate-topology-mismatch',
    });
  });

  it('语义图记录数量不完整、节点关系错误或列表不唯一时不规划', () => {
    const invalid = graphFixture({ summaries: 1 });
    const list = invalid.graph.nodes.find(node => node.kind === 'record-list' && node.id === 'record-list:0');
    if (list?.kind === 'record-list') list.existingRecordCount = 2;
    expect(createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: invalid.graph,
      expectedFieldIds: invalid.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    })).toMatchObject({
      status: 'request-human', reason: 'invalid-semantic-graph',
    });

    const ambiguous = graphFixture({ secondList: true });
    expect(createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: ambiguous.graph,
      expectedFieldIds: ambiguous.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    })).toMatchObject({
      status: 'request-human', reason: 'ambiguous-record-list',
    });

    const missingList = graphFixture();
    expect(createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: missingList.graph,
      expectedFieldIds: missingList.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:999',
    })).toMatchObject({
      status: 'request-human', reason: 'record-list-unverified',
    });
  });

  it('非法运行时编辑器状态和含页面文本的节点 ID 都不能进入去敏快照', () => {
    const invalidState = graphFixture({ editorState: 'creating', saveActions: 1 });
    const list = invalidState.graph.nodes.find(node => node.kind === 'record-list');
    const editor = invalidState.graph.nodes.find(node => node.kind === 'record' && node.state !== 'summary');
    if (list?.kind === 'record-list') list.editorState = 'bogus' as typeof list.editorState;
    if (editor?.kind === 'record') editor.state = 'bogus' as typeof editor.state;
    expect(createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: invalidState.graph,
      expectedFieldIds: invalidState.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    })).toMatchObject({ status: 'request-human', reason: 'invalid-semantic-graph', nodeIds: [] });

    const unsafeId = graphFixture();
    const page = unsafeId.graph.nodes.find(node => node.kind === 'page');
    const section = unsafeId.graph.nodes.find(node => node.kind === 'section');
    if (page?.kind === 'page' && section?.kind === 'section') {
      page.id = 'selector:sentinel-private-text';
      unsafeId.graph.rootId = page.id;
      section.parentId = page.id;
    }
    const result = createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: unsafeId.graph,
      expectedFieldIds: unsafeId.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'invalid-semantic-graph', nodeIds: [] });
    expect(JSON.stringify(result)).not.toContain('sentinel-private-text');
  });

  it('非法栏目类型、记录类型、证据和坐标空间不能躲在无关分支中', () => {
    const mutations = [
      (graph: PageSemanticGraph) => {
        const section = graph.nodes.find(node => node.kind === 'section');
        if (section?.kind === 'section') section.role = 'bogus' as typeof section.role;
      },
      (graph: PageSemanticGraph) => {
        const list = graph.nodes.find(node => node.kind === 'record-list');
        if (list?.kind === 'record-list') list.recordType = 'bogus' as typeof list.recordType;
      },
      (graph: PageSemanticGraph) => {
        graph.nodes[0]!.evidence = ['private-page-text' as typeof graph.nodes[0]['evidence'][number]];
      },
      (graph: PageSemanticGraph) => {
        graph.nodes[0]!.bounds = { x: 0, y: 0, width: 1, height: 1,
          coordinateSpace: 'document' as 'viewport' };
      },
    ];
    for (const mutate of mutations) {
      const fixture = graphFixture();
      mutate(fixture.graph);
      expect(createRecordPlannerSnapshot({
        runToken, snapshotToken, snapshotVersion: 7, graph: fixture.graph,
        expectedFieldIds: fixture.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
      })).toMatchObject({ status: 'request-human', reason: 'invalid-semantic-graph', nodeIds: [] });
    }
  });

  it('隐藏分支的自洽非法类型、null 坐标和超大数值节点 ID 都失败关闭', () => {
    const hidden = graphFixture({ secondList: true });
    const hiddenSection = hidden.graph.nodes.find(node => node.id === 'section:1');
    const hiddenList = hidden.graph.nodes.find(node => node.id === 'record-list:1');
    if (hiddenSection?.kind === 'section' && hiddenList?.kind === 'record-list') {
      hiddenSection.role = 'bogus' as typeof hiddenSection.role;
      hiddenList.recordType = 'bogus' as typeof hiddenList.recordType;
    }
    expect(createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: hidden.graph,
      expectedFieldIds: hidden.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    })).toMatchObject({ status: 'request-human', reason: 'invalid-semantic-graph' });

    const nullBounds = graphFixture();
    nullBounds.graph.nodes[0]!.bounds = null as unknown as NonNullable<SemanticNode['bounds']>;
    expect(() => createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: nullBounds.graph,
      expectedFieldIds: nullBounds.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    })).not.toThrow();
    expect(createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: nullBounds.graph,
      expectedFieldIds: nullBounds.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    })).toMatchObject({ status: 'request-human', reason: 'invalid-semantic-graph' });

    const hugeId = graphFixture();
    const page = hugeId.graph.nodes.find(node => node.kind === 'page');
    const section = hugeId.graph.nodes.find(node => node.kind === 'section');
    if (page?.kind === 'page' && section?.kind === 'section') {
      page.id = 'page:9876543210';
      hugeId.graph.rootId = page.id;
      section.parentId = page.id;
    }
    const hugeResult = createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: hugeId.graph,
      expectedFieldIds: hugeId.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    });
    expect(hugeResult).toMatchObject({ status: 'request-human', reason: 'invalid-semantic-graph' });
    expect(JSON.stringify(hugeResult)).not.toContain('9876543210');
  });

  it('档案意图序号必须唯一、非负且与目标记录类型一致', () => {
    const duplicate = plannerInput({ intentCount: 2 });
    duplicate.intents = [{ ...duplicate.intents[0]! }, { ...duplicate.intents[1]!, intentIndex: 0 }];
    expect(planRepeatableRecords(duplicate)).toMatchObject({
      status: 'request-human', reason: 'invalid-intent-set',
    });

    const wrongType = plannerInput({ intentCount: 1 });
    wrongType.intents = [{ ...wrongType.intents[0]!, recordType: 'education' }];
    expect(planRepeatableRecords(wrongType)).toMatchObject({
      status: 'request-human', reason: 'invalid-intent-set',
    });

    const numericPrivateValue = plannerInput({ intentCount: 1 });
    numericPrivateValue.intents = [{ ...numericPrivateValue.intents[0]!, intentIndex: 9_876_543_210 }];
    const result = planRepeatableRecords(numericPrivateValue);
    expect(result).toMatchObject({ status: 'request-human', reason: 'invalid-intent-set' });
    expect(JSON.stringify(result)).not.toContain('9876543210');
  });

  it.each([
    { addActions: 0, reason: 'add-action-missing' },
    { addActions: 2, reason: 'add-action-ambiguous' },
    { addActions: 1, disabledAdd: true, reason: 'action-disabled' },
  ] as const)('关闭编辑器时 add 动作异常会返回 $reason', (options) => {
    expect(planRepeatableRecords(plannerInput({ intentCount: 1, ...options }))).toMatchObject({
      status: 'request-human', reason: options.reason,
    });
  });

  it('风险被提升为 commit 或 restricted 的添加动作不会获自动授权', () => {
    for (const addRisk of ['commit', 'restricted'] as const) {
      expect(planRepeatableRecords(plannerInput({ intentCount: 1, addRisk }))).toMatchObject({
        status: 'request-human', reason: 'action-risk-disallowed',
      });
    }
  });

  it('已有创建编辑器但没有本流程续接令牌时视为被占用', () => {
    expect(planRepeatableRecords(plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1,
    }))).toMatchObject({ status: 'request-human', reason: 'editor-occupied' });
  });

  it('false、0、空串和 null 不能伪装成“没有活动事务”并触发新增', () => {
    for (const activeTransaction of [false, 0, '', null]) {
      const input = plannerInput({ intentCount: 1 });
      input.activeTransaction = activeTransaction as unknown as ActiveRecordTransaction;
      expect(planRepeatableRecords(input)).toMatchObject({
        status: 'request-human', reason: 'invalid-planner-input',
      });
    }
  });

  it('添加后重新扫描到自己的创建编辑器，规划填写但不提前点击保存', () => {
    const active = activeTransaction('add-invoked');
    const result = planRepeatableRecords(plannerInput({
      intentCount: 2, editorState: 'creating', saveActions: 1, active,
    }));
    expect(result).toMatchObject({
      status: 'ready', pendingIntentIndexes: [0, 1],
      nextStep: {
        kind: 'populate-editor', intentIndex: 0, editorRecordNodeId: 'record:99',
        fieldNodeIds: ['field:99'], requiredSaveActionNodeId: 'action:20',
        postcondition: { kind: 'fields-verified', intentIndex: 0, editorRecordNodeId: 'record:99' },
      },
    });
  });

  it.each([
    { saveActions: 0, reason: 'save-action-missing' },
    { saveActions: 2, reason: 'save-action-ambiguous' },
    { saveActions: 1, disabledSave: true, reason: 'action-disabled' },
  ] as const)('创建编辑器的 save 动作异常会返回 $reason', (options) => {
    const active = activeTransaction('add-invoked');
    expect(planRepeatableRecords(plannerInput({
      intentCount: 1, editorState: 'creating', active, ...options,
    }))).toMatchObject({ status: 'request-human', reason: options.reason });
  });

  it('restricted 保存动作不会获自动授权', () => {
    expect(planRepeatableRecords(plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1, saveRisk: 'restricted',
      active: activeTransaction('fields-verified'),
    }))).toMatchObject({ status: 'request-human', reason: 'action-risk-disallowed' });
  });

  it('字段已经核验后才授权当前快照中唯一的保存动作', () => {
    const active = activeTransaction('fields-verified');
    const result = planRepeatableRecords(plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1, active,
    }));
    expect(result).toMatchObject({
      status: 'ready',
      nextStep: {
        kind: 'save-created', intentIndex: 0, editorRecordNodeId: 'record:99', actionNodeId: 'action:20',
        postcondition: {
          kind: 'record-created', expectedExistingRecordCount: 1, expectedEditorState: 'closed', rematchIntentIndex: 0,
        },
      },
    });
  });

  it('保存动作发出后结果未确认时不重复保存或重新添加', () => {
    const active = activeTransaction('save-invoked');
    const stillOpen = planRepeatableRecords(plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1, active,
    }));
    expect(stillOpen).toMatchObject({ status: 'request-human', reason: 'save-result-uncertain' });
    expect('nextStep' in stillOpen).toBe(false);

    const closedWithoutRecord = planRepeatableRecords(plannerInput({ intentCount: 1, summaries: 0, active }));
    expect(closedWithoutRecord).toMatchObject({ status: 'request-human', reason: 'save-result-uncertain' });
  });

  it('保存后只有“编辑器关闭、计数加一、身份唯一匹配”同时成立才继续下一条', () => {
    const active = activeTransaction('save-invoked');
    const result = planRepeatableRecords(plannerInput({
      intentCount: 2, summaries: 1, samePairs: [[0, 'record:0']], active,
    }));
    expect(result).toMatchObject({
      status: 'ready', assignments: [{ intentIndex: 0, recordNodeId: 'record:0' }],
      pendingIntentIndexes: [1], nextStep: { kind: 'open-create', intentIndex: 1 },
    });

    const unmatched = plannerInput({ intentCount: 2, summaries: 1, active: activeTransaction('save-invoked') });
    expect(planRepeatableRecords(unmatched)).toMatchObject({
      status: 'request-human', reason: 'save-result-uncertain',
    });
  });

  it('同一保存成功能力只能回读一次，不能为下一条签发两份新增计划', () => {
    const active = activeTransaction('save-invoked');
    const input = plannerInput({
      intentCount: 2, summaries: 1, samePairs: [[0, 'record:0']], active,
    });
    const first = planRepeatableRecords(input);
    expect(first).toMatchObject({ status: 'ready', nextStep: { kind: 'open-create', intentIndex: 1 } });
    const second = planRepeatableRecords(input);
    expect(second).toMatchObject({ status: 'request-human', reason: 'active-transaction-mismatch' });
    expect('nextStep' in second).toBe(false);
    if (first.status !== 'ready') return;
    expect('status' in recordAddInvoked(first)).toBe(false);
  });

  it('新增卡片未匹配当前档案时，不能拿旧卡片的匹配结果冒充保存成功', () => {
    const active = activeTransaction('save-invoked', 1, [0]);
    const result = planRepeatableRecords(plannerInput({
      intentCount: 1, summaries: 2, samePairs: [[0, 'record:0']], active,
    }));
    expect(result).toMatchObject({ status: 'request-human', reason: 'save-result-uncertain' });
    expect('nextStep' in result).toBe(false);
  });

  it('保存后的卡片即使被网站插到列表前面，也用连续编号识别真正新增项', () => {
    const active = activeTransaction('save-invoked', 1, [10]);
    const input = plannerInput({
      intentCount: 1, summaries: 2, samePairs: [[0, 'record:0']], active,
    });
    input.candidates = input.candidates.map(candidate => ({
      ...candidate,
      candidateHandle: candidate.recordNodeId === 'record:0' ? 11 : 10,
    }));
    const result = planRepeatableRecords(input);
    expect(result).toMatchObject({
      status: 'complete',
      assignments: [{ intentIndex: 0, recordNodeId: 'record:0', candidateHandle: 11 }],
    });
  });

  it('已核验字段的事务不能授权另一个后来打开的编辑器', () => {
    const input = plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1,
      active: activeTransaction('fields-verified'),
    });
    input.editorCandidate = { ...input.editorCandidate!, editorHandle: 701 };
    expect(planRepeatableRecords(input)).toMatchObject({
      status: 'request-human', reason: 'active-transaction-mismatch',
    });
  });

  it('外部编辑、未知编辑器和不匹配的续接令牌均不会被接管', () => {
    for (const editorState of ['editing', 'unknown'] as const) {
      expect(planRepeatableRecords(plannerInput({
        intentCount: 1, summaries: editorState === 'editing' ? 1 : 0, editorState,
      }))).toMatchObject({ status: 'request-human', reason: 'editor-occupied' });
    }

    const active = { ...activeTransaction('add-invoked'), recordListNodeId: 'record-list:999' };
    expect(planRepeatableRecords(plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1, active,
    }))).toMatchObject({ status: 'request-human', reason: 'active-transaction-mismatch' });

    const invalidPhase = {
      ...activeTransaction('add-invoked'), phase: 'retry-save',
    } as unknown as ActiveRecordTransaction;
    expect(planRepeatableRecords(plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1, active: invalidPhase,
    }))).toMatchObject({ status: 'request-human', reason: 'active-transaction-mismatch' });

    const staleSnapshot = {
      ...activeTransaction('fields-verified'), sourceSnapshotToken: snapshotToken, sourceSnapshotVersion: 7,
    };
    expect(planRepeatableRecords(plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1, active: staleSnapshot,
    }))).toMatchObject({ status: 'request-human', reason: 'active-transaction-mismatch' });
  });

  it('全部档案记录已经存在时不要求页面仍有添加按钮', () => {
    const result = planRepeatableRecords(plannerInput({
      intentCount: 1, summaries: 1, samePairs: [[0, 'record:0']], addActions: 0,
    }));
    expect(result.status).toBe('complete');
  });

  it('零档案记录不会删除网页已有记录', () => {
    const input = plannerInput({ intentCount: 0, summaries: 2, includeRestrictedActions: true });
    input.candidates = input.candidates.map(candidate => ({ ...candidate, identityReady: false }));
    const result = planRepeatableRecords(input);
    expect(result).toMatchObject({
      status: 'complete', assignments: [], pendingIntentIndexes: [],
      unmatchedRecordNodeIds: ['record:0', 'record:1'],
    });
    expect(JSON.stringify(result)).not.toContain('delete');
    expect(JSON.stringify(result)).not.toContain('submit');
  });

  it('字符串形式的布尔值不能绕过身份就绪检查', () => {
    const badIntent = plannerInput({ intentCount: 1 });
    badIntent.intents = [{
      ...badIntent.intents[0]!, identityReady: 'false' as unknown as boolean,
    }];
    expect(planRepeatableRecords(badIntent)).toMatchObject({
      status: 'request-human', reason: 'invalid-intent-set',
    });

    const badCandidate = plannerInput({ intentCount: 1, summaries: 1 });
    badCandidate.candidates = [{
      ...badCandidate.candidates[0]!, identityReady: 'false' as unknown as boolean,
    }];
    expect(planRepeatableRecords(badCandidate)).toMatchObject({
      status: 'request-human', reason: 'candidate-topology-mismatch',
    });

    const privateIndex = plannerInput({ intentCount: 1 });
    privateIndex.intents = [{
      ...privateIndex.intents[0]!, intentIndex: 'sentinel-private-text' as unknown as number,
    }];
    const result = planRepeatableRecords(privateIndex);
    expect(result).toMatchObject({ status: 'request-human', reason: 'invalid-intent-set', intentIndexes: [] });
    expect(JSON.stringify(result)).not.toContain('sentinel-private-text');
  });

  it('计划结果只保留快照版本、固定枚举和语义节点引用', () => {
    const fixture = graphFixture();
    const section = fixture.graph.nodes.find(node => node.kind === 'section');
    if (section?.kind === 'section') section.heading = '页面里的私密项目名称 sentinel-private-text';
    const snapshotResult = createRecordPlannerSnapshot({
      runToken, snapshotToken, snapshotVersion: 7, graph: fixture.graph,
      expectedFieldIds: fixture.expectedFieldIds, recordType: 'project', recordListNodeId: 'record-list:0',
    });
    expect(snapshotResult.status).toBe('ready');
    const serialized = JSON.stringify(snapshotResult);
    expect(serialized).not.toContain('sentinel-private-text');
    expect(serialized).not.toContain('项目名称');
    expect(serialized).not.toContain('selector');
    expect(serialized).not.toContain('structuralFingerprint');
    expect(serialized).not.toContain('value');
  });

  it('去敏快照及其嵌套拓扑被冻结，序列化复制会失去内部能力标记', () => {
    const input = plannerInput({ intentCount: 1 });
    expect(Object.isFrozen(input.snapshot)).toBe(true);
    expect(Object.isFrozen(input.snapshot.summaries)).toBe(true);
    expect(Object.isFrozen(input.snapshot.actions)).toBe(true);
    const copied = structuredClone(input.snapshot) as RepeatableRecordPlannerInput['snapshot'];
    expect(planRepeatableRecords({ ...input, snapshot: copied })).toMatchObject({
      status: 'request-human', reason: 'invalid-planner-input',
    });

    const brand = Object.getOwnPropertySymbols(input.snapshot)[0]!;
    const forged = {
      ...input.snapshot,
      actions: Object.freeze(input.snapshot.actions.map(action => Object.freeze({
        ...action, risk: action.action === 'add-record' ? 'reversible' as const : action.risk,
      }))),
    } as RepeatableRecordPlannerInput['snapshot'];
    Object.defineProperty(forged, brand, { value: true, enumerable: false });
    Object.freeze(forged);
    expect(planRepeatableRecords({ ...input, snapshot: forged })).toMatchObject({
      status: 'request-human', reason: 'invalid-planner-input',
    });
  });

  it('动作计划和事务能力深度冻结、不可复制伪造且每次只能推进一次', () => {
    const openPlan = requireReadyPlan(plannerInput({ intentCount: 2, summaries: 0 }), 'open-create');
    expect(Object.isFrozen(openPlan)).toBe(true);
    expect(Object.isFrozen(openPlan.assignments)).toBe(true);
    expect(Object.isFrozen(openPlan.pendingIntentIndexes)).toBe(true);
    expect(Object.isFrozen(openPlan.unmatchedRecordNodeIds)).toBe(true);
    expect(Object.isFrozen(openPlan.nextStep)).toBe(true);
    expect(Object.isFrozen(openPlan.nextStep.preconditions)).toBe(true);
    expect(openPlan.nextStep.preconditions.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(openPlan.nextStep.postcondition)).toBe(true);
    expect(openPlan.nextStep.kind).toBe('open-create');
    if (openPlan.nextStep.kind !== 'open-create') return;
    expect(Object.isFrozen(openPlan.nextStep.postcondition.expectedCandidateHandles)).toBe(true);

    const copiedPlan = structuredClone(openPlan);
    expect(recordAddInvoked(copiedPlan)).toMatchObject({
      status: 'request-human', reason: 'invalid-planner-input',
    });

    const add = recordAddInvoked(openPlan);
    expect('status' in add).toBe(false);
    if ('status' in add) return;
    expect(Object.isFrozen(add)).toBe(true);
    expect(Object.isFrozen(add.baselineCandidateHandles)).toBe(true);
    expect(recordAddInvoked(openPlan)).toMatchObject({
      status: 'request-human', reason: 'invalid-planner-input',
    });

    const copiedActive = structuredClone(add) as ActiveRecordTransaction;
    const copiedInput = plannerInput({
      intentCount: 2, editorState: 'creating', saveActions: 1, active: copiedActive,
      snapshotVersion: 8, currentSnapshotToken: versionToken(8),
    });
    expect(planRepeatableRecords(copiedInput)).toMatchObject({
      status: 'request-human', reason: 'active-transaction-mismatch',
    });

    const populateInput = plannerInput({
      intentCount: 2, editorState: 'creating', saveActions: 1, active: add,
      snapshotVersion: 8, currentSnapshotToken: versionToken(8),
    });
    const populatePlan = requireReadyPlan(populateInput, 'populate-editor');
    expect(populatePlan.nextStep.kind).toBe('populate-editor');
    if (populatePlan.nextStep.kind !== 'populate-editor') return;
    expect(Object.isFrozen(populatePlan.nextStep.fieldNodeIds)).toBe(true);
    const verified = recordFieldsVerified(populatePlan, add);
    expect('status' in verified).toBe(false);
    if ('status' in verified) return;
    expect(recordFieldsVerified(populatePlan, add)).toMatchObject({
      status: 'request-human', reason: 'active-transaction-mismatch',
    });

    const savePlan = requireReadyPlan(plannerInput({
      intentCount: 2, editorState: 'creating', saveActions: 1, active: verified,
      snapshotVersion: 9, currentSnapshotToken: versionToken(9),
    }), 'save-created');
    const invoked = recordSaveInvoked(savePlan, verified);
    expect('status' in invoked).toBe(false);
    expect(recordSaveInvoked(savePlan, verified)).toMatchObject({
      status: 'request-human', reason: 'active-transaction-mismatch',
    });
  });

  it('同一快照重复规划出的等价新增计划也只能消费一份', () => {
    const input = plannerInput({ intentCount: 1 });
    const first = requireReadyPlan(input, 'open-create');
    const duplicate = requireReadyPlan(input, 'open-create');
    expect('status' in recordAddInvoked(first)).toBe(false);
    expect(recordAddInvoked(duplicate)).toMatchObject({
      status: 'request-human', reason: 'invalid-planner-input',
    });
  });

  it('事务只接受紧邻的新快照，且当前快照令牌不能复用事务令牌', () => {
    const openPlan = requireReadyPlan(plannerInput({
      intentCount: 1, snapshotVersion: 20, currentSnapshotToken: versionToken(20),
    }), 'open-create');
    const active = recordAddInvoked(openPlan);
    if ('status' in active) throw new Error(active.reason);

    const skipped = plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1, active,
      snapshotVersion: 22, currentSnapshotToken: versionToken(22),
    });
    expect(planRepeatableRecords(skipped)).toMatchObject({
      status: 'request-human', reason: 'active-transaction-mismatch',
    });

    const tokenReused = plannerInput({
      intentCount: 1, editorState: 'creating', saveActions: 1, active,
      snapshotVersion: 21, currentSnapshotToken: active.transactionToken,
    });
    expect(planRepeatableRecords(tokenReused)).toMatchObject({
      status: 'request-human', reason: 'active-transaction-mismatch',
    });
  });

  it('输入数组顺序变化不会改变规划结果', () => {
    const ordered = plannerInput({
      intentCount: 4, summaries: 2, samePairs: [[3, 'record:0'], [1, 'record:1']],
    });
    const shuffled = plannerInput({
      intentCount: 4, summaries: 2, samePairs: [[3, 'record:0'], [1, 'record:1']], shuffled: true,
    });
    expect(planRepeatableRecords(shuffled)).toEqual(planRepeatableRecords(ordered));
  });

  it('规划不会修改输入快照、档案意图、候选或身份矩阵', () => {
    const input = plannerInput({
      intentCount: 3, summaries: 2, samePairs: [[2, 'record:0'], [0, 'record:1']], shuffled: true,
    });
    const before = JSON.stringify(input);
    planRepeatableRecords(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
