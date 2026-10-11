import { expect, it } from 'vitest';
import { describeVisualOutcome } from '../src/popup/visualOutcome';
it('explains no eligible fields and preserves existing values', () => {
  expect(describeVisualOutcome({ identified: 0, eligible: 0, skipped: {} })).toContain('当前没有可处理的未知空字段');
});
it('explains disabled consent, unresolved scope and remaining budget using fixed text', () => {
  const text = describeVisualOutcome({ identified: 1, eligible: 5, skipped: { disabled: 1, 'local-scope': 1, budget: 2 } });
  expect(text).toContain('请先连接 AI 并启用局部截图许可');
  expect(text).toContain('字段缺少可核验'); expect(text).toContain('剩余字段保留待办（2项）');
  expect(text).toContain('请在匹配结果中核对');
});
