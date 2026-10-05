import { AGENT_ACTION_KINDS, agentStepRequestSchema, parseAgentStepProposal, type AgentActionKind, type AgentStepRequest } from './nextStepProtocol';

export interface AgentObservation {
  /** Private tokens maintained by the page/profile bridge. Never sent to the model. */
  readonly context: string;
  readonly fingerprint: string;
  readonly pending: { readonly fields: number; readonly records: number; readonly blockers: number };
  readonly tasks: ReadonlyArray<{ readonly kind: AgentActionKind; readonly count: number }>;
}
export interface AgentActionResult { readonly state: 'progress' | 'deferred' | 'needs-user' | 'stopped' | 'failed' }
export interface AgentStepPorts {
  observe(signal: AbortSignal): Promise<AgentObservation>;
  decide(request: AgentStepRequest, signal: AbortSignal): Promise<unknown>;
  /** Verify exact live scan/control identity, connection and profile before any action. */
  verify(observation: AgentObservation, signal: AbortSignal): Promise<boolean>;
  /** Uses a guarded executor. Progress is a verified write/save or a fresh, bounded option observation; neither waives pending work. */
  execute(kind: AgentActionKind, observation: AgentObservation, signal: AbortSignal): Promise<AgentActionResult>;
}
export interface AgentRunResult {
  readonly state: 'complete' | 'needs-user' | 'stopped' | 'invalid-observation' | 'invalid-proposal' | 'context-changed' | 'no-progress' | 'limit-reached' | 'unavailable';
  readonly steps: number;
  readonly pending?: AgentObservation['pending'];
}
function validObservation(value: AgentObservation): boolean {
  return typeof value.context === 'string' && value.context.length > 0
    && typeof value.fingerprint === 'string' && value.fingerprint.length > 0
    && value.tasks.every(task => AGENT_ACTION_KINDS.includes(task.kind));
}
function requestFor(observation: AgentObservation): AgentStepRequest | undefined {
  if (!validObservation(observation)) return undefined;
  const pending = { ...observation.pending };
  const tasks = observation.tasks.map((task, index) => ({ ref: `task-${index}`, kind: task.kind, count: task.count }));
  const request = { protocol: 1, requestId: crypto.randomUUID(), pending, tasks,
    canComplete: pending.fields === 0 && pending.records === 0 && pending.blockers === 0 && tasks.length === 0 };
  const parsed = agentStepRequestSchema.safeParse(request);
  return parsed.success ? parsed.data : undefined;
}

/** One explicit run: observe -> decide -> verify -> execute -> observe. No arbitrary button exploration. */
export async function runAgentSteps(ports: AgentStepPorts, signal: AbortSignal, maxSteps = 12): Promise<AgentRunResult> {
  const budget = Number.isInteger(maxSteps) && maxSteps >= 1 && maxSteps <= 30 ? maxSteps : 12;
  let steps = 0; let original: string | undefined; let last: AgentObservation | undefined;
  const visited = new Set<string>();
  const result = (state: AgentRunResult['state']): AgentRunResult => ({ state, steps,
    ...(last ? { pending: { ...last.pending } } : {}) });
  try {
    for (;;) {
      signal.throwIfAborted();
      const observation = await ports.observe(signal); signal.throwIfAborted();
      const request = requestFor(observation);
      if (!request) return result('invalid-observation');
      last = observation;
      original ??= observation.context;
      if (observation.context !== original) return result('context-changed');
      if (!await ports.verify(observation, signal)) return result('context-changed');
      signal.throwIfAborted();
      // Only fresh local evidence can terminate a whole-page run. A model cannot waive pending work.
      if (request.canComplete) return result('complete');
      if (!request.tasks.length) return result('needs-user');
      if (steps >= budget) return result('limit-reached');
      const response = await ports.decide(structuredClone(request), signal); signal.throwIfAborted();
      const proposal = parseAgentStepProposal(response, request);
      if (!proposal) return result('invalid-proposal');
      if (!await ports.verify(observation, signal)) return result('context-changed');
      signal.throwIfAborted();
      if (proposal.status === 'needs-user') return result('needs-user');
      // complete was impossible with tasks; parsing has already rejected it.
      const selected = request.tasks.find(task => task.ref === proposal.ref)!;
      const identity = JSON.stringify([observation.fingerprint, selected.kind]);
      if (visited.has(identity)) return result('no-progress');
      visited.add(identity); steps++;
      const executed = await ports.execute(selected.kind, observation, signal); signal.throwIfAborted();
      if (executed.state === 'deferred') continue;
      if (executed.state !== 'progress') return result(executed.state === 'stopped' ? 'stopped'
        : executed.state === 'needs-user' ? 'needs-user' : 'no-progress');
    }
  } catch { return result(signal.aborted ? 'stopped' : 'unavailable'); }
}
