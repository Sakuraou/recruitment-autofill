import type { PagePlan } from './bridge';
import { currentTab } from './bridge';
import { locateVisualField } from './visualLocationClient';
import { loadProfile } from '../profile/storage';
import { matchFields } from '../matching/ruleMatcher';
import { EXTENSION_VERSION } from '../shared/version';

/** First original target only; never move a plan that already has model review candidates. */
export async function prepareAgentVisual(plan: PagePlan, ids: ReadonlySet<string>, signal: AbortSignal): Promise<{ plan: PagePlan; ids: ReadonlySet<string>; moved: boolean }> {
  signal.throwIfAborted();
  const unchanged = { plan, ids, moved: false }, fieldId = ids.values().next().value;
  if (!fieldId || plan.matches.some(match => match.source === 'llm' && match.status === 'review')) return unchanged;
  const current = async () => {
    const [tab, profile] = await Promise.all([currentTab(), loadProfile()]); signal.throwIfAborted();
    if (tab.id !== plan.tabId || tab.url !== plan.scan.url || JSON.stringify(profile) !== JSON.stringify(plan.profile)) throw Error('网页或档案已变化');
  };
  await current();
  const result = await locateVisualField(plan.tabId, plan.scan.scanId, fieldId, signal); signal.throwIfAborted();
  await current();
  if (result.state === 'manual' || !result.moved) return unchanged;
  if (result.scan.url !== plan.scan.url || result.scan.contentVersion !== EXTENSION_VERSION) throw Error('定位后网页引用已变化');
  const before = plan.scan.fields.find(field => field.id === fieldId), after = result.scan.fields.find(field => field.id === result.fieldId);
  const meaning = (field: typeof before) => field && JSON.stringify({ ...field, id: '', groupId: '' });
  if (!before || !after || meaning(before) !== meaning(after)) throw Error('定位后字段含义已变化');
  return { plan: { ...plan, scan: result.scan, matches: matchFields(result.scan.fields, plan.profile) }, ids: new Set([result.fieldId]), moved: true };
}
