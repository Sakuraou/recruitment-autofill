import { describe, expect, it, vi } from 'vitest';
import { agentStepRequestSchema, parseAgentStepProposal, type AgentStepRequest } from '../src/agent/nextStepProtocol';
import { runAgentSteps, type AgentObservation, type AgentStepPorts } from '../src/agent/nextStepWorkflow';
const request = (): AgentStepRequest => ({ protocol: 1, requestId: crypto.randomUUID(), pending: { fields: 3, records: 2, blockers: 0 },
  tasks: [{ ref: 'task-0', kind: 'fill-visible', count: 3 }, { ref: 'task-1', kind: 'project-records', count: 2 }], canComplete: false });
const act = (value: AgentStepRequest, ref = value.tasks[0]?.ref ?? 'task-0'): unknown => ({ requestId: value.requestId, status: 'act', ref, reason: 'available-task' });
const observe = (id = 'start', tasks: AgentObservation['tasks'] = [{ kind: 'fill-visible', count: 1 }]): AgentObservation => ({
  context: 'private-page-profile-connection-identity', fingerprint: id, pending: { fields: tasks.some(t => t.kind === 'fill-visible') ? 1 : 0,
    records: tasks.filter(t => t.kind !== 'fill-visible').reduce((s, t) => s + t.count, 0), blockers: 0 }, tasks });
function setup(observations = [observe(), observe('done', [])]) {
  let index = 0;
  const ports: AgentStepPorts = { observe: vi.fn(async () => observations[Math.min(index++, observations.length - 1)]!),
    decide: vi.fn(async value => act(value)), verify: vi.fn(async () => true), execute: vi.fn(async () => ({ state: 'progress' as const })) };
  return { ports, signal: new AbortController().signal };
}
describe('single-step model contract', () => {
  it('accepts only one current capability', () => { const r = request(); expect(parseAgentStepProposal(act(r, 'task-1'), r)?.ref).toBe('task-1'); });
  it.each(['task-2', 'submit', '#add', 'task-100'])('rejects unknown or executable ref %s', ref => {
    const r = request(); expect(parseAgentStepProposal(act(r, ref), r)).toBeUndefined();
  });
  it('rejects old requests', () => { const r = request(); expect(parseAgentStepProposal(act(request()), r)).toBeUndefined(); });
  it.each(['script', 'selector', 'value', 'actions', 'url'])('rejects extra %s authority', key => {
    const r = request(); expect(parseAgentStepProposal({ ...act(r) as object, [key]: 'injected' }, r)).toBeUndefined();
  });
  it('rejects complete while fields or records remain', () => {
    const r = request(); expect(parseAgentStepProposal({ requestId: r.requestId, status: 'complete', ref: null, reason: 'no-pending-work' }, r)).toBeUndefined();
  });
  it('rejects complete while only unsupported blockers remain', () => {
    const r: AgentStepRequest = { ...request(), pending: { fields: 0, records: 0, blockers: 1 }, tasks: [], canComplete: false };
    expect(parseAgentStepProposal({ requestId: r.requestId, status: 'complete', ref: null, reason: 'no-pending-work' }, r)).toBeUndefined();
  });
  it('allows completion only with an independently clean request', () => {
    const r: AgentStepRequest = { ...request(), pending: { fields: 0, records: 0, blockers: 0 }, tasks: [], canComplete: true };
    expect(parseAgentStepProposal({ requestId: r.requestId, status: 'complete', ref: null, reason: 'no-pending-work' }, r)?.status).toBe('complete');
  });
  it('rejects falsified local completion gate', () => { expect(agentStepRequestSchema.safeParse({ ...request(), canComplete: true }).success).toBe(false); });
  it('rejects duplicated capabilities', () => { const r = request(); r.tasks.push({ ...r.tasks[0]! }); expect(agentStepRequestSchema.safeParse(r).success).toBe(false); });
  it('rejects overlapping record counts', () => { const r = request(); r.tasks.push({ ref: 'task-2', kind: 'education-records', count: 1 }); expect(agentStepRequestSchema.safeParse(r).success).toBe(false); });
  it.each([-1, 0.5, 10001, NaN])('rejects impossible pending count %s', fields => { expect(agentStepRequestSchema.safeParse({ ...request(), pending: { fields, records: 2, blockers: 0 } }).success).toBe(false); });
  it('allows needs-user with no action ref', () => { const r = request(); expect(parseAgentStepProposal({ requestId: r.requestId, status: 'needs-user', ref: null, reason: 'uncertain' }, r)?.status).toBe('needs-user'); });
  it('rejects help that also selects an action', () => { const r = request(); expect(parseAgentStepProposal({ requestId: r.requestId, status: 'needs-user', ref: 'task-0', reason: 'uncertain' }, r)).toBeUndefined(); });
});
describe('bounded agent observation loop', () => {
  it('fills, observes a newly revealed education list, and handles all records before completion', async () => {
    const { ports, signal } = setup([observe(), observe('education', [{ kind: 'education-records', count: 2 }]),
      observe('projects', [{ kind: 'project-records', count: 3 }]), observe('done', [])]);
    expect(await runAgentSteps(ports, signal)).toMatchObject({ state: 'complete', steps: 3 });
    expect(vi.mocked(ports.execute).mock.calls.map(call => call[0])).toEqual(['fill-visible', 'education-records', 'project-records']);
  });
  it('does not claim completion when known tasks have finished but other required fields remain', async () => {
    const pending = { ...observe('missing', []), pending: { fields: 1, records: 0, blockers: 1 } };
    const { ports, signal } = setup([observe(), pending]);
    expect(await runAgentSteps(ports, signal)).toMatchObject({ state: 'needs-user', steps: 1, pending: pending.pending });
    expect(ports.decide).toHaveBeenCalledTimes(1);
  });
  it('never sends private context or fingerprint to the provider', async () => {
    const { ports, signal } = setup(); await runAgentSteps(ports, signal);
    const sent = JSON.stringify(vi.mocked(ports.decide).mock.calls);
    expect(sent).not.toContain('private-page'); expect(sent).not.toContain('fingerprint'); expect(sent).not.toContain('start');
  });
  it('rejects model-declared completion without invoking an executor', async () => {
    const { ports, signal } = setup(); ports.decide = vi.fn(async r => ({ requestId: r.requestId, status: 'complete', ref: null, reason: 'no-pending-work' }));
    expect((await runAgentSteps(ports, signal)).state).toBe('invalid-proposal'); expect(ports.execute).not.toHaveBeenCalled();
  });
  it('rejects replaced controls after inference and before writing', async () => {
    const { ports, signal } = setup(); vi.mocked(ports.verify).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await runAgentSteps(ports, signal)).state).toBe('context-changed'); expect(ports.execute).not.toHaveBeenCalled();
  });
  it('does not call the model if initial controls are stale', async () => {
    const { ports, signal } = setup(); vi.mocked(ports.verify).mockResolvedValue(false);
    expect((await runAgentSteps(ports, signal)).state).toBe('context-changed'); expect(ports.decide).not.toHaveBeenCalled();
  });
  it('stops before the next task when profile or page context changes', async () => {
    const { ports, signal } = setup([observe(), { ...observe('next'), context: 'changed' }]);
    expect((await runAgentSteps(ports, signal)).state).toBe('context-changed'); expect(ports.execute).toHaveBeenCalledTimes(1);
  });
  it('cannot use provider-side mutation to expand current authority', async () => {
    const { ports, signal } = setup(); ports.decide = vi.fn(async r => { r.tasks[0]!.ref = 'task-9'; return act(r, 'task-9'); });
    expect((await runAgentSteps(ports, signal)).state).toBe('invalid-proposal'); expect(ports.execute).not.toHaveBeenCalled();
  });
  it('uses the selected current record capability without mixing categories', async () => {
    const start = observe('records', [{ kind: 'education-records', count: 2 }, { kind: 'project-records', count: 3 }]);
    const { ports, signal } = setup([start, observe('done', [])]); ports.decide = vi.fn(async r => act(r, 'task-1'));
    await runAgentSteps(ports, signal); expect(vi.mocked(ports.execute).mock.calls[0]?.[0]).toBe('project-records');
  });
  it('does not repeat an action after a false progress claim on an unchanged observation', async () => {
    const { ports, signal } = setup([observe()]);
    expect(await runAgentSteps(ports, signal)).toMatchObject({ state: 'no-progress', steps: 1 }); expect(ports.execute).toHaveBeenCalledTimes(1);
  });
  it('can defer unsupported ordinary fields, process another capability and still report remaining work', async () => {
    const record = observe('record', [{ kind: 'project-records', count: 2 }]);
    const pending = { ...observe('end', []), pending: { fields: 1, records: 0, blockers: 1 } };
    const { ports, signal } = setup([observe(), record, pending]);
    vi.mocked(ports.execute).mockResolvedValueOnce({ state: 'deferred' }).mockResolvedValueOnce({ state: 'progress' });
    expect(await runAgentSteps(ports, signal)).toMatchObject({ state: 'needs-user', steps: 2 });
    expect(vi.mocked(ports.execute).mock.calls.map(call => call[0])).toEqual(['fill-visible', 'project-records']);
  });
  it.each(['needs-user', 'stopped', 'failed'] as const)('preserves an executor %s without starting another category', async state => {
    const { ports, signal } = setup(); vi.mocked(ports.execute).mockResolvedValue({ state });
    expect((await runAgentSteps(ports, signal)).state).toBe(state === 'failed' ? 'no-progress' : state); expect(ports.observe).toHaveBeenCalledTimes(1);
  });
  it('enforces the action budget but still observes the final result', async () => {
    const { ports, signal } = setup([observe(), observe('next')]);
    expect(await runAgentSteps(ports, signal, 1)).toMatchObject({ state: 'limit-reached', steps: 1 }); expect(ports.observe).toHaveBeenCalledTimes(2);
  });
  it('can complete at the budget boundary only after local re-observation', async () => {
    const { ports, signal } = setup(); expect(await runAgentSteps(ports, signal, 1)).toMatchObject({ state: 'complete', steps: 1 });
  });
  it('aborts a late model response before any action', async () => {
    const { ports } = setup(); const stop = new AbortController(); ports.decide = vi.fn(async r => { stop.abort(); return act(r); });
    expect((await runAgentSteps(ports, stop.signal)).state).toBe('stopped'); expect(ports.execute).not.toHaveBeenCalled();
  });
  it('does not start observation after Stop', async () => {
    const { ports } = setup(); const stop = new AbortController(); stop.abort();
    expect((await runAgentSteps(ports, stop.signal)).state).toBe('stopped'); expect(ports.observe).not.toHaveBeenCalled();
  });
  it('does not include thrown personal literals in a failure', async () => {
    const { ports, signal } = setup(); ports.execute = vi.fn(async () => { throw new Error('private identity value'); });
    const result = await runAgentSteps(ports, signal); expect(result.state).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain('private');
  });
});
