import type { RecordWorkflowPhase, RecordWorkflowState } from '../workflow/recordState';
import type { RecordV2Session } from './recordV2Gateway';
import { MAX_RECORD_EDITOR_EXPANSIONS } from '../planner/recordPlanner';
export type ProjectionLoader<P> = () => Promise<P>;
export type RecordSessionFactory<P> = (doc: Document, projection: P, refresh: ProjectionLoader<P>) => RecordV2Session;
export type RecordPagePreparation<P> = (projection: P, context: Readonly<{
  signal: AbortSignal; current: () => boolean; refresh: ProjectionLoader<P>;
}>) => Promise<Readonly<{ ready: true }> | Readonly<{ ready: false; reason: string }>>;
export interface RecordWorkflowOptions<P> {
  readonly availability: (doc: Document) => Readonly<{ eligible: boolean; reason?: string }>;
  readonly prepare: (supplied: unknown) => Readonly<{ success: true; data: P; count: number }> | Readonly<{ success: false; reason?: string }>;
  /** Captures private targets before loading. Availability remains read-only. */
  readonly capturePreparation?: (doc: Document) => RecordPagePreparation<P> | undefined;
}
/** Page-local bounded runner. Closing a popup cannot cancel or restart it. */
export class RecordWorkflow<P> {
  readonly #doc: Document;
  readonly #load: ProjectionLoader<P>;
  readonly #factory: RecordSessionFactory<P>;
  readonly #options: RecordWorkflowOptions<P>;
  #phase: RecordWorkflowPhase = 'idle';
  #reason?: string;
  #total = 0;
  #generation = 0;
  #url?: string;
  #session?: RecordV2Session;
  #runner?: Promise<void>;
  #loading = false;
  #pauseRequested = false;
  #preparationController?: AbortController;

  constructor(doc: Document, load: ProjectionLoader<P>, factory: RecordSessionFactory<P>, options: RecordWorkflowOptions<P>) {
    this.#doc = doc; this.#load = load; this.#factory = factory; this.#options = options;
  }

  holdsPage(): boolean {
    return this.#loading || Boolean(this.#runner) || ['preparing', 'running', 'pausing', 'paused', 'review'].includes(this.#phase);
  }

  status(): RecordWorkflowState {
    if (this.#url && this.#doc.URL !== this.#url && this.holdsPage() && this.#phase !== 'stopped') {
      this.#generation++; this.#preparationController?.abort(); this.#session?.stop(); this.#phase = 'review'; this.#reason = 'page-changed';
    }
    const availability = this.holdsPage() ? undefined : this.#options.availability(this.#doc);
    const reason = this.#reason ?? availability?.reason;
    return Object.freeze({ phase: this.#phase, total: this.#total, canStart: availability?.eligible === true,
      ...(reason ? { reason } : {}) });
  }

  async start(): Promise<RecordWorkflowState> {
    if (this.holdsPage()) throw new Error('已有栏目任务，请先停止并等待当前操作结束');
    this.#session?.stop(); this.#session = undefined;
    const generation = ++this.#generation;
    this.#url = this.#doc.URL; this.#phase = 'preparing'; this.#reason = undefined; this.#total = 0; this.#loading = true; this.#pauseRequested = false;
    const controller = new AbortController(); this.#preparationController = controller;
    try {
      const preparePage = this.#options.capturePreparation?.(this.#doc);
      const supplied = await this.#load();
      if (generation !== this.#generation) return this.status();
      if (this.#doc.URL !== this.#url) { this.#phase = 'review'; this.#reason = 'page-changed'; return this.status(); }
      const parsed = this.#options.prepare(supplied);
      if (!parsed.success || !Number.isSafeInteger(parsed.count) || parsed.count < 0 || parsed.count > 100 || !parsed.count) {
        this.#phase = 'review'; this.#reason = parsed.success ? (parsed.count === 0 ? 'profile-value-missing' : 'profile-projection-unavailable') : (/^[a-z0-9-]{1,80}$/u.test(parsed.reason ?? '') ? parsed.reason : 'profile-projection-unavailable');
        return this.status();
      }
      if (preparePage) {
        const result = await preparePage(parsed.data, { signal: controller.signal, refresh: this.#load,
          current: () => generation === this.#generation && this.#doc.URL === this.#url && !controller.signal.aborted });
        if (generation !== this.#generation) return this.status();
        if (this.#doc.URL !== this.#url) { this.#phase = 'review'; this.#reason = 'page-changed'; return this.status(); }
        if (!result.ready) {
          this.#phase = 'review'; this.#reason = /^[a-z0-9-]{1,80}$/u.test(result.reason) ? result.reason : 'page-preparation-failed';
          return this.status();
        }
      }
      this.#session = this.#factory(this.#doc, parsed.data, this.#load);
      this.#total = parsed.count; this.#phase = 'running'; this.#launch(generation);
    } catch {
      if (generation === this.#generation) {
        this.#phase = 'review';
        this.#reason = this.#options.availability(this.#doc).reason ?? 'profile-projection-unavailable';
      }
    } finally { this.#loading = false; if (this.#preparationController === controller) this.#preparationController = undefined; }
    return this.status();
  }

  pause(): RecordWorkflowState {
    if (this.#phase !== 'running' || !this.#session) throw new Error('没有正在运行的栏目任务');
    this.#pauseRequested = true; this.#phase = 'pausing'; return this.status();
  }

  async resume(): Promise<RecordWorkflowState> {
    if (!['paused', 'pausing'].includes(this.#phase) || !this.#session) throw new Error('请先检查网页，再重新启动栏目任务');
    const generation = this.#generation;
    await this.#runner;
    if (generation !== this.#generation || this.status().phase !== 'paused') return this.status();
    this.#pauseRequested = false;
    // Cooperative pause preserves the completed step's capability and capture.
    // The next advance still refreshes the profile and validates live DOM state.
    if (this.#session.state === 'paused') this.#session.resume();
    this.#phase = 'running'; this.#launch(++this.#generation); return this.status();
  }

  stop(): RecordWorkflowState {
    this.#generation++; this.#preparationController?.abort(); this.#session?.stop(); this.#phase = 'stopped'; this.#reason = undefined; this.#pauseRequested = false;
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

