import {
  planRepeatableRecords,
  recordAddInvoked,
  type ActiveRecordTransaction,
  type ReadyRecordPlan,
} from '../../src/planner/recordPlanner';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureSource } from '../../src/planner/recordRunContext';
import {
  controlFingerprint,
  describeControl,
  describeRadioGroup,
  radioGroupFingerprint,
  type ScanState,
  type ScannedControl,
} from '../../src/content/scanner';
import {
  SEMANTIC_CANONICAL_ACTION_LABELS,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ActionSemanticNode,
  type PageSemanticGraph,
  type SemanticNode,
} from '../../src/shared/semanticGraph';

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

export function lifecycle(elements: readonly (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[],
  radioMembers?: ReadonlyMap<HTMLInputElement, HTMLInputElement[]>, existingList?: HTMLElement) {
  if (!existingList) document.body.innerHTML = '';
  const list = existingList ?? document.createElement('section');
  if (!existingList) document.body.append(list);
  const context = new RecordRunContext();
  const initial = capture(context, closedSource(list));
  const active = recordAddInvoked(plan(initial));
  if ('status' in active) throw new Error(active.reason);
  const fixture = creatingFixture(list, elements, radioMembers);
  const editing = capture(context, fixture.source);
  return { context, fixture, editing, active, populatePlan: plan(editing, active) };
}
