import { describe, expect, it } from 'vitest';
import { bindRecordEditor } from '../src/planner/recordEditorBinder';
import type {
  ActiveRecordTransaction,
  ReadyRecordPlan,
  RepeatableRecordPlannerInput,
} from '../src/planner/recordPlanner';
import { executeRecordAction } from '../src/planner/recordTransactionExecutor';
import {
  RecordTransactionOrchestrator,
  type RecordOrchestratorDriver,
} from '../src/planner/recordTransactionOrchestrator';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureSource } from '../src/planner/recordRunContext';
import {
  controlFingerprint,
  describeControl,
  type ScanState,
} from '../src/content/scanner';
import {
  SEMANTIC_CANONICAL_ACTION_LABELS,
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ActionSemanticNode,
  type PageSemanticGraph,
  type SemanticNode,
} from '../src/shared/semanticGraph';

const fingerprint = '0123456789abcdef';

interface Card {
  readonly intentIndex: number;
  readonly element: HTMLElement;
}

interface PageState {
  readonly source: RecordRunCaptureSource;
  readonly scanState: ScanState;
  readonly cardsByNodeId: ReadonlyMap<string, Card>;
}

interface PageOptions {
  readonly savedIntentOverride?: number;
  readonly extraSavedIntent?: number;
  readonly keepEditorAfterSave?: boolean;
  readonly editorDraft?: string;
}

function action(id: string, parentId: string, kind: 'add-record' | 'save-record', targetId: string): ActionSemanticNode {
  return {
    kind: 'action', id, parentId, childIds: [], order: 100, structuralFingerprint: fingerprint,
    evidence: [], action: kind, targetId, risk: kind === 'add-record' ? 'reversible' : 'commit',
    disabled: false, canonicalLabel: SEMANTIC_CANONICAL_ACTION_LABELS[kind],
  };
}

class MultiRecordPage {
  readonly list = document.createElement('section');
  readonly unsafeClicks = { delete: 0, upload: 0, next: 0, submit: 0 };
  addClicks = 0;
  saveClicks = 0;
  state!: PageState;
  #cards: Card[];
  readonly #options: PageOptions;

  constructor(existingIntentIndexes: readonly number[], options: PageOptions = {}) {
    document.body.innerHTML = '';
    document.body.append(this.list);
    this.#cards = existingIntentIndexes.map(intentIndex => this.#newCard(intentIndex));
    this.#options = options;
    const unsafe = [
      ['delete', '删除'], ['upload', '上传'], ['next', '下一步'], ['submit', '提交'],
    ] as const;
    for (const [key, label] of unsafe) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', () => { this.unsafeClicks[key]++; });
      document.body.append(button);
    }
    this.renderClosed();
  }

  renderClosed(): void {
    const addButton = document.createElement('button');
    addButton.textContent = '添加项目';
    addButton.addEventListener('click', () => {
      this.addClicks++;
      this.renderCreating();
    });
    this.list.replaceChildren(...this.#cards.map(card => card.element), addButton);
    this.state = this.#buildState(undefined, addButton);
  }

  renderCreating(): void {
    const editor = document.createElement('div');
    editor.dataset.editor = 'true';
    const input = document.createElement('input');
    input.name = 'projectName';
    input.value = this.#options.editorDraft ?? '';
    const saveButton = document.createElement('button');
    saveButton.textContent = '保存项目';
    saveButton.addEventListener('click', () => {
      this.saveClicks++;
      if (this.#options.keepEditorAfterSave) return;
      const match = /^project-(\d+)$/u.exec(input.value);
      if (!match) return;
      const card = this.#newCard(this.#options.savedIntentOverride ?? Number(match[1]));
      const previous = this.#cards;
      this.#cards = previous.length > 1
        ? [...previous.slice(1), card, previous[0]!]
        : [card, ...previous];
      if (this.#options.extraSavedIntent !== undefined) {
        this.#cards.push(this.#newCard(this.#options.extraSavedIntent));
      }
      this.renderClosed();
    });
    editor.append(input, saveButton);
    this.list.replaceChildren(...this.#cards.map(card => card.element), editor);
    this.state = this.#buildState({ editor, input }, saveButton);
  }

  #newCard(intentIndex: number): Card {
    const element = document.createElement('article');
    element.dataset.intent = String(intentIndex);
    element.textContent = `虚构项目 ${intentIndex}`;
    return { intentIndex, element };
  }

  #buildState(editorState: { editor: HTMLElement; input: HTMLInputElement } | undefined,
    actionButton: HTMLButtonElement): PageState {
    const nodes: SemanticNode[] = [{
      kind: 'page', id: 'page:0', parentId: null, childIds: ['section:0'], order: 0,
      structuralFingerprint: fingerprint, evidence: [],
    }, {
      kind: 'section', id: 'section:0', parentId: 'page:0', childIds: ['record-list:0'], order: 0,
      structuralFingerprint: fingerprint, evidence: ['heading'], heading: '项目经历', role: 'project', confidence: 1,
    }];
    const childIds: string[] = [];
    const targets = new Map<string, Element>([['record-list:0', this.list]]);
    const cardsByNodeId = new Map<string, Card>();
    this.#cards.forEach((card, index) => {
      const nodeId = `record:${index}`;
      childIds.push(nodeId);
      cardsByNodeId.set(nodeId, card);
      targets.set(nodeId, card.element);
      nodes.push({
        kind: 'record', id: nodeId, parentId: 'record-list:0', childIds: [], order: index,
        structuralFingerprint: fingerprint, evidence: ['repeated-structure'], index, state: 'summary',
      });
    });
    const fields = [];
    const controls = new Map();
    if (editorState) {
      childIds.push('record:99');
      const descriptor = describeControl(editorState.input, 'scan:0');
      fields.push(descriptor);
      controls.set('scan:0', { node: editorState.input, fingerprint: controlFingerprint(editorState.input, descriptor) });
      nodes.push({
        kind: 'record', id: 'record:99', parentId: 'record-list:0', childIds: ['field:99', 'action:20'],
        order: this.#cards.length, structuralFingerprint: fingerprint, evidence: ['editor-actions'],
        index: this.#cards.length, state: 'creating',
      }, {
        kind: 'field', id: 'field:99', parentId: 'record:99', childIds: [], order: 0,
        structuralFingerprint: fingerprint, evidence: ['visible-label'], fieldId: 'scan:0',
      }, action('action:20', 'record:99', 'save-record', 'record:99'));
      targets.set('record:99', editorState.editor);
      targets.set('field:99', editorState.input);
      targets.set('action:20', actionButton);
    } else {
      childIds.push('action:10');
      nodes.push(action('action:10', 'record-list:0', 'add-record', 'record-list:0'));
      targets.set('action:10', actionButton);
    }
    nodes.push({
      kind: 'record-list', id: 'record-list:0', parentId: 'section:0', childIds, order: 0,
      structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
      existingRecordCount: this.#cards.length, editorState: editorState ? 'creating' : 'closed',
    });
    const graph = { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: 'page:0', nodes } satisfies PageSemanticGraph;
    const scanState: ScanState = {
      result: { scanId: crypto.randomUUID(), url: document.URL, title: '', fields, semanticGraph: graph, warnings: [] },
      document, controls, semanticTargets: targets,
    };
    return {
      source: { graph, expectedFieldIds: fields.map(field => field.id), semanticTargets: targets,
        recordType: 'project', recordListNodeId: 'record-list:0' },
      scanState,
      cardsByNodeId,
    };
  }
}

function plannerInput(page: MultiRecordPage, capture: RecordRunCapture,
  active?: ActiveRecordTransaction): RepeatableRecordPlannerInput {
  const candidates = capture.candidates.map(candidate => ({ ...candidate, identityReady: true }));
  return {
    snapshot: capture.snapshot,
    profileRevision: capture.profileRevision,
    intents: Array.from({ length: 6 }, (_, intentIndex) => ({
      intentIndex, recordType: 'project' as const, identityReady: true,
    })),
    candidates,
    editorCandidate: capture.editorCandidate,
    identityComparisons: candidates.flatMap(candidate => {
      const card = page.state.cardsByNodeId.get(candidate.recordNodeId);
      if (!card) throw new Error('candidate/card mapping lost');
      return Array.from({ length: 6 }, (_, intentIndex) => ({
        runToken: capture.runToken,
        snapshotToken: capture.snapshotToken,
        intentIndex,
        recordNodeId: candidate.recordNodeId,
        verdict: card.intentIndex === intentIndex ? 'same' as const : 'different' as const,
        signals: card.intentIndex === intentIndex
          ? ['primary' as const, 'secondary' as const]
          : ['primary' as const],
        provenance: 'rule' as const,
      }));
    }),
    ...(active ? { activeTransaction: active } : {}),
  };
}

function driverFor(page: MultiRecordPage, context: RecordRunContext, timeoutMs = 2_000): RecordOrchestratorDriver {
  return {
    capture: () => context.capture(page.state.source),
    validateCapture: () => true,
    plannerInput: (capture, active) => plannerInput(page, capture, active),
    executeAction: (plan: ReadyRecordPlan, capture: RecordRunCapture, active?: ActiveRecordTransaction) => (
      executeRecordAction({
        plan, capture, activeTransaction: active, runContext: context,
        semanticTargets: page.state.source.semanticTargets,
        observePostcondition: () => plan.nextStep.kind === 'open-create'
          ? Boolean(page.list.querySelector('[data-editor]'))
          : !page.list.querySelector('[data-editor]'),
        rescan: () => context.capture(page.state.source),
        quietWindowMs: 10, timeoutMs,
      })
    ),
    bindEditor: (plan, capture, active) => bindRecordEditor({
      plan, capture, activeTransaction: active, runContext: context,
      scanState: page.state.scanState,
      provideValue: () => `project-${active.intentIndex}`,
      rescan: () => context.capture(page.state.source),
    }),
  };
}

describe('六项目多记录完整循环', () => {
  it('识别两个已有项目，只新增其余四个，并在每次卡片重排后重新匹配', async () => {
    const page = new MultiRecordPage([0, 1]);
    const context = new RecordRunContext();
    const orchestrator = new RecordTransactionOrchestrator(context, driverFor(page, context));
    const steps: string[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await orchestrator.advance();
      if (result.status === 'advanced') { steps.push(result.step); continue; }
      if (result.status !== 'complete') throw new Error(JSON.stringify(result));
      break;
    }

    expect(orchestrator.state).toBe('complete');
    expect(page.addClicks).toBe(4);
    expect(page.saveClicks).toBe(4);
    expect(steps.filter(step => step === 'open-create')).toHaveLength(4);
    expect(steps.filter(step => step === 'populate-editor')).toHaveLength(4);
    expect(steps.filter(step => step === 'save-created')).toHaveLength(4);
    expect(page.unsafeClicks).toEqual({ delete: 0, upload: 0, next: 0, submit: 0 });
  });

  it('保存生成了错误身份的新卡时停止，不继续新增下一项', async () => {
    const page = new MultiRecordPage([0, 1], { savedIntentOverride: 5 });
    const context = new RecordRunContext();
    const orchestrator = new RecordTransactionOrchestrator(context, driverFor(page, context));
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'open-create' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'populate-editor' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'save-created' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'save-result-uncertain' });
    expect(page.addClicks).toBe(1);
    expect(page.saveClicks).toBe(1);
    expect(page.unsafeClicks).toEqual({ delete: 0, upload: 0, next: 0, submit: 0 });
  });

  it('保存后一次多出两张卡时在保存步骤立即停止', async () => {
    const page = new MultiRecordPage([0, 1], { extraSavedIntent: 5 });
    const context = new RecordRunContext();
    const orchestrator = new RecordTransactionOrchestrator(context, driverFor(page, context));
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'open-create' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'populate-editor' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'postcondition-mismatch' });
    expect(page.addClicks).toBe(1);
    expect(page.saveClicks).toBe(1);
    expect(page.unsafeClicks).toEqual({ delete: 0, upload: 0, next: 0, submit: 0 });
  });

  it('保存点击后编辑器不关闭时超时停止且不重试保存', async () => {
    const page = new MultiRecordPage([0, 1], { keepEditorAfterSave: true });
    const context = new RecordRunContext();
    const orchestrator = new RecordTransactionOrchestrator(context, driverFor(page, context, 80));
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'open-create' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'populate-editor' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'postcondition-timeout' });
    expect(page.saveClicks).toBe(1);
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'manual-review-required' });
    expect(page.saveClicks).toBe(1);
  });

  it('两个已有摘要同时匹配同一项目时不点击新增', async () => {
    const page = new MultiRecordPage([0, 0]);
    const context = new RecordRunContext();
    const orchestrator = new RecordTransactionOrchestrator(context, driverFor(page, context));
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'duplicate-page-record' });
    expect(page.addClicks).toBe(0);
    expect(page.saveClicks).toBe(0);
  });

  it('编辑器已有冲突草稿时保留草稿且不点击保存', async () => {
    const page = new MultiRecordPage([0, 1], { editorDraft: '用户保留的草稿' });
    const context = new RecordRunContext();
    const orchestrator = new RecordTransactionOrchestrator(context, driverFor(page, context));
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'open-create' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'existing-value-conflict' });
    expect(page.list.querySelector<HTMLInputElement>('input')?.value).toBe('用户保留的草稿');
    expect(page.saveClicks).toBe(0);
  });

  it('字段核验后被网站再次修改时不进入保存步骤', async () => {
    const page = new MultiRecordPage([0, 1]);
    const context = new RecordRunContext();
    const orchestrator = new RecordTransactionOrchestrator(context, driverFor(page, context));
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'open-create' });
    expect(await orchestrator.advance()).toMatchObject({ status: 'advanced', step: 'populate-editor' });
    const input = page.list.querySelector<HTMLInputElement>('input')!;
    input.value = '网站二次改写';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(await orchestrator.advance()).toMatchObject({ status: 'request-human', reason: 'active-transaction-mismatch' });
    expect(page.saveClicks).toBe(0);
  });
});
