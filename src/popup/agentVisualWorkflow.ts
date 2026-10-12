import type { AgentPageResult } from './agentBridge';
import type { PagePlan } from './bridge';
import type { AgentRunStatus } from '../agent/runController';
import type { FillOutcome } from '../shared/types';
import type { VisualOutcome } from './visualOutcome';
import { UNKNOWN_FIELD_REASON } from '../matching/ruleMatcher';

export interface AgentVisualPorts {
  context(): Promise<string>;
  /** Resolves only after releasing its page owner. All phases share one step budget. */
  text(signal: AbortSignal, remaining: number, progress?: (status: AgentRunStatus) => void): Promise<AgentPageResult>;
  consent(): Promise<boolean>;
  scope(plan: PagePlan): ReadonlySet<string>;
  verify(plan: PagePlan): Promise<boolean>;
  visual(plan: PagePlan, signal: AbortSignal, ids: ReadonlySet<string>): Promise<{ plan: PagePlan; outcome: VisualOutcome }>;
  fill(plan: PagePlan, ids: Set<string>, signal: AbortSignal): Promise<FillOutcome[]>;
}

/** Text first, at most one separately consented visual fallback, then fresh observation.
 * Screenshot proposals keep their local value checks; only this explicit Agent intent may apply them. */
export async function runAgentWithVisualFallback(ports: AgentVisualPorts, signal: AbortSignal,
  progress?: (status: AgentRunStatus) => void): Promise<AgentPageResult> {
  const budget = 12; let latest: AgentPageResult | undefined; let steps = 0;
  const outcomes: FillOutcome[] = [];
  let visualOutcome:VisualOutcome|undefined;
  const fail = (state: 'stopped' | 'context-changed' | 'unavailable'): AgentPageResult => ({
    result: { state, steps, ...(latest?.result.pending ? { pending: latest.result.pending } : {}) }, outcomes, ...(visualOutcome?{visualOutcome}:{}),
  });
  try {
    signal.throwIfAborted(); const original = await ports.context(); signal.throwIfAborted();
    const current = async () => { signal.throwIfAborted(); const value = await ports.context(); signal.throwIfAborted(); return value === original; };
    latest = await ports.text(signal, budget, progress); signal.throwIfAborted();
    steps = latest.result.steps; outcomes.push(...latest.outcomes);
    const plan = latest.plan;
    // Never retry errors, cancellations, model refusals, limits or an already complete page.
    if (latest.result.state !== 'needs-user' || !plan || !latest.result.pending?.fields || steps >= budget - 1) return latest;
    if (!await current()) return fail('context-changed');
    if (!await ports.consent()) return latest;
    const scope = ports.scope(plan);
    const ids = new Set(plan.scan.fields.filter(field => scope.has(field.id) && !field.hasValue && !field.disabled && !field.readOnly && !field.blockedReason
      && plan.matches.find(match => match.fieldId === field.id)?.reason === UNKNOWN_FIELD_REASON).map(field => field.id));
    if (!ids.size) return latest;
    if (!await current() || !await ports.verify(plan)) return fail('context-changed');
    steps++; progress?.({ phase: 'acting', steps, pending: latest.result.pending });
    const visual = await ports.visual(plan, signal, ids); signal.throwIfAborted();
    visualOutcome=visual.outcome;
    if (!await current() || !await ports.verify(plan)) return fail('context-changed');
    if (visual.plan.scan !== plan.scan || JSON.stringify(visual.plan.profile) !== JSON.stringify(plan.profile) || visual.plan.tabId !== plan.tabId)
      return fail('context-changed');
    const next = { ...latest, plan: visual.plan, result: { ...latest.result, steps }, visualOutcome };
    // A lifecycle failure or uncertain termination must never turn earlier review
    // candidates into automatic writes. Budget leftovers alone are harmless.
    if (!visual.outcome.identified || Object.entries(visual.outcome.skipped).some(([reason, count]) => reason !== 'budget' && !!count)) return next;
    const replacements = visual.plan.matches.filter(match => {
      const before = plan.matches.find(item => item.fieldId === match.fieldId);
      return match !== before;
    });
    if (visual.plan.matches.length !== plan.matches.length || new Set(visual.plan.matches.map(match => match.fieldId)).size !== visual.plan.matches.length
      || replacements.length > 3 || replacements.length !== visual.outcome.identified
      || replacements.some(match => !ids.has(match.fieldId) || match.source !== 'llm' || match.status !== 'review')) return next;
    const selected = new Set(replacements.filter(match => match.confidence >= 0.9 && match.value !== undefined).map(match => match.fieldId));
    if (!selected.size) return next;
    if (!await current() || !await ports.consent()) return fail('context-changed');
    const filled = await ports.fill(visual.plan, selected, signal); signal.throwIfAborted(); outcomes.push(...filled);
    if (!filled.some(item => selected.has(item.fieldId) && item.status === 'filled')) return { ...next, outcomes };
    if (!await current()) return fail('context-changed');
    // Completion/pending counts come from a new full text observation, never from
    // the screenshot count. Failed records remain pending; visual runs only once.
    latest = await ports.text(signal, budget - steps, status => progress?.({ ...status, steps: status.steps + steps }));
    signal.throwIfAborted();
    if (!await current()) return fail('context-changed');
    steps += latest.result.steps; outcomes.push(...latest.outcomes);
    return { ...latest, result: { ...latest.result, steps }, outcomes, visualOutcome };
  } catch { return fail(signal.aborted ? 'stopped' : 'unavailable'); }
}
