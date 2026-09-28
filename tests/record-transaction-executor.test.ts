import { describe, expect, it } from 'vitest';
import {
  issueFieldsVerifiedReceipt,
  planRepeatableRecords,
  recordAddInvoked,
  recordFieldsVerified,
  type ActiveRecordTransaction,
  type ReadyRecordPlan,
} from '../src/planner/recordPlanner';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureSource } from '../src/planner/recordRunContext';
import { executeRecordAction } from '../src/planner/recordTransactionExecutor';
import {
  SEMANTIC_CANONICAL_ACTION_LABELS,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ActionSemanticNode,
  type PageSemanticGraph,
  type SemanticNode,
} from '../src/shared/semanticGraph';

const fingerprint = '0123456789abcdef';

interface InstalledState {
  source: RecordRunCaptureSource;
  action: HTMLButtonElement;
  editor?: HTMLElement;
  cards: readonly HTMLElement[];
}

function actionNode(id: string, parentId: string, action: 'add-record' | 'save-record',
  targetId: string): ActionSemanticNode {
  return {
    kind: 'action', id, parentId, childIds: [], order: 10,
    structuralFingerprint: fingerprint, evidence: [], action, targetId,
    risk: action === 'add-record' ? 'reversible' : 'commit', disabled: false,
    canonicalLabel: SEMANTIC_CANONICAL_ACTION_LABELS[action],
  };
}

function install(list: HTMLElement, mode: 'closed' | 'creating', cards: readonly HTMLElement[] = []): InstalledState {
  const action = document.createElement('button');
  const targets = new Map<string, Element>([['record-list:0', list]]);
  const nodes: SemanticNode[] = [
    {
      kind: 'page', id: 'page:0', parentId: null, childIds: ['section:0'], order: 0,
      structuralFingerprint: fingerprint, evidence: [],
    },
    {
      kind: 'section', id: 'section:0', parentId: 'page:0', childIds: ['record-list:0'], order: 0,
      structuralFingerprint: fingerprint, evidence: ['heading'], heading: '项目经历', role: 'project', confidence: 1,
    },
  ];
  const childIds: string[] = [];
  cards.forEach((card, index) => {
    const id = `record:${index}`;
    childIds.push(id);
    nodes.push({
      kind: 'record', id, parentId: 'record-list:0', childIds: [], order: index,
      structuralFingerprint: fingerprint, evidence: ['repeated-structure'], index, state: 'summary',
    });
    targets.set(id, card);
  });
  let editor: HTMLElement | undefined;
  const expectedFieldIds: string[] = [];
  if (mode === 'creating') {
    editor = document.createElement('div');
    editor.dataset.editor = 'true';
    const field = document.createElement('input');
    editor.append(field, action);
    childIds.push('record:99');
    expectedFieldIds.push('scan:0');
    nodes.push({
      kind: 'record', id: 'record:99', parentId: 'record-list:0', childIds: ['field:99', 'action:20'],
      order: cards.length, structuralFingerprint: fingerprint, evidence: ['editor-actions'],
      index: cards.length, state: 'creating',
    }, {
      kind: 'field', id: 'field:99', parentId: 'record:99', childIds: [], order: 0,
      structuralFingerprint: fingerprint, evidence: ['visible-label'], fieldId: 'scan:0',
    }, actionNode('action:20', 'record:99', 'save-record', 'record:99'));
    targets.set('record:99', editor);
    targets.set('field:99', field);
    targets.set('action:20', action);
    list.replaceChildren(...cards, editor);
  } else {
    childIds.push('action:10');
    nodes.push(actionNode('action:10', 'record-list:0', 'add-record', 'record-list:0'));
    targets.set('action:10', action);
    list.replaceChildren(...cards, action);
  }
  nodes.push({
    kind: 'record-list', id: 'record-list:0', parentId: 'section:0', childIds, order: 0,
    structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
    existingRecordCount: cards.length, editorState: mode,
  });
  return {
    source: {
      graph: { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: 'page:0', nodes } satisfies PageSemanticGraph,
      expectedFieldIds,
      semanticTargets: targets,
      recordType: 'project',
      recordListNodeId: 'record-list:0',
    },
    action,
    ...(editor ? { editor } : {}),
    cards,
  };
}

function capture(context: RecordRunContext, state: InstalledState): RecordRunCapture {
  const result = context.capture(state.source);
  if (result.status !== 'ready') throw new Error(`capture failed: ${result.reason}`);
  return result;
}

function plan(captured: RecordRunCapture, activeTransaction?: ActiveRecordTransaction): ReadyRecordPlan {
  const result = planRepeatableRecords({
    snapshot: captured.snapshot,
    profileRevision: captured.profileRevision,
    intents: [{ intentIndex: 0, recordType: 'project', identityReady: true }],
    candidates: captured.candidates.map(candidate => Object.freeze({ ...candidate, identityReady: true })),
    editorCandidate: captured.editorCandidate,
    identityComparisons: captured.candidates.map(candidate => ({
      runToken: captured.runToken,
      snapshotToken: captured.snapshotToken,
      intentIndex: 0,
      recordNodeId: candidate.recordNodeId,
      verdict: 'different' as const,
      signals: ['primary' as const],
      provenance: 'rule' as const,
    })),
    ...(activeTransaction ? { activeTransaction } : {}),
  });
  if (result.status !== 'ready') throw new Error(`plan failed: ${result.status === 'complete' ? 'complete' : result.reason}`);
  return result;
}

describe('单步记录事务执行器', () => {
  it('先监听再单击新增一次，并只在相邻重扫确认唯一编辑器后推进事务', async () => {
    document.body.innerHTML = '';
    const list = document.createElement('section');
    document.body.append(list);
    const context = new RecordRunContext();
    let current = install(list, 'closed');
    const initial = capture(context, current);
    const openPlan = plan(initial);
    let clicks = 0;
    current.action.addEventListener('click', () => {
      clicks++;
      current = install(list, 'creating');
    });

    const result = await executeRecordAction({
      plan: openPlan,
      capture: initial,
      semanticTargets: current.source.semanticTargets,
      runContext: context,
      observePostcondition: () => Boolean(list.querySelector('[data-editor]')),
      rescan: () => context.capture(current.source),
      quietWindowMs: 10,
      timeoutMs: 200,
    });

    expect(result.status).toBe('advanced');
    expect(clicks).toBe(1);
    if (result.status === 'advanced') {
      expect(result.activeTransaction.phase).toBe('add-invoked');
      expect(result.capture.snapshot.editorState).toBe('creating');
      expect(result.capture.snapshotVersion).toBe(initial.snapshotVersion + 1);
    }
  });

  it('并发重复消息最多点击一次，第二次被同一快照预留锁拒绝', async () => {
    document.body.innerHTML = '';
    const list = document.createElement('section');
    document.body.append(list);
    const context = new RecordRunContext();
    let current = install(list, 'closed');
    const initial = capture(context, current);
    const openPlan = plan(initial);
    let clicks = 0;
    current.action.addEventListener('click', () => {
      clicks++;
      current = install(list, 'creating');
    });
    const input = {
      plan: openPlan,
      capture: initial,
      semanticTargets: current.source.semanticTargets,
      runContext: context,
      observePostcondition: () => Boolean(list.querySelector('[data-editor]')),
      rescan: () => context.capture(current.source),
      quietWindowMs: 10,
      timeoutMs: 200,
    };

    const [first, duplicate] = await Promise.all([executeRecordAction(input), executeRecordAction(input)]);
    expect(first.status).toBe('advanced');
    expect(duplicate).toMatchObject({ status: 'request-human', reason: 'duplicate-step', clicked: false });
    expect(clicks).toBe(1);
  });

  it('点击后超时会永久关闭新增能力，不能用等价重规划再次点击', async () => {
    document.body.innerHTML = '';
    const list = document.createElement('section');
    document.body.append(list);
    const context = new RecordRunContext();
    const current = install(list, 'closed');
    const initial = capture(context, current);
    const openPlan = plan(initial);
    let clicks = 0;
    current.action.addEventListener('click', () => { clicks++; });

    const failed = await executeRecordAction({
      plan: openPlan,
      capture: initial,
      semanticTargets: current.source.semanticTargets,
      runContext: context,
      observePostcondition: () => false,
      rescan: () => context.capture(current.source),
      quietWindowMs: 5,
      timeoutMs: 25,
    });
    expect(failed).toMatchObject({
      status: 'request-human', reason: 'postcondition-timeout', clicked: true,
      plannerResult: { reason: 'add-result-uncertain' },
    });
    expect(clicks).toBe(1);
    expect(planRepeatableRecords({
      snapshot: initial.snapshot,
      profileRevision: initial.profileRevision,
      intents: [{ intentIndex: 0, recordType: 'project', identityReady: true }],
      candidates: [],
      identityComparisons: [],
    })).toMatchObject({ status: 'request-human', reason: 'add-result-uncertain' });
  });

  it('扫描后按钮被替换时零点击并关闭旧能力', async () => {
    document.body.innerHTML = '';
    const list = document.createElement('section');
    document.body.append(list);
    const context = new RecordRunContext();
    const current = install(list, 'closed');
    const initial = capture(context, current);
    const openPlan = plan(initial);
    const replacement = current.action.cloneNode(true) as HTMLButtonElement;
    current.action.replaceWith(replacement);
    (current.source.semanticTargets as Map<string, Element>).set('action:10', replacement);
    let clicks = 0;
    replacement.addEventListener('click', () => { clicks++; });

    const result = await executeRecordAction({
      plan: openPlan,
      capture: initial,
      semanticTargets: current.source.semanticTargets,
      runContext: context,
      observePostcondition: () => false,
      rescan: () => context.capture(current.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'action-target-replaced', clicked: false });
    expect(clicks).toBe(0);
  });

  it('暂停会中止已点击步骤且不重试', async () => {
    document.body.innerHTML = '';
    const list = document.createElement('section');
    document.body.append(list);
    const context = new RecordRunContext();
    const current = install(list, 'closed');
    const initial = capture(context, current);
    const openPlan = plan(initial);
    let clicks = 0;
    current.action.addEventListener('click', () => {
      clicks++;
      setTimeout(() => context.cancelStep(), 5);
    });
    const result = await executeRecordAction({
      plan: openPlan,
      capture: initial,
      semanticTargets: current.source.semanticTargets,
      runContext: context,
      observePostcondition: () => false,
      rescan: () => context.capture(current.source),
      quietWindowMs: 5,
      timeoutMs: 100,
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'postcondition-aborted', clicked: true });
    expect(clicks).toBe(1);
  });

  it('字段核验完成后单击保存一次，并要求关闭编辑器且只新增一张卡片', async () => {
    document.body.innerHTML = '';
    const list = document.createElement('section');
    document.body.append(list);
    const context = new RecordRunContext();
    let current = install(list, 'closed');
    const initial = capture(context, current);
    const add = recordAddInvoked(plan(initial));
    if ('status' in add) throw new Error(add.reason);

    current = install(list, 'creating');
    const editing = capture(context, current);
    const populatePlan = plan(editing, add);
    const verifiedCapture = capture(context, current);
    const receipt = issueFieldsVerifiedReceipt(populatePlan, add, verifiedCapture, () => true);
    if (receipt.status !== 'ready') throw new Error(receipt.reason);
    const verified = recordFieldsVerified(populatePlan, add, receipt.receipt);
    if ('status' in verified) throw new Error(verified.reason);

    const beforeSave = capture(context, current);
    const savePlan = plan(beforeSave, verified);
    const card = document.createElement('article');
    let clicks = 0;
    current.action.addEventListener('click', () => {
      clicks++;
      current = install(list, 'closed', [card]);
    });
    const missingCapability = await executeRecordAction({
      plan: savePlan,
      capture: beforeSave,
      semanticTargets: current.source.semanticTargets,
      runContext: context,
      observePostcondition: () => false,
      rescan: () => context.capture(current.source),
    });
    expect(missingCapability).toMatchObject({
      status: 'request-human', reason: 'invalid-execution-input', clicked: false,
    });
    expect(clicks).toBe(0);
    const result = await executeRecordAction({
      plan: savePlan,
      capture: beforeSave,
      semanticTargets: current.source.semanticTargets,
      runContext: context,
      activeTransaction: verified,
      observePostcondition: () => !list.querySelector('[data-editor]') && list.contains(card),
      rescan: () => context.capture(current.source),
      quietWindowMs: 10,
      timeoutMs: 200,
    });

    expect(result.status).toBe('advanced');
    expect(clicks).toBe(1);
    if (result.status === 'advanced') {
      expect(result.step).toBe('save-created');
      expect(result.activeTransaction.phase).toBe('save-invoked');
      expect(result.capture.snapshot.existingRecordCount).toBe(1);
    }
  });
});
