import { fillScan } from '../content/autofill';
import { belongsToDocument, hasValue } from '../content/domUtils';
import type { ScanState, ScannedControl } from '../content/scanner';
import {
  isRecordPlanCurrentForSnapshot,
  isRecordTransactionCurrentForPlan,
  issueFieldsVerifiedReceipt,
  recordFieldsVerified,
  type ActiveRecordTransaction,
  type ReadyRecordPlan,
  type RequestHumanRecordPlan,
} from './recordPlanner';
import {
  isIssuedRecordRunCapture,
  matchesIssuedRecordRunTarget,
  RecordRunContext,
  type RecordRunCapture,
  type RecordRunCaptureFailure,
} from './recordRunContext';

export interface EditorFieldValueRequest {
  readonly fieldNodeId: string;
  readonly scanFieldId: string;
}

export type EditorFieldValueProvider = (request: EditorFieldValueRequest) => string | undefined;

export type RecordEditorBindReason =
  | 'invalid-bind-input'
  | 'duplicate-step'
  | 'field-map-mismatch'
  | 'field-target-replaced'
  | 'field-unsupported'
  | 'profile-value-missing'
  | 'existing-value-conflict'
  | 'field-write-failed'
  | 'field-readback-failed'
  | 'step-aborted'
  | 'rescan-failed'
  | 'receipt-rejected'
  | 'rollback-incomplete';

export type RecordEditorBindResult =
  | Readonly<{
    status: 'advanced';
    capture: RecordRunCapture;
    activeTransaction: ActiveRecordTransaction;
    writtenFieldCount: number;
    preservedFieldCount: number;
  }>
  | Readonly<{
    status: 'request-human';
    reason: RecordEditorBindReason;
    writtenFieldCount: number;
    rollbackComplete: boolean;
    plannerResult?: RequestHumanRecordPlan;
  }>;

export interface RecordEditorBindInput {
  readonly plan: ReadyRecordPlan;
  readonly capture: RecordRunCapture;
  readonly activeTransaction: ActiveRecordTransaction;
  readonly runContext: RecordRunContext;
  readonly scanState: ScanState;
  readonly provideValue: EditorFieldValueProvider;
  readonly rescan: () => RecordRunCapture | RecordRunCaptureFailure;
}

interface Binding {
  readonly fieldNodeId: string;
  readonly scanFieldId: string;
  readonly value: string;
  readonly control: ScannedControl;
  readonly preserved: boolean;
  readonly originalValue: string;
  readonly originalChecked: readonly boolean[];
}

const reservedSnapshots = new WeakSet<object>();

function thenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
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

function currentValueMatches(control: ScannedControl, value: string): boolean {
  if (control.adapter === 'mobile-select') return false;
  if (control.adapter === 'aria-combobox') return control.controller.verify(value);
  if (control.adapter === 'aria-radio-group') return control.controller.verify(value);
  if (control.adapter === 'radio-group') {
    const index = Number(value.replace('__radio_option_', ''));
    return Number.isInteger(index) && index >= 0 && control.members[index]?.checked === true;
  }
  return control.node.value === value && control.node.validity.valid;
}

function controlHasValue(control: ScannedControl): boolean {
  if (control.adapter === 'mobile-select') return true;
  if (control.adapter === 'aria-combobox') return control.controller.inspect().hasValue;
  if (control.adapter === 'aria-radio-group') return control.controller.inspect().hasValue;
  if (control.adapter === 'radio-group') return control.members.some(member => member.checked);
  return hasValue(control.node);
}

function failure(reason: RecordEditorBindReason, writtenFieldCount = 0, rollbackComplete = true,
  plannerResult?: RequestHumanRecordPlan): RecordEditorBindResult {
  return Object.freeze({ status: 'request-human', reason, writtenFieldCount, rollbackComplete,
    ...(plannerResult ? { plannerResult } : {}) });
}

function rollbackBindings(state: ScanState, bindings: readonly Binding[]): boolean {
  let complete = true;
  for (const binding of [...bindings].reverse()) {
    const control = state.controls.get(binding.scanFieldId);
    if (!control || control.adapter === 'mobile-select' || control.adapter === 'aria-combobox' || control.adapter === 'aria-radio-group'
      || !belongsToDocument(control.node, state.document)) {
      complete = false;
      continue;
    }
    try {
      const view = control.node.ownerDocument.defaultView;
      if (!view) throw new Error('document unavailable');
      if (control.adapter === 'radio-group') {
        const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'checked')?.set;
        if (!setter || control.members.length !== binding.originalChecked.length
          || control.members.some(member => !belongsToDocument(member, state.document))) throw new Error('radio replaced');
        control.members.forEach((member, index) => {
          setter.call(member, binding.originalChecked[index] ?? false);
          member.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
          member.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
        });
      } else {
        const node = control.node;
        const prototype: object = node instanceof view.HTMLInputElement ? view.HTMLInputElement.prototype
          : node instanceof view.HTMLTextAreaElement ? view.HTMLTextAreaElement.prototype
            : view.HTMLSelectElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) throw new Error('setter unavailable');
        setter.call(node, binding.originalValue);
        node.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
        node.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
      }
    } catch {
      complete = false;
    }
  }
  return complete;
}

/**
 * Fills one already-open record editor. Values stay inside this call and are never returned,
 * logged, hashed or persisted. Saving remains a separate, later executor step.
 */
export async function bindRecordEditor(input: RecordEditorBindInput): Promise<RecordEditorBindResult> {
  const { plan, capture, activeTransaction, runContext, scanState } = input ?? {} as RecordEditorBindInput;
  if (!plan || !capture || !(runContext instanceof RecordRunContext) || !scanState
    || !isIssuedRecordRunCapture(capture) || capture.runToken !== runContext.runToken
    || !isRecordPlanCurrentForSnapshot(plan, capture.snapshot) || plan.nextStep.kind !== 'populate-editor'
    || plan.runToken !== capture.runToken || plan.snapshotToken !== capture.snapshotToken
    || plan.snapshotVersion !== capture.snapshotVersion
    || !isRecordTransactionCurrentForPlan(activeTransaction, plan, 'populate-editor')
    || typeof input.provideValue !== 'function' || typeof input.rescan !== 'function') {
    return failure('invalid-bind-input');
  }
  if (reservedSnapshots.has(capture.snapshot)) return failure('duplicate-step');
  reservedSnapshots.add(capture.snapshot);

  const graph = scanState.result.semanticGraph;
  const editor = scanState.semanticTargets.get(plan.nextStep.editorRecordNodeId);
  if (!graph || !editor || !matchesIssuedRecordRunTarget(capture, plan.nextStep.editorRecordNodeId, editor)
    || !editor.isConnected || editor.ownerDocument !== scanState.document) return failure('field-map-mismatch');
  const graphNodes = new Map(graph.nodes.map(node => [node.id, node]));
  const bindings: Binding[] = [];
  for (const fieldNodeId of plan.nextStep.fieldNodeIds) {
    const fieldNode = graphNodes.get(fieldNodeId);
    if (fieldNode?.kind !== 'field') return failure('field-map-mismatch');
    const control = scanState.controls.get(fieldNode.fieldId);
    const target = scanState.semanticTargets.get(fieldNodeId);
    if (!control || !target || target !== control.node
      || !matchesIssuedRecordRunTarget(capture, fieldNodeId, target)
      || !target.isConnected || target.ownerDocument !== scanState.document || !composedContains(editor, target)) {
      return failure('field-target-replaced');
    }
    const descriptor = scanState.result.fields.find(field => field.id === fieldNode.fieldId);
    if (!descriptor || descriptor.blockedReason || control.adapter === 'mobile-select' || control.adapter === 'aria-combobox' || control.adapter === 'aria-radio-group'
      || descriptor.kind === 'checkbox') return failure('field-unsupported');
    let supplied: unknown;
    try {
      supplied = input.provideValue(Object.freeze({ fieldNodeId, scanFieldId: fieldNode.fieldId }));
      if (thenable(supplied)) void Promise.resolve(supplied).catch(() => undefined);
    } catch {
      return failure('profile-value-missing');
    }
    if (typeof supplied !== 'string' || supplied.trim() === '') return failure('profile-value-missing');
    const preserved = controlHasValue(control);
    if (preserved && !currentValueMatches(control, supplied)) return failure('existing-value-conflict');
    bindings.push({
      fieldNodeId, scanFieldId: fieldNode.fieldId, value: supplied, control, preserved,
      originalValue: 'value' in control.node ? control.node.value : '',
      originalChecked: control.adapter === 'radio-group' ? control.members.map(member => member.checked) : [],
    });
  }

  let signal: AbortSignal;
  try {
    signal = runContext.beginStep();
  } catch {
    return failure('step-aborted');
  }
  const items = bindings.filter(binding => !binding.preserved)
    .map(binding => ({ fieldId: binding.scanFieldId, value: binding.value, confirmed: true }));
  let outcomes: Awaited<ReturnType<typeof fillScan>>;
  try {
    outcomes = signal.aborted ? [] : await fillScan(scanState, { scanId: scanState.result.scanId, items });
  } catch {
    outcomes = [];
  }
  if (signal.aborted || outcomes.length !== items.length || outcomes.some(outcome => outcome.status !== 'filled')) {
    const wasAborted = signal.aborted;
    runContext.cancelStep();
    const rollbackComplete = rollbackBindings(scanState, bindings.filter(binding => (
      !binding.preserved && currentValueMatches(binding.control, binding.value)
    )));
    return failure(rollbackComplete ? (wasAborted ? 'step-aborted' : 'field-write-failed') : 'rollback-incomplete',
      outcomes.filter(outcome => outcome.status === 'filled').length, rollbackComplete);
  }
  if (signal.aborted || bindings.some(binding => !currentValueMatches(binding.control, binding.value))) {
    const wasAborted = signal.aborted;
    runContext.cancelStep();
    const rollbackComplete = rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? (wasAborted ? 'step-aborted' : 'field-readback-failed') : 'rollback-incomplete',
      items.length, rollbackComplete);
  }

  let next: RecordRunCapture | RecordRunCaptureFailure;
  try {
    next = input.rescan();
  } catch {
    next = { status: 'request-human', snapshotVersion: capture.snapshotVersion, reason: 'invalid-planner-input' };
  }
  runContext.cancelStep();
  if (next.status !== 'ready' || !isIssuedRecordRunCapture(next)
    || next.runToken !== capture.runToken || next.snapshotVersion !== capture.snapshotVersion + 1
    || next.profileRevision !== capture.profileRevision) {
    const rollbackComplete = rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? 'rescan-failed' : 'rollback-incomplete', items.length, rollbackComplete);
  }
  const byNodeId = new Map(bindings.map(binding => [binding.fieldNodeId, binding]));
  const receipt = issueFieldsVerifiedReceipt(plan, activeTransaction, next, fieldNodeId => {
    const binding = byNodeId.get(fieldNodeId);
    return Boolean(binding && matchesIssuedRecordRunTarget(next, fieldNodeId, binding.control.node)
      && currentValueMatches(binding.control, binding.value));
  });
  if (receipt.status !== 'ready') {
    const rollbackComplete = rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? 'receipt-rejected' : 'rollback-incomplete', items.length, rollbackComplete,
      receipt);
  }
  const advanced = recordFieldsVerified(plan, activeTransaction, receipt.receipt);
  if ('status' in advanced) {
    const rollbackComplete = rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? 'receipt-rejected' : 'rollback-incomplete', items.length, rollbackComplete,
      advanced);
  }
  return Object.freeze({
    status: 'advanced', capture: next, activeTransaction: advanced,
    writtenFieldCount: items.length, preservedFieldCount: bindings.length - items.length,
  });
}
