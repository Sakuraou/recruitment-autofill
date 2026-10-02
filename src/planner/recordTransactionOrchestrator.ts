import type { RecordEditorBindResult } from './recordEditorBinder';
import {
  planRepeatableRecords,
  isRecordEditorExpansionCurrent,
  type ActiveRecordTransaction,
  type ReadyRecordPlan,
  type RepeatableRecordPlannerInput,
  type RequestHumanRecordPlan,
} from './recordPlanner';
import type { RecordActionExecutionResult } from './recordTransactionExecutor';
import {
  isIssuedRecordRunCapture,
  RecordRunContext,
  type RecordRunCapture,
  type RecordRunCaptureFailure,
} from './recordRunContext';

export type RecordOrchestratorState = 'ready' | 'running' | 'paused' | 'stopped' | 'request-human' | 'complete';
export type RecordOrchestratorStep = ReadyRecordPlan['nextStep']['kind'];

export interface RecordOrchestratorDriver {
  /** Always performs a fresh scan/capture; it must not return a cached capture. */
  capture(): RecordRunCapture | RecordRunCaptureFailure;
  /** Synchronous fresh observation without issuing a new transaction version. */
  validateCapture(capture: RecordRunCapture): boolean;
  plannerInput(capture: RecordRunCapture, active?: ActiveRecordTransaction): RepeatableRecordPlannerInput;
  executeAction(plan: ReadyRecordPlan, capture: RecordRunCapture,
    active?: ActiveRecordTransaction): Promise<RecordActionExecutionResult>;
  bindEditor(plan: ReadyRecordPlan, capture: RecordRunCapture,
    active: ActiveRecordTransaction): Promise<RecordEditorBindResult>;
}

export type RecordOrchestratorResult =
  | Readonly<{ status: 'advanced'; step: RecordOrchestratorStep; snapshotVersion: number }>
  | Readonly<{ status: 'complete'; snapshotVersion: number }>
  | Readonly<{ status: 'paused' | 'stopped' | 'busy'; snapshotVersion: number }>
  | Readonly<{ status: 'request-human'; snapshotVersion: number; reason: string;
    plannerResult?: RequestHumanRecordPlan }>;

function frozen<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

function validAdvance(previous: RecordRunCapture, next: RecordRunCapture, plan: ReadyRecordPlan,
  active: ActiveRecordTransaction): boolean {
  if (!isIssuedRecordRunCapture(next) || next.runToken !== previous.runToken
    || next.snapshotVersion !== previous.snapshotVersion + 1 || next.snapshotToken === previous.snapshotToken
    || next.snapshot.recordListNodeId !== plan.recordListNodeId || next.snapshot.recordType !== plan.recordType) return false;
  if (plan.nextStep.kind === 'open-create') {
    const expected = plan.nextStep.postcondition;
    return active.phase === 'add-invoked' && next.snapshot.editorState === 'creating'
      && Boolean(next.snapshot.editor && next.editorCandidate)
      && next.snapshot.existingRecordCount === expected.expectedExistingRecordCount
      && next.candidates.length === expected.expectedCandidateHandles.length
      && expected.expectedCandidateHandles.every(handle => (
        next.candidates.some(candidate => candidate.candidateHandle === handle)
      ));
  }
  if (plan.nextStep.kind === 'populate-editor') {
    return active.phase === 'fields-verified' && next.snapshot.editorState === 'creating'
      && next.editorCandidate?.editorHandle === active.editorHandle
      && next.profileRevision === active.profileRevision;
  }
  return active.phase === 'save-invoked' && next.snapshot.editorState === 'closed'
    && !next.snapshot.editor && next.snapshot.existingRecordCount === plan.nextStep.postcondition.expectedExistingRecordCount
    && next.profileRevision === active.profileRevision;
}

/**
 * Coordinates one planner capability per call. It never loops over steps, so every DOM mutation is
 * followed by a fresh capture and a new plan before another action can run.
 */
export class RecordTransactionOrchestrator {
  readonly #context: RecordRunContext;
  readonly #driver: RecordOrchestratorDriver;
  #state: RecordOrchestratorState = 'ready';
  #capture?: RecordRunCapture;
  #active?: ActiveRecordTransaction;
  #inFlight = false;
  #generation = 0;

  constructor(context: RecordRunContext, driver: RecordOrchestratorDriver) {
    if (!(context instanceof RecordRunContext) || !driver || typeof driver.validateCapture !== 'function') throw new TypeError('无效的记录事务编排器参数');
    this.#context = context;
    this.#driver = driver;
  }

  get state(): RecordOrchestratorState { return this.#state; }
  get snapshotVersion(): number { return this.#capture?.snapshotVersion ?? 0; }

  pause(): void {
    if (this.#state === 'stopped' || this.#state === 'complete') return;
    this.#context.cancelStep();
    this.#capture = undefined;
    this.#generation++;
    this.#state = 'paused';
  }

  resume(): void {
    if (this.#state !== 'paused') return;
    this.#capture = undefined;
    this.#generation++;
    this.#state = 'ready';
  }

  stop(): void {
    if (this.#state === 'stopped') return;
    this.#context.stop();
    this.#capture = undefined;
    this.#active = undefined;
    this.#generation++;
    this.#state = 'stopped';
  }

  async advance(): Promise<RecordOrchestratorResult> {
    if (this.#state === 'paused') return frozen({ status: 'paused', snapshotVersion: this.snapshotVersion });
    if (this.#state === 'stopped') return frozen({ status: 'stopped', snapshotVersion: this.snapshotVersion });
    if (this.#state === 'complete') return frozen({ status: 'complete', snapshotVersion: this.snapshotVersion });
    if (this.#state === 'request-human') {
      return frozen({ status: 'request-human', snapshotVersion: this.snapshotVersion, reason: 'manual-review-required' });
    }
    if (this.#inFlight) return frozen({ status: 'busy', snapshotVersion: this.snapshotVersion });
    this.#inFlight = true;
    this.#state = 'running';
    const generation = this.#generation;
    try {
      const current = this.#capture ?? this.#driver.capture();
      if (current.status !== 'ready') return this.#requestHuman(current.snapshotVersion, current.reason);
      if (!isIssuedRecordRunCapture(current) || current.runToken !== this.#context.runToken) {
        return this.#requestHuman(current.snapshotVersion, 'capture-rejected');
      }
      this.#capture = current;
      try {
        if (this.#driver.validateCapture(current) !== true) return this.#requestHuman(current.snapshotVersion, 'snapshot-stale');
      } catch { return this.#requestHuman(current.snapshotVersion, 'snapshot-validation-failed'); }
      let input: RepeatableRecordPlannerInput;
      try {
        input = this.#driver.plannerInput(current, this.#active);
      } catch {
        return this.#requestHuman(current.snapshotVersion, 'planner-input-failed');
      }
      if (input.snapshot !== current.snapshot || input.profileRevision !== current.profileRevision
        || input.activeTransaction !== this.#active) {
        return this.#requestHuman(current.snapshotVersion, 'planner-input-mismatch');
      }
      const plan = planRepeatableRecords(input);
      if (plan.status === 'request-human') {
        return this.#requestHuman(current.snapshotVersion, plan.reason, plan);
      }
      if (plan.status === 'complete') {
        this.#active = undefined;
        this.#state = 'complete';
        return frozen({ status: 'complete', snapshotVersion: current.snapshotVersion });
      }

      let result: RecordActionExecutionResult | RecordEditorBindResult;
      try {
        result = plan.nextStep.kind === 'populate-editor'
          ? await this.#driver.bindEditor(plan, current, this.#active as ActiveRecordTransaction)
          : await this.#driver.executeAction(plan, current,
            plan.nextStep.kind === 'save-created' ? this.#active : undefined);
      } catch {
        return this.#requestHuman(current.snapshotVersion, 'step-driver-failed');
      }
      if (generation !== this.#generation) return this.#interruptedResult();
      if (result.status === 'expanded') {
        if (plan.nextStep.kind !== 'populate-editor' || !isIssuedRecordRunCapture(result.capture)
          || result.capture.snapshotVersion !== current.snapshotVersion + 1
          || !isRecordEditorExpansionCurrent(result.activeTransaction, plan, result.capture)) {
          return this.#requestHuman(current.snapshotVersion, 'step-result-mismatch');
        }
        this.#capture = result.capture; this.#active = result.activeTransaction; this.#state = 'ready';
        return frozen({ status: 'advanced', step: 'populate-editor', snapshotVersion: result.capture.snapshotVersion });
      }
      if (result.status === 'request-human') {
        return this.#requestHuman(current.snapshotVersion, result.reason, result.plannerResult);
      }
      if (!validAdvance(current, result.capture, plan, result.activeTransaction)) {
        return this.#requestHuman(current.snapshotVersion, 'step-result-mismatch');
      }
      // A fields-verified receipt is anchored to the fill readback capture. Saving deliberately
      // requires one more adjacent observation so website-side rewrites cannot share that receipt.
      this.#capture = plan.nextStep.kind === 'populate-editor' ? undefined : result.capture;
      this.#active = result.activeTransaction;
      this.#state = 'ready';
      return frozen({ status: 'advanced', step: plan.nextStep.kind,
        snapshotVersion: result.capture.snapshotVersion });
    } finally {
      this.#inFlight = false;
      if (this.#state === 'running') this.#state = 'ready';
    }
  }

  #requestHuman(snapshotVersion: number, reason: string,
    plannerResult?: RequestHumanRecordPlan): RecordOrchestratorResult {
    this.#state = 'request-human';
    return frozen({ status: 'request-human', snapshotVersion, reason,
      ...(plannerResult ? { plannerResult } : {}) });
  }

  #interruptedResult(): RecordOrchestratorResult {
    if (this.#state === 'stopped') return frozen({ status: 'stopped', snapshotVersion: this.snapshotVersion });
    if (this.#state === 'paused') return frozen({ status: 'paused', snapshotVersion: this.snapshotVersion });
    return this.#requestHuman(this.snapshotVersion, 'step-interrupted');
  }
}
