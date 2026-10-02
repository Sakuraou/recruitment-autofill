import { isExtensionContext, loadProfile } from '../profile/storage';
import { matchFields } from '../matching/ruleMatcher';
import type { UserProfile } from '../profile/schema';
import type { ContentRequest, ContentResponse, FillOutcome, MatchResult, ScanResult } from '../shared/types';
import { EXTENSION_VERSION } from '../shared/version';
import { loadAiConnection } from '../ai/connection';
import { createLoopbackProvider } from '../ai/loopbackProvider';
import { inferSemanticCandidates } from '../ai/semanticCandidates';
import { SessionSemanticRecipes } from '../ai/sessionRecipes';
import { runAiFillWorkflow, type AiFillResult } from './aiWorkflow';

export interface PagePlan { tabId: number; scan: ScanResult; matches: MatchResult[]; profile: UserProfile }
export async function currentTab(): Promise<chrome.tabs.Tab & { id: number }> {
  if (!isExtensionContext()) throw new Error('请先在 Chrome / Edge 加载 dist 文件夹，再从工具栏打开扩展。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^(https?:|file:)/.test(tab.url)) {
    throw new Error('请切换到普通招聘网页。浏览器设置页、扩展页和部分内置页面不能扫描。');
  }
  return { ...tab, id: tab.id };
}
export async function send<T>(tabId: number, request: ContentRequest): Promise<T> {
  let response: ContentResponse<T> | undefined;
  try { response = await chrome.tabs.sendMessage(tabId, request, { frameId: 0 }); }
  catch {
    throw new Error(request.type === 'RA_FILL'
      ? '填写连接中断，部分字段可能已经写入。请先检查网页，再重新扫描；不要重复点击填写。'
      : '无法连接网页中的网申助手。若刚更新扩展，请先保留未保存内容，再刷新招聘网页并重新扫描。');
  }
  if (!response) throw new Error('页面没有响应，请刷新页面后重新扫描。');
  if (!response.ok) throw new Error((request.type.startsWith('RA_WORKFLOW_') || request.type.startsWith('RA_PROJECT_RECORD_')) && response.error === '无效的扩展请求'
    ? '网页仍运行旧版脚本，请先保留未保存内容，再刷新招聘网页以加载连续填写功能。' : response.error);
  return response.data;
}
export async function scanPage(settled = false): Promise<PagePlan> {
  const [tab, profile] = await Promise.all([currentTab(), loadProfile()]);
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] }); }
  catch { throw new Error('无法访问此页面。请确认是普通网页；file:// 测试页需要在扩展详情开启文件访问，或使用本地测试服务器。'); }
  const scan = await send<ScanResult>(tab.id, { type: settled ? 'RA_SCAN_SETTLED' : 'RA_SCAN' });
  if (scan.contentVersion !== EXTENSION_VERSION) throw new Error(`扩展已是 v${EXTENSION_VERSION}，但网页仍运行旧版脚本。请先保留未保存内容，再刷新招聘网页后扫描。`);
  return { tabId: tab.id, scan, matches: matchFields(scan.fields, profile), profile };
}
export async function fillPlan(plan: PagePlan, selectedIds: Set<string>, mode: 'auto' | 'review', signal?: AbortSignal): Promise<FillOutcome[]> {
  signal?.throwIfAborted();
  if (plan.scan.contentVersion !== EXTENSION_VERSION) throw new Error('网页脚本版本不一致，请刷新招聘网页并重新扫描。');
  const [tab, latestProfile] = await Promise.all([currentTab(), loadProfile()]);
  if (tab.id !== plan.tabId || tab.url !== plan.scan.url) throw new Error('当前页面已变化，请重新扫描。');
  if (JSON.stringify(latestProfile) !== JSON.stringify(plan.profile)) throw new Error('档案已修改，请重新扫描以使用最新内容。');
  const items = plan.matches.filter(match => match.status === mode && match.value !== undefined &&
    (mode === 'auto' ? match.confidence >= 0.9 && match.source !== 'llm' : selectedIds.has(match.fieldId)))
    .map(match => ({ fieldId: match.fieldId, value: match.value!, confirmed: true }));
  if (!items.length) throw new Error('没有已确认且可填写的候选。');
  signal?.throwIfAborted();
  return send<FillOutcome[]>(plan.tabId, { type: 'RA_FILL', payload: { scanId: plan.scan.scanId, items } });
}

export interface IterativeFillResult { plan: PagePlan; outcomes: FillOutcome[]; rounds: number }

/**
 * Fill, wait for ordinary page handlers to reveal dependent controls, then scan
 * again. The loop is deliberately bounded and stops immediately without
 * progress; it never clicks submit/save buttons.
 */
export async function fillAutoUntilStable(initial: PagePlan, maxRounds = 4, signal?: AbortSignal): Promise<IterativeFillResult> {
  let plan = initial;
  const profileSnapshot = JSON.stringify(initial.profile);
  const outcomes: FillOutcome[] = [];
  let rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    signal?.throwIfAborted();
    const auto = plan.matches.filter((match) => match.status === 'auto' && match.value !== undefined
      && match.confidence >= 0.9 && match.source !== 'llm');
    if (!auto.length) break;
    const result = await fillPlan(plan, new Set(), 'auto', signal);
    outcomes.push(...result);
    if (!result.some((item) => item.status === 'filled')) { rounds++; break; }
    await new Promise((resolve) => setTimeout(resolve, 300));
    signal?.throwIfAborted();
    plan = await scanPage();
    if (plan.tabId !== initial.tabId || plan.scan.url !== initial.scan.url || JSON.stringify(plan.profile) !== profileSnapshot)
      throw new Error('页面或档案已变化，已停止后续填写。');
  }
  return { plan, outcomes, rounds };
}

/** Explicit whole-page AI intent. Ordinary rules run first; model candidates still pass local value and live-DOM guards. */
export async function fillWithAi(signal: AbortSignal): Promise<AiFillResult> {
  signal.throwIfAborted();
  const connection = await loadAiConnection();
  const provider = connection ? createLoopbackProvider({ protocol: 1, token: connection.token }) : undefined;
  const recipes = new SessionSemanticRecipes();
  return runAiFillWorkflow({ scan: () => scanPage(), scanAfterFill: () => scanPage(true),
    fillRules: (plan, activeSignal) => fillAutoUntilStable(plan, 4, activeSignal),
    fillModel: (plan, ids, activeSignal) => fillPlan(plan, ids, 'review', activeSignal),
    infer: (plan, activeSignal, excludedFieldIds) => inferSemanticCandidates(plan.scan, plan.profile, provider, { recipes, signal: activeSignal, excludedFieldIds, currentContext: async () => {
    const [tab, profile, latestConnection] = await Promise.all([currentTab(), loadProfile(), loadAiConnection()]);
    signal.throwIfAborted();
    if (tab.id !== plan.tabId || tab.url !== plan.scan.url || JSON.stringify(latestConnection) !== JSON.stringify(connection))
      throw new Error('页面或 AI 连接已经改变');
    const scan = await send<ScanResult>(plan.tabId, { type: 'RA_VERIFY_SCAN', payload: { scanId: plan.scan.scanId } });
    return { scan, profile };
    } }),
  }, signal);
}
export async function readSelection(): Promise<string> {
  const tab = await currentTab();
  await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] });
  return send<string>(tab.id, { type: 'RA_SELECTION' });
}
