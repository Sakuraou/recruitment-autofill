import { describe, expect, it } from 'vitest';
import { bindRecordEditor } from '../src/planner/recordEditorBinder';
import {
  planRepeatableRecords,
  recordAddInvoked,
  type ActiveRecordTransaction,
  type ReadyRecordPlan,
} from '../src/planner/recordPlanner';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureSource } from '../src/planner/recordRunContext';
import {
  controlFingerprint,
  describeControl,
  describeRadioGroup,
  radioGroupFingerprint,
  type ScanState,
  type ScannedControl,
} from '../src/content/scanner';
import {
  SEMANTIC_CANONICAL_ACTION_LABELS,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ActionSemanticNode,
  type PageSemanticGraph,
  type SemanticNode,
} from '../src/shared/semanticGraph';

const fingerprint = '0123456789abcdef';

function action(id: string, parentId: string, kind: 'add-record' | 'save-record', targetId: string): ActionSemanticNode {
  return {
    kind: 'action', id, parentId, childIds: [], order: 20, structuralFingerprint: fingerprint,
    evidence: [], action: kind, targetId, risk: kind === 'add-record' ? 'reversible' : 'commit',
    disabled: false, canonicalLabel: SEMANTIC_CANONICAL_ACTION_LABELS[kind],
  };
}

function closedSource(list: HTMLElement): RecordRunCaptureSource {
  const add = document.createElement('button');
  list.replaceChildren(add);
  const nodes: SemanticNode[] = [{
    kind: 'page', id: 'page:0', parentId: null, childIds: ['section:0'], order: 0,
    structuralFingerprint: fingerprint, evidence: [],
  }, {
    kind: 'section', id: 'section:0', parentId: 'page:0', childIds: ['record-list:0'], order: 0,
    structuralFingerprint: fingerprint, evidence: ['heading'], heading: '项目经历', role: 'project', confidence: 1,
  }, action('action:10', 'record-list:0', 'add-record', 'record-list:0'), {
    kind: 'record-list', id: 'record-list:0', parentId: 'section:0', childIds: ['action:10'], order: 0,
    structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
    existingRecordCount: 0, editorState: 'closed',
  }];
  return {
    graph: { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: 'page:0', nodes },
    expectedFieldIds: [],
    semanticTargets: new Map([['record-list:0', list], ['action:10', add]]),
    recordType: 'project', recordListNodeId: 'record-list:0',
  };
}

interface CreatingFixture {
  source: RecordRunCaptureSource;
  scanState: ScanState;
  editor: HTMLElement;
  controls: readonly ScannedControl[];
}

function creatingFixture(list: HTMLElement, elements: readonly (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[],
  radioMembers: ReadonlyMap<HTMLInputElement, HTMLInputElement[]> = new Map()): CreatingFixture {
  const editor = document.createElement('div');
  const save = document.createElement('button');
  const controls = new Map<string, ScannedControl>();
  const targets = new Map<string, Element>([['record-list:0', list], ['record:99', editor], ['action:20', save]]);
  const fields = elements.map((node, index) => {
    const scanId = `scan:${index}`;
    const members = node instanceof HTMLInputElement ? radioMembers.get(node) : undefined;
    const descriptor = members ? describeRadioGroup(members, scanId) : describeControl(node, scanId);
    const control: ScannedControl = members
      ? { node: node as HTMLInputElement, members, adapter: 'radio-group', fingerprint: radioGroupFingerprint(members, descriptor) }
      : { node, fingerprint: controlFingerprint(node, descriptor) };
    controls.set(scanId, control);
    targets.set(`field:${index}`, node);
    if (members) editor.append(...members);
    else editor.append(node);
    return descriptor;
  });
  editor.append(save);
  list.replaceChildren(editor);
  const fieldIds = fields.map((_, index) => `field:${index}`);
  const nodes: SemanticNode[] = [{
    kind: 'page', id: 'page:0', parentId: null, childIds: ['section:0'], order: 0,
    structuralFingerprint: fingerprint, evidence: [],
  }, {
    kind: 'section', id: 'section:0', parentId: 'page:0', childIds: ['record-list:0'], order: 0,
    structuralFingerprint: fingerprint, evidence: ['heading'], heading: '项目经历', role: 'project', confidence: 1,
  }, {
    kind: 'record', id: 'record:99', parentId: 'record-list:0', childIds: [...fieldIds, 'action:20'], order: 0,
    structuralFingerprint: fingerprint, evidence: ['editor-actions'], index: 0, state: 'creating',
  }, ...fields.map((field, index): SemanticNode => ({
    kind: 'field', id: `field:${index}`, parentId: 'record:99', childIds: [], order: index,
    structuralFingerprint: fingerprint, evidence: ['visible-label'], fieldId: field.id,
  })), action('action:20', 'record:99', 'save-record', 'record:99'), {
    kind: 'record-list', id: 'record-list:0', parentId: 'section:0', childIds: ['record:99'], order: 0,
    structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
    existingRecordCount: 0, editorState: 'creating',
  }];
  const graph = { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: 'page:0', nodes } satisfies PageSemanticGraph;
  return {
    source: { graph, expectedFieldIds: fields.map(field => field.id), semanticTargets: targets,
      recordType: 'project', recordListNodeId: 'record-list:0' },
    scanState: {
      result: { scanId: 'scan', url: document.URL, title: '', fields, semanticGraph: graph, warnings: [] },
      document, controls, semanticTargets: targets,
    },
    editor,
    controls: [...controls.values()],
  };
}

function capture(context: RecordRunContext, source: RecordRunCaptureSource): RecordRunCapture {
  const result = context.capture(source);
  if (result.status !== 'ready') throw new Error(result.reason);
  return result;
}

function plan(captured: RecordRunCapture, active?: ActiveRecordTransaction): ReadyRecordPlan {
  const result = planRepeatableRecords({
    snapshot: captured.snapshot, profileRevision: captured.profileRevision,
    intents: [{ intentIndex: 0, recordType: 'project', identityReady: true }],
    candidates: [], identityComparisons: [], editorCandidate: captured.editorCandidate,
    ...(active ? { activeTransaction: active } : {}),
  });
  if (result.status !== 'ready') throw new Error(result.status === 'complete' ? 'complete' : result.reason);
  return result;
}

function lifecycle(elements: readonly (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[],
  radioMembers?: ReadonlyMap<HTMLInputElement, HTMLInputElement[]>) {
  document.body.innerHTML = '';
  const list = document.createElement('section');
  document.body.append(list);
  const context = new RecordRunContext();
  const initial = capture(context, closedSource(list));
  const active = recordAddInvoked(plan(initial));
  if ('status' in active) throw new Error(active.reason);
  const fixture = creatingFixture(list, elements, radioMembers);
  const editing = capture(context, fixture.source);
  return { context, fixture, editing, active, populatePlan: plan(editing, active) };
}

describe('记录编辑器脱敏绑定器', () => {
  it('填写 input、select 和 radio，逐项回读后推进到 fields-verified，且不点击保存', async () => {
    const input = document.createElement('input');
    const select = document.createElement('select');
    select.append(new Option('请选择', ''), new Option('统招', 'fulltime'));
    const male = document.createElement('input');
    male.type = 'radio'; male.name = 'gender'; male.value = 'M';
    const female = document.createElement('input');
    female.type = 'radio'; female.name = 'gender'; female.value = 'F';
    const state = lifecycle([input, select, male], new Map([[male, [male, female]]]));
    let saves = 0;
    state.fixture.editor.querySelector('button')!.addEventListener('click', () => { saves++; });
    const values = ['虚构项目', 'fulltime', '__radio_option_1'];
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => values[Number(fieldNodeId.split(':')[1])],
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result.status).toBe('advanced');
    expect(input.value).toBe('虚构项目');
    expect(select.value).toBe('fulltime');
    expect(female.checked).toBe(true);
    expect(saves).toBe(0);
    if (result.status === 'advanced') {
      expect(result.activeTransaction.phase).toBe('fields-verified');
      expect(result.writtenFieldCount).toBe(3);
    }
  });

  it('相同已有值会保留，冲突已有值会零写入并请求人工处理', async () => {
    const same = document.createElement('input');
    same.value = '用户草稿';
    const other = document.createElement('input');
    const state = lifecycle([same, other]);
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? '不同答案' : '不会写入',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'existing-value-conflict', writtenFieldCount: 0 });
    expect(same.value).toBe('用户草稿');
    expect(other.value).toBe('');
  });

  it('后续字段被网站改写时回滚此前成功写入，不重复覆盖网站结果', async () => {
    const first = document.createElement('input');
    const second = document.createElement('input');
    second.addEventListener('input', () => { second.value = '网站保留值'; });
    const state = lifecycle([first, second]);
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? '先写入' : '预期值',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'field-write-failed' });
    expect(first.value).toBe('');
    expect(second.value).toBe('网站保留值');
  });

  it('扫描后字段 DOM 被替换时保持零写入，原生事实 checkbox 可安全填写', async () => {
    const input = document.createElement('input');
    const state = lifecycle([input]);
    const replacement = document.createElement('input');
    input.replaceWith(replacement);
    state.fixture.scanState.semanticTargets.set('field:0', replacement);
    const replaced = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: () => '不应写入', rescan: () => state.context.capture(state.fixture.source),
    });
    expect(replaced).toMatchObject({ status: 'request-human', reason: 'field-target-replaced', writtenFieldCount: 0 });
    expect(replacement.value).toBe('');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', '是否学生干部');
    const unsupported = lifecycle([checkbox]);
    const checkboxResult = await bindRecordEditor({
      plan: unsupported.populatePlan, capture: unsupported.editing, activeTransaction: unsupported.active,
      runContext: unsupported.context, scanState: unsupported.fixture.scanState,
      provideValue: () => 'true', rescan: () => unsupported.context.capture(unsupported.fixture.source),
    });
    expect(checkboxResult.status).toBe('advanced');
    expect(checkbox.checked).toBe(true);
  });

  it('后续字段失败时回滚此前勾选的原生 checkbox', async () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', '是否学生干部');
    const broken = document.createElement('input');
    broken.addEventListener('input', () => { broken.value = '网页保留值'; });
    const state = lifecycle([checkbox, broken]);
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? 'true' : '预期值',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'field-write-failed', rollbackComplete: true });
    expect(checkbox.checked).toBe(false);
    expect(broken.value).toBe('网页保留值');
  });
});
