import { internshipFillOrder } from '../profile/internshipFillOrder';
import { internshipIdentityReady } from '../profile/internshipIdentityFacts';
import { bindRecordEditor, type RecordEditorBindResult, type RecordEditorBindReason } from '../planner/recordEditorBinder';
import { resolveInternshipField, resolveBoundInternshipField, qualifyInternshipWeakMeaning } from '../matching/internshipFieldResolver';
import type { ActiveRecordTransaction, ReadyRecordPlan, RepeatableRecordPlannerInput } from '../planner/recordPlanner';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureFailure,
  type RecordRunCaptureSource } from '../planner/recordRunContext';
import { executeRecordAction } from '../planner/recordTransactionExecutor';
import { RecordTransactionOrchestrator, type RecordOrchestratorDriver } from '../planner/recordTransactionOrchestrator';
import type { RecordV2Session } from './recordV2Gateway';
import { scanDocument, type ScanState } from './scanner';
import { internshipProjectionResponseSchema, type InternshipProjectionResponse } from '../profile/internshipProjection';
import { internshipCardComparator } from './internshipRecordIdentity';
import { hiddenReason } from './domUtils';
import { recordEditorCoverageComplete, recordObservationMatches } from './recordObservation';
import { createEmptyProfile, type UserProfile } from '../profile/schema';
import { createInternshipSemanticContext, internshipSemanticContextCurrent } from '../ai/internshipSemanticContext';
import { inferSemanticCandidates, type SemanticProvider } from '../ai/semanticCandidates';

interface InternshipObservation {
  readonly scan: ScanState;
  readonly source: RecordRunCaptureSource;
}

function observe(doc: Document): InternshipObservation | undefined {
  const scan = scanDocument(doc);
  const graph = scan.result.semanticGraph;
  if (!graph) return undefined;
  const lists = graph.nodes.filter(node => node.kind === 'record-list' && node.recordType === 'internship');
  if (lists.length !== 1) return undefined;
  const list = lists[0]!;
  return {
    scan,
    source: {
      graph,
      expectedFieldIds: scan.result.fields.map(field => field.id),
      semanticTargets: scan.semanticTargets,
      recordType: 'internship',
      recordListNodeId: list.id,
    },
  };
}

export type InternshipPageReason = 'record-list-unverified' | 'record-root-unsupported'
  | 'editor-already-open' | 'add-action-unverified';

function internshipPageProblem(doc: Document, observation: InternshipObservation | undefined): InternshipPageReason | undefined {
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

/** Value-free availability for a future explicit internship-only pilot entry. No page actions. */
export function internshipRecordAvailability(doc: Document): Readonly<{ eligible: boolean; reason?: InternshipPageReason }> {
  const reason = internshipPageProblem(doc, observe(doc));
  return Object.freeze(reason ? { eligible: false, reason } : { eligible: true });
}

class InternshipDriver implements RecordOrchestratorDriver {
  readonly #context: RecordRunContext;
  readonly #observe: () => InternshipObservation | undefined;
  readonly #records: readonly InternshipProjectionResponse['internships'][number][];
  readonly #profile: UserProfile;
  readonly #provider?: SemanticProvider;
  readonly #verifyProfile: () => Promise<boolean>;
  #semanticPaths = new WeakMap<Element, string>();
  readonly #observations = new WeakMap<RecordRunCapture, InternshipObservation>();
  readonly #identities = new WeakMap<RecordRunCapture, string>();
  #verifiedFields?: { readonly observation: InternshipObservation; readonly capture: RecordRunCapture };

  constructor(context: RecordRunContext, projection: InternshipProjectionResponse,
    observer: () => InternshipObservation | undefined, verifyProfile: () => Promise<boolean>, provider?: SemanticProvider) {
    this.#observe = observer;
    this.#context = context;
    this.#records = projection.internships;
    this.#profile = createEmptyProfile(); this.#profile.updatedAt = projection.profileRevision;
    this.#profile.internships = projection.internships.map(record => ({ ...record,
      ...(record.endDateFact ? { endDateFact: { ...record.endDateFact } } : {}),
    }));
    this.#provider = provider; this.#verifyProfile = verifyProfile;
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

  private identityEvidence(capture: RecordRunCapture, observation: InternshipObservation): string {
    // Value-free comparison results detect renamed/changed cards between
    // steps without storing their text or hashes of private values.
    return JSON.stringify(capture.candidates.map(candidate => {
      const comparison = internshipCardComparator(observation.scan.semanticTargets.get(candidate.recordNodeId), this.#records);
      return { ready: comparison.ready, results: this.#records.map(record => comparison.compare(record)) };
    }));
  }

  plannerInput(capture: RecordRunCapture, active?: ActiveRecordTransaction): RepeatableRecordPlannerInput {
    const observation = this.#observations.get(capture);
    if (!observation) throw new Error('internship observation missing');
    const comparisons = new Map(capture.candidates.map(candidate => [candidate.recordNodeId,
      internshipCardComparator(observation.scan.semanticTargets.get(candidate.recordNodeId), this.#records)]));
    const candidates = capture.candidates.map((candidate) => {
      return { ...candidate, identityReady: comparisons.get(candidate.recordNodeId)!.ready };
    });
    return {
      snapshot: capture.snapshot,
      profileRevision: capture.profileRevision,
      intents: this.#records.map((record, intentIndex) => ({ intentIndex, recordType: 'internship', identityReady: internshipIdentityReady(record) })),
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
    if (!observation) throw new Error('internship observation missing');
    if (plan.nextStep.kind === 'open-create') this.#semanticPaths = new WeakMap();
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
    if (!observation) throw new Error('internship observation missing');
    if (plan.nextStep.kind !== 'populate-editor') throw new Error('editor plan missing');
    const record = this.#records[active.intentIndex];
    if (!record) return { status: 'request-human', reason: 'profile-value-missing', writtenFieldCount: 0, rollbackComplete: true };
    const values = new Map<string, string>();
    const semanticPaths = new Map<Element, string>();
    const unknown = new Set<string>();
    for (const nodeId of plan.nextStep.fieldNodeIds) {
      const node = observation.scan.result.semanticGraph?.nodes.find(candidate => candidate.id === nodeId);
      const field = node?.kind === 'field' ? observation.scan.result.fields.find(candidate => candidate.id === node.fieldId) : undefined;
      if (!field) return { status: 'request-human', reason: 'field-map-mismatch', writtenFieldCount: 0, rollbackComplete: true };
      const control = observation.scan.controls.get(field.id);
      const meaning = control && this.#semanticPaths.get(control.node);
      const resolved = meaning ? resolveBoundInternshipField(field, record, meaning) : resolveInternshipField(field, record);
      if (resolved.status !== 'known') {
        if (resolved.reason === 'field-semantic-unknown' || !meaning && qualifyInternshipWeakMeaning(field,record).status==='confirm') { unknown.add(field.id); continue; }
        return { status: 'request-human', reason: resolved.reason, writtenFieldCount: 0, rollbackComplete: true };
      }
      values.set(field.id, resolved.value);
    }
    if (unknown.size) {
      const reject = (reason: RecordEditorBindReason = 'field-semantic-unknown'): RecordEditorBindResult => ({ status: 'request-human', reason, writtenFieldCount: 0, rollbackComplete: true });
      if (!this.#provider) return reject();
      const internshipContext = createInternshipSemanticContext({ plan, capture, activeTransaction: active,
        runContext: this.#context, scanState: observation.scan, profile: this.#profile });
      if (!internshipContext) return reject('snapshot-stale');
      const signal = this.#context.beginStep();
      const candidates = await inferSemanticCandidates(observation.scan.result, this.#profile, this.#provider, {
        signal, internshipContext, excludedFieldIds: new Set(observation.scan.result.fields.filter(field => !unknown.has(field.id)).map(field => field.id)),
        currentContext: async () => {
          if (!await this.#verifyProfile() || !this.validateCapture(capture)) throw new Error('实习观察已变化');
          return { scan: observation.scan.result, profile: this.#profile };
        },
      });
      if (signal.aborted || !internshipSemanticContextCurrent(internshipContext, observation.scan.result, this.#profile, [...unknown])) return reject('snapshot-stale');
      if (candidates.state !== 'ready' || candidates.matches.length !== unknown.size) return reject();
      const seen = new Set<string>();
      for (const match of candidates.matches) {
        if (!unknown.has(match.fieldId) || seen.has(match.fieldId) || match.source !== 'llm' || match.status !== 'review'
          || match.confidence < 0.9 || match.value === undefined || !match.matchedProfileKey?.startsWith('internships.')) return reject();
        seen.add(match.fieldId); values.set(match.fieldId, match.value);
        const control = observation.scan.controls.get(match.fieldId);
        if (!control) return reject('field-map-mismatch');
        semanticPaths.set(control.node, match.matchedProfileKey!);
      }
      // Meaning proposals cannot issue actions; the atomic binder verifies every local answer below.
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
      for (const [node, path] of semanticPaths) this.#semanticPaths.set(node, path);
      const verified = this.#observations.get(result.capture);
      if (verified) this.#verifiedFields = { observation: verified, capture: result.capture };
    }
    return result;
  }
}

/** Internal factory: selectors, values and page eligibility never come from runtime messages. */
export function createInternshipRecordSession(doc: Document, projection: InternshipProjectionResponse,
  refreshProjection?: () => Promise<InternshipProjectionResponse>,
  additionalEligibility?: (doc: Document) => boolean, semanticProvider?: SemanticProvider): RecordV2Session {
  const initial = observe(doc);
  if (internshipPageProblem(doc, initial) || additionalEligibility?.(doc) === false) {
    throw new Error('当前页面没有唯一、可验证且已关闭编辑器的实习列表');
  }
  const initialUrl = doc.URL;
  const listElement = initial!.scan.semanticTargets.get(initial!.source.recordListNodeId);
  const observer = (): InternshipObservation | undefined => {
    if (doc.URL !== initialUrl || !listElement?.isConnected || additionalEligibility?.(doc) === false) return undefined;
    const current = observe(doc);
    return current && current.scan.semanticTargets.get(current.source.recordListNodeId) === listElement
      ? current : undefined;
  };
  const parsed = internshipProjectionResponseSchema.safeParse(projection);
  if (!parsed.success || parsed.data.internships.length === 0
    || new Set(parsed.data.internships.map(internship => internship.id)).size !== parsed.data.internships.length) {
    throw new Error('实习档案投影格式无效');
  }
  const order = internshipFillOrder(parsed.data.internships);
  if (order.status !== 'ready') throw new Error('实习记录无法建立可靠填写顺序');
  const context = new RecordRunContext();
  let stoppedForProfileChange = false;
  const originalProjection = JSON.stringify(parsed.data);
  const verifyProfile = async (): Promise<boolean> => {
    if (stoppedForProfileChange || context.stopped) return false;
    if (!refreshProjection) return true;
    try {
      const latest = internshipProjectionResponseSchema.safeParse(await refreshProjection());
      if (latest.success && JSON.stringify(latest.data) === originalProjection) return true;
    } catch { /* Never change the current record table during inference. */ }
    stoppedForProfileChange = true; context.stop(); return false;
  };
  const orchestrator = new RecordTransactionOrchestrator(context, new InternshipDriver(context, { ...parsed.data,
    internships: order.indices.map(index => parsed.data.internships[index]!) }, observer, verifyProfile, semanticProvider));
  return {
    get state() { return orchestrator.state; },
    get snapshotVersion() { return orchestrator.snapshotVersion; },
    advance: async () => {
      if (stoppedForProfileChange) return { status: 'request-human', snapshotVersion: orchestrator.snapshotVersion,
        reason: 'profile-changed' };
      if (refreshProjection) {
        let latest: InternshipProjectionResponse;
        try { latest = await refreshProjection(); }
        catch { stoppedForProfileChange = true; orchestrator.stop(); return { status: 'request-human',
          snapshotVersion: orchestrator.snapshotVersion, reason: 'profile-projection-unavailable' }; }
        const checked = internshipProjectionResponseSchema.safeParse(latest);
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
