import { afterEach, expect, it, vi } from 'vitest';
import { runAgentWithVisualFallback, type AgentVisualPorts } from '../src/popup/agentVisualWorkflow';
import { scanDocument } from '../src/content/scanner';
import { matchFields } from '../src/matching/ruleMatcher';
import { createEmptyProfile } from '../src/profile/schema';
import { agentOptionFieldIds } from '../src/agent/optionFieldScope';
import type { PagePlan } from '../src/popup/bridge';
import type { AgentPageResult } from '../src/popup/agentBridge';
import type { VisualSkipReason } from '../src/popup/visualOutcome';
import type { MatchResult } from '../src/shared/types';

afterEach(() => { document.body.innerHTML = ''; });
function setup() {
  document.body.innerHTML = '<form><section><h2>个人信息</h2><label for="unknown">陌生问题甲</label><input id="unknown" required></section></form>';
  const profile = createEmptyProfile(); profile.basic.name = '虚构候选人';
  const scan = scanDocument();
  const plan: PagePlan = { tabId: 1, scan: scan.result, matches: matchFields(scan.result.fields, profile), profile };
  const id = plan.scan.fields[0]!.id; let context = 'fixed'; let ownerHeld = false;
  const first: AgentPageResult = { plan, result: { state: 'needs-user', steps: 1, pending: { fields: 1, records: 0, blockers: 1 } }, outcomes: [] };
  const candidate: MatchResult = { ...plan.matches[0]!, source: 'llm', status: 'review', confidence: 0.9,
    matchedProfileKey: 'basic.name', value: profile.basic.name };
  const visualPlan = { ...plan, matches: [candidate] };
  const ports: AgentVisualPorts = {
    context: vi.fn(async () => context), consent: vi.fn(async () => true), scope: value => agentOptionFieldIds(value.scan), verify: vi.fn(async () => true),
    text: vi.fn(async () => {
      ownerHeld = true; ownerHeld = false;
      return first;
    }),
    visual: vi.fn(async () => {
      expect(ownerHeld).toBe(false);
      return { plan: visualPlan, outcome: { identified: 1, eligible: 1, skipped: {} } };
    }),
    fill: vi.fn(async () => { expect(ownerHeld).toBe(false); return [{ fieldId: id, status: 'filled' as const, reason: 'verified' }]; }),
  };
  return { plan, first, id, visualPlan, ports, changeContext: () => { context = 'changed'; } };
}
it('hands off a completed text owner, applies only the local candidate, and derives completion from a fresh observation', async () => {
  const s = setup(); const progress = vi.fn();
  vi.mocked(s.ports.text).mockResolvedValueOnce(s.first).mockImplementationOnce(async (_signal, remaining, report) => {
    expect(remaining).toBe(10); report?.({ phase: 'observing', steps: 0 });
    return { plan: s.visualPlan, result: { state: 'complete', steps: 0, pending: { fields: 0, records: 0, blockers: 0 } }, outcomes: [] };
  });
  const result = await runAgentWithVisualFallback(s.ports, new AbortController().signal, progress);
  expect(result.result).toEqual({ state: 'complete', steps: 2, pending: { fields: 0, records: 0, blockers: 0 } });
  expect(s.ports.visual).toHaveBeenCalledTimes(1); expect(s.ports.fill).toHaveBeenCalledWith(s.visualPlan, new Set([s.id]), expect.any(AbortSignal));
  expect(result.outcomes).toHaveLength(1); expect(progress.mock.calls.map(([status]) => status.steps)).toEqual([2, 2]);
});
it('does not request images without separate visual consent', async () => {
  const s = setup(); vi.mocked(s.ports.consent).mockResolvedValue(false);
  expect(await runAgentWithVisualFallback(s.ports, new AbortController().signal)).toBe(s.first);
  expect(s.ports.visual).not.toHaveBeenCalled(); expect(s.ports.fill).not.toHaveBeenCalled();
});
it.each(['complete', 'stopped', 'unavailable', 'invalid-proposal', 'limit-reached', 'no-progress'] as const)('does not retry %s as an image fallback', async state => {
  const s = setup(); Object.assign(s.first, { result: { ...s.first.result, state } });
  expect(await runAgentWithVisualFallback(s.ports, new AbortController().signal)).toBe(s.first);
  expect(s.ports.visual).not.toHaveBeenCalled();
});
it('keeps the shared twelve-step limit rather than restarting an exhausted text run', async () => {
  const s = setup(); Object.assign(s.first, { result: { ...s.first.result, steps: 11 } });
  expect(await runAgentWithVisualFallback(s.ports, new AbortController().signal)).toBe(s.first);
  expect(s.ports.visual).not.toHaveBeenCalled();
});
it('excludes repeated and unclassified experience sections using the actual semantic graph', async () => {
  const s = setup();
  document.body.innerHTML = '<section><h2>项目经历</h2><label>陌生问题甲<input required></label></section>';
  const scan = scanDocument(); Object.assign(s.first, { plan: { ...s.plan, scan: scan.result, matches: matchFields(scan.result.fields, s.plan.profile) } });
  await runAgentWithVisualFallback(s.ports, new AbortController().signal);
  expect(agentOptionFieldIds(scan.result).size).toBe(0); expect(s.ports.visual).not.toHaveBeenCalled();
});
it('stops at a changed original context before opening a visual transaction', async () => {
  const s = setup(); vi.mocked(s.ports.text).mockImplementationOnce(async () => { s.changeContext(); return s.first; });
  expect((await runAgentWithVisualFallback(s.ports, new AbortController().signal)).result.state).toBe('context-changed');
  expect(s.ports.visual).not.toHaveBeenCalled(); expect(s.ports.fill).not.toHaveBeenCalled();
});
it('rejects a late visual result after stop or changed profile/connection scope', async () => {
  for (const stop of [false, true]) {
    const s = setup(); const controller = new AbortController();
    vi.mocked(s.ports.visual).mockImplementationOnce(async () => {
      if (stop) controller.abort(); else s.changeContext();
      return { plan: s.visualPlan, outcome: { identified: 1, eligible: 1, skipped: {} } };
    });
    expect((await runAgentWithVisualFallback(s.ports, controller.signal)).result.state).toBe(stop ? 'stopped' : 'context-changed');
    expect(s.ports.fill).not.toHaveBeenCalled();
  }
});
it.each(['stale-page', 'unavailable', 'invalid-proposal', 'disabled', 'local-scope','browser-capability','unsupported-component','unsupported-layout'] as VisualSkipReason[])('keeps earlier image candidates for review on %s instead of automatically writing them', async reason => {
  const s = setup(); vi.mocked(s.ports.visual).mockResolvedValueOnce({ plan: s.visualPlan, outcome: { identified: 1, eligible: 2, skipped: { [reason]: 1 } } });
  const result = await runAgentWithVisualFallback(s.ports, new AbortController().signal);
  expect(result.plan).toBe(s.visualPlan); expect(result.result.state).toBe('needs-user'); expect(s.ports.fill).not.toHaveBeenCalled();
  expect(result.visualOutcome?.skipped).toEqual({[reason]:1});
});
it('rejects replaced scans, duplicate candidates and field references outside its verified scope', async () => {
  for (const invalid of ['scan', 'duplicate', 'outside']) {
    const s = setup(); const plan = { ...s.visualPlan, matches: [...s.visualPlan.matches] };
    if (invalid === 'scan') plan.scan = { ...s.plan.scan };
    if (invalid === 'duplicate') plan.matches.push(plan.matches[0]!);
    if (invalid === 'outside') plan.matches[0] = { ...plan.matches[0]!, fieldId: 'unrelated-record-field' };
    vi.mocked(s.ports.visual).mockResolvedValueOnce({ plan, outcome: { identified: 1, eligible: 1, skipped: {} } });
    const result = await runAgentWithVisualFallback(s.ports, new AbortController().signal);
    expect(result.result.state).not.toBe('complete'); expect(s.ports.fill).not.toHaveBeenCalled();
  }
});
it('keeps missing facts unanswered and never calls the writer with an empty candidate set', async () => {
  const s = setup(); s.visualPlan.matches[0]!.value = undefined;
  expect((await runAgentWithVisualFallback(s.ports, new AbortController().signal)).result.state).toBe('needs-user');
  expect(s.ports.fill).not.toHaveBeenCalled();
});
it('runs at most one image fallback and preserves fresh remaining fields and record blockers', async () => {
  const s = setup();
  vi.mocked(s.ports.visual).mockResolvedValueOnce({ plan: s.visualPlan, outcome: { identified: 1, eligible: 4, skipped: { budget: 1 } } });
  vi.mocked(s.ports.text).mockResolvedValueOnce(s.first).mockResolvedValueOnce({ plan: s.plan,
    result: { state: 'needs-user', steps: 1, pending: { fields: 1, records: 2, blockers: 1 } }, outcomes: [] });
  const result = await runAgentWithVisualFallback(s.ports, new AbortController().signal);
  expect(result.result).toEqual({ state: 'needs-user', steps: 3, pending: { fields: 1, records: 2, blockers: 1 } });
  expect(s.ports.text).toHaveBeenCalledTimes(2); expect(s.ports.visual).toHaveBeenCalledTimes(1);
});
