import { expect, it, vi } from 'vitest';
import { AgentRunController } from '../src/agent/runController';
import type { AgentActionResult, AgentObservation, AgentStepPorts } from '../src/agent/nextStepWorkflow';
import type { AgentStepRequest } from '../src/agent/nextStepProtocol';
const observation = (): AgentObservation => ({ context: 'private-context', fingerprint: 'first', pending: { fields: 1, records: 0, blockers: 0 }, tasks: [{ kind: 'fill-visible', count: 1 }] });
const decide = (r: AgentStepRequest) => ({ requestId: r.requestId, status: 'act', ref: 'task-0', reason: 'available-task' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  let complete = false;
  const ports: AgentStepPorts = { observe: vi.fn(async () => complete ? { ...observation(), fingerprint: 'done', pending: { fields: 0, records: 0, blockers: 0 }, tasks: [] } : observation()),
    verify: vi.fn(async () => true), decide: vi.fn(async r => decide(r)), execute: vi.fn(async () => { complete = true; return { state: 'progress' as const }; }) };
  return { ports, run: new AgentRunController() };
}
it('starts one task, preserves verified progress and completes after a new observation', async () => {
  const { ports, run } = setup(); expect(run.start(ports).phase).toBe('observing');
  await vi.waitFor(() => expect(run.status()).toMatchObject({ phase: 'complete', steps: 1, pending: { fields: 0, records: 0, blockers: 0 } }));
  expect(ports.observe).toHaveBeenCalledTimes(2); expect(run.isActive()).toBe(false);
});
it('keeps Stop available while model inference waits and rejects a duplicate start', async () => {
  const { ports, run } = setup(); const gate = deferred<unknown>(); ports.decide = vi.fn(async () => gate.promise);
  run.start(ports); await vi.waitFor(() => expect(run.status().phase).toBe('thinking'));
  expect(() => run.start(ports)).toThrow('尚未结束'); expect(ports.decide).toHaveBeenCalledTimes(1);
  run.stop(); gate.resolve(decide({ protocol: 1, requestId: crypto.randomUUID(), pending: { fields: 1, records: 0, blockers: 0 }, tasks: [], canComplete: false }));
  await vi.waitFor(() => expect(run.isActive()).toBe(false)); expect(run.status().phase).toBe('stopped'); expect(ports.execute).not.toHaveBeenCalled();
});
it('does not restart until an aborted request has settled', async () => {
  const { ports, run } = setup(); const gate = deferred<unknown>(); ports.decide = vi.fn(async () => gate.promise);
  run.start(ports); await vi.waitFor(() => expect(run.status().phase).toBe('thinking')); run.stop();
  expect(() => run.start(ports)).toThrow(); gate.resolve({}); await vi.waitFor(() => expect(run.isActive()).toBe(false));
  ports.decide = vi.fn(async r => decide(r)); run.start(ports); await vi.waitFor(() => expect(run.status().phase).toBe('complete'));
});
it('signals the current executor on Stop and never starts another action', async () => {
  const { ports, run } = setup(); let aborted = false;
  ports.execute = vi.fn(async (_kind, _observation, signal) => new Promise<AgentActionResult>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ state: 'stopped' }); })));
  run.start(ports); await vi.waitFor(() => expect(run.status().phase).toBe('acting')); run.stop();
  await vi.waitFor(() => expect(run.isActive()).toBe(false)); expect(aborted).toBe(true); expect(run.status().phase).toBe('stopped'); expect(ports.execute).toHaveBeenCalledTimes(1);
});
it('late observation cannot overwrite Stop or trigger inference', async () => {
  const { ports, run } = setup(); const gate = deferred<AgentObservation>(); ports.observe = vi.fn(async () => gate.promise);
  run.start(ports); run.stop(); gate.resolve(observation()); await vi.waitFor(() => expect(run.isActive()).toBe(false));
  expect(run.status().phase).toBe('stopped'); expect(ports.decide).not.toHaveBeenCalled();
});
it('snapshot consumers cannot change the private public progress state', async () => {
  const { ports, run } = setup(); run.start(ports); await vi.waitFor(() => expect(run.status().phase).toBe('complete'));
  const state = run.status(); expect(Object.isFrozen(state)).toBe(true); expect(Object.isFrozen(state.pending)).toBe(true);
  expect(() => { (state.pending as { fields: number }).fields = 999; }).toThrow(); expect(run.status().pending?.fields).toBe(0);
  expect(JSON.stringify(state)).not.toContain('private-context');
});
