import { describe, expect, it, vi } from 'vitest';
import { runAiFillWorkflow, type AiWorkflowPorts } from '../src/popup/aiWorkflow';
import { createEmptyProfile } from '../src/profile/schema';
import type { PagePlan } from '../src/popup/bridge';
import type { MatchResult } from '../src/shared/types';

function plan(index: number): PagePlan {
  return { tabId: 1, profile: createEmptyProfile(), scan: { scanId: `scan-${index}`, url: 'https://fictional.example.test/', title: '虚构网页', warnings: [],
    fields: [{ id: `field-${index}`, kind: 'input', type: 'text', label: '未知问题', ariaLabel: '', placeholder: '', title: '', name: '', htmlId: '',
      parentText: '', previousText: '', sectionText: '', tableHeader: '', options: [], maxLength: null, required: false, disabled: false, readOnly: false, hasValue: false }] },
    matches: [{ fieldId: `field-${index}`, fieldName: '未知问题', confidence: 0, status: 'missing', source: 'rule', sensitive: false, reason: '未知' }] };
}
function setup() {
  let index = 0;
  const ports: AiWorkflowPorts = {
    scan: vi.fn(async () => plan(index++)),
    fillRules: vi.fn<AiWorkflowPorts['fillRules']>(async value => ({ plan: value, outcomes: [], rounds: 0 })),
    infer: vi.fn<AiWorkflowPorts['infer']>(async value => ({ state: 'ready', matches: value.matches.map(match => ({ ...match, status: 'review', source: 'llm', value: '虚构值', confidence: 0.9 })) })),
    fillModel: vi.fn<AiWorkflowPorts['fillModel']>(async (_value, ids) => [...ids].map(fieldId => ({ fieldId, status: 'filled', reason: '已填' }))),
    scanAfterFill: vi.fn(async () => plan(index++)),
  };
  return { ports, controller: new AbortController() };
}

describe('bounded AI whole-page workflow', () => {
  it('rescans and creates a fresh inference for each progressing layer, stopping at three rounds', async () => {
    const { ports, controller } = setup();
    const result = await runAiFillWorkflow(ports, controller.signal);
    expect(result.state).toBe('limit-reached'); expect(result.rounds).toBe(3); expect(result.outcomes).toHaveLength(3);
    expect(ports.scanAfterFill).toHaveBeenCalledTimes(3);
    expect(vi.mocked(ports.infer).mock.calls.map(([value]) => value.scan.scanId)).toEqual(['scan-0', 'scan-1', 'scan-2']);
    expect(vi.mocked(ports.fillModel).mock.calls.map(([, ids]) => [...ids])).toEqual([['field-0'], ['field-1'], ['field-2']]);
    expect(result.plan.scan.scanId).toBe('scan-3');
  });
  it.each(['disabled', 'no-candidates', 'rejected', 'unavailable', 'timeout', 'cancelled'] as const)('stops %s after preserving ordinary rule outcomes', async state => {
    const { ports, controller } = setup();
    ports.fillRules = vi.fn<AiWorkflowPorts['fillRules']>(async value => ({ plan: value, outcomes: [{ fieldId: 'ordinary', status: 'filled', reason: '已填' }], rounds: 1 }));
    ports.infer = vi.fn(async () => ({ state, matches: [] }));
    const result = await runAiFillWorkflow(ports, controller.signal);
    expect(result.state).toBe(state); expect(result.outcomes).toHaveLength(1); expect(ports.fillModel).not.toHaveBeenCalled(); expect(ports.scanAfterFill).not.toHaveBeenCalled();
  });
  it('does not retry if the model produces no usable local value', async () => {
    const { ports, controller } = setup(); ports.infer = vi.fn<AiWorkflowPorts['infer']>(async () => ({ state: 'ready', matches: [] }));
    expect((await runAiFillWorkflow(ports, controller.signal)).state).toBe('no-progress');
    expect(ports.infer).toHaveBeenCalledTimes(1); expect(ports.fillModel).not.toHaveBeenCalled();
  });
  it('does not loop on skipped or failed writes', async () => {
    const { ports, controller } = setup(); ports.fillModel = vi.fn<AiWorkflowPorts['fillModel']>(async (_plan, ids) => [...ids].map(fieldId => ({ fieldId, status: 'skipped', reason: '手工已有值' })));
    expect((await runAiFillWorkflow(ports, controller.signal)).state).toBe('no-progress'); expect(ports.infer).toHaveBeenCalledTimes(1);
  });
  it('excludes an unchanged previously-bound missing fact after another field made progress, despite fresh opaque IDs', async () => {
    const { ports, controller } = setup();
    const first = plan(0); const extra = plan(1);
    first.scan.fields.push({ ...extra.scan.fields[0]!, label: '另一问题' }); first.matches.push(extra.matches[0]!);
    ports.scan = vi.fn(async () => first);
    ports.infer = vi.fn<AiWorkflowPorts['infer']>(async value => value.scan.scanId === 'scan-0'
      ? { state: 'ready', matches: value.matches.map((match, index) => ({ ...match, source: 'llm', status: index ? 'review' : 'missing', value: index ? '虚构值' : undefined, confidence: 0.9 })) }
      : { state: 'no-candidates', matches: [] });
    ports.scanAfterFill = vi.fn(async () => plan(2));
    const result = await runAiFillWorkflow(ports, controller.signal);
    expect(result.state).toBe('no-candidates'); expect(ports.fillModel).toHaveBeenCalledTimes(1);
    expect([...vi.mocked(ports.infer).mock.calls[1]![2]]).toEqual(['field-2']);
  });
  it.each(['tab', 'url', 'profile'])('binds the whole intent to its initial %s across rounds', async change => {
    const { ports, controller } = setup();
    ports.scanAfterFill = vi.fn(async () => { const value = plan(1);
      if (change === 'tab') value.tabId = 2;
      if (change === 'url') value.scan.url = 'https://other.example.test/';
      if (change === 'profile') value.profile.basic.name = '新档案'; return value; });
    await expect(runAiFillWorkflow(ports, controller.signal)).rejects.toThrow(); expect(ports.infer).toHaveBeenCalledTimes(1);
  });
  it.each(['scan', 'rules', 'inference', 'write', 'settle'])('honors Stop at the %s async boundary', async boundary => {
    const { ports, controller } = setup();
    if (boundary === 'scan') ports.scan = vi.fn(async () => { controller.abort(); return plan(0); });
    if (boundary === 'rules') ports.fillRules = vi.fn(async value => { controller.abort(); return { plan: value, outcomes: [], rounds: 0 }; });
    if (boundary === 'inference') { const original = ports.infer; ports.infer = vi.fn(async (value, signal, excluded) => { const result = await original(value, signal, excluded); controller.abort(); return result; }); }
    if (boundary === 'write') { const original = ports.fillModel; ports.fillModel = vi.fn(async (value, ids, signal) => { const result = await original(value, ids, signal); controller.abort(); return result; }); }
    if (boundary === 'settle') ports.scanAfterFill = vi.fn(async () => { controller.abort(); return plan(1); });
    await expect(runAiFillWorkflow(ports, controller.signal)).rejects.toThrow();
    expect(vi.mocked(ports.infer).mock.calls.length).toBeLessThanOrEqual(1);
    if (['scan', 'rules', 'inference'].includes(boundary)) expect(ports.fillModel).not.toHaveBeenCalled();
  });
  it('never forwards an unrecognized field reference from an inference result', async () => {
    const { ports, controller } = setup(); ports.infer = vi.fn<AiWorkflowPorts['infer']>(async () => ({ state: 'ready', matches: [{ ...plan(0).matches[0]!, fieldId: 'old-field', source: 'llm', status: 'review', confidence: 0.9, value: '虚构值' } as MatchResult] }));
    expect((await runAiFillWorkflow(ports, controller.signal)).state).toBe('rejected'); expect(ports.fillModel).not.toHaveBeenCalled();
  });
});
