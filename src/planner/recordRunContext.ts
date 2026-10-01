import type { PageSemanticGraph, RecordListSemanticNode, RecordSemanticNode } from '../shared/semanticGraph';
import {
  createRecordPlannerSnapshot,
  type PageRecordCandidate,
  type PageRecordEditorCandidate,
  type RecordPlanHumanReason,
  type RecordPlannerSnapshot,
  type RepeatableRecordType,
} from './recordPlanner';

export type RecordRunCaptureFailureReason = RecordPlanHumanReason
  | 'run-stopped'
  | 'record-target-missing'
  | 'record-target-disconnected'
  | 'record-target-outside-list'
  | 'record-target-ambiguous'
  | 'fields-changed-after-verification'
  | 'handle-limit-reached';

export interface RecordRunCaptureFailure {
  readonly status: 'request-human';
  readonly snapshotVersion: number;
  readonly reason: RecordRunCaptureFailureReason;
}

export interface RecordRunCapture {
  readonly status: 'ready';
  readonly runToken: string;
  readonly snapshotToken: string;
  readonly snapshotVersion: number;
  readonly profileRevision: number;
  readonly snapshot: RecordPlannerSnapshot;
  readonly candidates: readonly PageRecordCandidate[];
  readonly editorCandidate?: PageRecordEditorCandidate;
  readonly editorRevision?: number;
}

export interface RecordRunCaptureSource {
  readonly graph: PageSemanticGraph;
  readonly expectedFieldIds: readonly string[];
  readonly semanticTargets: ReadonlyMap<string, Element>;
  readonly recordType: RepeatableRecordType;
  readonly recordListNodeId: string;
}

const issuedCaptures = new WeakSet<object>();
const captureTargets = new WeakMap<object, ReadonlyMap<string, Element>>();

/** Only captures issued by a live RecordRunContext can cross the executor boundary. */
export function isIssuedRecordRunCapture(value: unknown): value is RecordRunCapture {
  return Boolean(value && typeof value === 'object' && issuedCaptures.has(value)
    && Object.isFrozen(value) && (value as RecordRunCapture).status === 'ready');
}

/** Compares a current scan target with the exact DOM object observed when the capture was issued. */
export function matchesIssuedRecordRunTarget(capture: RecordRunCapture, nodeId: string,
  target: unknown): target is Element {
  if (!isIssuedRecordRunCapture(capture) || typeof nodeId !== 'string' || !element(target)) return false;
  return captureTargets.get(capture)?.get(nodeId) === target;
}

interface CandidateBinding {
  readonly handle: number;
  readonly listElement: Element;
  readonly recordType: RepeatableRecordType;
}

interface EditorObservation {
  readonly element: Element;
  readonly listElement: Element;
  readonly recordType: RepeatableRecordType;
  readonly handle: number;
  revision: number;
  readonly form?: HTMLFormElement;
  readonly onFieldMutation: EventListener;
  readonly onFormReset: EventListener;
}

const MAX_HANDLE = 1_000_000;
const MAX_SNAPSHOT_VERSION = 1_000_000;
const MAX_REVISION = 1_000_000;
const RUN_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function freezeFailure(snapshotVersion: number, reason: RecordRunCaptureFailureReason): RecordRunCaptureFailure {
  return Object.freeze({ status: 'request-human', snapshotVersion, reason });
}

function element(value: unknown): value is Element {
  return Boolean(value && typeof value === 'object' && (value as Node).nodeType === 1
    && 'ownerDocument' in (value as object) && 'isConnected' in (value as object));
}

function targetFor(targets: ReadonlyMap<string, Element>, nodeId: string): Element | undefined {
  try {
    return typeof targets?.get === 'function' ? targets.get(nodeId) : undefined;
  } catch {
    return undefined;
  }
}

function composedContains(ancestor: Element, descendant: Element): boolean {
  let current: Node | null = descendant;
  const seen = new Set<Node>();
  for (let depth = 0; current && depth < 256; depth++) {
    if (current === ancestor) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    const root = current.getRootNode();
    current = current.parentNode ?? (root && 'host' in root ? (root as ShadowRoot).host : null);
  }
  return false;
}

function summaryNodes(graph: PageSemanticGraph, list: RecordListSemanticNode): RecordSemanticNode[] {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  return list.childIds.map(id => byId.get(id))
    .filter((node): node is RecordSemanticNode => node?.kind === 'record' && node.state === 'summary')
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
}

function editorNode(graph: PageSemanticGraph, list: RecordListSemanticNode): RecordSemanticNode | undefined {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  return list.childIds.map(id => byId.get(id))
    .find((node): node is RecordSemanticNode => node?.kind === 'record' && node.state !== 'summary');
}

/**
 * In-memory continuity state for one content-script run. It stores only DOM object identity,
 * bounded counters and random capabilities; it never stores field values, labels or hashes.
 */
export class RecordRunContext {
  readonly #runToken: string;
  readonly #seenTokens = new Set<string>();
  readonly #candidateBindings = new WeakMap<Element, CandidateBinding>();
  #visibleCandidates = new Set<Element>();
  #editor?: EditorObservation;
  #snapshotVersion = 0;
  #nextCandidateHandle = 0;
  #nextEditorHandle = 0;
  #profileRevision = 0;
  #stepController?: AbortController;
  #stopped = false;

  constructor() {
    const token = globalThis.crypto?.randomUUID?.();
    if (!token || !RUN_TOKEN_PATTERN.test(token)) throw new Error('无法创建安全的运行令牌');
    this.#runToken = token;
    this.#seenTokens.add(token);
  }

  get runToken(): string { return this.#runToken; }
  get profileRevision(): number { return this.#profileRevision; }
  get stopped(): boolean { return this.#stopped; }

  bumpProfileRevision(): number {
    if (this.#stopped || this.#profileRevision >= MAX_REVISION) throw new Error('运行已停止或档案修订次数超限');
    this.#profileRevision++;
    return this.#profileRevision;
  }

  beginStep(): AbortSignal {
    if (this.#stopped) throw new Error('运行已停止');
    this.#stepController?.abort();
    this.#stepController = new AbortController();
    return this.#stepController.signal;
  }

  cancelStep(): void {
    this.#stepController?.abort();
    this.#stepController = undefined;
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.cancelStep();
    this.#detachEditor();
    for (const candidate of this.#visibleCandidates) this.#candidateBindings.delete(candidate);
    this.#visibleCandidates.clear();
  }

  capture(source: RecordRunCaptureSource): RecordRunCapture | RecordRunCaptureFailure {
    if (this.#stopped) return freezeFailure(this.#snapshotVersion, 'run-stopped');
    if (!source || typeof source !== 'object' || !source.semanticTargets) {
      return freezeFailure(this.#snapshotVersion, 'invalid-planner-input');
    }
    if (this.#snapshotVersion >= MAX_SNAPSHOT_VERSION) {
      return freezeFailure(this.#snapshotVersion, 'handle-limit-reached');
    }
    const snapshotVersion = ++this.#snapshotVersion;
    const snapshotToken = globalThis.crypto?.randomUUID?.();
    if (!snapshotToken || !RUN_TOKEN_PATTERN.test(snapshotToken) || this.#seenTokens.has(snapshotToken)) {
      return freezeFailure(snapshotVersion, 'invalid-planner-input');
    }
    this.#seenTokens.add(snapshotToken);
    const snapshotResult = createRecordPlannerSnapshot({
      runToken: this.#runToken,
      snapshotToken,
      snapshotVersion,
      graph: source.graph,
      expectedFieldIds: source.expectedFieldIds,
      recordType: source.recordType,
      recordListNodeId: source.recordListNodeId,
    });
    if (snapshotResult.status !== 'ready') return freezeFailure(snapshotVersion, snapshotResult.reason);

    const list = source.graph.nodes.find((node): node is RecordListSemanticNode => (
      node.kind === 'record-list' && node.id === source.recordListNodeId
    ));
    const listElement = targetFor(source.semanticTargets, source.recordListNodeId);
    if (!list || !element(listElement)) return freezeFailure(snapshotVersion, 'record-target-missing');
    if (!listElement.isConnected) return freezeFailure(snapshotVersion, 'record-target-disconnected');

    const currentCandidates = new Set<Element>();
    const candidates: PageRecordCandidate[] = [];
    for (const record of summaryNodes(source.graph, list)) {
      const recordElement = targetFor(source.semanticTargets, record.id);
      if (!element(recordElement)) return freezeFailure(snapshotVersion, 'record-target-missing');
      if (!recordElement.isConnected) return freezeFailure(snapshotVersion, 'record-target-disconnected');
      if (recordElement === listElement || recordElement.ownerDocument !== listElement.ownerDocument
        || !composedContains(listElement, recordElement)) {
        return freezeFailure(snapshotVersion, 'record-target-outside-list');
      }
      if (currentCandidates.has(recordElement)) return freezeFailure(snapshotVersion, 'record-target-ambiguous');
      currentCandidates.add(recordElement);
      let binding = this.#candidateBindings.get(recordElement);
      if (!binding || binding.listElement !== listElement || binding.recordType !== source.recordType) {
        if (this.#nextCandidateHandle >= MAX_HANDLE) return freezeFailure(snapshotVersion, 'handle-limit-reached');
        binding = Object.freeze({ handle: this.#nextCandidateHandle++, listElement, recordType: source.recordType });
        this.#candidateBindings.set(recordElement, binding);
      }
      candidates.push(Object.freeze({
        runToken: this.#runToken,
        snapshotToken,
        recordNodeId: record.id,
        recordListNodeId: list.id,
        recordType: source.recordType,
        index: record.index,
        candidateHandle: binding.handle,
        identityReady: false,
      }));
    }
    for (const previous of this.#visibleCandidates) {
      if (!currentCandidates.has(previous)) this.#candidateBindings.delete(previous);
    }
    this.#visibleCandidates = currentCandidates;

    const editor = editorNode(source.graph, list);
    let editorCandidate: PageRecordEditorCandidate | undefined;
    let editorRevision: number | undefined;
    if (editor) {
      const editorElement = targetFor(source.semanticTargets, editor.id);
      if (!element(editorElement)) return freezeFailure(snapshotVersion, 'record-target-missing');
      if (!editorElement.isConnected) return freezeFailure(snapshotVersion, 'record-target-disconnected');
      if (editorElement === listElement || currentCandidates.has(editorElement)
        || editorElement.ownerDocument !== listElement.ownerDocument || !composedContains(listElement, editorElement)) {
        return freezeFailure(snapshotVersion, 'record-target-outside-list');
      }
      const observation = this.#observeEditor(editorElement, listElement, source.recordType);
      if (!observation) return freezeFailure(snapshotVersion, 'handle-limit-reached');
      editorCandidate = Object.freeze({
        runToken: this.#runToken,
        snapshotToken,
        recordNodeId: editor.id,
        editorHandle: observation.handle,
        editorRevision: observation.revision,
      });
      editorRevision = observation.revision;
    } else {
      this.#detachEditor(true);
    }

    const capture = Object.freeze({
      status: 'ready',
      runToken: this.#runToken,
      snapshotToken,
      snapshotVersion,
      profileRevision: this.#profileRevision,
      snapshot: snapshotResult.snapshot,
      candidates: Object.freeze(candidates),
      ...(editorCandidate ? { editorCandidate, editorRevision } : {}),
    } satisfies RecordRunCapture);
    const relevantNodeIds = new Set([
      snapshotResult.snapshot.recordListNodeId,
      ...snapshotResult.snapshot.summaries.map(summary => summary.recordNodeId),
      ...(snapshotResult.snapshot.editor
        ? [snapshotResult.snapshot.editor.recordNodeId, ...snapshotResult.snapshot.editor.fieldNodeIds]
        : []),
      ...snapshotResult.snapshot.actions.flatMap(action => [action.actionNodeId, action.targetNodeId]),
    ]);
    const targets = new Map<string, Element>();
    for (const nodeId of relevantNodeIds) {
      const target = targetFor(source.semanticTargets, nodeId);
      if (element(target)) targets.set(nodeId, target);
    }
    issuedCaptures.add(capture);
    captureTargets.set(capture, targets);
    return capture;
  }

  #observeEditor(elementNode: Element, listElement: Element, recordType: RepeatableRecordType): EditorObservation | undefined {
    const currentForm = elementNode.closest('form') ?? undefined;
    if (this.#editor?.element === elementNode && this.#editor.listElement === listElement
      && this.#editor.recordType === recordType && this.#editor.form === currentForm) return this.#editor;
    this.#detachEditor(true);
    if (this.#nextEditorHandle >= MAX_HANDLE) return undefined;
    const observation: EditorObservation = {
      element: elementNode,
      listElement,
      recordType,
      handle: this.#nextEditorHandle++,
      revision: 0,
      form: currentForm,
      onFieldMutation: () => {
        if (observation.revision < MAX_REVISION) observation.revision++;
      },
      onFormReset: () => {
        if (observation.revision < MAX_REVISION) observation.revision++;
      },
    };
    elementNode.addEventListener('input', observation.onFieldMutation, true);
    elementNode.addEventListener('change', observation.onFieldMutation, true);
    elementNode.addEventListener('reset', observation.onFormReset, true);
    observation.form?.addEventListener('reset', observation.onFormReset, true);
    this.#editor = observation;
    return observation;
  }

  #detachEditor(invalidate = false): void {
    const observation = this.#editor;
    if (!observation) return;
    observation.element.removeEventListener('input', observation.onFieldMutation, true);
    observation.element.removeEventListener('change', observation.onFieldMutation, true);
    observation.element.removeEventListener('reset', observation.onFormReset, true);
    observation.form?.removeEventListener('reset', observation.onFormReset, true);
    if (invalidate) observation.revision = Math.min(MAX_REVISION, observation.revision + 1);
    this.#editor = undefined;
  }
}
