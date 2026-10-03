import type {
  ActionSemanticNode,
  PageSemanticGraph,
  RecordListSemanticNode,
  RecordSemanticNode,
  SemanticActionRisk,
  SemanticSectionRole,
} from '../shared/semanticGraph';
import { semanticGraphProblems } from '../shared/semanticGraphValidation';

export type RepeatableRecordType = Exclude<SemanticSectionRole, 'basic' | 'job-intent' | 'other'>;

export interface ProfileRecordIntent {
  /** Run-local ordinal. It must not contain or encode a profile value. */
  readonly intentIndex: number;
  readonly recordType: RepeatableRecordType;
  /** True only when this record can be verified again after saving. */
  readonly identityReady: boolean;
}

export interface PageRecordCandidate {
  readonly runToken: string;
  readonly snapshotToken: string;
  readonly recordNodeId: string;
  readonly recordListNodeId: string;
  readonly recordType: RepeatableRecordType;
  readonly index: number;
  /** Run-local continuity number maintained without retaining field values or their hashes. */
  readonly candidateHandle: number;
  readonly identityReady: boolean;
}

export interface PageRecordEditorCandidate {
  readonly runToken: string;
  readonly snapshotToken: string;
  readonly recordNodeId: string;
  /** Changes when the editor DOM instance is replaced, cancelled, or reopened. */
  readonly editorHandle: number;
  /** Increments after input/change/reset without retaining field values. */
  readonly editorRevision: number;
}

export type RecordIdentitySignal = 'primary' | 'secondary' | 'start-date' | 'end-date' | 'site-record-id';
export type RecordIdentityVerdict = 'same' | 'different' | 'insufficient';
export type RecordIdentityProvenance = 'rule' | 'site-recipe' | 'human-confirmed';

/** A value-free pairwise comparison produced for exactly one page snapshot. */
export interface RecordIdentityComparison {
  readonly runToken: string;
  readonly snapshotToken: string;
  readonly intentIndex: number;
  readonly recordNodeId: string;
  readonly verdict: RecordIdentityVerdict;
  readonly signals: readonly RecordIdentitySignal[];
  readonly provenance: RecordIdentityProvenance;
}

export type ActiveRecordTransactionPhase =
  | 'add-invoked'
  | 'fields-verified'
  | 'save-invoked';

const TRANSACTION_BRAND: unique symbol = Symbol('issued-record-transaction');

interface ActiveRecordTransactionBase {
  readonly [TRANSACTION_BRAND]: true;
  readonly runToken: string;
  /** Unique per attempted record creation and consumed by the future executor exactly once. */
  readonly transactionToken: string;
  readonly recordListNodeId: string;
  readonly recordType: RepeatableRecordType;
  readonly intentIndex: number;
  readonly baselineExistingRecordCount: number;
  readonly baselineCandidateHandles: readonly number[];
  /** Snapshot from which the preceding step was authorized. */
  readonly sourceSnapshotToken: string;
  readonly sourceSnapshotVersion: number;
}

export type ActiveRecordTransaction =
  | (ActiveRecordTransactionBase & { phase: 'add-invoked'; editorHandle?: never })
  | (ActiveRecordTransactionBase & {
    phase: Exclude<ActiveRecordTransactionPhase, 'add-invoked'>;
    editorHandle: number;
    editorRevision: number;
    profileRevision: number;
  });

export interface RecordAssignment {
  readonly intentIndex: number;
  readonly recordNodeId: string;
  readonly recordListNodeId: string;
  readonly candidateHandle: number;
}

export type RecordPlanCondition =
  | { readonly kind: 'snapshot-current'; readonly runToken: string; readonly snapshotToken: string;
    readonly snapshotVersion: number }
  | { readonly kind: 'record-list-state'; readonly recordListNodeId: string;
    readonly existingRecordCount: number; readonly editorState: 'closed' | 'creating' }
  | { readonly kind: 'action-enabled'; readonly actionNodeId: string }
  | { readonly kind: 'identity-unmatched'; readonly intentIndex: number }
  | { readonly kind: 'transaction-active'; readonly transactionToken: string; readonly intentIndex: number;
    readonly phase: ActiveRecordTransactionPhase };

export type RecordPlanPostcondition =
  | { readonly kind: 'editor-opened'; readonly expectedExistingRecordCount: number;
    readonly expectedEditorState: 'creating'; readonly expectedCandidateHandles: readonly number[] }
  | { readonly kind: 'fields-verified'; readonly transactionToken: string; readonly intentIndex: number;
    readonly editorRecordNodeId: string; readonly editorHandle: number }
  | { readonly kind: 'record-created'; readonly transactionToken: string;
    readonly expectedExistingRecordCount: number; readonly expectedEditorState: 'closed';
    readonly rematchIntentIndex: number; readonly expectedNewCandidateCount: 1 };

export interface OpenCreateRecordStep {
  readonly kind: 'open-create';
  readonly intentIndex: number;
  readonly recordListNodeId: string;
  readonly actionNodeId: string;
  readonly preconditions: readonly RecordPlanCondition[];
  readonly postcondition: Extract<RecordPlanPostcondition, { kind: 'editor-opened' }>;
}

export interface PopulateRecordEditorStep {
  readonly kind: 'populate-editor';
  readonly transactionToken: string;
  readonly intentIndex: number;
  readonly recordListNodeId: string;
  readonly editorRecordNodeId: string;
  readonly editorHandle: number;
  readonly fieldNodeIds: readonly string[];
  /** Verified as present; this step does not authorize clicking it. */
  readonly requiredSaveActionNodeId: string;
  readonly preconditions: readonly RecordPlanCondition[];
  readonly postcondition: Extract<RecordPlanPostcondition, { kind: 'fields-verified' }>;
}

export interface SaveCreatedRecordStep {
  readonly kind: 'save-created';
  readonly transactionToken: string;
  readonly intentIndex: number;
  readonly recordListNodeId: string;
  readonly editorRecordNodeId: string;
  readonly editorHandle: number;
  readonly actionNodeId: string;
  readonly preconditions: readonly RecordPlanCondition[];
  readonly postcondition: Extract<RecordPlanPostcondition, { kind: 'record-created' }>;
}

export type RecordPlanStep = OpenCreateRecordStep | PopulateRecordEditorStep | SaveCreatedRecordStep;

export type RecordPlanHumanReason =
  | 'invalid-planner-input'
  | 'invalid-semantic-graph'
  | 'record-list-unverified'
  | 'ambiguous-record-list'
  | 'invalid-intent-set'
  | 'candidate-topology-mismatch'
  | 'identity-evidence-incomplete'
  | 'identity-evidence-conflict'
  | 'identity-insufficient'
  | 'duplicate-page-record'
  | 'duplicate-intent-identity'
  | 'ambiguous-assignment'
  | 'editor-occupied'
  | 'editor-unverified'
  | 'active-transaction-mismatch'
  | 'record-count-changed'
  | 'add-action-missing'
  | 'add-action-ambiguous'
  | 'save-action-missing'
  | 'save-action-ambiguous'
  | 'action-disabled'
  | 'action-risk-disallowed'
  | 'add-result-uncertain'
  | 'save-result-uncertain'
  | 'editor-expansion-limit';

interface RecordPlanSummary {
  readonly runToken: string;
  readonly snapshotToken: string;
  readonly snapshotVersion: number;
  readonly recordType: RepeatableRecordType;
  readonly recordListNodeId: string;
  readonly assignments: readonly RecordAssignment[];
  readonly pendingIntentIndexes: readonly number[];
  readonly unmatchedRecordNodeIds: readonly string[];
}

export interface ReadyRecordPlan extends RecordPlanSummary {
  readonly status: 'ready';
  readonly nextStep: RecordPlanStep;
}

export interface CompleteRecordPlan extends RecordPlanSummary {
  readonly status: 'complete';
}

export interface RequestHumanRecordPlan {
  readonly status: 'request-human';
  readonly snapshotVersion: number;
  readonly runToken?: string;
  readonly snapshotToken?: string;
  readonly reason: RecordPlanHumanReason;
  readonly intentIndexes: readonly number[];
  readonly nodeIds: readonly string[];
}

export type RepeatableRecordPlan = ReadyRecordPlan | CompleteRecordPlan | RequestHumanRecordPlan;

interface RecordPlannerSummaryNode {
  recordNodeId: string;
  index: number;
}

interface RecordPlannerEditorNode {
  recordNodeId: string;
  state: 'creating' | 'editing' | 'unknown';
  fieldNodeIds: readonly string[];
}

interface RecordPlannerActionNode {
  actionNodeId: string;
  action: 'add-record' | 'save-record';
  targetNodeId: string;
  risk: SemanticActionRisk;
  disabled: boolean;
}

const SNAPSHOT_BRAND: unique symbol = Symbol('validated-record-planner-snapshot');
const validatedSnapshots = new WeakSet<object>();
const issuedPlans = new WeakSet<object>();
const issuedTransactions = new WeakSet<object>();
const consumedPlans = new WeakSet<object>();
const consumedTransactions = new WeakSet<object>();
const issuedFieldReceipts = new WeakSet<object>();
const consumedFieldReceipts = new WeakSet<object>();
const planSnapshots = new WeakMap<object, RecordPlannerSnapshot>();
const snapshotsWithConsumedAdd = new WeakSet<object>();
/** Two additional observations permit three bounded batches, never a new Add or Save. */
export const MAX_RECORD_EDITOR_EXPANSIONS = 2;
const expandedEditors = new WeakMap<object, Readonly<{
  count: number; editorHandle: number; editorRevision: number; profileRevision: number;
  fieldNodeIds: readonly string[]; sourcePlan: ReadyRecordPlan;
}>>();

/** A frozen, value-free projection. It can only be created by createRecordPlannerSnapshot. */
export interface RecordPlannerSnapshot {
  readonly [SNAPSHOT_BRAND]: true;
  readonly runToken: string;
  readonly snapshotToken: string;
  readonly snapshotVersion: number;
  readonly recordType: RepeatableRecordType;
  readonly recordListNodeId: string;
  readonly existingRecordCount: number;
  readonly editorState: 'closed' | 'creating' | 'editing' | 'unknown';
  readonly summaries: readonly RecordPlannerSummaryNode[];
  readonly editor?: RecordPlannerEditorNode;
  readonly actions: readonly RecordPlannerActionNode[];
}

export interface RecordPlannerSnapshotSource {
  runToken: string;
  snapshotToken: string;
  snapshotVersion: number;
  graph: PageSemanticGraph;
  expectedFieldIds: readonly string[];
  recordType: RepeatableRecordType;
  recordListNodeId: string;
}

export type RecordPlannerSnapshotResult =
  | { status: 'ready'; snapshot: RecordPlannerSnapshot }
  | RequestHumanRecordPlan;

export interface RepeatableRecordPlannerInput {
  snapshot: RecordPlannerSnapshot;
  /** Run-local profile revision. It changes whenever source profile facts change. */
  profileRevision: number;
  intents: readonly ProfileRecordIntent[];
  candidates: readonly PageRecordCandidate[];
  editorCandidate?: PageRecordEditorCandidate;
  identityComparisons: readonly RecordIdentityComparison[];
  activeTransaction?: ActiveRecordTransaction;
}

const FIELDS_RECEIPT_BRAND: unique symbol = Symbol('issued-fields-verified-receipt');

export interface FieldsVerifiedReceipt {
  readonly [FIELDS_RECEIPT_BRAND]: true;
  readonly runToken: string;
  readonly transactionToken: string;
  readonly sourcePlanSnapshotToken: string;
  readonly verifiedSnapshotToken: string;
  readonly verifiedSnapshotVersion: number;
  readonly intentIndex: number;
  readonly recordListNodeId: string;
  readonly editorRecordNodeId: string;
  readonly editorHandle: number;
  readonly editorRevision: number;
  readonly profileRevision: number;
  readonly fieldNodeIds: readonly string[];
}

export interface FieldsVerificationCapture {
  readonly runToken: string;
  readonly snapshotToken: string;
  readonly snapshotVersion: number;
  readonly profileRevision: number;
  readonly snapshot: RecordPlannerSnapshot;
  readonly editorCandidate?: PageRecordEditorCandidate;
  readonly editorRevision?: number;
}

export type FieldsVerifiedReceiptResult =
  | { readonly status: 'ready'; readonly receipt: FieldsVerifiedReceipt }
  | RequestHumanRecordPlan;

const repeatableRecordTypes: ReadonlySet<RepeatableRecordType> = new Set([
  'education', 'student-work', 'internship', 'project', 'award', 'publication', 'language', 'skill', 'family',
]);
const identitySignals: ReadonlySet<RecordIdentitySignal> = new Set([
  'primary', 'secondary', 'start-date', 'end-date', 'site-record-id',
]);
const identityProvenance: ReadonlySet<RecordIdentityProvenance> = new Set([
  'rule', 'site-recipe', 'human-confirmed',
]);
const identityVerdicts: ReadonlySet<RecordIdentityVerdict> = new Set(['same', 'different', 'insufficient']);
const transactionPhases: ReadonlySet<ActiveRecordTransactionPhase> = new Set([
  'add-invoked', 'fields-verified', 'save-invoked',
]);
const editorStates = new Set(['closed', 'creating', 'editing', 'unknown']);
const recordStates = new Set(['summary', 'creating', 'editing', 'unknown']);
const semanticNodeKinds = new Set(['page', 'section', 'record-list', 'record', 'field', 'action']);
const semanticSectionRoles = new Set([
  'basic', 'job-intent', 'education', 'student-work', 'internship', 'project', 'award', 'publication',
  'language', 'skill', 'family', 'other',
]);
const semanticEvidence = new Set([
  'legend', 'heading', 'aria-name', 'visible-label', 'add-action', 'edit-action', 'editor-actions', 'repeated-structure',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEMANTIC_NODE_ID_PATTERN = /^(?:page|section|record-list|record|field|action):(\d+)$/u;
const MAX_INTENTS = 100;
const MAX_COMPARISONS = 50_000;
const MAX_RUN_LOCAL_HANDLE = 1_000_000;
const MAX_RUN_LOCAL_REVISION = 1_000_000;
const MAX_SNAPSHOT_VERSION = 1_000_000;
const MAX_SEMANTIC_NODE_ORDINAL = 9_999;

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isRunLocalHandle(value: unknown): value is number {
  return isSafeInteger(value) && value <= MAX_RUN_LOCAL_HANDLE;
}

function isRunLocalRevision(value: unknown): value is number {
  return isSafeInteger(value) && value <= MAX_RUN_LOCAL_REVISION;
}

function isSnapshotVersion(value: unknown): value is number {
  return isSafeInteger(value) && value <= MAX_SNAPSHOT_VERSION;
}

function isSemanticNodeId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = SEMANTIC_NODE_ID_PATTERN.exec(value);
  if (!match) return false;
  const ordinal = Number(match[1]);
  return Number.isSafeInteger(ordinal) && ordinal <= MAX_SEMANTIC_NODE_ORDINAL;
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...new Set([...values].filter(isSafeInteger))].sort((left, right) => left - right);
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function freezePlan<T extends RepeatableRecordPlan>(plan: T, snapshot?: RecordPlannerSnapshot): T {
  const mutable = plan as unknown as Record<string, unknown>;
  if (Array.isArray(mutable.intentIndexes)) mutable.intentIndexes = Object.freeze([...mutable.intentIndexes]);
  if (Array.isArray(mutable.nodeIds)) mutable.nodeIds = Object.freeze([...mutable.nodeIds]);
  if (Array.isArray(mutable.assignments)) {
    mutable.assignments = Object.freeze(mutable.assignments.map(item => Object.freeze({ ...(item as object) })));
  }
  if (Array.isArray(mutable.pendingIntentIndexes)) {
    mutable.pendingIntentIndexes = Object.freeze([...mutable.pendingIntentIndexes]);
  }
  if (Array.isArray(mutable.unmatchedRecordNodeIds)) {
    mutable.unmatchedRecordNodeIds = Object.freeze([...mutable.unmatchedRecordNodeIds]);
  }
  if (mutable.nextStep && typeof mutable.nextStep === 'object') {
    const step = { ...(mutable.nextStep as Record<string, unknown>) };
    if (Array.isArray(step.fieldNodeIds)) step.fieldNodeIds = Object.freeze([...step.fieldNodeIds]);
    if (Array.isArray(step.preconditions)) {
      step.preconditions = Object.freeze(step.preconditions.map(condition => Object.freeze({ ...(condition as object) })));
    }
    if (step.postcondition && typeof step.postcondition === 'object') {
      const postcondition = { ...(step.postcondition as Record<string, unknown>) };
      if (Array.isArray(postcondition.expectedCandidateHandles)) {
        postcondition.expectedCandidateHandles = Object.freeze([...postcondition.expectedCandidateHandles]);
      }
      step.postcondition = Object.freeze(postcondition);
    }
    mutable.nextStep = Object.freeze(step);
  }
  Object.freeze(plan);
  issuedPlans.add(plan);
  if (snapshot) planSnapshots.set(plan, snapshot);
  return plan;
}

function rawRequestHuman(snapshotVersion: number, reason: RecordPlanHumanReason): RequestHumanRecordPlan {
  return freezePlan({ status: 'request-human', snapshotVersion, reason, intentIndexes: [], nodeIds: [] });
}

function snapshotNodeIds(snapshot: RecordPlannerSnapshot): Set<string> {
  return new Set([
    snapshot.recordListNodeId,
    ...snapshot.summaries.map(summary => summary.recordNodeId),
    ...(snapshot.editor ? [snapshot.editor.recordNodeId, ...snapshot.editor.fieldNodeIds] : []),
    ...snapshot.actions.map(action => action.actionNodeId),
  ]);
}

function requestHuman(snapshot: RecordPlannerSnapshot, reason: RecordPlanHumanReason,
  intentIndexes: Iterable<number> = [], nodeIds: Iterable<string> = []): RequestHumanRecordPlan {
  const verifiedIds = snapshotNodeIds(snapshot);
  return freezePlan({
    status: 'request-human',
    runToken: snapshot.runToken,
    snapshotToken: snapshot.snapshotToken,
    snapshotVersion: snapshot.snapshotVersion,
    reason,
    intentIndexes: sortedNumbers(intentIndexes),
    nodeIds: sortedStrings([...nodeIds].filter(nodeId => verifiedIds.has(nodeId))),
  });
}

function isIssuedReadyPlan(plan: unknown): plan is ReadyRecordPlan {
  return Boolean(plan && typeof plan === 'object' && issuedPlans.has(plan)
    && Object.isFrozen(plan) && (plan as ReadyRecordPlan).status === 'ready'
    && Object.isFrozen((plan as ReadyRecordPlan).nextStep));
}

/** Internal executor guard: an issued plan is valid only for the exact snapshot object that produced it. */
export function isRecordPlanCurrentForSnapshot(plan: unknown, snapshot: unknown): plan is ReadyRecordPlan {
  return isIssuedReadyPlan(plan) && !consumedPlans.has(plan) && Boolean(snapshot)
    && validatedSnapshots.has(snapshot as object) && Object.isFrozen(snapshot)
    && planSnapshots.get(plan) === snapshot;
}

/**
 * Permanently closes an add/save capability after a click has an uncertain result. The executor must
 * never retry such a capability because the website may have accepted the first click asynchronously.
 */
export function recordActionResultUncertain(plan: ReadyRecordPlan, active?: ActiveRecordTransaction):
RequestHumanRecordPlan {
  const originSnapshot = plan && typeof plan === 'object' ? planSnapshots.get(plan) : undefined;
  if (!isIssuedReadyPlan(plan) || consumedPlans.has(plan) || !originSnapshot) {
    return rawRequestHuman(0, 'invalid-planner-input');
  }
  if (plan.nextStep.kind === 'open-create') {
    consumedPlans.add(plan);
    snapshotsWithConsumedAdd.add(originSnapshot);
    return requestHuman(originSnapshot, 'add-result-uncertain', [plan.nextStep.intentIndex],
      [plan.nextStep.actionNodeId]);
  }
  if (plan.nextStep.kind === 'save-created' && active?.phase === 'fields-verified'
    && transactionMatchesPlan(active, plan, 'save-created')
    && active.editorHandle === plan.nextStep.editorHandle) {
    consumedPlans.add(plan);
    consumedTransactions.add(active);
    return requestHuman(originSnapshot, 'save-result-uncertain', [plan.nextStep.intentIndex],
      [plan.nextStep.actionNodeId]);
  }
  return rawRequestHuman(plan.snapshotVersion, 'active-transaction-mismatch');
}

function freezeTransaction(transaction: Omit<ActiveRecordTransactionBase, typeof TRANSACTION_BRAND>
  & ({ phase: 'add-invoked'; editorHandle?: never }
    | { phase: 'fields-verified' | 'save-invoked'; editorHandle: number;
      editorRevision: number; profileRevision: number })): ActiveRecordTransaction {
  const result = {
    ...transaction,
    baselineCandidateHandles: Object.freeze([...transaction.baselineCandidateHandles]),
  } as ActiveRecordTransaction;
  Object.defineProperty(result, TRANSACTION_BRAND, { value: true, enumerable: false, writable: false });
  Object.freeze(result);
  issuedTransactions.add(result);
  return result;
}

function newTransactionToken(plan: ReadyRecordPlan): string | undefined {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = globalThis.crypto?.randomUUID?.();
    if (isToken(token) && token !== plan.runToken && token !== plan.snapshotToken) return token;
  }
  return undefined;
}

/**
 * Creates the only valid add-invoked capability from an issued open-create plan.
 * The future executor calls this only after it has consumed the plan and clicked add.
 */
export function recordAddInvoked(plan: ReadyRecordPlan): ActiveRecordTransaction | RequestHumanRecordPlan {
  const originSnapshot = plan && typeof plan === 'object' ? planSnapshots.get(plan) : undefined;
  if (!isIssuedReadyPlan(plan) || consumedPlans.has(plan) || !originSnapshot
    || snapshotsWithConsumedAdd.has(originSnapshot) || plan.nextStep.kind !== 'open-create') {
    return rawRequestHuman(0, 'invalid-planner-input');
  }
  const token = newTransactionToken(plan);
  if (!token) return rawRequestHuman(plan.snapshotVersion, 'invalid-planner-input');
  const transaction = freezeTransaction({
    runToken: plan.runToken,
    transactionToken: token,
    recordListNodeId: plan.recordListNodeId,
    recordType: plan.recordType,
    intentIndex: plan.nextStep.intentIndex,
    baselineExistingRecordCount: plan.nextStep.postcondition.expectedExistingRecordCount,
    baselineCandidateHandles: plan.nextStep.postcondition.expectedCandidateHandles,
    sourceSnapshotToken: plan.snapshotToken,
    sourceSnapshotVersion: plan.snapshotVersion,
    phase: 'add-invoked',
  });
  consumedPlans.add(plan);
  snapshotsWithConsumedAdd.add(originSnapshot);
  return transaction;
}

function transactionMatchesPlan(active: ActiveRecordTransaction, plan: ReadyRecordPlan,
  expectedStep: 'populate-editor' | 'save-created'): boolean {
  if (!issuedTransactions.has(active) || consumedTransactions.has(active) || consumedPlans.has(plan)
    || !Object.isFrozen(active) || plan.nextStep.kind !== expectedStep) return false;
  const step = plan.nextStep;
  const expanded = expandedEditors.get(active);
  if (expanded && (step.editorHandle !== expanded.editorHandle
    || expectedStep !== 'populate-editor' || step.kind !== 'populate-editor'
    || !sameStringSet(step.fieldNodeIds, expanded.fieldNodeIds))) return false;
  return active.runToken === plan.runToken && active.recordType === plan.recordType
    && active.recordListNodeId === plan.recordListNodeId && active.intentIndex === step.intentIndex
    && active.transactionToken === step.transactionToken && active.sourceSnapshotVersion < plan.snapshotVersion;
}

/** Internal executor guard used before any save click is allowed to escape. */
export function isRecordTransactionCurrentForPlan(active: unknown, plan: unknown,
  expectedStep: 'populate-editor' | 'save-created'): active is ActiveRecordTransaction {
  if (!isIssuedReadyPlan(plan) || !active || typeof active !== 'object'
    || !transactionMatchesPlan(active as ActiveRecordTransaction, plan, expectedStep)) return false;
  if (expectedStep === 'save-created') {
    return plan.nextStep.kind === 'save-created'
      && (active as ActiveRecordTransaction).phase === 'fields-verified'
      && (active as ActiveRecordTransaction).editorHandle === plan.nextStep.editorHandle;
  }
  return plan.nextStep.kind === 'populate-editor';
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length
    && left.every(item => right.includes(item));
}

function thenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Issues a value-free receipt only after a trusted executor synchronously reads back every field.
 * The callback result is consumed immediately and never retained.
 */
export function issueFieldsVerifiedReceipt(plan: ReadyRecordPlan, active: ActiveRecordTransaction,
  capture: FieldsVerificationCapture, verifyField: (fieldNodeId: string) => boolean): FieldsVerifiedReceiptResult {
  const snapshot = capture?.snapshot;
  const candidate = capture?.editorCandidate;
  if (!isIssuedReadyPlan(plan) || plan.nextStep.kind !== 'populate-editor'
    || active?.phase !== 'add-invoked' || !transactionMatchesPlan(active, plan, 'populate-editor')
    || !snapshot || !validatedSnapshots.has(snapshot) || !Object.isFrozen(snapshot)
    || capture.runToken !== plan.runToken || capture.snapshotToken !== snapshot.snapshotToken
    || capture.snapshotVersion !== snapshot.snapshotVersion || snapshot.runToken !== plan.runToken
    || capture.snapshotToken === plan.snapshotToken || capture.snapshotVersion !== plan.snapshotVersion + 1
    || snapshot.recordType !== plan.recordType || snapshot.recordListNodeId !== plan.recordListNodeId
    || snapshot.editorState !== 'creating' || !snapshot.editor || !candidate
    || candidate.runToken !== capture.runToken || candidate.snapshotToken !== capture.snapshotToken
    || candidate.recordNodeId !== snapshot.editor.recordNodeId
    || snapshot.editor.recordNodeId !== plan.nextStep.editorRecordNodeId
    || candidate.editorHandle !== plan.nextStep.editorHandle
    || candidate.editorRevision !== capture.editorRevision
    || !isRunLocalRevision(candidate.editorRevision) || !isRunLocalRevision(capture.profileRevision)
    || !sameStringSet(snapshot.editor.fieldNodeIds, plan.nextStep.fieldNodeIds)
    || typeof verifyField !== 'function') {
    return rawRequestHuman(isSnapshotVersion(capture?.snapshotVersion) ? capture.snapshotVersion : 0,
      'active-transaction-mismatch');
  }
  for (const fieldNodeId of plan.nextStep.fieldNodeIds) {
    let verified: unknown;
    try {
      verified = verifyField(fieldNodeId);
      if (thenable(verified)) void Promise.resolve(verified).catch(() => undefined);
    } catch {
      return requestHuman(snapshot, 'editor-unverified', [active.intentIndex], [fieldNodeId]);
    }
    if (verified !== true) {
      return requestHuman(snapshot, 'editor-unverified', [active.intentIndex], [fieldNodeId]);
    }
  }
  const receipt = {
    runToken: plan.runToken,
    transactionToken: active.transactionToken,
    sourcePlanSnapshotToken: plan.snapshotToken,
    verifiedSnapshotToken: capture.snapshotToken,
    verifiedSnapshotVersion: capture.snapshotVersion,
    intentIndex: active.intentIndex,
    recordListNodeId: plan.recordListNodeId,
    editorRecordNodeId: plan.nextStep.editorRecordNodeId,
    editorHandle: candidate.editorHandle,
    editorRevision: candidate.editorRevision,
    profileRevision: capture.profileRevision,
    fieldNodeIds: Object.freeze([...plan.nextStep.fieldNodeIds]),
  } as FieldsVerifiedReceipt;
  Object.defineProperty(receipt, FIELDS_RECEIPT_BRAND, { value: true, enumerable: false, writable: false });
  Object.freeze(receipt);
  issuedFieldReceipts.add(receipt);
  return Object.freeze({ status: 'ready', receipt });
}

export function recordFieldsVerified(plan: ReadyRecordPlan, active: ActiveRecordTransaction,
  receipt: FieldsVerifiedReceipt):
  ActiveRecordTransaction | RequestHumanRecordPlan {
  if (!isIssuedReadyPlan(plan) || plan.nextStep.kind !== 'populate-editor'
    || active?.phase !== 'add-invoked' || !transactionMatchesPlan(active, plan, 'populate-editor')
    || !receipt || !issuedFieldReceipts.has(receipt) || consumedFieldReceipts.has(receipt)
    || !Object.isFrozen(receipt) || receipt[FIELDS_RECEIPT_BRAND] !== true
    || receipt.runToken !== plan.runToken || receipt.transactionToken !== active.transactionToken
    || receipt.sourcePlanSnapshotToken !== plan.snapshotToken || receipt.intentIndex !== active.intentIndex
    || receipt.recordListNodeId !== plan.recordListNodeId
    || receipt.editorRecordNodeId !== plan.nextStep.editorRecordNodeId
    || receipt.editorHandle !== plan.nextStep.editorHandle
    || !sameStringSet(receipt.fieldNodeIds, plan.nextStep.fieldNodeIds)) {
    return rawRequestHuman(isIssuedReadyPlan(plan) ? plan.snapshotVersion : 0, 'active-transaction-mismatch');
  }
  const transaction = freezeTransaction({
    runToken: active.runToken,
    transactionToken: active.transactionToken,
    recordListNodeId: active.recordListNodeId,
    recordType: active.recordType,
    intentIndex: active.intentIndex,
    baselineExistingRecordCount: active.baselineExistingRecordCount,
    baselineCandidateHandles: active.baselineCandidateHandles,
    sourceSnapshotToken: receipt.verifiedSnapshotToken,
    sourceSnapshotVersion: receipt.verifiedSnapshotVersion,
    phase: 'fields-verified',
    editorHandle: receipt.editorHandle,
    editorRevision: receipt.editorRevision,
    profileRevision: receipt.profileRevision,
  });
  consumedPlans.add(plan);
  consumedTransactions.add(active);
  consumedFieldReceipts.add(receipt);
  return transaction;
}

/**
 * A trusted binder may replan an expanded draft after reading back EVERY original field.
 * This consumes the old capability and keeps the same record in add-invoked phase.
 * It does not verify the new fields, permit saving, or permit another Add.
 * DOM continuity and current values must be checked synchronously by the caller.
 */
export function recordEditorExpanded(plan: ReadyRecordPlan, active: ActiveRecordTransaction,
  previous: FieldsVerificationCapture, next: FieldsVerificationCapture,
  verifyOriginalField: (fieldNodeId: string) => boolean): ActiveRecordTransaction | RequestHumanRecordPlan {
  const reject = (reason: RecordPlanHumanReason = 'editor-unverified') => rawRequestHuman(
    isSnapshotVersion(next?.snapshotVersion) ? next.snapshotVersion : 0, reason);
  if (!isIssuedReadyPlan(plan) || plan.nextStep.kind !== 'populate-editor' || !['project', 'education', 'internship'].includes(plan.recordType)
    || active?.phase !== 'add-invoked' || !transactionMatchesPlan(active, plan, 'populate-editor')
    || !previous || !next || !isRecordPlanCurrentForSnapshot(plan, previous.snapshot)
    || previous.snapshotVersion !== plan.snapshotVersion || previous.snapshotToken !== plan.snapshotToken
    || previous.runToken !== plan.runToken || previous.snapshot.snapshotToken !== previous.snapshotToken
    || !validatedSnapshots.has(next.snapshot) || !Object.isFrozen(next.snapshot)
    || next.runToken !== plan.runToken || next.snapshot.runToken !== plan.runToken
    || next.snapshotToken !== next.snapshot.snapshotToken || next.snapshotToken === plan.snapshotToken
    || next.snapshotVersion !== next.snapshot.snapshotVersion || next.snapshotVersion !== plan.snapshotVersion + 1
    || !isRunLocalRevision(previous.profileRevision) || next.profileRevision !== previous.profileRevision
    || next.snapshot.recordType !== plan.recordType || next.snapshot.recordListNodeId !== plan.recordListNodeId
    || next.snapshot.editorState !== 'creating' || !next.snapshot.editor || !next.editorCandidate
    || next.snapshot.editor.recordNodeId !== plan.nextStep.editorRecordNodeId
    || next.editorCandidate.recordNodeId !== plan.nextStep.editorRecordNodeId
    || next.editorCandidate.runToken !== next.runToken || next.editorCandidate.snapshotToken !== next.snapshotToken
    || next.editorCandidate.editorHandle !== plan.nextStep.editorHandle
    || !isRunLocalRevision(next.editorRevision) || next.editorCandidate.editorRevision !== next.editorRevision
    || next.snapshot.existingRecordCount !== previous.snapshot.existingRecordCount
    || next.snapshot.existingRecordCount !== active.baselineExistingRecordCount
    || JSON.stringify(next.snapshot.summaries) !== JSON.stringify(previous.snapshot.summaries)
    || JSON.stringify(next.snapshot.actions) !== JSON.stringify(previous.snapshot.actions)
    || next.snapshot.editor.fieldNodeIds.length <= plan.nextStep.fieldNodeIds.length
    || !plan.nextStep.fieldNodeIds.every(id => next.snapshot.editor!.fieldNodeIds.includes(id))
    || typeof verifyOriginalField !== 'function') return reject();
  const count = (expandedEditors.get(active)?.count ?? 0) + 1;
  if (count > MAX_RECORD_EDITOR_EXPANSIONS) return reject('editor-expansion-limit');
  for (const id of plan.nextStep.fieldNodeIds) {
    let checked: unknown;
    try { checked = verifyOriginalField(id); if (thenable(checked)) void Promise.resolve(checked).catch(() => undefined); }
    catch { return reject(); }
    if (checked !== true) return reject();
  }
  const transaction = freezeTransaction({
    runToken: active.runToken, transactionToken: active.transactionToken,
    recordListNodeId: active.recordListNodeId, recordType: active.recordType, intentIndex: active.intentIndex,
    baselineExistingRecordCount: active.baselineExistingRecordCount,
    baselineCandidateHandles: active.baselineCandidateHandles,
    sourceSnapshotToken: plan.snapshotToken, sourceSnapshotVersion: plan.snapshotVersion, phase: 'add-invoked',
  });
  expandedEditors.set(transaction, Object.freeze({ count, editorHandle: next.editorCandidate.editorHandle,
    editorRevision: next.editorRevision, profileRevision: next.profileRevision,
    fieldNodeIds: Object.freeze([...next.snapshot.editor.fieldNodeIds]), sourcePlan: plan }));
  consumedPlans.add(plan); consumedTransactions.add(active);
  return transaction;
}

/** Value-free evidence for the orchestrator; cloned results cannot bypass the expansion transition. */
export function isRecordEditorExpansionCurrent(active: ActiveRecordTransaction, plan: ReadyRecordPlan,
  capture: FieldsVerificationCapture): boolean {
  const anchor = active && expandedEditors.get(active);
  return Boolean(anchor && anchor.sourcePlan === plan && issuedTransactions.has(active)
    && !consumedTransactions.has(active) && consumedPlans.has(plan) && active.phase === 'add-invoked'
    && validatedSnapshots.has(capture.snapshot) && capture.snapshotVersion === active.sourceSnapshotVersion + 1
    && capture.runToken === active.runToken && capture.snapshot.recordListNodeId === active.recordListNodeId
    && capture.snapshot.editorState === 'creating' && capture.snapshot.editor
    && capture.editorCandidate?.editorHandle === anchor.editorHandle
    && capture.editorRevision === anchor.editorRevision && capture.profileRevision === anchor.profileRevision
    && sameStringSet(capture.snapshot.editor.fieldNodeIds, anchor.fieldNodeIds));
}

/** Called only after the executor has consumed the issued save-created plan once. */
export function recordSaveInvoked(plan: ReadyRecordPlan, active: ActiveRecordTransaction):
  ActiveRecordTransaction | RequestHumanRecordPlan {
  if (!isIssuedReadyPlan(plan) || plan.nextStep.kind !== 'save-created'
    || active?.phase !== 'fields-verified' || !transactionMatchesPlan(active, plan, 'save-created')
    || active.editorHandle !== plan.nextStep.editorHandle) {
    return rawRequestHuman(isIssuedReadyPlan(plan) ? plan.snapshotVersion : 0, 'active-transaction-mismatch');
  }
  const transaction = freezeTransaction({
    runToken: active.runToken,
    transactionToken: active.transactionToken,
    recordListNodeId: active.recordListNodeId,
    recordType: active.recordType,
    intentIndex: active.intentIndex,
    baselineExistingRecordCount: active.baselineExistingRecordCount,
    baselineCandidateHandles: active.baselineCandidateHandles,
    sourceSnapshotToken: plan.snapshotToken,
    sourceSnapshotVersion: plan.snapshotVersion,
    phase: 'save-invoked',
    editorHandle: active.editorHandle,
    editorRevision: active.editorRevision,
    profileRevision: active.profileRevision,
  });
  consumedPlans.add(plan);
  consumedTransactions.add(active);
  return transaction;
}

function graphSummaryRecords(graph: PageSemanticGraph, list: RecordListSemanticNode): RecordSemanticNode[] {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  return list.childIds.map(id => byId.get(id))
    .filter((node): node is RecordSemanticNode => node?.kind === 'record' && node.state === 'summary')
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
}

function graphEditor(graph: PageSemanticGraph, list: RecordListSemanticNode): RecordSemanticNode | undefined {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  return list.childIds.map(id => byId.get(id))
    .find((node): node is RecordSemanticNode => node?.kind === 'record' && node.state !== 'summary');
}

function runtimeGraphStateIsValid(graph: PageSemanticGraph): boolean {
  return graph.nodes.every((node) => {
    if (!isSemanticNodeId(node.id) || !semanticNodeKinds.has(node.kind)
      || !Array.isArray(node.evidence) || node.evidence.some(evidence => !semanticEvidence.has(evidence))
      || (node.bounds !== undefined && (!node.bounds || typeof node.bounds !== 'object'
        || !['viewport', 'frame-viewport'].includes(node.bounds.coordinateSpace)))) return false;
    if (node.kind === 'section') return semanticSectionRoles.has(node.role);
    if (node.kind === 'record-list') {
      return editorStates.has(node.editorState) && repeatableRecordTypes.has(node.recordType as RepeatableRecordType);
    }
    if (node.kind === 'record') return recordStates.has(node.state);
    if (node.kind === 'action') {
      return typeof node.disabled === 'boolean'
        && ['inspect', 'reversible', 'commit', 'restricted'].includes(node.risk)
        && ['add-record', 'edit-record', 'save-record', 'cancel-record', 'expand', 'select-tab', 'next-step',
          'submit', 'delete-record', 'withdraw', 'upload', 'unknown'].includes(node.action);
    }
    return true;
  });
}

function freezeSnapshot(snapshot: Omit<RecordPlannerSnapshot, typeof SNAPSHOT_BRAND>): RecordPlannerSnapshot {
  const summaries = Object.freeze(snapshot.summaries.map(summary => Object.freeze({ ...summary })));
  const editor = snapshot.editor ? Object.freeze({
    ...snapshot.editor,
    fieldNodeIds: Object.freeze([...snapshot.editor.fieldNodeIds]),
  }) : undefined;
  const actions = Object.freeze(snapshot.actions.map(action => Object.freeze({ ...action })));
  const result = { ...snapshot, summaries, editor, actions } as RecordPlannerSnapshot;
  Object.defineProperty(result, SNAPSHOT_BRAND, { value: true, enumerable: false, writable: false });
  Object.freeze(result);
  validatedSnapshots.add(result);
  return result;
}

/** Validates and strips a semantic graph before it reaches the planner. */
export function createRecordPlannerSnapshot(source: RecordPlannerSnapshotSource): RecordPlannerSnapshotResult {
  if (!source || typeof source !== 'object' || !isSnapshotVersion(source.snapshotVersion)
    || !isToken(source.runToken) || !isToken(source.snapshotToken)
    || source.runToken === source.snapshotToken || !repeatableRecordTypes.has(source.recordType)) {
    const version = source && typeof source === 'object' && isSnapshotVersion(source.snapshotVersion)
      ? source.snapshotVersion : 0;
    return rawRequestHuman(version, 'invalid-planner-input');
  }
  let problems;
  try {
    problems = semanticGraphProblems(source.graph, source.expectedFieldIds);
  } catch {
    return rawRequestHuman(source.snapshotVersion, 'invalid-semantic-graph');
  }
  let runtimeValid = false;
  try {
    runtimeValid = runtimeGraphStateIsValid(source.graph);
  } catch {
    return rawRequestHuman(source.snapshotVersion, 'invalid-semantic-graph');
  }
  if (problems.length > 0 || !runtimeValid) {
    return rawRequestHuman(source.snapshotVersion, 'invalid-semantic-graph');
  }
  const lists = source.graph.nodes.filter((node): node is RecordListSemanticNode => node.kind === 'record-list'
    && node.recordType === source.recordType);
  if (lists.length > 1) return rawRequestHuman(source.snapshotVersion, 'ambiguous-record-list');
  const list = lists.find(node => node.id === source.recordListNodeId);
  if (!list) return rawRequestHuman(source.snapshotVersion, 'record-list-unverified');

  const summaries = graphSummaryRecords(source.graph, list).map(record => ({ recordNodeId: record.id, index: record.index }));
  const editorRecord = graphEditor(source.graph, list);
  const byId = new Map(source.graph.nodes.map(node => [node.id, node]));
  const editor = editorRecord ? {
    recordNodeId: editorRecord.id,
    state: editorRecord.state as RecordPlannerEditorNode['state'],
    fieldNodeIds: editorRecord.childIds.map(id => byId.get(id))
      .filter(node => node?.kind === 'field')
      .sort((left, right) => left!.order - right!.order || left!.id.localeCompare(right!.id))
      .map(node => node!.id),
  } : undefined;
  const relevantTargets = new Set([list.id, ...(editor ? [editor.recordNodeId] : [])]);
  const actions = source.graph.nodes.filter((node): node is ActionSemanticNode => node.kind === 'action'
      && (node.action === 'add-record' || node.action === 'save-record')
      && 'targetId' in node && relevantTargets.has(node.targetId))
    .map((node): RecordPlannerActionNode => ({
      actionNodeId: node.id,
      action: node.action as 'add-record' | 'save-record',
      targetNodeId: node.targetId!,
      risk: node.risk,
      disabled: node.disabled,
    }))
    .sort((left, right) => left.actionNodeId.localeCompare(right.actionNodeId));

  return {
    status: 'ready',
    snapshot: freezeSnapshot({
      runToken: source.runToken,
      snapshotToken: source.snapshotToken,
      snapshotVersion: source.snapshotVersion,
      recordType: source.recordType,
      recordListNodeId: list.id,
      existingRecordCount: list.existingRecordCount,
      editorState: list.editorState,
      summaries,
      editor,
      actions,
    }),
  };
}

function comparisonIsStrong(comparison: RecordIdentityComparison): boolean {
  if (!identityVerdicts.has(comparison.verdict) || !Array.isArray(comparison.signals)) return false;
  const signals = new Set(comparison.signals);
  if (signals.size === 0 || [...signals].some(signal => !identitySignals.has(signal))) return false;
  if (!identityProvenance.has(comparison.provenance)) return false;
  if (comparison.verdict === 'insufficient') return false;
  if (comparison.verdict === 'different') return true;
  if (comparison.provenance === 'human-confirmed' || signals.has('site-record-id')) return true;
  return signals.has('primary') && [...signals].some(signal => signal !== 'primary');
}

function validateIntents(input: RepeatableRecordPlannerInput): RequestHumanRecordPlan | undefined {
  const { snapshot } = input;
  if (!Array.isArray(input.intents) || input.intents.length > MAX_INTENTS) {
    return requestHuman(snapshot, 'invalid-intent-set');
  }
  const indexes = new Set<number>();
  for (const intent of input.intents) {
    if (!intent || typeof intent !== 'object' || !isSafeInteger(intent.intentIndex) || indexes.has(intent.intentIndex)
      || intent.recordType !== snapshot.recordType || typeof intent.identityReady !== 'boolean') {
      const index = intent && typeof intent === 'object' ? intent.intentIndex : -1;
      return requestHuman(snapshot, 'invalid-intent-set', [index]);
    }
    indexes.add(intent.intentIndex);
  }
  if (indexes.size !== input.intents.length
    || input.intents.some((_, index) => !indexes.has(index))) {
    return requestHuman(snapshot, 'invalid-intent-set');
  }
  const withoutIdentity = input.intents.filter(intent => intent.identityReady !== true).map(intent => intent.intentIndex);
  return withoutIdentity.length > 0 ? requestHuman(snapshot, 'identity-insufficient', withoutIdentity) : undefined;
}

function validateCandidates(input: RepeatableRecordPlannerInput): RequestHumanRecordPlan | undefined {
  const { snapshot } = input;
  if (!Array.isArray(input.candidates) || input.candidates.length !== snapshot.existingRecordCount
    || input.candidates.length !== snapshot.summaries.length || input.candidates.length > 500) {
    return requestHuman(snapshot, 'candidate-topology-mismatch');
  }
  const summariesById = new Map(snapshot.summaries.map(summary => [summary.recordNodeId, summary]));
  const seenNodes = new Set<string>();
  const seenHandles = new Set<number>();
  for (const candidate of input.candidates) {
    if (!candidate || typeof candidate !== 'object') {
      return requestHuman(snapshot, 'candidate-topology-mismatch');
    }
    const summary = summariesById.get(candidate.recordNodeId);
    if (!summary || seenNodes.has(candidate.recordNodeId) || seenHandles.has(candidate.candidateHandle)
      || candidate.runToken !== snapshot.runToken || candidate.snapshotToken !== snapshot.snapshotToken
      || candidate.recordListNodeId !== snapshot.recordListNodeId || candidate.recordType !== snapshot.recordType
      || candidate.index !== summary.index || !isRunLocalHandle(candidate.candidateHandle)
      || typeof candidate.identityReady !== 'boolean') {
      return requestHuman(snapshot, 'candidate-topology-mismatch');
    }
    seenNodes.add(candidate.recordNodeId);
    seenHandles.add(candidate.candidateHandle);
  }
  if (seenNodes.size !== summariesById.size || snapshot.summaries.some(summary => !seenNodes.has(summary.recordNodeId))) {
    return requestHuman(snapshot, 'candidate-topology-mismatch');
  }
  if (input.intents.length === 0) return undefined;
  const withoutIdentity = input.candidates.filter(candidate => candidate.identityReady !== true)
    .map(candidate => candidate.recordNodeId);
  return withoutIdentity.length > 0 ? requestHuman(snapshot, 'identity-insufficient', [], withoutIdentity) : undefined;
}

function validateEditorCandidate(input: RepeatableRecordPlannerInput):
  PageRecordEditorCandidate | RequestHumanRecordPlan | undefined {
  const { snapshot } = input;
  if (snapshot.editorState !== 'creating') return undefined;
  const candidate = input.editorCandidate;
  if (!snapshot.editor || !candidate || typeof candidate !== 'object' || candidate.runToken !== snapshot.runToken
    || candidate.snapshotToken !== snapshot.snapshotToken || candidate.recordNodeId !== snapshot.editor.recordNodeId
    || !isRunLocalHandle(candidate.editorHandle) || !isRunLocalRevision(candidate.editorRevision)) {
    return requestHuman(snapshot, 'editor-unverified', [], snapshot.editor ? [snapshot.editor.recordNodeId] : []);
  }
  return candidate;
}

interface AssignmentResult {
  assignments: RecordAssignment[];
  pendingIntentIndexes: number[];
  unmatchedRecordNodeIds: string[];
}

function assignRecords(input: RepeatableRecordPlannerInput): AssignmentResult | RequestHumanRecordPlan {
  const { snapshot } = input;
  if (!Array.isArray(input.identityComparisons) || input.identityComparisons.length > MAX_COMPARISONS) {
    return requestHuman(snapshot, 'identity-evidence-incomplete');
  }
  const intentIndexes = new Set(input.intents.map(intent => intent.intentIndex));
  const candidateIds = new Set(input.candidates.map(candidate => candidate.recordNodeId));
  const matrix = new Map<string, RecordIdentityComparison>();
  for (const comparison of input.identityComparisons) {
    if (!comparison || typeof comparison !== 'object') {
      return requestHuman(snapshot, 'identity-evidence-incomplete');
    }
    const key = `${comparison.intentIndex}\u0000${comparison.recordNodeId}`;
    if (matrix.has(key)) {
      return requestHuman(snapshot, 'identity-evidence-conflict', [comparison.intentIndex], [comparison.recordNodeId]);
    }
    if (comparison.runToken !== snapshot.runToken || comparison.snapshotToken !== snapshot.snapshotToken
      || !intentIndexes.has(comparison.intentIndex) || !candidateIds.has(comparison.recordNodeId)) {
      return requestHuman(snapshot, 'identity-evidence-incomplete');
    }
    matrix.set(key, comparison);
  }
  if (matrix.size !== input.intents.length * input.candidates.length) {
    return requestHuman(snapshot, 'identity-evidence-incomplete');
  }

  const insufficientIntents = new Set<number>();
  const insufficientNodes = new Set<string>();
  for (const comparison of matrix.values()) {
    if (!comparisonIsStrong(comparison)) {
      insufficientIntents.add(comparison.intentIndex);
      insufficientNodes.add(comparison.recordNodeId);
    }
  }
  if (insufficientIntents.size > 0 || insufficientNodes.size > 0) {
    return requestHuman(snapshot, 'identity-insufficient', insufficientIntents, insufficientNodes);
  }

  const sameByIntent = new Map<number, string[]>();
  const sameByCandidate = new Map<string, number[]>();
  for (const comparison of matrix.values()) {
    if (comparison.verdict !== 'same') continue;
    const ids = sameByIntent.get(comparison.intentIndex) ?? [];
    ids.push(comparison.recordNodeId);
    sameByIntent.set(comparison.intentIndex, ids);
    const indexes = sameByCandidate.get(comparison.recordNodeId) ?? [];
    indexes.push(comparison.intentIndex);
    sameByCandidate.set(comparison.recordNodeId, indexes);
  }
  const duplicateRows = [...sameByIntent.entries()].filter(([, ids]) => ids.length > 1);
  const duplicateColumns = [...sameByCandidate.entries()].filter(([, indexes]) => indexes.length > 1);
  if (duplicateRows.length > 0 && duplicateColumns.length > 0) {
    return requestHuman(snapshot, 'ambiguous-assignment',
      [
        ...duplicateRows.map(([intentIndex]) => intentIndex),
        ...duplicateColumns.flatMap(([, indexes]) => indexes),
      ], [
        ...duplicateRows.flatMap(([, ids]) => ids),
        ...duplicateColumns.map(([nodeId]) => nodeId),
      ]);
  }
  if (duplicateRows.length > 0) {
    return requestHuman(snapshot, 'duplicate-page-record', duplicateRows.map(([index]) => index),
      duplicateRows.flatMap(([, ids]) => ids));
  }
  if (duplicateColumns.length > 0) {
    return requestHuman(snapshot, 'duplicate-intent-identity', duplicateColumns.flatMap(([, indexes]) => indexes),
      duplicateColumns.map(([nodeId]) => nodeId));
  }

  const candidateByNode = new Map(input.candidates.map(candidate => [candidate.recordNodeId, candidate]));
  const assignments = [...sameByIntent.entries()].map(([intentIndex, ids]): RecordAssignment => ({
    intentIndex,
    recordNodeId: ids[0]!,
    recordListNodeId: snapshot.recordListNodeId,
    candidateHandle: candidateByNode.get(ids[0]!)!.candidateHandle,
  })).sort((left, right) => left.intentIndex - right.intentIndex);
  const assignedIntents = new Set(assignments.map(assignment => assignment.intentIndex));
  const assignedCandidates = new Set(assignments.map(assignment => assignment.recordNodeId));
  return {
    assignments,
    pendingIntentIndexes: input.intents.map(intent => intent.intentIndex)
      .filter(index => !assignedIntents.has(index)).sort((left, right) => left - right),
    unmatchedRecordNodeIds: input.candidates.filter(candidate => !assignedCandidates.has(candidate.recordNodeId))
      .sort((left, right) => left.index - right.index || left.recordNodeId.localeCompare(right.recordNodeId))
      .map(candidate => candidate.recordNodeId),
  };
}

function validateActiveTransaction(input: RepeatableRecordPlannerInput,
  active: ActiveRecordTransaction): RequestHumanRecordPlan | undefined {
  const { snapshot } = input;
  const intent = input.intents.find(item => item.intentIndex === active.intentIndex);
  const handles = active.baselineCandidateHandles;
  const expanded = expandedEditors.get(active);
  if (expanded && (snapshot.editorState !== 'creating'
    || input.editorCandidate?.editorHandle !== expanded.editorHandle
    || input.editorCandidate.editorRevision !== expanded.editorRevision
    || input.profileRevision !== expanded.profileRevision || !snapshot.editor
    || !sameStringSet(snapshot.editor.fieldNodeIds, expanded.fieldNodeIds))) {
    return requestHuman(snapshot, 'active-transaction-mismatch', [active.intentIndex]);
  }
  const editorHandleValid = active.phase === 'add-invoked'
    ? active.editorHandle === undefined
    : isRunLocalHandle(active.editorHandle) && isRunLocalRevision(active.editorRevision)
      && isRunLocalRevision(active.profileRevision);
  const revisionsMatch = active.phase === 'add-invoked' || (
    active.profileRevision === input.profileRevision
    && (snapshot.editorState !== 'creating' || active.editorRevision === input.editorCandidate?.editorRevision)
  );
  if (!issuedTransactions.has(active) || consumedTransactions.has(active)
    || active[TRANSACTION_BRAND] !== true || !Object.isFrozen(active)
    || !Object.isFrozen(handles) || !intent || active.runToken !== snapshot.runToken || !isToken(active.transactionToken)
    || active.recordListNodeId !== snapshot.recordListNodeId || active.recordType !== snapshot.recordType
    || !isSafeInteger(active.baselineExistingRecordCount) || active.baselineExistingRecordCount > 500
    || !Array.isArray(handles) || handles.length !== active.baselineExistingRecordCount
    || handles.some(handle => !isRunLocalHandle(handle))
    || new Set(handles).size !== handles.length || !transactionPhases.has(active.phase)
    || !isToken(active.sourceSnapshotToken) || active.sourceSnapshotToken === snapshot.snapshotToken
    || active.sourceSnapshotToken === snapshot.runToken || active.transactionToken === snapshot.runToken
    || active.transactionToken === snapshot.snapshotToken || active.transactionToken === active.sourceSnapshotToken
    || !isSnapshotVersion(active.sourceSnapshotVersion)
    || active.sourceSnapshotVersion + 1 !== snapshot.snapshotVersion
    || !editorHandleValid || !revisionsMatch) {
    return requestHuman(snapshot, 'active-transaction-mismatch', [active.intentIndex]);
  }
  return undefined;
}

function sameHandleSet(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && new Set(left).size === left.length
    && left.every(handle => right.includes(handle));
}

function planSummary(input: RepeatableRecordPlannerInput, assignments: AssignmentResult): RecordPlanSummary {
  const { snapshot } = input;
  return {
    runToken: snapshot.runToken,
    snapshotToken: snapshot.snapshotToken,
    snapshotVersion: snapshot.snapshotVersion,
    recordType: snapshot.recordType,
    recordListNodeId: snapshot.recordListNodeId,
    assignments: assignments.assignments,
    pendingIntentIndexes: assignments.pendingIntentIndexes,
    unmatchedRecordNodeIds: assignments.unmatchedRecordNodeIds,
  };
}

function uniqueAction(snapshot: RecordPlannerSnapshot, action: 'add-record' | 'save-record', targetId: string):
  RecordPlannerActionNode | RequestHumanRecordPlan {
  const actions = snapshot.actions.filter(node => node.action === action && node.targetNodeId === targetId);
  if (actions.length === 0) {
    return requestHuman(snapshot, action === 'add-record' ? 'add-action-missing' : 'save-action-missing', [], [targetId]);
  }
  if (actions.length > 1) {
    return requestHuman(snapshot, action === 'add-record' ? 'add-action-ambiguous' : 'save-action-ambiguous', [],
      actions.map(item => item.actionNodeId));
  }
  const selected = actions[0]!;
  if (selected.disabled) return requestHuman(snapshot, 'action-disabled', [], [selected.actionNodeId]);
  const expectedRisk: SemanticActionRisk = action === 'add-record' ? 'reversible' : 'commit';
  if (selected.risk !== expectedRisk) {
    return requestHuman(snapshot, 'action-risk-disallowed', [], [selected.actionNodeId]);
  }
  return selected;
}

function planCreatingEditor(input: RepeatableRecordPlannerInput, assignments: AssignmentResult,
  editorCandidate: PageRecordEditorCandidate): RepeatableRecordPlan {
  const { snapshot } = input;
  const editor = snapshot.editor;
  const active = input.activeTransaction;
  if (!editor || !active) return requestHuman(snapshot, 'editor-occupied', [], editor ? [editor.recordNodeId] : []);
  const invalidActive = validateActiveTransaction(input, active);
  if (invalidActive) return invalidActive;
  if (active.phase !== 'add-invoked' && active.editorHandle !== editorCandidate.editorHandle) {
    return requestHuman(snapshot, 'active-transaction-mismatch', [active.intentIndex], [editor.recordNodeId]);
  }
  if (active.phase === 'save-invoked') {
    return requestHuman(snapshot, 'save-result-uncertain', [active.intentIndex], [editor.recordNodeId]);
  }
  const currentHandles = input.candidates.map(candidate => candidate.candidateHandle);
  if (snapshot.existingRecordCount !== active.baselineExistingRecordCount
    || !sameHandleSet(currentHandles, active.baselineCandidateHandles)) {
    return requestHuman(snapshot, 'record-count-changed', [active.intentIndex], [snapshot.recordListNodeId]);
  }
  if (!assignments.pendingIntentIndexes.includes(active.intentIndex)) {
    return requestHuman(snapshot, 'active-transaction-mismatch', [active.intentIndex], [editor.recordNodeId]);
  }
  const save = uniqueAction(snapshot, 'save-record', editor.recordNodeId);
  if ('status' in save) return save;
  if (editor.fieldNodeIds.length === 0) {
    return requestHuman(snapshot, 'editor-unverified', [active.intentIndex], [editor.recordNodeId]);
  }
  const conditions: RecordPlanCondition[] = [
    { kind: 'snapshot-current', runToken: snapshot.runToken, snapshotToken: snapshot.snapshotToken,
      snapshotVersion: snapshot.snapshotVersion },
    { kind: 'record-list-state', recordListNodeId: snapshot.recordListNodeId,
      existingRecordCount: snapshot.existingRecordCount, editorState: 'creating' },
    { kind: 'transaction-active', transactionToken: active.transactionToken,
      intentIndex: active.intentIndex, phase: active.phase },
    { kind: 'action-enabled', actionNodeId: save.actionNodeId },
    { kind: 'identity-unmatched', intentIndex: active.intentIndex },
  ];
  const base = planSummary(input, assignments);
  if (active.phase === 'fields-verified') {
    return freezePlan({
      ...base,
      status: 'ready',
      nextStep: {
        kind: 'save-created',
        transactionToken: active.transactionToken,
        intentIndex: active.intentIndex,
        recordListNodeId: snapshot.recordListNodeId,
        editorRecordNodeId: editor.recordNodeId,
        editorHandle: editorCandidate.editorHandle,
        actionNodeId: save.actionNodeId,
        preconditions: conditions,
        postcondition: {
          kind: 'record-created',
          transactionToken: active.transactionToken,
          expectedExistingRecordCount: snapshot.existingRecordCount + 1,
          expectedEditorState: 'closed',
          rematchIntentIndex: active.intentIndex,
          expectedNewCandidateCount: 1,
        },
      },
    }, snapshot);
  }
  return freezePlan({
    ...base,
    status: 'ready',
    nextStep: {
      kind: 'populate-editor',
      transactionToken: active.transactionToken,
      intentIndex: active.intentIndex,
      recordListNodeId: snapshot.recordListNodeId,
      editorRecordNodeId: editor.recordNodeId,
      editorHandle: editorCandidate.editorHandle,
      fieldNodeIds: editor.fieldNodeIds,
      requiredSaveActionNodeId: save.actionNodeId,
      preconditions: conditions,
      postcondition: {
        kind: 'fields-verified',
        transactionToken: active.transactionToken,
        intentIndex: active.intentIndex,
        editorRecordNodeId: editor.recordNodeId,
        editorHandle: editorCandidate.editorHandle,
      },
    },
  }, snapshot);
}

function verifiedSaveResult(input: RepeatableRecordPlannerInput, assignments: AssignmentResult,
  active: ActiveRecordTransaction): boolean {
  const { snapshot } = input;
  if (active.phase !== 'save-invoked'
    || snapshot.existingRecordCount !== active.baselineExistingRecordCount + 1) return false;
  const currentHandles = input.candidates.map(candidate => candidate.candidateHandle);
  const baseline = new Set(active.baselineCandidateHandles);
  if (!active.baselineCandidateHandles.every(handle => currentHandles.includes(handle))) return false;
  const newHandles = currentHandles.filter(handle => !baseline.has(handle));
  if (newHandles.length !== 1) return false;
  return assignments.assignments.some(assignment => assignment.intentIndex === active.intentIndex
    && assignment.candidateHandle === newHandles[0]);
}

/**
 * Produces a deterministic, value-free plan for one validated record-list snapshot.
 * It never reads DOM, labels, selectors or field values and authorizes at most one
 * current-snapshot action. A future executor must consume that authorization once.
 */
export function planRepeatableRecords(input: RepeatableRecordPlannerInput): RepeatableRecordPlan {
  const snapshot = input?.snapshot;
  if (!snapshot || snapshot[SNAPSHOT_BRAND] !== true || !Object.isFrozen(snapshot)
    || !validatedSnapshots.has(snapshot)) {
    return rawRequestHuman(0, 'invalid-planner-input');
  }
  if (!isRunLocalRevision(input.profileRevision)) return requestHuman(snapshot, 'invalid-planner-input');
  const invalidIntents = validateIntents(input);
  if (invalidIntents) return invalidIntents;
  const invalidCandidates = validateCandidates(input);
  if (invalidCandidates) return invalidCandidates;
  const assignments = assignRecords(input);
  if ('status' in assignments) return assignments;
  const active = input.activeTransaction;
  if (active !== undefined && (active === null || typeof active !== 'object')) {
    return requestHuman(snapshot, 'invalid-planner-input');
  }
  if (active !== undefined) {
    const invalidActive = validateActiveTransaction(input, active);
    if (invalidActive) return invalidActive;
  }

  if (snapshot.editorState === 'editing' || snapshot.editorState === 'unknown') {
    return requestHuman(snapshot, 'editor-occupied', [], snapshot.editor ? [snapshot.editor.recordNodeId] : []);
  }
  if (snapshot.editorState === 'creating') {
    const editorCandidate = validateEditorCandidate(input);
    if (!editorCandidate || 'status' in editorCandidate) {
      return editorCandidate ?? requestHuman(snapshot, 'editor-unverified');
    }
    return planCreatingEditor(input, assignments, editorCandidate);
  }
  if (snapshot.editorState !== 'closed' || snapshot.editor) {
    return requestHuman(snapshot, 'editor-unverified', [], snapshot.editor ? [snapshot.editor.recordNodeId] : []);
  }

  if (active !== undefined) {
    if (active.phase === 'save-invoked') {
      if (snapshot.existingRecordCount === active.baselineExistingRecordCount) {
        return requestHuman(snapshot, 'save-result-uncertain', [active.intentIndex], [snapshot.recordListNodeId]);
      }
      if (snapshot.existingRecordCount !== active.baselineExistingRecordCount + 1) {
        return requestHuman(snapshot, 'record-count-changed', [active.intentIndex], [snapshot.recordListNodeId]);
      }
      if (!verifiedSaveResult(input, assignments, active)) {
        return requestHuman(snapshot, 'save-result-uncertain', [active.intentIndex], [snapshot.recordListNodeId]);
      }
      consumedTransactions.add(active);
    } else if (active.phase === 'add-invoked') {
      const currentHandles = input.candidates.map(candidate => candidate.candidateHandle);
      if (snapshot.existingRecordCount !== active.baselineExistingRecordCount
        || !sameHandleSet(currentHandles, active.baselineCandidateHandles)) {
        return requestHuman(snapshot, 'record-count-changed', [active.intentIndex], [snapshot.recordListNodeId]);
      }
      return requestHuman(snapshot, 'add-result-uncertain', [active.intentIndex], [snapshot.recordListNodeId]);
    } else {
      return requestHuman(snapshot, 'active-transaction-mismatch', [active.intentIndex], [snapshot.recordListNodeId]);
    }
  }

  const base = planSummary(input, assignments);
  if (assignments.pendingIntentIndexes.length === 0) {
    return freezePlan({ ...base, status: 'complete' }, snapshot);
  }
  if (snapshotsWithConsumedAdd.has(snapshot)) {
    return requestHuman(snapshot, 'add-result-uncertain', assignments.pendingIntentIndexes,
      [snapshot.recordListNodeId]);
  }
  const add = uniqueAction(snapshot, 'add-record', snapshot.recordListNodeId);
  if ('status' in add) return add;
  const intentIndex = assignments.pendingIntentIndexes[0]!;
  const candidateHandles = input.candidates.map(candidate => candidate.candidateHandle).sort((left, right) => left - right);
  return freezePlan({
    ...base,
    status: 'ready',
    nextStep: {
      kind: 'open-create',
      intentIndex,
      recordListNodeId: snapshot.recordListNodeId,
      actionNodeId: add.actionNodeId,
      preconditions: [
        { kind: 'snapshot-current', runToken: snapshot.runToken, snapshotToken: snapshot.snapshotToken,
          snapshotVersion: snapshot.snapshotVersion },
        { kind: 'record-list-state', recordListNodeId: snapshot.recordListNodeId,
          existingRecordCount: snapshot.existingRecordCount, editorState: 'closed' },
        { kind: 'action-enabled', actionNodeId: add.actionNodeId },
        { kind: 'identity-unmatched', intentIndex },
      ],
      postcondition: {
        kind: 'editor-opened',
        expectedExistingRecordCount: snapshot.existingRecordCount,
        expectedEditorState: 'creating',
        expectedCandidateHandles: candidateHandles,
      },
    },
  }, snapshot);
}
