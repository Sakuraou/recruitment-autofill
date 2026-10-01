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

const FIXTURE_ORIGIN = 'http://localhost:3000';
const FIXTURE_PATH = '/repeatable-records';
const FIXTURE_MARKER = 'record-v2-six-projects-v1';
interface FixtureObservation {
  readonly scan: ScanState;
  readonly source: RecordRunCaptureSource;
}

function urlEligible(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === FIXTURE_ORIGIN && url.pathname === FIXTURE_PATH && url.search === '?case=happy';
  } catch {
    return false;
  }
}

/** This fixture recipe is intentionally unusable on ordinary pages, even in a test build. */
export function isRecordV2FixtureEligible(doc: Document): boolean {
  return urlEligible(doc.URL)
    && doc.documentElement.dataset.raRecordV2Fixture === 'v1'
    && doc.querySelector(`meta[name="ra-record-v2-fixture"][content="${FIXTURE_MARKER}"]`) !== null
    && doc.querySelector(`#ra-record-v2-fixture[data-schema="${FIXTURE_MARKER}"]`) !== null;
}

function observe(doc: Document): FixtureObservation | undefined {
  if (!isRecordV2FixtureEligible(doc)) return undefined;
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

class FixtureDriver implements RecordOrchestratorDriver {
  readonly #doc: Document;
  readonly #context: RecordRunContext;
  readonly #records: readonly ProjectProjectionResponse['projects'][number][];
  readonly #observations = new WeakMap<RecordRunCapture, FixtureObservation>();
  readonly #identities = new WeakMap<RecordRunCapture, string>();

  constructor(doc: Document, context: RecordRunContext, projection: ProjectProjectionResponse) {
    this.#doc = doc;
    this.#context = context;
    this.#records = projection.projects;
  }

  capture(): RecordRunCapture | RecordRunCaptureFailure {
    const observation = observe(this.#doc);
    if (!observation) return { status: 'request-human', snapshotVersion: 0, reason: 'record-list-unverified' };
    const capture = this.#context.capture(observation.source);
    if (capture.status === 'ready') {
      this.#observations.set(capture, observation);
      this.#identities.set(capture, this.identityEvidence(capture, observation));
    }
    return capture;
  }

  validateCapture(capture: RecordRunCapture): boolean {
    const previous = this.#observations.get(capture);
    const current = observe(this.#doc);
    if (!previous || !current || !recordObservationMatches(previous.scan, current.scan, capture.snapshot.recordListNodeId)) return false;
    if (this.#identities.get(capture) !== this.identityEvidence(capture, current)) return false;
    this.#observations.set(capture, current);
    return true;
  }

  private identityEvidence(capture: RecordRunCapture, observation: FixtureObservation): string {
    // Value-free comparison results detect renamed/changed cards between
    // steps without storing their text or hashes of private values.
    return JSON.stringify(capture.candidates.map(candidate => {
      const comparison = projectCardComparator(observation.scan.semanticTargets.get(candidate.recordNodeId));
      return { ready: comparison.ready, results: this.#records.map(record => comparison.compare(record)) };
    }));
  }

  plannerInput(capture: RecordRunCapture, active?: ActiveRecordTransaction): RepeatableRecordPlannerInput {
    const observation = this.#observations.get(capture);
    if (!observation) throw new Error('fixture observation missing');
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
    if (!observation) throw new Error('fixture observation missing');
    const list = observation.scan.semanticTargets.get(plan.recordListNodeId);
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
    if (!observation) throw new Error('fixture observation missing');
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
    return bindRecordEditor({
      plan,
      capture,
      activeTransaction: active,
      runContext: this.#context,
      scanState: observation.scan,
      provideValue: ({ scanFieldId }) => values.get(scanFieldId),
      rescan: () => this.capture(),
    });
  }
}

/** Creates the only v2 session currently available: a fixed local E2E recipe fed by a trusted projection. */
export function createRecordV2FixtureSession(doc: Document, projection: ProjectProjectionResponse,
  refreshProjection?: () => Promise<ProjectProjectionResponse>): RecordV2Session {
  if (!isRecordV2FixtureEligible(doc)) throw new Error('当前页面不是通用多记录填写测试页');
  const parsed = projectProjectionResponseSchema.safeParse(projection);
  if (!parsed.success || parsed.data.projects.length === 0
    || new Set(parsed.data.projects.map(project => project.id)).size !== parsed.data.projects.length) {
    throw new Error('项目档案投影格式无效');
  }
  const context = new RecordRunContext();
  const orchestrator = new RecordTransactionOrchestrator(context, new FixtureDriver(doc, context, parsed.data));
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
