import { describe, expect, it } from 'vitest';
import { bindRecordEditor } from '../src/planner/recordEditorBinder';
import { lifecycle } from './fixtures/record-editor-context';

describe('记录编辑器脱敏绑定器', () => {
  it('未勾选的已扫描字段被改为协议项时不能签发“否”的核验收据', async () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', '是否学生干部');
    const state = lifecycle([checkbox]);
    checkbox.setAttribute('aria-label', '我同意隐私协议');
    let clicks = 0;
    checkbox.addEventListener('click', () => { clicks++; });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: () => 'false', rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'field-unsupported', writtenFieldCount: 0 });
    expect(clicks).toBe(0);
  });

  it('无操作字段在回扫时改为协议项也不能签发收据', async () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', '是否学生干部');
    const state = lifecycle([checkbox]);
    let clicks = 0;
    checkbox.addEventListener('click', () => { clicks++; });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: () => 'false', rescan: () => {
        checkbox.setAttribute('aria-label', '我同意隐私协议');
        return state.context.capture(state.fixture.source);
      },
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'receipt-rejected', writtenFieldCount: 0 });
    expect(clicks).toBe(0);
  });

  it('明确“否”与未勾选状态一致时零点击核验，正常推进记录', async () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', '是否学生干部');
    const state = lifecycle([checkbox]);
    let clicks = 0;
    checkbox.addEventListener('click', () => { clicks++; });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: () => '否', rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'advanced', writtenFieldCount: 0, preservedFieldCount: 1 });
    expect(clicks).toBe(0);
    expect(checkbox.checked).toBe(false);
  });

  it.each(['mixed', 'required-false', 'custom-error'])('复选框状态或校验不明确时不推进也不写后续字段：%s', async mode => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', '是否学生干部');
    if (mode === 'mixed') checkbox.indeterminate = true;
    if (mode === 'required-false') checkbox.required = true;
    if (mode === 'custom-error') checkbox.setCustomValidity('夹具校验失败');
    const next = document.createElement('input');
    const state = lifecycle([checkbox, next]);
    let clicks = 0;
    checkbox.addEventListener('click', () => { clicks++; });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? (mode === 'required-false' ? 'false' : 'true') : '不会写入',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', writtenFieldCount: 0 });
    expect(clicks).toBe(0);
    expect(next.value).toBe('');
  });

  it('网页拒绝回滚勾选时报告回滚未完成，不重试点击', async () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', '是否学生干部');
    const broken = document.createElement('input'); broken.maxLength = 1;
    const state = lifecycle([checkbox, broken]);
    let clicks = 0;
    checkbox.addEventListener('click', event => { clicks++; if (clicks > 1) event.preventDefault(); });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? 'true' : '超长值',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false });
    expect(checkbox.checked).toBe(true);
    expect(clicks).toBe(2);
  });

  it('短暂延迟后网页撤销文本回滚时也报告未完成', async () => {
    const first = document.createElement('input');
    const broken = document.createElement('input'); broken.maxLength = 1;
    const state = lifecycle([first, broken]);
    first.addEventListener('input', () => {
      if (first.value === '') setTimeout(() => { first.value = '页面恢复的草稿'; }, 25);
    });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? '待回滚值' : '超长值',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false });
    expect(first.value).toBe('页面恢复的草稿');
  });

  it('回扫期间用户修改答案时保留新答案，不用回滚覆盖用户', async () => {
    const first = document.createElement('input');
    const state = lifecycle([first]);
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: () => '插件答案', rescan: () => {
        first.value = '用户新答案';
        return state.context.capture(state.fixture.source);
      },
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false });
    expect(first.value).toBe('用户新答案');
  });

  it('回滚前复选框变为协议字段时不再点击该控件', async () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', '是否学生干部');
    const state = lifecycle([checkbox]);
    let clicks = 0;
    checkbox.addEventListener('click', () => { clicks++; });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: () => 'true', rescan: () => {
        checkbox.setAttribute('aria-label', '我同意隐私协议');
        throw new Error('夹具回扫失败');
      },
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false });
    expect(clicks).toBe(1);
    expect(checkbox.checked).toBe(true);
  });

  it('填写 input、select 和 radio，逐项回读后推进到 fields-verified，且不点击保存', async () => {
    const input = document.createElement('input');
    const select = document.createElement('select');
    select.append(new Option('请选择', ''), new Option('统招', 'fulltime'));
    const male = document.createElement('input');
    male.type = 'radio'; male.name = 'gender'; male.value = 'M';
    const female = document.createElement('input');
    female.type = 'radio'; female.name = 'gender'; female.value = 'F';
    const state = lifecycle([input, select, male], new Map([[male, [male, female]]]));
    let saves = 0;
    state.fixture.editor.querySelector('button')!.addEventListener('click', () => { saves++; });
    const values = ['虚构项目', 'fulltime', '__radio_option_1'];
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => values[Number(fieldNodeId.split(':')[1])],
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result.status).toBe('advanced');
    expect(input.value).toBe('虚构项目');
    expect(select.value).toBe('fulltime');
    expect(female.checked).toBe(true);
    expect(saves).toBe(0);
    if (result.status === 'advanced') {
      expect(result.activeTransaction.phase).toBe('fields-verified');
      expect(result.writtenFieldCount).toBe(3);
    }
  });

  it('相同已有值会保留，冲突已有值会零写入并请求人工处理', async () => {
    const same = document.createElement('input');
    same.value = '用户草稿';
    const other = document.createElement('input');
    const state = lifecycle([same, other]);
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? '不同答案' : '不会写入',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'existing-value-conflict', writtenFieldCount: 0 });
    expect(same.value).toBe('用户草稿');
    expect(other.value).toBe('');
  });

  it('后续字段被网站改写时回滚此前成功写入，不重复覆盖网站结果', async () => {
    const first = document.createElement('input');
    const second = document.createElement('input');
    second.addEventListener('input', () => { second.value = '网站保留值'; });
    const state = lifecycle([first, second]);
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? '先写入' : '预期值',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'field-write-failed' });
    expect(first.value).toBe('');
    expect(second.value).toBe('网站保留值');
  });

  it('扫描后字段 DOM 被替换时保持零写入，原生事实 checkbox 可安全填写', async () => {
    const input = document.createElement('input');
    const state = lifecycle([input]);
    const replacement = document.createElement('input');
    input.replaceWith(replacement);
    state.fixture.scanState.semanticTargets.set('field:0', replacement);
    const replaced = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: () => '不应写入', rescan: () => state.context.capture(state.fixture.source),
    });
    expect(replaced).toMatchObject({ status: 'request-human', reason: 'field-target-replaced', writtenFieldCount: 0 });
    expect(replacement.value).toBe('');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', '是否学生干部');
    const unsupported = lifecycle([checkbox]);
    const checkboxResult = await bindRecordEditor({
      plan: unsupported.populatePlan, capture: unsupported.editing, activeTransaction: unsupported.active,
      runContext: unsupported.context, scanState: unsupported.fixture.scanState,
      provideValue: () => 'true', rescan: () => unsupported.context.capture(unsupported.fixture.source),
    });
    expect(checkboxResult.status).toBe('advanced');
    expect(checkbox.checked).toBe(true);
  });

  it('后续字段失败时回滚此前勾选的原生 checkbox', async () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', '是否学生干部');
    const broken = document.createElement('input');
    broken.addEventListener('input', () => { broken.value = '网页保留值'; });
    const state = lifecycle([checkbox, broken]);
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? 'true' : '预期值',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'field-write-failed', rollbackComplete: true });
    expect(checkbox.checked).toBe(false);
    expect(broken.value).toBe('网页保留值');
  });

  it('单选后其它字段失败时保留选择，明确回滚不完整且不重试点击', async () => {
    const male = document.createElement('input');
    male.type = 'radio'; male.name = 'gender';
    const female = document.createElement('input');
    female.type = 'radio'; female.name = 'gender';
    const broken = document.createElement('input'); broken.maxLength = 1;
    const state = lifecycle([male, broken], new Map([[male, [male, female]]]));
    let clicks = 0;
    female.addEventListener('click', () => { clicks++; });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? '__radio_option_1' : '超长答案',
      rescan: () => state.context.capture(state.fixture.source),
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false });
    expect(female.checked).toBe(true);
    expect(clicks).toBe(1);
  });

  it('回扫时字段移出原编辑器，不清空已属于另一表单的答案', async () => {
    const input = document.createElement('input');
    const state = lifecycle([input]);
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: () => '插件答案', rescan: () => {
        const otherForm = document.createElement('form'); document.body.append(otherForm);
        otherForm.append(input);
        throw new Error('字段已移动');
      },
    });
    expect(result).toMatchObject({ status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false });
    expect(input.value).toBe('插件答案');
  });
});
