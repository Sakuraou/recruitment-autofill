import { fillScan, type FillScanInteractionTrace } from '../content/autofill';
import type { RecordFieldReason } from '../matching/recordFieldReason';
import { belongsToDocument, hasValue, hiddenReason } from '../content/domUtils';
import { booleanValue, createControlAdapter, stableAriaComboboxObservationMatches, verifyNativeRadioGroup } from '../content/controlAdapter';
import { ariaComboboxFingerprint, controlFingerprint, describeAriaCombobox, describeControl, describeRadioGroup } from '../content/scanner';
import { waitForDomStability } from '../content/domStability';
import type { ScanState, ScannedControl } from '../content/scanner';
import {
  isRecordPlanCurrentForSnapshot,
  isRecordTransactionCurrentForPlan,
  issueFieldsVerifiedReceipt,
  recordFieldsVerified,
  recordEditorExpanded,
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
  | RecordFieldReason
  | 'invalid-bind-input'
  | 'duplicate-step'
  | 'snapshot-stale'
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
  | 'editor-expansion-limit'
  | 'rollback-incomplete';

export type RecordEditorBindResult =
  | Readonly<{
    status: 'advanced' | 'expanded';
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
  /** Explicit current-project/education sessions only; legacy binders retain fixed-field behavior. */
  readonly allowExpansion?: boolean;
}

interface Binding {
  readonly fieldNodeId: string;
  readonly scanFieldId: string;
  readonly value: string;
  readonly control: ScannedControl;
  readonly preserved: boolean;
  readonly originalValue: string;
  readonly originalChecked: readonly boolean[];
  readonly rollbackIdentity: string;
  readonly editor: Element;
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
  if (control.adapter === 'aria-checkbox') return control.controller.verify(value);
  if (control.adapter === 'radio-group') {
    return verifyNativeRadioGroup(control.members, value);
  }
  if (control.node.tagName === 'INPUT' && (control.node as HTMLInputElement).type === 'checkbox') {
    return createControlAdapter(control.node).verify(value);
  }
  return control.node.value === value && control.node.validity.valid;
}

function controlHasValue(control: ScannedControl): boolean {
  if (control.adapter === 'mobile-select') return true;
  if (control.adapter === 'aria-combobox') return control.controller.inspect().hasValue;
  if (control.adapter === 'aria-radio-group') return control.controller.inspect().hasValue;
  if (control.adapter === 'aria-checkbox') return control.controller.inspect().hasValue;
  if (control.adapter === 'radio-group') return control.members.some(member => member.checked);
  return hasValue(control.node);
}

function failure(reason: RecordEditorBindReason, writtenFieldCount = 0, rollbackComplete = true,
  plannerResult?: RequestHumanRecordPlan): RecordEditorBindResult {
  return Object.freeze({ status: 'request-human', reason, writtenFieldCount, rollbackComplete,
    ...(plannerResult ? { plannerResult } : {}) });
}

function nativeControl(control: ScannedControl): control is Extract<ScannedControl, { adapter?: undefined }> | Extract<ScannedControl, { adapter: 'radio-group' }> {
  return control.adapter === undefined || control.adapter === 'radio-group';
}

function bindingIdentity(control: ScannedControl): string {
  if (control.adapter === 'aria-combobox') {
    if (!control.observation || !stableAriaComboboxObservationMatches(control.node, control.observation)) return '';
    const field = describeAriaCombobox(control.node, '', control.controller); if (field.blockedReason) return '';
    return JSON.stringify({ kind: field.kind, type: field.type, label: field.label, name: field.name, htmlId: field.htmlId,
      ariaLabel: field.ariaLabel, placeholder: field.placeholder, title: field.title, required: field.required,
      disabled: field.disabled, readOnly: field.readOnly, options: field.options });
  }
  if (!nativeControl(control)) return '';
  const field = control.adapter === 'radio-group' ? describeRadioGroup(control.members, '') : describeControl(control.node, '');
  const identity = { kind: field.kind, type: field.type, label: field.label, name: field.name,
    htmlId: field.htmlId, ariaLabel: field.ariaLabel, placeholder: field.placeholder, title: field.title,
    tableHeader: field.tableHeader, required: field.required, disabled: field.disabled, readOnly: field.readOnly,
    options: field.options };
  // Controlled React inputs may update value/checked attributes as part of
  // their normal event chain. Those are state, not control identity.
  const attributes = Array.from(control.node.attributes).filter(attribute => !['value', 'checked', 'aria-invalid'].includes(attribute.name))
    .map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''));
  const members = control.adapter === 'radio-group' ? control.members.map(member => ({
    label: member.getAttribute('aria-label'),
    attributes: Array.from(member.attributes).filter(attribute => !['checked', 'aria-invalid'].includes(attribute.name))
      .map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')),
  })) : undefined;
  return JSON.stringify({ identity, attributes, members });
}

function valueEquals(control: ScannedControl, value: string): boolean {
  if (!nativeControl(control)) return false;
  if (control.adapter === 'radio-group') {
    const index = Number(value.replace('__radio_option_', ''));
    return Number.isInteger(index) && control.members.filter(member => member.checked).length === 1
      && control.members[index]?.checked === true;
  }
  if (control.node.tagName === 'INPUT' && (control.node as HTMLInputElement).type === 'checkbox') {
    const node = control.node as HTMLInputElement;
    const desired = booleanValue(value);
    return desired !== undefined && !node.indeterminate && node.checked === desired;
  }
  return control.node.value === value;
}

function originalValueRestored(binding: Binding): boolean {
  const control = binding.control;
  if (!nativeControl(control)) return false;
  if (control.adapter === 'radio-group') return control.members.length === binding.originalChecked.length
    && control.members.every((member, index) => member.checked === binding.originalChecked[index]);
  if (control.node.tagName === 'INPUT' && (control.node as HTMLInputElement).type === 'checkbox') {
    const node = control.node as HTMLInputElement;
    return !node.indeterminate && node.checked === binding.originalChecked[0];
  }
  return control.node.value === binding.originalValue;
}

async function rollbackBindings(state: ScanState, bindings: readonly Binding[]): Promise<boolean> {
  let complete = true;
  const restored: Binding[] = [];
  for (const binding of [...bindings].reverse()) {
    const control = state.controls.get(binding.scanFieldId);
    if (state.document.URL !== state.result.url || !control || control !== binding.control || !nativeControl(control)
      || !belongsToDocument(control.node, state.document) || !binding.editor.isConnected
      || !composedContains(binding.editor, control.node) || bindingIdentity(control) !== binding.rollbackIdentity) {
      complete = false;
      continue;
    }
    if (originalValueRestored(binding)) { restored.push(binding); continue; }
    const descriptor = control.adapter === 'radio-group' ? describeRadioGroup(control.members, binding.scanFieldId)
      : describeControl(control.node, binding.scanFieldId);
    // A user or the website can change a value between writing and rollback.
    // Only undo a still-identifiable value written by this transaction.
    if (descriptor.blockedReason || !valueEquals(control, binding.value)) { complete = false; continue; }
    try {
      const view = control.node.ownerDocument.defaultView;
      if (!view) throw new Error('document unavailable');
      if (control.adapter === 'radio-group') {
        // Native radios have no normal UI action for clearing a selection.
        // checked setters can clear DOM while leaving framework state selected.
        // Keep the answer visible and report incomplete rollback; never reset
        // the form or choose another answer to manufacture a successful undo.
        complete = false;
        continue;
      } else if (control.node.tagName === 'INPUT' && (control.node as HTMLInputElement).type === 'checkbox') {
        const node = control.node as HTMLInputElement;
        const original = binding.originalChecked[0];
        if (original === undefined) throw new Error('checkbox snapshot unavailable');
        if (node.checked !== original) node.click();
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
      restored.push(binding);
    } catch {
      complete = false;
    }
  }
  if (restored.length) {
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    if (state.document.URL !== state.result.url || restored.some(binding => state.controls.get(binding.scanFieldId) !== binding.control
      || !belongsToDocument(binding.control.node, state.document)
      || !binding.editor.isConnected || !composedContains(binding.editor, binding.control.node)
      || bindingIdentity(binding.control) !== binding.rollbackIdentity || !originalValueRestored(binding))) complete = false;
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
  const ownedFields = new Set(plan.nextStep.fieldNodeIds.map(id => {
    const node = graphNodes.get(id); return node?.kind === 'field' ? node.fieldId : undefined;
  }));
  // Visible controls cannot be silently omitted just because a nested heading
  // could not be assigned to this editor. No writes or saving grant in that case.
  if (scanState.result.fields.some(field => {
    const control = scanState.controls.get(field.id);
    return control && composedContains(editor, control.node) && !hiddenReason(control.node) && !ownedFields.has(field.id);
  })) return failure('field-semantic-unknown');
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
    const nativeCheckbox = descriptor?.kind === 'checkbox' && control.adapter === undefined
      && control.node.tagName === 'INPUT' && (control.node as HTMLInputElement).type === 'checkbox';
    const stableCombo = control.adapter === 'aria-combobox' && control.observation
      && stableAriaComboboxObservationMatches(control.node, control.observation);
    if (!descriptor || descriptor.blockedReason || control.adapter === 'mobile-select'
      || (control.adapter === 'aria-combobox' && !stableCombo) || control.adapter === 'aria-radio-group' || control.adapter === 'aria-checkbox'
      || (descriptor.kind === 'checkbox' && !nativeCheckbox)) return failure('field-unsupported');
    if (control.adapter === 'aria-combobox') {
      const current = describeAriaCombobox(control.node, fieldNode.fieldId, control.controller);
      if (current.blockedReason || ariaComboboxFingerprint(control.node, current, control.controller) !== control.fingerprint)
        return failure('field-target-replaced');
    }
    if (nativeCheckbox && control.adapter === undefined) {
      const current = describeControl(control.node, fieldNode.fieldId);
      if (current.blockedReason) return failure('field-unsupported');
      if (controlFingerprint(control.node, current) !== control.fingerprint) return failure('field-target-replaced');
    }
    let supplied: unknown;
    try {
      supplied = input.provideValue(Object.freeze({ fieldNodeId, scanFieldId: fieldNode.fieldId }));
      if (thenable(supplied)) void Promise.resolve(supplied).catch(() => undefined);
    } catch {
      return failure('profile-value-missing');
    }
    if (typeof supplied !== 'string' || supplied.trim() === '') return failure('profile-value-missing');
    if (control.adapter === 'aria-combobox'
      && descriptor.options.filter(option => option.label === supplied && !option.disabled).length !== 1) return failure('field-unsupported');
    if (nativeCheckbox) {
      const node = control.node as HTMLInputElement;
      const desired = booleanValue(supplied);
      if (createControlAdapter(node).inspect().blockedReason || desired === undefined) return failure('field-unsupported');
      if (node.required && !desired) return failure('field-write-failed');
    }
    const preserved = controlHasValue(control) || (nativeCheckbox && currentValueMatches(control, supplied));
    if (preserved && !currentValueMatches(control, supplied)) return failure('existing-value-conflict');
    bindings.push({
      fieldNodeId, scanFieldId: fieldNode.fieldId, value: supplied, control, preserved,
      originalValue: 'value' in control.node ? control.node.value : '',
      originalChecked: control.adapter === 'radio-group' ? control.members.map(member => member.checked)
        : nativeCheckbox ? [(control.node as HTMLInputElement).checked] : [],
      rollbackIdentity: bindingIdentity(control),
      editor,
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
  const trace: FillScanInteractionTrace = { ariaComboboxAttempts: new Set() };
  try {
    outcomes = signal.aborted ? [] : await fillScan(scanState, { scanId: scanState.result.scanId, items }, signal, trace);
  } catch {
    outcomes = [];
  }
  if (signal.aborted || outcomes.length !== items.length || outcomes.some(outcome => outcome.status !== 'filled')) {
    const wasAborted = signal.aborted;
    runContext.cancelStep();
    const rollbackComplete = await rollbackBindings(scanState, bindings.filter(binding => (
      !binding.preserved && (valueEquals(binding.control, binding.value) || trace.ariaComboboxAttempts.has(binding.control.node))
    )));
    return failure(rollbackComplete ? (wasAborted ? 'step-aborted' : 'field-write-failed') : 'rollback-incomplete',
      outcomes.filter(outcome => outcome.status === 'filled').length, rollbackComplete);
  }
  if (signal.aborted || bindings.some(binding => bindingIdentity(binding.control) !== binding.rollbackIdentity
    || !currentValueMatches(binding.control, binding.value))) {
    const wasAborted = signal.aborted;
    runContext.cancelStep();
    const rollbackComplete = await rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? (wasAborted ? 'step-aborted' : 'field-readback-failed') : 'rollback-incomplete',
      items.length, rollbackComplete);
  }

  // Choices may reveal controls asynchronously. Observe only this editor;
  // manual rewrites, replacement and cancellation cannot grant a saving capability.
  if (input.allowExpansion === true && bindings.some(binding => !binding.preserved
    && (binding.control.node.tagName === 'SELECT' || binding.control.adapter === 'radio-group' || binding.control.adapter === 'aria-combobox'))) {
    const quiet = await waitForDomStability({ root: editor, signal, quietWindowMs: 750, timeoutMs: 3_000,
      predicate: () => bindings.every(binding => bindingIdentity(binding.control) === binding.rollbackIdentity
        && currentValueMatches(binding.control, binding.value)) });
    if (quiet.status !== 'stable') {
      runContext.cancelStep();
      const rollbackComplete = await rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
      return failure(rollbackComplete ? (quiet.status === 'aborted' ? 'step-aborted' : 'field-readback-failed')
        : 'rollback-incomplete', items.length, rollbackComplete);
    }
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
    const rollbackComplete = await rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? 'rescan-failed' : 'rollback-incomplete', items.length, rollbackComplete);
  }
  const byNodeId = new Map(bindings.map(binding => [binding.fieldNodeId, binding]));
  const verifyField = (fieldNodeId: string): boolean => {
    const binding = byNodeId.get(fieldNodeId);
    return Boolean(binding && matchesIssuedRecordRunTarget(next, fieldNodeId, binding.control.node)
      && bindingIdentity(binding.control) === binding.rollbackIdentity
      && currentValueMatches(binding.control, binding.value));
  };
  if (input.allowExpansion === true && next.snapshot.editor
    && next.snapshot.editor.fieldNodeIds.length > plan.nextStep.fieldNodeIds.length) {
    const continuityIds = [plan.recordListNodeId, plan.nextStep.editorRecordNodeId,
      ...capture.snapshot.summaries.map(summary => summary.recordNodeId),
      ...capture.snapshot.actions.map(action => action.actionNodeId)];
    if (continuityIds.some(id => {
      const target = scanState.semanticTargets.get(id);
      return !target || !matchesIssuedRecordRunTarget(next, id, target);
    })) {
      const rollbackComplete = await rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
      return failure(rollbackComplete ? 'field-target-replaced' : 'rollback-incomplete', items.length, rollbackComplete);
    }
    const expanded = recordEditorExpanded(plan, activeTransaction, capture, next, verifyField);
    if (!('status' in expanded)) return Object.freeze({ status: 'expanded', capture: next, activeTransaction: expanded,
      writtenFieldCount: items.length, preservedFieldCount: bindings.length - items.length });
    const rollbackComplete = await rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? (expanded.reason === 'editor-expansion-limit' ? 'editor-expansion-limit' : 'receipt-rejected')
      : 'rollback-incomplete', items.length, rollbackComplete, expanded);
  }
  const receipt = issueFieldsVerifiedReceipt(plan, activeTransaction, next, verifyField);
  if (receipt.status !== 'ready') {
    const rollbackComplete = await rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? 'receipt-rejected' : 'rollback-incomplete', items.length, rollbackComplete,
      receipt);
  }
  const advanced = recordFieldsVerified(plan, activeTransaction, receipt.receipt);
  if ('status' in advanced) {
    const rollbackComplete = await rollbackBindings(scanState, bindings.filter(binding => !binding.preserved));
    return failure(rollbackComplete ? 'receipt-rejected' : 'rollback-incomplete', items.length, rollbackComplete,
      advanced);
  }
  return Object.freeze({
    status: 'advanced', capture: next, activeTransaction: advanced,
    writtenFieldCount: items.length, preservedFieldCount: bindings.length - items.length,
  });
}
