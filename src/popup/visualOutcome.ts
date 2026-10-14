import type { VisualManualReason } from '../shared/visualReason';
export type VisualSkipReason = VisualManualReason | 'budget';
export interface VisualOutcome { identified: number; eligible: number; skipped: Partial<Record<VisualSkipReason, number>> }
const descriptions: Record<VisualSkipReason, string> = {
  disabled: '请先连接 AI 并启用局部截图许可',
  'stale-page': '网页已变化，请重新扫描',
  unavailable: '截图或图片识别未完成，请检查本机服务及图片模型',
  'invalid-proposal': '模型结果无法核验，已保留待办',
  'local-scope': '字段缺少可核验的本地识别范围，已保留待办',
  budget: '达到每次3项的识别上限，剩余字段保留待办',
  'browser-capability': '当前浏览器缺少截图所需的页面检查能力，已保留待办',
  'unsupported-component': '页面含暂不支持截图识别的组件，已保留待办',
  'unsupported-layout': '标签布局暂不支持截图识别，可查看文字识别结果或手动填写',
  'outside-viewport': '字段或标签不在截图范围内，请调整页面位置后重新扫描识别',
};
export function describeVisualSkips(outcome:VisualOutcome):string {
  return (Object.keys(descriptions) as VisualSkipReason[]).filter(key=>(outcome.skipped[key]??0)>0)
    .map(key=>`${descriptions[key]}（${outcome.skipped[key]}项）。`).join('');
}
/** Fixed explanations only: never embed page labels, facts or model prose in status. */
export function describeVisualOutcome(outcome: VisualOutcome): string {
  const start = `局部截图识别得到 ${outcome.identified} 项候选。`;
  if (outcome.eligible === 0) return start + '当前没有可处理的未知空字段；已有内容不会覆盖。';
  const reasons = describeVisualSkips(outcome);
  return start + (outcome.identified ? '请在匹配结果中核对。' : '') + reasons;
}
