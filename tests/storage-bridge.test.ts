import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { loadProfile, PROFILE_STORAGE_KEY, saveProfile } from '../src/profile/storage';
import { fillPlan, scanPage, type PagePlan } from '../src/popup/bridge';
import { scanDocument } from '../src/content/scanner';
import { matchFields } from '../src/matching/ruleMatcher';
import { createDebugReport } from '../src/popup/debug';
import { EXTENSION_VERSION } from '../src/shared/version';

const profile = createEmptyProfile();
profile.basic = { name: '虚构用户', phone: '00000000000', email: 'fictional@example.invalid', idNumber: 'TEST-SECRET-ID' };
const local = { setAccessLevel: vi.fn().mockResolvedValue(undefined), get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
const tabs = { query: vi.fn(), sendMessage: vi.fn() };
const scripting = { executeScript: vi.fn().mockResolvedValue([]) };
let plan: PagePlan;
beforeEach(() => {
  vi.clearAllMocks();
  local.get.mockResolvedValue({ [PROFILE_STORAGE_KEY]: profile });
  document.body.innerHTML = '<label>姓名<input></label><label>手机号<input></label>';
  const scan = scanDocument().result;
  plan = { tabId: 12, scan, profile: structuredClone(profile), matches: matchFields(scan.fields, profile) };
  tabs.query.mockResolvedValue([{ id: 12, url: scan.url }]);
  tabs.sendMessage.mockResolvedValue({ ok: true, data: scan });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-test' }, storage: { local }, tabs, scripting });
});
describe('local profile storage', () => {
  it('restricts reads to trusted extension contexts and does not use sync storage', async () => {
    expect(await loadProfile()).toEqual(profile);
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(local.setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(local.get.mock.invocationCallOrder[0]!);
  });
  it('opens a blank profile when none exists; corrupt data is reported without erasure', async () => {
    local.get.mockResolvedValueOnce({});
    expect((await loadProfile()).basic).toEqual({});
    local.get.mockResolvedValueOnce({ [PROFILE_STORAGE_KEY]: { schemaVersion: 999 } });
    await expect(loadProfile()).rejects.toThrow();
    expect(local.set).not.toHaveBeenCalled();
  });
  it('validates before writing and stamps a saved profile', async () => {
    await expect(saveProfile({ ...profile, schemaVersion: 3 } as unknown as typeof profile)).rejects.toThrow();
    expect(local.set).not.toHaveBeenCalled();
    const saved = await saveProfile(profile);
    expect(saved.updatedAt).toBeTruthy();
    expect(local.set).toHaveBeenCalledWith({ [PROFILE_STORAGE_KEY]: saved });
  });
});
describe('popup execution gates', () => {
  it('拒绝旧页面脚本，明确告知刷新招聘网页而不是反复重装', async () => {
    tabs.sendMessage.mockResolvedValue({ ok: true, data: { ...plan.scan, contentVersion: undefined } });
    await expect(scanPage()).rejects.toThrow('网页仍运行旧版脚本');
    plan.scan.contentVersion = 'old';
    await expect(fillPlan(plan, new Set(), 'auto')).rejects.toThrow('脚本版本不一致');
  });
  it('扫描和填写连接中断给出不同恢复说明，不自动重试写入', async () => {
    tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
    await expect(scanPage()).rejects.toThrow('无法连接网页');
    await expect(fillPlan(plan, new Set(), 'auto')).rejects.toThrow('部分字段可能已经写入');
    expect(tabs.sendMessage).toHaveBeenCalledTimes(2);
  });
  it('问题报告使用真实版本并包含脱敏后的逐字段填写失败原因', () => {
    const field = plan.scan.fields[0]!;
    field.blockedReason = `包含${profile.basic.phone}`;
    const report = createDebugReport(plan.scan, plan.matches, profile, [{ fieldId: field.id, status: 'error', reason: `拒绝${profile.basic.name}` }]);
    const parsed = JSON.parse(report);
    expect(parsed.extensionVersion).toBe(EXTENSION_VERSION);
    expect(parsed.contentVersion).toBe(EXTENSION_VERSION);
    expect(parsed.summary.errors).toBe(1);
    expect(parsed.fields[0].outcome.status).toBe('error');
    expect(report).not.toContain(profile.basic.phone);
    expect(report).not.toContain(profile.basic.name);
  });
  it('sends no profile values during scanning', async () => {
    await scanPage();
    expect(tabs.sendMessage).toHaveBeenCalledWith(12, { type: 'RA_SCAN' }, { frameId: 0 });
    expect(JSON.stringify(scripting.executeScript.mock.calls)).not.toContain(profile.basic.name);
  });
  it('rechecks the saved profile before execution', async () => {
    local.get.mockResolvedValue({ [PROFILE_STORAGE_KEY]: { ...profile, basic: { name: '更正后的本人' } } });
    await expect(fillPlan(plan, new Set(), 'auto')).rejects.toThrow('档案已修改');
    expect(tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('rejects tab and URL changes', async () => {
    tabs.query.mockResolvedValue([{ id: 13, url: plan.scan.url }]);
    await expect(fillPlan(plan, new Set(), 'auto')).rejects.toThrow('页面已变化');
    tabs.query.mockResolvedValue([{ id: 12, url: `${plan.scan.url}new` }]);
    await expect(fillPlan(plan, new Set(), 'auto')).rejects.toThrow('页面已变化');
    expect(tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('excludes low-confidence and LLM items from high-confidence filling', async () => {
    plan.matches[0] = { ...plan.matches[0]!, source: 'llm' };
    plan.matches[1] = { ...plan.matches[1]!, confidence: 0.78, status: 'review' };
    await expect(fillPlan(plan, new Set(), 'auto')).rejects.toThrow('没有已确认');
    await expect(fillPlan(plan, new Set(), 'review')).rejects.toThrow('没有已确认');
    await fillPlan(plan, new Set([plan.matches[1]!.fieldId]), 'review');
    expect(tabs.sendMessage).toHaveBeenCalledWith(12, { type: 'RA_FILL', payload: {
      scanId: plan.scan.scanId, items: [{ fieldId: plan.matches[1]!.fieldId, value: profile.basic.phone, confirmed: true }],
    } }, { frameId: 0 });
  });
  it('debug export masks profile values embedded in labels and context', () => {
    plan.scan.fields[0]!.parentText = `姓名 ${profile.basic.name} 手机 ${profile.basic.phone} ${profile.basic.email} ${profile.basic.idNumber}`;
    const report = createDebugReport(plan.scan, plan.matches, profile);
    for (const value of Object.values(profile.basic)) expect(report).not.toContain(value);
    expect(JSON.parse(report)).toHaveProperty('fields');
  });
});
