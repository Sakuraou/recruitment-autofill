import { isExtensionContext, loadProfile } from '../profile/storage';
import { matchFields } from '../matching/ruleMatcher';
import type { UserProfile } from '../profile/schema';
import type { ContentRequest, ContentResponse, FillOutcome, MatchResult, ScanResult } from '../shared/types';

export interface PagePlan { tabId: number; scan: ScanResult; matches: MatchResult[]; profile: UserProfile }
async function currentTab(): Promise<chrome.tabs.Tab & { id: number }> {
  if (!isExtensionContext()) throw new Error('请先在 Chrome / Edge 加载 dist 文件夹，再从工具栏打开扩展。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^(https?:|file:)/.test(tab.url)) {
    throw new Error('请切换到普通招聘网页。浏览器设置页、扩展页和部分内置页面不能扫描。');
  }
  return { ...tab, id: tab.id };
}
async function send<T>(tabId: number, request: ContentRequest): Promise<T> {
  const response: ContentResponse<T> | undefined = await chrome.tabs.sendMessage(tabId, request, { frameId: 0 });
  if (!response) throw new Error('页面没有响应，请刷新页面后重新扫描。');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
export async function scanPage(): Promise<PagePlan> {
  const [tab, profile] = await Promise.all([currentTab(), loadProfile()]);
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] }); }
  catch { throw new Error('无法访问此页面。请确认是普通网页；file:// 测试页需要在扩展详情开启文件访问，或使用本地测试服务器。'); }
  const scan = await send<ScanResult>(tab.id, { type: 'RA_SCAN' });
  return { tabId: tab.id, scan, matches: matchFields(scan.fields, profile), profile };
}
export async function fillPlan(plan: PagePlan, selectedIds: Set<string>, mode: 'auto' | 'review'): Promise<FillOutcome[]> {
  const [tab, latestProfile] = await Promise.all([currentTab(), loadProfile()]);
  if (tab.id !== plan.tabId || tab.url !== plan.scan.url) throw new Error('当前页面已变化，请重新扫描。');
  if (JSON.stringify(latestProfile) !== JSON.stringify(plan.profile)) throw new Error('档案已修改，请重新扫描以使用最新内容。');
  const items = plan.matches.filter(match => match.status === mode && match.value !== undefined &&
    (mode === 'auto' ? match.confidence >= 0.9 && match.source !== 'llm' : selectedIds.has(match.fieldId)))
    .map(match => ({ fieldId: match.fieldId, value: match.value!, confirmed: true }));
  if (!items.length) throw new Error('没有已确认且可填写的候选。');
  return send<FillOutcome[]>(plan.tabId, { type: 'RA_FILL', payload: { scanId: plan.scan.scanId, items } });
}
export async function readSelection(): Promise<string> {
  const tab = await currentTab();
  await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] });
  return send<string>(tab.id, { type: 'RA_SELECTION' });
}
