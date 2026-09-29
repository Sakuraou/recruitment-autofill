import { bindRecordEditor } from '../planner/recordEditorBinder';
import type { ActiveRecordTransaction, ReadyRecordPlan, RepeatableRecordPlannerInput } from '../planner/recordPlanner';
import { RecordRunContext, type RecordRunCapture, type RecordRunCaptureFailure,
  type RecordRunCaptureSource } from '../planner/recordRunContext';
import { executeRecordAction } from '../planner/recordTransactionExecutor';
import { RecordTransactionOrchestrator, type RecordOrchestratorDriver } from '../planner/recordTransactionOrchestrator';
import type { RecordV2Session } from './recordV2Gateway';
import { scanDocument, type ScanState } from './scanner';
import { projectProjectionResponseSchema, type ProjectProjectionResponse } from '../profile/projection';

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

function fixtureIntentIndex(element: Element | undefined, recordCount: number): number | undefined {
  const raw = element?.getAttribute('data-ra-v2-intent');
  if (raw === null || raw === undefined || !/^\d$/u.test(raw)) return undefined;
  const index = Number(raw);
  return index >= 0 && index < recordCount ? index : undefined;
}

class FixtureDriver implements RecordOrchestratorDriver {
  readonly #doc: Document;
  readonly #context: RecordRunContext;
  readonly #records: readonly ProjectProjectionResponse['projects'][number][];
  readonly #observations = new WeakMap<RecordRunCapture, FixtureObservation>();

  constructor(doc: Document, context: RecordRunContext, projection: ProjectProjectionResponse) {
    this.#doc = doc;
    this.#context = context;
    this.#records = projection.projects;
  }

  capture(): RecordRunCapture | RecordRunCaptureFailure {
    const observation = observe(this.#doc);
    if (!observation) return { status: 'request-human', snapshotVersion: 0, reason: 'record-list-unverified' };
    const capture = this.#context.capture(observation.source);
    if (capture.status === 'ready') this.#observations.set(capture, observation);
    return capture;
  }

  plannerInput(capture: RecordRunCapture, active?: ActiveRecordTransaction): RepeatableRecordPlannerInput {
    const observation = this.#observations.get(capture);
    if (!observation) throw new Error('fixture observation missing');
    const candidates = capture.candidates.map((candidate) => {
      const target = observation.scan.semanticTargets.get(candidate.recordNodeId);
      return { ...candidate, identityReady: fixtureIntentIndex(target, this.#records.length) !== undefined };
    });
    return {
      snapshot: capture.snapshot,
      profileRevision: capture.profileRevision,
      intents: this.#records.map((_, intentIndex) => ({ intentIndex, recordType: 'project', identityReady: true })),
      candidates,
      editorCandidate: capture.editorCandidate,
      identityComparisons: candidates.flatMap((candidate) => {
        const target = observation.scan.semanticTargets.get(candidate.recordNodeId);
        const actual = fixtureIntentIndex(target, this.#records.length);
        return this.#records.map((_, intentIndex) => ({
          runToken: capture.runToken,
          snapshotToken: capture.snapshotToken,
          intentIndex,
          recordNodeId: candidate.recordNodeId,
          verdict: actual === undefined ? 'insufficient' as const
            : actual === intentIndex ? 'same' as const : 'different' as const,
          signals: actual === intentIndex ? ['primary' as const, 'secondary' as const] : ['primary' as const],
          provenance: 'site-recipe' as const,
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
        const editorOpen = list.querySelector('[data-ra-v2-editor="v1"]') !== null;
        if (plan.nextStep.kind === 'open-create') return editorOpen;
        if (plan.nextStep.kind !== 'save-created') return false;
        return !editorOpen
          && list.querySelectorAll('[data-ra-v2-card="v1"]').length
            === plan.nextStep.postcondition.expectedExistingRecordCount;
      },
      rescan: () => this.capture(),
      quietWindowMs: 10,
      timeoutMs: 2_000,
    });
  }

  bindEditor(plan: ReadyRecordPlan, capture: RecordRunCapture, active: ActiveRecordTransaction) {
    const observation = this.#observations.get(capture);
    if (!observation) throw new Error('fixture observation missing');
    return bindRecordEditor({
      plan,
      capture,
      activeTransaction: active,
      runContext: this.#context,
      scanState: observation.scan,
      provideValue: ({ scanFieldId }) => {
        const field = observation.scan.result.fields.find(candidate => candidate.id === scanFieldId);
        const record = this.#records[active.intentIndex];
        if (!field || !record) return undefined;
        const identity = `${field.label} ${field.ariaLabel} ${field.name} ${field.placeholder}`;
        if (/项目名称/u.test(identity)) return record.name;
        if (/项目描述/u.test(identity)) return record.description;
        return undefined;
      },
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
