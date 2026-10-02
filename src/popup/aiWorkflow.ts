import type { SemanticInferenceResult } from '../ai/semanticCandidates';
import type { FillOutcome } from '../shared/types';
import type { IterativeFillResult, PagePlan } from './bridge';

export interface AiWorkflowPorts {
  scan(): Promise<PagePlan>;
  fillRules(plan: PagePlan, signal: AbortSignal): Promise<IterativeFillResult>;
  infer(plan: PagePlan, signal: AbortSignal, excludedFieldIds: ReadonlySet<string>): Promise<SemanticInferenceResult>;
  fillModel(plan: PagePlan, ids: Set<string>, signal: AbortSignal): Promise<FillOutcome[]>;
  scanAfterFill(signal: AbortSignal): Promise<PagePlan>;
}
export interface AiFillResult {
  plan: PagePlan; outcomes: FillOutcome[]; rounds: number;
  state: SemanticInferenceResult['state'] | 'no-progress' | 'limit-reached';
}
function context(plan: PagePlan): string { return JSON.stringify({ tabId: plan.tabId, url: plan.scan.url, profile: plan.profile }); }
function fieldObservation(plan: PagePlan, fieldId: string): string {
  const field = plan.scan.fields.find(item => item.id === fieldId)!;
  const node = plan.scan.semanticGraph?.nodes.find(item => item.kind === 'field' && item.fieldId === fieldId);
  return JSON.stringify({ field: { ...field, id: undefined, groupId: undefined }, fingerprint: node?.structuralFingerprint });
}

/** A single explicit intent. Only progressing ordinary field writes can open another inference round. */
export async function runAiFillWorkflow(ports: AiWorkflowPorts, signal: AbortSignal): Promise<AiFillResult> {
  signal.throwIfAborted(); let plan = await ports.scan(); signal.throwIfAborted();
  const original = context(plan); const outcomes: FillOutcome[] = []; const observed = new Set<string>(); let rounds = 0;
  const verify = (value: PagePlan) => { signal.throwIfAborted(); if (context(value) !== original) throw new Error('页面或档案已变化，已停止后续 AI 填写。'); };
  for (let attempt = 0; attempt < 3; attempt++) {
    verify(plan); const ordinary = await ports.fillRules(plan, signal); verify(ordinary.plan);
    plan = ordinary.plan; outcomes.push(...ordinary.outcomes);
    const excluded = new Set(plan.scan.fields.filter(field => observed.has(fieldObservation(plan, field.id))).map(field => field.id));
    const inferred = await ports.infer(plan, signal, excluded); verify(plan);
    if (!['disabled', 'no-candidates'].includes(inferred.state)) rounds++;
    if (inferred.state !== 'ready') return { plan, outcomes, rounds, state: inferred.state };
    const fields = new Set(plan.scan.fields.map(field => field.id)); const references = new Set<string>();
    for (const match of inferred.matches) {
      if (!fields.has(match.fieldId) || references.has(match.fieldId) || match.source !== 'llm') return { plan, outcomes, rounds, state: 'rejected' };
      references.add(match.fieldId);
    }
    for (const match of inferred.matches) observed.add(fieldObservation(plan, match.fieldId));
    const replacements = new Map(inferred.matches.map(match => [match.fieldId, match]));
    plan = { ...plan, matches: plan.matches.map(match => replacements.get(match.fieldId) ?? match) };
    const ids = new Set(inferred.matches.filter(match => match.status === 'review' && match.value !== undefined && match.confidence >= 0.9).map(match => match.fieldId));
    if (!ids.size) return { plan, outcomes, rounds, state: 'no-progress' };
    signal.throwIfAborted(); const filled = await ports.fillModel(plan, ids, signal); signal.throwIfAborted();
    outcomes.push(...filled);
    if (!filled.some(item => item.status === 'filled')) return { plan, outcomes, rounds, state: 'no-progress' };
    const next = await ports.scanAfterFill(signal); verify(next); plan = next;
  }
  return { plan, outcomes, rounds, state: 'limit-reached' };
}
