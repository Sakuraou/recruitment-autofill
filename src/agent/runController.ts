import { runAgentSteps, type AgentRunResult, type AgentStepPorts } from './nextStepWorkflow';
export interface AgentRunStatus {
  readonly phase: 'idle' | 'observing' | 'thinking' | 'acting' | AgentRunResult['state'];
  readonly steps: number;
  readonly pending?: { readonly fields: number; readonly records: number; readonly blockers: number };
}
/** Owns one explicit run and prevents overlapping starts, including while a stopped request settles. */
export class AgentRunController {
  #status: AgentRunStatus = { phase: 'idle', steps: 0 };
  #controller?: AbortController;
  #runner?: Promise<void>;
  #generation = 0;
  status(): AgentRunStatus { return Object.freeze({ ...this.#status,
    ...(this.#status.pending ? { pending: Object.freeze({ ...this.#status.pending }) } : {}) }); }
  isActive(): boolean { return !!this.#runner; }
  start(ports: AgentStepPorts, maxSteps = 12): AgentRunStatus {
    if (this.#runner) throw new Error('已有 Agent 任务尚未结束');
    const controller = new AbortController(); this.#controller = controller;
    const generation = ++this.#generation;
    const current = () => generation === this.#generation && !controller.signal.aborted;
    this.#status = { phase: 'observing', steps: 0 };
    const wrapped: AgentStepPorts = {
      observe: async signal => {
        if (current()) this.#status = { ...this.#status, phase: 'observing' };
        const value = await ports.observe(signal);
        if (current() && [value.pending.fields, value.pending.records, value.pending.blockers].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 10_000))
          this.#status = { ...this.#status, pending: { ...value.pending } };
        return value;
      },
      decide: async (request, signal) => {
        if (current()) this.#status = { ...this.#status, phase: 'thinking' };
        return ports.decide(request, signal);
      },
      verify: (value, signal) => ports.verify(value, signal),
      execute: async (kind, observation, signal) => {
        if (current()) this.#status = { ...this.#status, phase: 'acting', steps: this.#status.steps + 1 };
        return ports.execute(kind, observation, signal);
      },
    };
    const task = runAgentSteps(wrapped, controller.signal, maxSteps).then(result => {
      if (current()) this.#status = { phase: result.state, steps: result.steps,
        ...(result.pending ? { pending: { ...result.pending } } : {}) };
    }).finally(() => {
      if (this.#runner === task) this.#runner = undefined;
      if (this.#controller === controller) this.#controller = undefined;
    });
    this.#runner = task; return this.status();
  }
  stop(): AgentRunStatus {
    this.#generation++; this.#controller?.abort();
    this.#status = { ...this.#status, phase: 'stopped' };
    return this.status();
  }
}
