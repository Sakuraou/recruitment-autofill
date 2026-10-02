import type { ProjectProjectionResponse } from '../profile/projection';
import { projectProjectionResponseSchema } from '../profile/projection';
import type { ProjectWorkflowPhase, ProjectWorkflowState } from '../workflow/projectRecords';
import type { RecordV2Session } from './recordV2Gateway';
import { createProjectRecordSession, projectRecordAvailability } from './projectRecordSession';
import { MAX_RECORD_EDITOR_EXPANSIONS } from '../planner/recordPlanner';

type ProjectionLoader = () => Promise<ProjectProjectionResponse>;
type SessionFactory = (doc: Document, projection: ProjectProjectionResponse, refresh: ProjectionLoader) => RecordV2Session;

/** Page-local bounded runner. Closing a popup cannot cancel or restart it. */
export class ProjectRecordWorkflow {
  readonly #doc: Document;
  readonly #load: ProjectionLoader;
  readonly #factory: SessionFactory;
  #phase: ProjectWorkflowPhase = 'idle';
  #reason?: string;
  #total = 0;
  #generation = 0;
  #url?: string;
  #session?: RecordV2Session;
  #runner?: Promise<void>;
  #loading = false;
  #pauseRequested = false;

  constructor(doc: Document, load: ProjectionLoader, factory: SessionFactory = createProjectRecordSession) {
    this.#doc = doc; this.#load = load; this.#factory = factory;
  }

  holdsPage(): boolean {
    return this.#loading || Boolean(this.#runner) || ['preparing', 'running', 'pausing', 'paused', 'review'].includes(this.#phase);
  }

  status(): ProjectWorkflowState {
    if (this.#url && this.#doc.URL !== this.#url && this.holdsPage() && this.#phase !== 'stopped') {
      this.#generation++; this.#session?.stop(); this.#phase = 'review'; this.#reason = 'page-changed';
    }
    const availability = this.holdsPage() ? undefined : projectRecordAvailability(this.#doc);
    const reason = this.#reason ?? availability?.reason;
    return Object.freeze({ phase: this.#phase, total: this.#total, canStart: availability?.eligible === true,
      ...(reason ? { reason } : {}) });
  }

  async start(): Promise<ProjectWorkflowState> {
    if (this.holdsPage()) throw new Error('已有项目任务，请先停止并等待当前操作结束');
    this.#session?.stop(); this.#session = undefined;
    const generation = ++this.#generation;
    this.#url = this.#doc.URL; this.#phase = 'preparing'; this.#reason = undefined; this.#total = 0; this.#loading = true; this.#pauseRequested = false;
    try {
      const supplied = await this.#load();
      if (generation !== this.#generation) return this.status();
      if (this.#doc.URL !== this.#url) { this.#phase = 'review'; this.#reason = 'page-changed'; return this.status(); }
      const parsed = projectProjectionResponseSchema.safeParse(supplied);
      if (!parsed.success || !parsed.data.projects.length) {
        this.#phase = 'review'; this.#reason = parsed.success ? 'profile-value-missing' : 'profile-projection-unavailable';
        return this.status();
      }
      this.#session = this.#factory(this.#doc, parsed.data, this.#load);
      this.#total = parsed.data.projects.length; this.#phase = 'running'; this.#launch(generation);
    } catch {
      if (generation === this.#generation) {
        this.#phase = 'review';
        this.#reason = projectRecordAvailability(this.#doc).reason ?? 'profile-projection-unavailable';
      }
    } finally { this.#loading = false; }
    return this.status();
  }

  pause(): ProjectWorkflowState {
    if (this.#phase !== 'running' || !this.#session) throw new Error('没有正在运行的项目任务');
    this.#pauseRequested = true; this.#phase = 'pausing'; return this.status();
  }

  async resume(): Promise<ProjectWorkflowState> {
    if (!['paused', 'pausing'].includes(this.#phase) || !this.#session) throw new Error('请先检查网页，再重新启动项目任务');
    const generation = this.#generation;
    await this.#runner;
    if (generation !== this.#generation || this.status().phase !== 'paused') return this.status();
    this.#pauseRequested = false;
    // Cooperative pause preserves the completed step's capability and capture.
    // The next advance still refreshes the profile and validates live DOM state.
    if (this.#session.state === 'paused') this.#session.resume();
    this.#phase = 'running'; this.#launch(++this.#generation); return this.status();
  }

  stop(): ProjectWorkflowState {
    this.#generation++; this.#session?.stop(); this.#phase = 'stopped'; this.#reason = undefined; this.#pauseRequested = false;
    return this.status();
  }

  #launch(generation: number): void {
    const task = this.#pump(generation); this.#runner = task;
    void task.then(() => { if (this.#runner === task) this.#runner = undefined; });
  }

  async #pump(generation: number): Promise<void> {
    const limit = this.#total * (3 + MAX_RECORD_EDITOR_EXPANSIONS) + 1;
    try {
      for (let step = 0; step < limit; step++) {
        if (generation !== this.#generation || !['running', 'pausing'].includes(this.status().phase) || !this.#session) return;
        if (this.#pauseRequested) { this.#phase = 'paused'; return; }
        const result = await this.#session.advance();
        if (generation !== this.#generation) return;
        if (!['running', 'pausing'].includes(this.status().phase)) return;
        if (result.status === 'complete') { this.#phase = 'complete'; return; }
        if (result.status !== 'advanced') {
          this.#phase = result.status === 'paused' ? 'paused' : result.status === 'stopped' ? 'stopped' : 'review';
          if (this.#phase === 'review') this.#reason = /^[a-z0-9-]{1,80}$/u.test(result.reason ?? '') ? result.reason : 'run-failed';
          return;
        }
        if (this.#pauseRequested) { this.#phase = 'paused'; return; }
        await new Promise<void>(done => setTimeout(done, 0));
      }
      if (generation === this.#generation) { this.#session?.stop(); this.#phase = 'review'; this.#reason = 'action-limit'; }
    } catch {
      if (generation === this.#generation) { this.#phase = 'review'; this.#reason = 'run-failed'; }
    }
  }
}
