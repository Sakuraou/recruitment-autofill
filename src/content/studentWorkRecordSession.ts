import { bindRecordEditor, type RecordEditorBindResult } from '../planner/recordEditorBinder';
import { resolveStudentWorkField } from '../matching/studentWorkFieldResolver';
import type { ActiveRecordTransaction, ReadyRecordPlan, RepeatableRecordPlannerInput } from '../planner/recordPlanner';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureFailure,
  type RecordRunCaptureSource } from '../planner/recordRunContext';
import { executeRecordAction } from '../planner/recordTransactionExecutor';
import { RecordTransactionOrchestrator, type RecordOrchestratorDriver } from '../planner/recordTransactionOrchestrator';
import type { RecordV2Session } from './recordV2Gateway';
import { scanDocument, type ScanState } from './scanner';
import { studentWorkProjectionResponseSchema, type StudentWorkProjectionResponse } from '../profile/studentWorkProjection';
import { studentWorkCardComparator, studentWorkIdentityFactsReady } from './studentWorkRecordIdentity';
import { hiddenReason } from './domUtils';
import { recordEditorCoverageComplete, recordObservationMatches } from './recordObservation';

interface StudentWorkObservation {
  readonly scan: ScanState;
  readonly source: RecordRunCaptureSource;
}

function observe(doc: Document): StudentWorkObservation | undefined {
  const scan = scanDocument(doc);
  const graph = scan.result.semanticGraph;
  if (!graph) return undefined;
  const lists = graph.nodes.filter(node => node.kind === 'record-list' && node.recordType === 'student-work');
  if (lists.length !== 1) return undefined;
  const list = lists[0]!;
  return {
    scan,
    source: {
      graph,
      expectedFieldIds: scan.result.fields.map(field => field.id),
      semanticTargets: scan.semanticTargets,
      recordType: 'student-work',
      recordListNodeId: list.id,
    },
  };
}

export type StudentWorkPageReason = 'record-list-unverified' | 'record-root-unsupported'
  | 'editor-already-open' | 'add-action-unverified';

function studentWorkPageProblem(doc: Document, observation: StudentWorkObservation | undefined): StudentWorkPageReason | undefined {
  if (!/^https?:/u.test(doc.URL) || !observation) return 'record-list-unverified';
  const { graph, recordListNodeId } = observation.source;
  const list = graph.nodes.find(node => node.id === recordListNodeId);
  const target = observation.scan.semanticTargets.get(recordListNodeId);
  if (!target?.isConnected || target.ownerDocument !== doc || target.getRootNode() !== doc) return 'record-root-unsupported';
  if (list?.kind !== 'record-list' || list.editorState !== 'closed') return 'editor-already-open';
  const adds = graph.nodes.filter(node => node.kind === 'action' && node.action === 'add-record'
    && node.targetId === recordListNodeId && node.risk === 'reversible' && !node.disabled);
  return adds.length === 1 ? undefined : 'add-action-unverified';
}

/** Value-free availability for the explicit studentWork record entry. No page actions. */
export function studentWorkRecordAvailability(doc: Document): Readonly<{ eligible: boolean; reason?: StudentWorkPageReason }> {
  const reason = studentWorkPageProblem(doc, observe(doc));
  return Object.freeze(reason ? { eligible: false, reason } : { eligible: true });
}

class StudentWorkDriver implements RecordOrchestratorDriver {
  readonly #context: RecordRunContext;
  readonly #observe: () => StudentWorkObservation | undefined;
  readonly #records: readonly StudentWorkProjectionResponse['studentWork'][number][];

  readonly #verifyProfile: () => Promise<boolean>;
  readonly #observations = new WeakMap<RecordRunCapture, StudentWorkObservation>();
  readonly #identities = new WeakMap<RecordRunCapture, string>();
  #verifiedFields?: { readonly observation: StudentWorkObservation; readonly capture: RecordRunCapture };

  constructor(context: RecordRunContext, projection: StudentWorkProjectionResponse,
    observer: () => StudentWorkObservation | undefined, verifyProfile: () => Promise<boolean>) {
    this.#observe = observer;
    this.#context = context;
    this.#records = projection.studentWork;

    this.#verifyProfile = verifyProfile;
  }

  capture(): RecordRunCapture | RecordRunCaptureFailure {
    const observation = this.#observe();
    if (!observation) return { status: 'request-human', snapshotVersion: 0, reason: 'record-list-unverified' };
    if (!recordEditorCoverageComplete(observation.scan, observation.source.recordListNodeId)) {
      return { status: 'request-human', snapshotVersion: 0, reason: 'editor-fields-unverified' };
    }
    // Populate deliberately requires a new adjacent capture before Save. Do
    // not let that fresh capture erase evidence of silent value/field changes.
    if (this.#verifiedFields && !recordObservationMatches(this.#verifiedFields.observation.scan,
      observation.scan, this.#verifiedFields.capture.snapshot.recordListNodeId)) {
      return { status: 'request-human', snapshotVersion: this.#verifiedFields.capture.snapshotVersion,
        reason: 'fields-changed-after-verification' };
    }
    const capture = this.#context.capture(observation.source);
    if (capture.status === 'ready') {
      this.#observations.set(capture, observation);
      this.#identities.set(capture, this.identityEvidence(capture, observation));
    }
    return capture;
  }

  validateCapture(capture: RecordRunCapture): boolean {
    const previous = this.#observations.get(capture);
    const current = this.#observe();
    if (!previous || !current || !recordObservationMatches(previous.scan, current.scan, capture.snapshot.recordListNodeId)) return false;
    if (this.#identities.get(capture) !== this.identityEvidence(capture, current)) return false;
    this.#observations.set(capture, current);
    return true;
  }

  private identityEvidence(capture: RecordRunCapture, observation: StudentWorkObservation): string {
    // Value-free comparison results detect renamed/changed cards between
    // steps without storing their text or hashes of private values.
    return JSON.stringify(capture.candidates.map(candidate => {
      const comparison = studentWorkCardComparator(observation.scan.semanticTargets.get(candidate.recordNodeId));
      return { ready: comparison.ready, results: this.#records.map(record => comparison.compare(record)) };
    }));
  }

  plannerInput(capture: RecordRunCapture, active?: ActiveRecordTransaction): RepeatableRecordPlannerInput {
    const observation = this.#observations.get(capture);
    if (!observation) throw new Error('studentWork observation missing');
    const comparisons = new Map(capture.candidates.map(candidate => [candidate.recordNodeId,
      studentWorkCardComparator(observation.scan.semanticTargets.get(candidate.recordNodeId))]));
    const candidates = capture.candidates.map((candidate) => {
      return { ...candidate, identityReady: comparisons.get(candidate.recordNodeId)!.ready };
    });
    return {
      snapshot: capture.snapshot,
      profileRevision: capture.profileRevision,
      intents: this.#records.map((record, intentIndex) => ({ intentIndex, recordType: 'student-work', identityReady: studentWorkIdentityFactsReady(record) })),
      candidates,
      editorCandidate: capture.editorCandidate,
      identityComparisons: candidates.flatMap((candidate) => {
        const comparison = comparisons.get(candidate.recordNodeId)!;
        return this.#records.map((record, intentIndex) => ({
          runToken: capture.runToken,
          snapshotToken: capture.snapshotToken,
          intentIndex,
          recordNodeId: candidate.recordNodeId,
          ...comparison.compare(record),
        }));
      }),
      ...(active ? { activeTransaction: active } : {}),
    };
  }

  executeAction(plan: ReadyRecordPlan, capture: RecordRunCapture, active?: ActiveRecordTransaction) {
    const observation = this.#observations.get(capture);
    if (!observation) throw new Error('studentWork observation missing');
    const list = observation.scan.semanticTargets.get(plan.recordListNodeId);
    // The executor immediately checks the issued Save capability, clicks once,
    // then captures the expected closed editor. That capture must no longer be
    // compared with the populated editor; uncertain outcomes still stop.
    if (plan.nextStep.kind === 'save-created') this.#verifiedFields = undefined;
    return executeRecordAction({
      plan,
      capture,
      activeTransaction: active,
      runContext: this.#context,
      semanticTargets: observation.scan.semanticTargets,
      observePostcondition: () => {
        if (!list?.isConnected) return false;
        // This is only a cheap structural hint. The executor always performs
        // a fresh semantic capture and verifies the full topology afterwards.
        const editorOpen = Array.from(list.querySelectorAll('form, fieldset, [role="dialog"]'))
          .some(editor => !hiddenReason(editor) && editor.querySelector('input, textarea, select'));
        if (plan.nextStep.kind === 'open-create') return editorOpen;
        if (plan.nextStep.kind !== 'save-created') return false;
        const cards = Array.from(list.querySelectorAll('[role="listitem"], article, li, tr'));
        const outerCards = cards.filter(card => !hiddenReason(card)
          && !cards.some(other => other !== card && other.contains(card)));
        return !editorOpen && outerCards.length === plan.nextStep.postcondition.expectedExistingRecordCount;
      },
      rescan: () => this.capture(),
      quietWindowMs: 10,
      timeoutMs: 2_000,
    });
  }

  async bindEditor(plan: ReadyRecordPlan, capture: RecordRunCapture, active: ActiveRecordTransaction): Promise<RecordEditorBindResult> {
    const observation = this.#observations.get(capture);
    if (!observation) throw new Error('studentWork observation missing');
    if (plan.nextStep.kind !== 'populate-editor') throw new Error('editor plan missing');
    const record = this.#records[active.intentIndex];
    if (!record) return { status: 'request-human', reason: 'profile-value-missing', writtenFieldCount: 0, rollbackComplete: true };
    if(!await this.#verifyProfile())return {status:'request-human',reason:'step-aborted',writtenFieldCount:0,rollbackComplete:true};
    const values = new Map<string, string>();
    for (const nodeId of plan.nextStep.fieldNodeIds) {
      const node=observation.scan.result.semanticGraph?.nodes.find(candidate=>candidate.id===nodeId);
      const field=node?.kind==='field'?observation.scan.result.fields.find(candidate=>candidate.id===node.fieldId):undefined;
      if(!field)return {status:'request-human',reason:'field-map-mismatch',writtenFieldCount:0,rollbackComplete:true};
      const resolved=resolveStudentWorkField(field,record);
      if(resolved.status!=='known')return {status:'request-human',reason:resolved.reason,writtenFieldCount:0,rollbackComplete:true};
      values.set(field.id,resolved.value);
    }
    // The current draft was checked before this call. Its rescan must observe
    // the new answers instead of comparing them with the previous draft.
    this.#verifiedFields = undefined;
    const result = await bindRecordEditor({
      plan,
      capture,
      activeTransaction: active,
      runContext: this.#context,
      scanState: observation.scan,
      provideValue: ({ scanFieldId }) => values.get(scanFieldId),
      rescan: () => this.capture(),
      allowExpansion: true,
    });
    if (result.status === 'advanced' || result.status === 'expanded') {
      const verified = this.#observations.get(result.capture);
      if (verified) this.#verifiedFields = { observation: verified, capture: result.capture };
    }
    return result;
  }
}

/** Internal factory: selectors, values and page eligibility never come from runtime messages. */
export function createStudentWorkRecordSession(doc: Document, projection: StudentWorkProjectionResponse,
  refreshProjection?: () => Promise<StudentWorkProjectionResponse>,
  additionalEligibility?: (doc: Document) => boolean): RecordV2Session {
  const initial = observe(doc);
  if (studentWorkPageProblem(doc, initial) || additionalEligibility?.(doc) === false) {
    throw new Error('当前页面没有唯一、可验证且已关闭编辑器的校内职务列表');
  }
  const initialUrl = doc.URL;
  const listElement = initial!.scan.semanticTargets.get(initial!.source.recordListNodeId);
  const observer = (): StudentWorkObservation | undefined => {
    if (doc.URL !== initialUrl || !listElement?.isConnected || additionalEligibility?.(doc) === false) return undefined;
    const current = observe(doc);
    return current && current.scan.semanticTargets.get(current.source.recordListNodeId) === listElement
      ? current : undefined;
  };
  const parsed = studentWorkProjectionResponseSchema.safeParse(projection);
  if (!parsed.success || parsed.data.studentWork.length === 0
    || new Set(parsed.data.studentWork.map(studentWork => studentWork.id)).size !== parsed.data.studentWork.length) {
    throw new Error('校内职务档案投影格式无效');
  }
  const context = new RecordRunContext();
  let stoppedForProfileChange = false;
  const originalProjection = JSON.stringify(parsed.data);
  const verifyProfile = async (): Promise<boolean> => {
    if (stoppedForProfileChange || context.stopped) return false;
    if (!refreshProjection) return true;
    try {
      const latest = studentWorkProjectionResponseSchema.safeParse(await refreshProjection());
      if (latest.success && JSON.stringify(latest.data) === originalProjection) return true;
    } catch { /* Missing or changed projections never update an in-flight record. */ }
    stoppedForProfileChange = true; context.stop(); return false;
  };
  const orchestrator = new RecordTransactionOrchestrator(context, new StudentWorkDriver(context, parsed.data, observer, verifyProfile));
  return {
    get state() { return orchestrator.state; },
    get snapshotVersion() { return orchestrator.snapshotVersion; },
    advance: async () => {
      if (stoppedForProfileChange) return { status: 'request-human', snapshotVersion: orchestrator.snapshotVersion,
        reason: 'profile-changed' };
      if (refreshProjection) {
        let latest: StudentWorkProjectionResponse;
        try { latest = await refreshProjection(); }
        catch { stoppedForProfileChange = true; orchestrator.stop(); return { status: 'request-human',
          snapshotVersion: orchestrator.snapshotVersion, reason: 'profile-projection-unavailable' }; }
        const checked = studentWorkProjectionResponseSchema.safeParse(latest);
        if (!checked.success || JSON.stringify(checked.data) !== originalProjection) {
          stoppedForProfileChange = true;
          orchestrator.stop();
          return { status: 'request-human', snapshotVersion: orchestrator.snapshotVersion, reason: 'profile-changed' };
        }
      }
      return orchestrator.advance();
    },
    pause: () => orchestrator.pause(),
    resume: () => orchestrator.resume(),
    stop: () => orchestrator.stop(),
  };
}
