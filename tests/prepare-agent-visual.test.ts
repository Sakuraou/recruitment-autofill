import { afterEach, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ tab: vi.fn(), profile: vi.fn(), locate: vi.fn() }));
vi.mock('../src/popup/bridge', () => ({ currentTab: ports.tab }));
vi.mock('../src/profile/storage', () => ({ loadProfile: ports.profile }));
vi.mock('../src/popup/visualLocationClient', () => ({ locateVisualField: ports.locate }));
import { prepareAgentVisual } from '../src/popup/prepareAgentVisual';
import { scanDocument } from '../src/content/scanner';
import { matchFields } from '../src/matching/ruleMatcher';
import { createEmptyProfile } from '../src/profile/schema';

afterEach(() => { document.body.innerHTML = ''; vi.resetAllMocks(); });
function fixture() {
  document.body.innerHTML = '<section><h2>个人信息</h2><label for="opaque">陌生问题甲</label><input id="opaque"></section>';
  const profile = createEmptyProfile(); profile.basic.name = '虚构候选人';
  const scan = scanDocument(), fresh = scanDocument();
  const plan = { tabId: 12, scan: scan.result, profile, matches: matchFields(scan.result.fields, profile) };
  const ids = new Set([scan.result.fields[0]!.id]), target = fresh.result.fields[0]!.id;
  ports.tab.mockResolvedValue({ id: 12, url: scan.result.url }); ports.profile.mockResolvedValue(profile);
  ports.locate.mockResolvedValue({ state: 'located', moved: true, scan: fresh.result, fieldId: target });
  return { plan, ids, fresh, target, signal: new AbortController().signal };
}
it('rebuilds local matches from the fresh original target rather than copying old model candidates', async () => {
  const s = fixture(), result = await prepareAgentVisual(s.plan, s.ids, s.signal);
  expect(result.moved).toBe(true); expect(result.plan.scan).toBe(s.fresh.result); expect(result.ids).toEqual(new Set([s.target]));
  expect(result.plan.profile).toBe(s.plan.profile); expect(result.plan.matches).not.toBe(s.plan.matches);
  expect(result.plan.matches.every(match => match.source !== 'llm')).toBe(true);
});
it('does not open the location channel while any existing model review candidate remains', async () => {
  const s = fixture(); s.plan.matches[0] = { ...s.plan.matches[0]!, source: 'llm', status: 'review' };
  const result = await prepareAgentVisual(s.plan, s.ids, s.signal);
  expect(result).toEqual({ plan: s.plan, ids: s.ids, moved: false }); expect(ports.locate).not.toHaveBeenCalled(); expect(ports.profile).not.toHaveBeenCalled();
});
it('preserves the identical plan when location declines or the field was already visible', async () => {
  for (const reply of [{ state: 'manual', reason: 'layout' }, { state: 'located', moved: false }]) {
    const s = fixture(); ports.locate.mockResolvedValueOnce(reply);
    const result = await prepareAgentVisual(s.plan, s.ids, s.signal);
    expect(result.plan).toBe(s.plan); expect(result.ids).toBe(s.ids); expect(result.moved).toBe(false);
  }
});
it('rejects profile changes while location waits instead of rematching with mixed facts', async () => {
  const s = fixture(); ports.profile.mockResolvedValueOnce(s.plan.profile).mockResolvedValueOnce({ ...s.plan.profile, basic: { ...s.plan.profile.basic, name: '另一份虚构档案' } });
  await expect(prepareAgentVisual(s.plan, s.ids, s.signal)).rejects.toThrow('档案已变化'); expect(ports.locate).toHaveBeenCalledOnce();
});
it('rejects a changed question after location instead of treating its new reference as the original meaning', async () => {
  const s = fixture(); s.fresh.result.fields[0]!.label = '另一道问题';
  await expect(prepareAgentVisual(s.plan, s.ids, s.signal)).rejects.toThrow('含义已变化');
});
it('pre-abort performs no context read or location attempt', async () => {
  const s = fixture(), controller = new AbortController(); controller.abort();
  await expect(prepareAgentVisual(s.plan, s.ids, controller.signal)).rejects.toThrow(); expect(ports.tab).not.toHaveBeenCalled(); expect(ports.locate).not.toHaveBeenCalled();
});
