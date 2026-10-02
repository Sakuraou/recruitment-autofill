import { afterEach, describe, expect, it, vi } from 'vitest';
import { lifecycle } from './fixtures/record-editor-context';
import { isRecordPlanCurrentForSnapshot, issueFieldsVerifiedReceipt, MAX_RECORD_EDITOR_EXPANSIONS,
  planRepeatableRecords, recordEditorExpanded, recordFieldsVerified,
  type ActiveRecordTransaction, type ReadyRecordPlan } from '../src/planner/recordPlanner';
import type { RecordRunCapture } from '../src/planner/recordRunContext';
import type { SemanticNode } from '../src/shared/semanticGraph';

afterEach(() => { document.body.innerHTML = ''; });
function input(capture: RecordRunCapture, active: ActiveRecordTransaction) {
  return { snapshot: capture.snapshot, profileRevision: capture.profileRevision,
    candidates: capture.candidates, editorCandidate: capture.editorCandidate, identityComparisons: [],
    intents: [{ intentIndex: 0, recordType: 'project' as const, identityReady: true }], activeTransaction: active };
}
function readyPlan(capture: RecordRunCapture, active: ActiveRecordTransaction): ReadyRecordPlan {
  const plan = planRepeatableRecords(input(capture, active));
  if (plan.status !== 'ready') throw new Error('没有可用步骤'); return plan;
}
function grow(state: ReturnType<typeof lifecycle>, mode = 'normal'): RecordRunCapture {
  const { source } = state.fixture;
  const editor = source.graph.nodes.find(node => node.kind === 'record' && node.state === 'creating')!;
  const index = source.expectedFieldIds.length;
  const id = `field:${index}`; const scanId = `scan:${index}`;
  const field = document.createElement('input'); field.setAttribute('aria-label', '新展开的项目职责');
  state.fixture.editor.append(field);
  const targets = source.semanticTargets as Map<string, Element>; targets.set(id, field);
  const node: SemanticNode = { kind: 'field', id, parentId: editor.id, childIds: [], order: index,
    structuralFingerprint: '0123456789abcdef', evidence: ['visible-label'], fieldId: scanId };
  source.graph.nodes.push(node); editor.childIds.push(id);
  (source.expectedFieldIds as string[]).push(scanId);
  if (mode === 'shrink') {
    source.graph.nodes = source.graph.nodes.filter(candidate => candidate.id !== 'field:0');
    editor.childIds = editor.childIds.filter(item => item !== 'field:0');
    (source.expectedFieldIds as string[]).splice((source.expectedFieldIds as string[]).indexOf('scan:0'), 1);
  }
  const save = source.graph.nodes.find(candidate => candidate.kind === 'action')!;
  if (mode === 'action') { if (save.kind === 'action') save.disabled = true; }
  if (mode === 'replace-editor') {
    const replacement = state.fixture.editor.cloneNode(true) as HTMLElement;
    state.fixture.editor.replaceWith(replacement); targets.set(editor.id, replacement);
  }
  if (mode === 'profile') state.context.bumpProfileRevision();
  const capture = state.context.capture(source);
  if (capture.status !== 'ready') throw new Error(capture.reason); return capture;
}
function initial() { return lifecycle([document.createElement('input')]); }

describe('动态展开只签发新草稿规划的内部契约', () => {
  it('原完整字段回执拒绝新增字段，不签发保存凭据', () => {
    const state = initial(); const next = grow(state);
    expect(issueFieldsVerifiedReceipt(state.populatePlan, state.active, next, () => true).status).toBe('request-human');
  });
  it('核验所有原字段后消费旧规划，保留同一项目并规划新增字段', () => {
    const state = initial(); const next = grow(state); const verify = vi.fn(() => true);
    const active = recordEditorExpanded(state.populatePlan, state.active, state.editing, next, verify);
    if ('status' in active) throw new Error(active.reason);
    expect(verify).toHaveBeenCalledExactlyOnceWith('field:0');
    expect(active).toMatchObject({ phase: 'add-invoked', intentIndex: 0, transactionToken: state.active.transactionToken });
    expect(isRecordPlanCurrentForSnapshot(state.populatePlan, state.editing.snapshot)).toBe(false);
    expect(planRepeatableRecords(input(next, state.active)).status).toBe('request-human');
    const plan = readyPlan(next, active);
    expect(plan.nextStep).toMatchObject({ kind: 'populate-editor', fieldNodeIds: ['field:0', 'field:1'] });
    expect(JSON.stringify(active)).not.toContain('value'); expect(Object.isFrozen(active)).toBe(true);
    const completeCapture = state.context.capture(state.fixture.source);
    if (completeCapture.status !== 'ready') throw new Error(completeCapture.reason);
    const receipt = issueFieldsVerifiedReceipt(plan, active, completeCapture, () => true);
    if (receipt.status !== 'ready') throw new Error(receipt.reason);
    const verified = recordFieldsVerified(plan, active, receipt.receipt);
    if ('status' in verified) throw new Error(verified.reason);
    const beforeSave = state.context.capture(state.fixture.source);
    if (beforeSave.status !== 'ready') throw new Error(beforeSave.reason);
    expect(readyPlan(beforeSave, verified).nextStep.kind).toBe('save-created');
  });
  it.each(['shrink', 'action', 'replace-editor', 'profile'])('结构或资料变化=%s时不接受展开', mode => {
    const state = initial(); const next = grow(state, mode); const verify = vi.fn(() => true);
    const result = recordEditorExpanded(state.populatePlan, state.active, state.editing, next, verify);
    expect('status' in result && result.status).toBe('request-human');
    expect(verify).not.toHaveBeenCalled();
  });
  it.each(['clone-plan', 'clone-active', 'clone-snapshot', 'old-version', 'wrong-token', 'no-growth'])('伪造或无进展=%s时拒绝', mode => {
    const state = initial(); const actual = mode === 'no-growth' ? state.context.capture(state.fixture.source) : grow(state);
    if (actual.status !== 'ready') throw new Error(actual.reason);
    const next = mode === 'clone-snapshot' ? { ...actual, snapshot: { ...actual.snapshot } }
      : mode === 'old-version' ? state.editing : mode === 'wrong-token' ? { ...actual, snapshotToken: state.editing.snapshotToken } : actual;
    const plan = mode === 'clone-plan' ? { ...state.populatePlan } : state.populatePlan;
    const active = mode === 'clone-active' ? { ...state.active } : state.active;
    const result = recordEditorExpanded(plan, active, state.editing, next, () => true);
    expect('status' in result && result.status).toBe('request-human');
  });
  it.each(['false', 'throw', 'promise', 'reject'])('原字段回读%s不能推进', mode => {
    const state = initial(); const next = grow(state);
    const verify = () => { if (mode === 'throw') throw new Error('private');
      if (mode === 'promise') return Promise.resolve(true); if (mode === 'reject') return Promise.reject(new Error('private'));
      return false; };
    const result = recordEditorExpanded(state.populatePlan, state.active, state.editing, next, verify as () => boolean);
    expect('status' in result && result.status).toBe('request-human');
  });
  it('连续展开有上限，达到上限仍不能省略新字段并保存', () => {
    const state = initial(); let capture = state.editing; let plan = state.populatePlan; let active = state.active;
    for (let round = 0; round < MAX_RECORD_EDITOR_EXPANSIONS; round++) {
      const next = grow(state); const changed = recordEditorExpanded(plan, active, capture, next, () => true);
      if ('status' in changed) throw new Error(changed.reason);
      active = changed; capture = next; plan = readyPlan(capture, active);
      expect(plan.nextStep.kind).toBe('populate-editor');
    }
    const next = grow(state);
    expect(recordEditorExpanded(plan, active, capture, next, () => true)).toMatchObject({ status: 'request-human', reason: 'editor-expansion-limit' });
    expect(issueFieldsVerifiedReceipt(plan, active, next, () => true).status).toBe('request-human');
  });
  it('新草稿凭据绑定捕获的编辑器和档案修订，换修订不能重新规划', () => {
    const state = initial(); const next = grow(state);
    const active = recordEditorExpanded(state.populatePlan, state.active, state.editing, next, () => true);
    if ('status' in active) throw new Error(active.reason);
    expect(planRepeatableRecords({ ...input(next, active), profileRevision: next.profileRevision + 1 }).status).toBe('request-human');
    expect(planRepeatableRecords({ ...input(next, active), editorCandidate: { ...next.editorCandidate!, editorRevision: next.editorRevision! + 1 } }).status).toBe('request-human');
  });
});
