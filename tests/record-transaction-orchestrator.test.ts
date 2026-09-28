import { describe, expect, it } from 'vitest';
import {
  RecordTransactionOrchestrator,
  type RecordOrchestratorDriver,
} from '../src/planner/recordTransactionOrchestrator';
import {
  recordAddInvoked,
  type ActiveRecordTransaction,
  type ReadyRecordPlan,
  type RepeatableRecordPlannerInput,
} from '../src/planner/recordPlanner';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureSource } from '../src/planner/recordRunContext';
import {
  SEMANTIC_CANONICAL_ACTION_LABELS,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ActionSemanticNode,
  type SemanticNode,
} from '../src/shared/semanticGraph';

const fingerprint = '0123456789abcdef';

function action(id: string, parentId: string, kind: 'add-record' | 'save-record', targetId: string): ActionSemanticNode {
  return {
    kind: 'action', id, parentId, childIds: [], order: 10, structuralFingerprint: fingerprint,
    evidence: [], action: kind, targetId, risk: kind === 'add-record' ? 'reversible' : 'commit',
    disabled: false, canonicalLabel: SEMANTIC_CANONICAL_ACTION_LABELS[kind],
  };
}

function source(list: HTMLElement, mode: 'closed' | 'creating'): RecordRunCaptureSource {
  const button = document.createElement('button');
  const targets = new Map<string, Element>([['record-list:0', list]]);
  const nodes: SemanticNode[] = [{
    kind: 'page', id: 'page:0', parentId: null, childIds: ['section:0'], order: 0,
    structuralFingerprint: fingerprint, evidence: [],
  }, {
    kind: 'section', id: 'section:0', parentId: 'page:0', childIds: ['record-list:0'], order: 0,
    structuralFingerprint: fingerprint, evidence: ['heading'], heading: '项目经历', role: 'project', confidence: 1,
  }];
  if (mode === 'closed') {
    nodes.push(action('action:10', 'record-list:0', 'add-record', 'record-list:0'), {
      kind: 'record-list', id: 'record-list:0', parentId: 'section:0', childIds: ['action:10'], order: 0,
      structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
      existingRecordCount: 0, editorState: 'closed',
    });
    targets.set('action:10', button);
    list.replaceChildren(button);
    return { graph: { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: 'page:0', nodes },
      expectedFieldIds: [], semanticTargets: targets, recordType: 'project', recordListNodeId: 'record-list:0' };
  }
  const editor = document.createElement('div');
  const input = document.createElement('input');
  editor.append(input, button);
  list.replaceChildren(editor);
  nodes.push({
    kind: 'record', id: 'record:99', parentId: 'record-list:0', childIds: ['field:0', 'action:20'], order: 0,
    structuralFingerprint: fingerprint, evidence: ['editor-actions'], index: 0, state: 'creating',
  }, {
    kind: 'field', id: 'field:0', parentId: 'record:99', childIds: [], order: 0,
    structuralFingerprint: fingerprint, evidence: ['visible-label'], fieldId: 'scan:0',
  }, action('action:20', 'record:99', 'save-record', 'record:99'), {
    kind: 'record-list', id: 'record-list:0', parentId: 'section:0', childIds: ['record:99'], order: 0,
    structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
    existingRecordCount: 0, editorState: 'creating',
  });
  targets.set('record:99', editor); targets.set('field:0', input); targets.set('action:20', button);
  return { graph: { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: 'page:0', nodes },
    expectedFieldIds: ['scan:0'], semanticTargets: targets, recordType: 'project', recordListNodeId: 'record-list:0' };
}

function ready(context: RecordRunContext, value: RecordRunCaptureSource): RecordRunCapture {
  const result = context.capture(value);
  if (result.status !== 'ready') throw new Error(result.reason);
  return result;
}

function plannerInput(capture: RecordRunCapture, active?: ActiveRecordTransaction): RepeatableRecordPlannerInput {
  return {
    snapshot: capture.snapshot, profileRevision: capture.profileRevision,
    intents: [{ intentIndex: 0, recordType: 'project', identityReady: true }],
    candidates: [], editorCandidate: capture.editorCandidate, identityComparisons: [],
    ...(active ? { activeTransaction: active } : {}),
  };
}

function setup(delayed = false) {
  document.body.innerHTML = '';
  const list = document.createElement('section');
  document.body.append(list);
  const context = new RecordRunContext();
  let current = source(list, 'closed');
  let captureCalls = 0;
  let actionCalls = 0;
  let bindCalls = 0;
  let release: (() => void) | undefined;
  const gate = delayed ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  const driver: RecordOrchestratorDriver = {
    capture: () => { captureCalls++; return context.capture(current); },
    plannerInput,
    executeAction: async (plan: ReadyRecordPlan) => {
      actionCalls++;
      await gate;
      const active = recordAddInvoked(plan);
      if ('status' in active) throw new Error(active.reason);
      current = source(list, 'creating');
      return { status: 'advanced', step: 'open-create' as const,
        capture: ready(context, current), activeTransaction: active };
    },
    bindEditor: async () => {
      bindCalls++;
      return { status: 'request-human', reason: 'profile-value-missing' as const,
        writtenFieldCount: 0, rollbackComplete: true };
    },
  };
  return { context, driver, release: () => release?.(), counts: () => ({ captureCalls, actionCalls, bindCalls }) };
}

describe('记录事务编排器', () => {
  it('一次 advance 只执行一个新增步骤，下一次才规划填写', async () => {
    const state = setup();
    const orchestrator = new RecordTransactionOrchestrator(state.context, state.driver);
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'open-create', snapshotVersion: 2 });
    expect(orchestrator.state).toBe('ready');
    expect(state.counts()).toEqual({ captureCalls: 1, actionCalls: 1, bindCalls: 0 });

    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'profile-value-missing' });
    expect(state.counts()).toEqual({ captureCalls: 1, actionCalls: 1, bindCalls: 1 });
    expect(orchestrator.state).toBe('request-human');
  });

  it('并发重复 advance 不会调度第二个动作', async () => {
    const state = setup(true);
    const orchestrator = new RecordTransactionOrchestrator(state.context, state.driver);
    const first = orchestrator.advance();
    await Promise.resolve();
    expect(await orchestrator.advance()).toMatchObject({ status: 'busy' });
    expect(state.counts().actionCalls).toBe(1);
    state.release();
    expect(await first).toMatchObject({ status: 'advanced', step: 'open-create' });
    expect(state.counts().actionCalls).toBe(1);
  });

  it('暂停会丢弃旧快照，恢复后强制重新捕获；停止后不可恢复', async () => {
    const state = setup();
    const orchestrator = new RecordTransactionOrchestrator(state.context, state.driver);
    orchestrator.pause();
    expect(await orchestrator.advance()).toMatchObject({ status: 'paused' });
    orchestrator.resume();
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'open-create' });
    expect(state.counts().captureCalls).toBe(1);

    orchestrator.pause();
    orchestrator.resume();
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'active-transaction-mismatch' });
    expect(state.counts().captureCalls).toBe(2);
    orchestrator.stop();
    orchestrator.resume();
    expect(await orchestrator.advance()).toMatchObject({ status: 'stopped' });
  });

  it('异步步骤尚未完成时暂停，不接纳迟到的成功结果', async () => {
    const state = setup(true);
    const orchestrator = new RecordTransactionOrchestrator(state.context, state.driver);
    const pending = orchestrator.advance();
    await Promise.resolve();
    orchestrator.pause();
    state.release();
    expect(await pending).toMatchObject({ status: 'paused' });
    expect(orchestrator.state).toBe('paused');
    orchestrator.resume();
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human' });
  });
});
