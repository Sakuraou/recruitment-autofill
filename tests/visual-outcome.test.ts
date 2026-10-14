import { expect, it } from 'vitest';
import { describeVisualOutcome, describeVisualSkips } from '../src/popup/visualOutcome';
it('explains no eligible fields and preserves existing values', () => {
  expect(describeVisualOutcome({ identified: 0, eligible: 0, skipped: {} })).toContain('当前没有可处理的未知空字段');
});
it.each(['browser-capability','unsupported-component','unsupported-layout','outside-viewport'] as const)('explains %s without blaming service/model or showing any page text',reason=>{
  const skipped:import('../src/popup/visualOutcome').VisualOutcome['skipped']={ [reason]:1 };
  Object.assign(skipped,{injected:'私人标签和模型解释'});
  const text=describeVisualSkips({identified:0,eligible:1,skipped});
  expect(text).toContain('（1项）');expect(text).not.toContain('本机服务');expect(text).not.toContain('图片模型');expect(text).not.toContain('私人标签');
});
it('separates provider unavailable from unverified model output',()=>{
  expect(describeVisualSkips({identified:0,eligible:1,skipped:{unavailable:1}})).toContain('请检查本机服务及图片模型');
  expect(describeVisualSkips({identified:0,eligible:1,skipped:{'invalid-proposal':1}})).toContain('模型结果无法核验');
});
it('explains disabled consent, unresolved scope and remaining budget using fixed text', () => {
  const text = describeVisualOutcome({ identified: 1, eligible: 5, skipped: { disabled: 1, 'local-scope': 1, budget: 2 } });
  expect(text).toContain('请先连接 AI 并启用局部截图许可');
  expect(text).toContain('字段缺少可核验'); expect(text).toContain('剩余字段保留待办（2项）');
  expect(text).toContain('请在匹配结果中核对');
});
