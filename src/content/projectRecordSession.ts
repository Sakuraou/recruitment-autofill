import { bindRecordEditor, type RecordEditorBindResult } from '../planner/recordEditorBinder';
import { resolveProjectField } from '../matching/projectFieldResolver';
import type { ActiveRecordTransaction, ReadyRecordPlan, RepeatableRecordPlannerInput } from '../planner/recordPlanner';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureFailure,
  type RecordRunCaptureSource } from '../planner/recordRunContext';
import { executeRecordAction } from '../planner/recordTransactionExecutor';
import { RecordTransactionOrchestrator, type RecordOrchestratorDriver } from '../planner/recordTransactionOrchestrator';
import type { RecordV2Session } from './recordV2Gateway';
import { scanDocument, type ScanState } from './scanner';
import { projectProjectionResponseSchema, type ProjectProjectionResponse } from '../profile/projection';
import { projectCardComparator } from './projectRecordIdentity';
import { hiddenReason } from './domUtils';
import { recordObservationMatches } from './recordObservation';

interface ProjectObservation {
  readonly scan: ScanState;
  readonly source: RecordRunCaptureSource;
}

function observe(doc: Document): ProjectObservation | undefined {
  const scan = scanDocument(doc);
  const graph = scan.result.semanticGraph;
  if (!graph) return undefined;
  const lists = graph.nodes.filter(node => node.kind === 'record-list' && node.recordType === 'project');
  if (lists.length !== 1) return undefined;
  const list = lists[0]!;
  return {
    scan,
    source: {
      graph,
      expectedFieldIds: scan.result.fields.map(field => field.id),
      semanticTargets: scan.semanticTargets,
      recordType: 'project',
      recordListNodeId: list.id,
    },
  };
}

export type ProjectPageReason = 'record-list-unverified' | 'record-root-unsupported'
  | 'editor-already-open' | 'add-action-unverified';

function projectPageProblem(doc: Document, observation: ProjectObservation | undefined): ProjectPageReason | undefined {
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

/** Value-free availability for a future explicit project-only pilot entry. No page actions. */
export function projectRecordAvailability(doc: Document): Readonly<{ eligible: boolean; reason?: ProjectPageReason }> {
  const reason = projectPageProblem(doc, observe(doc));
  return Object.freeze(reason ? { eligible: false, reason } : { eligible: true });
}

class ProjectDriver implements RecordOrchestratorDriver {
  readonly #context: RecordRunContext;
  readonly #observe: () => ProjectObservation | undefined;
  readonly #records: readonly ProjectProjectionResponse['projects'][number][];
  readonly #observations = new WeakMap<RecordRunCapture, ProjectObservation>();
  readonly #identities = new WeakMap<RecordRunCapture, string>();
  #verifiedFields?: { readonly observation: ProjectObservation; readonly capture: RecordRunCapture };

  constructor(context: RecordRunContext, projection: ProjectProjectionResponse,
    observer: () => ProjectObservation | undefined) {
    this.#observe = observer;
    this.#context = context;
    this.#records = projection.projects;
  }

  capture(): RecordRunCapture | RecordRunCaptureFailure {
    const observation = this.#observe();
    if (!observation) return { status: 'request-human', snapshotVersion: 0, reason: 'record-list-unverified' };
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

  private identityEvidence(capture: RecordRunCapture, observation: ProjectObservation): string {
    // Value-free comparison results detect renamed/changed cards between
    // steps without storing their text or hashes of private values.
    return JSON.stringify(capture.candidates.map(candidate => {
      const comparison = projectCardComparator(observation.scan.semanticTargets.get(candidate.recordNodeId));
      return { ready: comparison.ready, results: this.#records.map(record => comparison.compare(record)) };
    }));
  }

  plannerInput(capture: RecordRunCapture, active?: ActiveRecordTransaction): RepeatableRecordPlannerInput {
    const observation = this.#observations.get(capture);
    if (!observation) throw new Error('project observation missing');
    const comparisons = new Map(capture.candidates.map(candidate => [candidate.recordNodeId,
      projectCardComparator(observation.scan.semanticTargets.get(candidate.recordNodeId))]));
    const candidates = capture.candidates.map((candidate) => {
      return { ...candidate, identityReady: comparisons.get(candidate.recordNodeId)!.ready };
    });
    return {
      snapshot: capture.snapshot,
      profileRevision: capture.profileRevision,
      intents: this.#records.map((record, intentIndex) => ({ intentIndex, recordType: 'project', identityReady: Boolean(record.name?.trim()) })),
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
    if (!observation) throw new Error('project observation missing');
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
    if (!observation) throw new Error('project observation missing');
    if (plan.nextStep.kind !== 'populate-editor') throw new Error('editor plan missing');
    const record = this.#records[active.intentIndex];
    if (!record) return { status: 'request-human', reason: 'profile-value-missing', writtenFieldCount: 0, rollbackComplete: true };
    const values = new Map<string, string>();
    for (const nodeId of plan.nextStep.fieldNodeIds) {
      const node = observation.scan.result.semanticGraph?.nodes.find(candidate => candidate.id === nodeId);
      const field = node?.kind === 'field' ? observation.scan.result.fields.find(candidate => candidate.id === node.fieldId) : undefined;
      if (!field) return { status: 'request-human', reason: 'field-map-mismatch', writtenFieldCount: 0, rollbackComplete: true };
      const resolved = resolveProjectField(field, record);
      if (resolved.status !== 'known') return { status: 'request-human', reason: resolved.reason, writtenFieldCount: 0, rollbackComplete: true };
      values.set(field.id, resolved.value);
    }
    const result = await bindRecordEditor({
      plan,
      capture,
      activeTransaction: active,
      runContext: this.#context,
      scanState: observation.scan,
      provideValue: ({ scanFieldId }) => values.get(scanFieldId),
      rescan: () => this.capture(),
    });
    if (result.status === 'advanced') {
      const verified = this.#observations.get(result.capture);
      if (verified) this.#verifiedFields = { observation: verified, capture: result.capture };
    }
    return result;
  }
}

/** Internal factory: selectors, values and page eligibility never come from runtime messages. */
export function createProjectRecordSession(doc: Document, projection: ProjectProjectionResponse,
  refreshProjection?: () => Promise<ProjectProjectionResponse>,
  additionalEligibility?: (doc: Document) => boolean): RecordV2Session {
  const initial = observe(doc);
  if (projectPageProblem(doc, initial) || additionalEligibility?.(doc) === false) {
    throw new Error('当前页面没有唯一、可验证且已关闭编辑器的项目列表');
  }
  const initialUrl = doc.URL;
  const listElement = initial!.scan.semanticTargets.get(initial!.source.recordListNodeId);
  const observer = (): ProjectObservation | undefined => {
    if (doc.URL !== initialUrl || !listElement?.isConnected || additionalEligibility?.(doc) === false) return undefined;
    const current = observe(doc);
    return current && current.scan.semanticTargets.get(current.source.recordListNodeId) === listElement
      ? current : undefined;
  };
  const parsed = projectProjectionResponseSchema.safeParse(projection);
  if (!parsed.success || parsed.data.projects.length === 0
    || new Set(parsed.data.projects.map(project => project.id)).size !== parsed.data.projects.length) {
    throw new Error('项目档案投影格式无效');
  }
  const context = new RecordRunContext();
  const orchestrator = new RecordTransactionOrchestrator(context, new ProjectDriver(context, parsed.data, observer));
  let stoppedForProfileChange = false;
  return {
    get state() { return orchestrator.state; },
    get snapshotVersion() { return orchestrator.snapshotVersion; },
    advance: async () => {
      if (stoppedForProfileChange) return { status: 'request-human', snapshotVersion: orchestrator.snapshotVersion,
        reason: 'profile-changed' };
      if (refreshProjection) {
        let latest: ProjectProjectionResponse;
        try { latest = await refreshProjection(); }
        catch { stoppedForProfileChange = true; orchestrator.stop(); return { status: 'request-human',
          snapshotVersion: orchestrator.snapshotVersion, reason: 'profile-projection-unavailable' }; }
        if (latest.profileRevision !== parsed.data.profileRevision) {
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
