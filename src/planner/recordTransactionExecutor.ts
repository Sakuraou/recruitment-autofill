import { waitForDomStability, type DomStabilityResult } from '../content/domStability';
import {
  isRecordPlanCurrentForSnapshot,
  isRecordTransactionCurrentForPlan,
  recordActionResultUncertain,
  recordAddInvoked,
  recordSaveInvoked,
  type ActiveRecordTransaction,
  type ReadyRecordPlan,
  type RecordPlannerSnapshot,
  type RequestHumanRecordPlan,
} from './recordPlanner';
import {
  isIssuedRecordRunCapture,
  matchesIssuedRecordRunTarget,
  RecordRunContext,
  type RecordRunCapture,
  type RecordRunCaptureFailure,
} from './recordRunContext';

export type ExecutableRecordActionStep = 'open-create' | 'save-created';

export type RecordActionExecutionReason =
  | 'invalid-execution-input'
  | 'duplicate-step'
  | 'action-target-missing'
  | 'action-target-replaced'
  | 'action-not-clickable'
  | 'action-threw'
  | 'postcondition-timeout'
  | 'postcondition-aborted'
  | 'postcondition-disconnected'
  | 'postcondition-failed'
  | 'postcondition-mismatch'
  | 'transition-rejected';

export type RecordActionExecutionResult =
  | Readonly<{
    status: 'advanced';
    step: ExecutableRecordActionStep;
    capture: RecordRunCapture;
    activeTransaction: ActiveRecordTransaction;
  }>
  | Readonly<{
    status: 'request-human';
    step?: ExecutableRecordActionStep;
    reason: RecordActionExecutionReason;
    clicked: boolean;
    plannerResult?: RequestHumanRecordPlan;
  }>;

export interface RecordActionExecutionInput {
  readonly plan: ReadyRecordPlan;
  readonly capture: RecordRunCapture;
  readonly semanticTargets: ReadonlyMap<string, Element>;
  readonly runContext: RecordRunContext;
  readonly activeTransaction?: ActiveRecordTransaction;
  /** Synchronous structural hint used by the DOM stability waiter; it must not mutate the page. */
  readonly observePostcondition: () => boolean;
  /** Performs one fresh semantic scan after the structural hint has remained stable. */
  readonly rescan: () => RecordRunCapture | RecordRunCaptureFailure;
  readonly quietWindowMs?: number;
  readonly timeoutMs?: number;
}

const reservedSteps = new WeakMap<RecordPlannerSnapshot, Set<ExecutableRecordActionStep>>();

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

function enabledClickable(target: Element): target is Element & { click(): void } {
  const clickable = target as Element & { click?: unknown; disabled?: unknown };
  return target.isConnected && typeof clickable.click === 'function' && clickable.disabled !== true
    && target.getAttribute('aria-disabled') !== 'true' && !target.closest('[inert]');
}

function reserve(snapshot: RecordPlannerSnapshot, step: ExecutableRecordActionStep): boolean {
  let steps = reservedSteps.get(snapshot);
  if (!steps) {
    steps = new Set();
    reservedSteps.set(snapshot, steps);
  }
  if (steps.has(step)) return false;
  steps.add(step);
  return true;
}

function sameNumberSet(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && new Set(left).size === left.length
    && left.every(value => right.includes(value));
}

function validAdjacentCapture(input: RecordActionExecutionInput, next: RecordRunCapture,
  step: ExecutableRecordActionStep): boolean {
  const { capture, plan, activeTransaction } = input;
  if (!isIssuedRecordRunCapture(next) || next.runToken !== capture.runToken
    || next.snapshotVersion !== capture.snapshotVersion + 1 || next.snapshotToken === capture.snapshotToken
    || next.profileRevision !== capture.profileRevision || next.snapshot.recordType !== plan.recordType
    || next.snapshot.recordListNodeId !== plan.recordListNodeId) return false;
  if (step === 'open-create' && plan.nextStep.kind === 'open-create') {
    return next.snapshot.editorState === 'creating' && Boolean(next.snapshot.editor && next.editorCandidate)
      && next.snapshot.existingRecordCount === plan.nextStep.postcondition.expectedExistingRecordCount
      && sameNumberSet(next.candidates.map(candidate => candidate.candidateHandle),
        plan.nextStep.postcondition.expectedCandidateHandles)
      && next.editorCandidate?.recordNodeId === next.snapshot.editor?.recordNodeId;
  }
  if (step === 'save-created' && plan.nextStep.kind === 'save-created'
    && activeTransaction?.phase === 'fields-verified') {
    const handles = next.candidates.map(candidate => candidate.candidateHandle);
    const baseline = activeTransaction.baselineCandidateHandles;
    return next.snapshot.editorState === 'closed' && !next.snapshot.editor && !next.editorCandidate
      && next.snapshot.existingRecordCount === plan.nextStep.postcondition.expectedExistingRecordCount
      && handles.length === baseline.length + plan.nextStep.postcondition.expectedNewCandidateCount
      && baseline.every(handle => handles.includes(handle))
      && handles.filter(handle => !baseline.includes(handle)).length === 1
      && next.profileRevision === activeTransaction.profileRevision;
  }
  return false;
}

function waitReason(wait: DomStabilityResult<boolean>): RecordActionExecutionReason {
  if (wait.status === 'timeout') return 'postcondition-timeout';
  if (wait.status === 'aborted') return 'postcondition-aborted';
  if (wait.status === 'root-disconnected') return 'postcondition-disconnected';
  return 'postcondition-failed';
}

function rejected(reason: RecordActionExecutionReason, clicked: boolean,
  step?: ExecutableRecordActionStep, plannerResult?: RequestHumanRecordPlan): RecordActionExecutionResult {
  return Object.freeze({ status: 'request-human', ...(step ? { step } : {}), reason, clicked,
    ...(plannerResult ? { plannerResult } : {}) });
}

function uncertain(input: RecordActionExecutionInput, step: ExecutableRecordActionStep,
  reason: RecordActionExecutionReason, clicked: boolean): RecordActionExecutionResult {
  return rejected(reason, clicked, step, recordActionResultUncertain(input.plan, input.activeTransaction));
}

/** Executes exactly one add/save click from an issued plan and never retries an uncertain result. */
export async function executeRecordAction(input: RecordActionExecutionInput): Promise<RecordActionExecutionResult> {
  const { plan, capture, semanticTargets, runContext } = input ?? {} as RecordActionExecutionInput;
  if (!plan || !capture || !(runContext instanceof RecordRunContext) || !isIssuedRecordRunCapture(capture)
    || capture.runToken !== runContext.runToken || !isRecordPlanCurrentForSnapshot(plan, capture.snapshot)
    || plan.runToken !== capture.runToken || plan.snapshotToken !== capture.snapshotToken
    || plan.snapshotVersion !== capture.snapshotVersion
    || (plan.nextStep.kind !== 'open-create' && plan.nextStep.kind !== 'save-created')
    || typeof input.observePostcondition !== 'function' || typeof input.rescan !== 'function') {
    return rejected('invalid-execution-input', false);
  }
  const nextStep = plan.nextStep;
  const step = nextStep.kind;
  if ((step === 'open-create' && input.activeTransaction !== undefined)
    || (step === 'save-created'
      && !isRecordTransactionCurrentForPlan(input.activeTransaction, plan, 'save-created'))) {
    return rejected('invalid-execution-input', false, step);
  }
  if (!reserve(capture.snapshot, step)) return rejected('duplicate-step', false, step);

  const action = capture.snapshot.actions.find(candidate => candidate.actionNodeId === nextStep.actionNodeId);
  if (!action || action.action !== (step === 'open-create' ? 'add-record' : 'save-record')
    || action.targetNodeId !== (step === 'open-create' ? plan.recordListNodeId : nextStep.editorRecordNodeId)
    || action.disabled || action.risk !== (step === 'open-create' ? 'reversible' : 'commit')) {
    return uncertain(input, step, 'invalid-execution-input', false);
  }
  const listTarget = targetFor(semanticTargets, plan.recordListNodeId);
  const actionTarget = targetFor(semanticTargets, action.actionNodeId);
  const declaredTarget = targetFor(semanticTargets, action.targetNodeId);
  if (!element(listTarget) || !element(actionTarget) || !element(declaredTarget)) {
    return uncertain(input, step, 'action-target-missing', false);
  }
  if (!matchesIssuedRecordRunTarget(capture, plan.recordListNodeId, listTarget)
    || !matchesIssuedRecordRunTarget(capture, action.actionNodeId, actionTarget)
    || !matchesIssuedRecordRunTarget(capture, action.targetNodeId, declaredTarget)
    || listTarget.ownerDocument !== actionTarget.ownerDocument || listTarget.ownerDocument !== declaredTarget.ownerDocument
    || !composedContains(listTarget, declaredTarget) || !composedContains(declaredTarget, actionTarget)) {
    return uncertain(input, step, 'action-target-replaced', false);
  }
  if (!enabledClickable(actionTarget)) return uncertain(input, step, 'action-not-clickable', false);

  let signal: AbortSignal;
  try {
    signal = runContext.beginStep();
  } catch {
    return uncertain(input, step, 'postcondition-aborted', false);
  }
  let waiter: Promise<DomStabilityResult<boolean>>;
  try {
    waiter = waitForDomStability({
      root: listTarget,
      predicate: input.observePostcondition,
      quietWindowMs: input.quietWindowMs ?? 40,
      timeoutMs: input.timeoutMs ?? 2_000,
      signal,
    });
  } catch {
    runContext.cancelStep();
    return uncertain(input, step, 'postcondition-failed', false);
  }
  try {
    actionTarget.click();
  } catch {
    runContext.cancelStep();
    await waiter;
    return uncertain(input, step, 'action-threw', true);
  }
  const wait = await waiter;
  runContext.cancelStep();
  if (wait.status !== 'stable') return uncertain(input, step, waitReason(wait), true);

  let next: RecordRunCapture | RecordRunCaptureFailure;
  try {
    next = input.rescan();
  } catch {
    return uncertain(input, step, 'postcondition-failed', true);
  }
  if (next.status !== 'ready' || !validAdjacentCapture(input, next, step)) {
    return uncertain(input, step, 'postcondition-mismatch', true);
  }
  const transition = step === 'open-create'
    ? recordAddInvoked(plan)
    : recordSaveInvoked(plan, input.activeTransaction as ActiveRecordTransaction);
  if ('status' in transition) return rejected('transition-rejected', true, step, transition);
  return Object.freeze({ status: 'advanced', step, capture: next, activeTransaction: transition });
}
