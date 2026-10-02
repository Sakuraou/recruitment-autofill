import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { currentControlFingerprint } from '../src/content/controlObservation';
import { fillScan } from '../src/content/autofill';
import { recordObservationMatches } from '../src/content/recordObservation';
import { createControlAdapter, observeStableAriaCombobox, stableAriaComboboxObservationMatches } from '../src/content/controlAdapter';
import { verifyScanObservation } from '../src/content/scanFreshness';

afterEach(() => { document.body.innerHTML = ''; });
function fixture() {
  document.body.innerHTML = '<input role="combobox" aria-label="项目角色" aria-controls="choices" aria-expanded="false"><div id="choices" role="listbox" hidden><div role="option" data-value="developer">开发成员</div><div role="option" data-value="lead">负责人</div></div>';
  const node = document.querySelector('input')!; const list = document.querySelector<HTMLElement>('#choices')!;
  const actions = { opens: 0, options: 0 };
  node.addEventListener('click', () => { actions.opens++; list.hidden = false; node.setAttribute('aria-expanded', 'true'); });
  const scan = scanDocument(); const field = scan.result.fields.find(field => field.type === 'aria-combobox')!;
  const control = scan.controls.get(field.id)!; if (control.adapter !== 'aria-combobox') throw new Error('fixture missing ARIA combo');
  return { node, list, actions, scan, field, control };
}
it.each(['option', 'list', 'shared-list'] as const)('扫描后的%s变化不能凭相同字段文字沿用旧绑定', async mode => {
  const state = fixture();
  if (mode === 'option') state.list.firstElementChild!.replaceWith(state.list.firstElementChild!.cloneNode(true));
  if (mode === 'list') state.list.replaceWith(state.list.cloneNode(true));
  if (mode === 'shared-list') document.body.insertAdjacentHTML('beforeend', '<input role="combobox" aria-label="其他角色" aria-controls="choices">');
  const currentList = document.querySelector<HTMLElement>('#choices')!;
  state.node.addEventListener('click', () => { currentList.hidden = false; });
  currentList.addEventListener('click', () => { state.actions.options++; state.node.value = '开发成员'; });
  const outcomes = await fillScan(state.scan, { scanId: state.scan.result.scanId, items: [{ fieldId: state.field.id, value: '开发成员', confirmed: true }] });
  expect(state.actions).toEqual({ opens: 0, options: 0 }); expect(outcomes[0]?.status).not.toBe('filled');
  expect(currentControlFingerprint(state.control, state.field.id)).toBeUndefined();
  expect(verifyScanObservation(state.scan)).toBeUndefined();
});
it('打开时同名重挂载选项不得获得旧扫描的点击能力', async () => {
  const state = fixture();
  state.node.addEventListener('click', () => { const markup = state.list.innerHTML; state.list.innerHTML = markup; });
  state.list.addEventListener('click', () => { state.actions.options++; state.node.value = '开发成员'; });
  const outcomes = await fillScan(state.scan, { scanId: state.scan.result.scanId, items: [{ fieldId: state.field.id, value: '开发成员', confirmed: true }] });
  expect(state.actions).toEqual({ opens: 1, options: 0 }); expect(outcomes[0]?.status).not.toBe('filled');
});
it('记录保存前的新扫描不能接受同名外置列表替换', () => {
  document.body.innerHTML = '<section aria-label="项目经历"><h2>项目经历</h2><div role="list" aria-label="项目经历列表"><article role="listitem"><h3>虚构项目</h3><button type="button">编辑项目经历</button><button type="button">删除</button></article><form aria-label="新增项目经历编辑器"><label>项目名称<input></label><label>项目描述<textarea></textarea></label><input role="combobox" aria-label="项目角色" aria-controls="choices"><button type="button">保存</button><button type="button">取消</button></form><button type="button">添加项目经历</button></div></section><div id="choices" role="listbox"><div role="option">开发成员</div></div>';
  const before = scanDocument(); const listId = before.result.semanticGraph!.nodes.find(node => node.kind === 'record-list')!.id;
  document.querySelector('#choices')!.replaceWith(document.querySelector('#choices')!.cloneNode(true));
  expect(recordObservationMatches(before, scanDocument(), listId)).toBe(false);
});
it('回读就绪后同一轮微任务替换选项，不能报告成功', async () => {
  const state = fixture();
  state.list.addEventListener('click', () => {
    state.actions.options++; state.node.value = '开发成员';
    queueMicrotask(() => state.list.firstElementChild!.replaceWith(state.list.firstElementChild!.cloneNode(true)));
  });
  const outcome = await state.control.controller.write('开发成员');
  expect(outcome.status).toBe('request-human'); expect(state.actions).toEqual({ opens: 1, options: 1 });
});
it.each(['reorder', 'add', 'remove', 'label', 'value', 'disabled', 'ancestor', 'reference', 'duplicate-id'] as const)('稳定观察拒绝%s变化', mode => {
  const state = fixture(); const observation = state.control.observation!;
  const first = state.list.firstElementChild!;
  if (mode === 'reorder') state.list.append(first);
  if (mode === 'add') state.list.insertAdjacentHTML('beforeend', '<div role="option">测试</div>');
  if (mode === 'remove') first.remove();
  if (mode === 'label') first.textContent = '其他';
  if (mode === 'value') first.setAttribute('data-value', 'other');
  if (mode === 'disabled') first.setAttribute('aria-disabled', 'true');
  if (mode === 'ancestor') { const wrapper = document.createElement('div'); state.list.append(wrapper); wrapper.append(first); }
  if (mode === 'reference') state.node.setAttribute('aria-controls', 'other');
  if (mode === 'duplicate-id') document.body.insertAdjacentHTML('beforeend', '<div id="choices"></div>');
  expect(stableAriaComboboxObservationMatches(state.node, observation)).toBe(false);
});
it('正常折叠、展开、框架状态和选中状态变化保留原对象观察', async () => {
  const state = fixture(); const observation = state.control.observation!;
  state.node.setAttribute('class', 'open'); state.list.hidden = false; state.list.setAttribute('aria-hidden', 'false');
  state.list.firstElementChild!.setAttribute('aria-selected', 'true'); state.list.firstElementChild!.setAttribute('class', 'selected');
  expect(stableAriaComboboxObservationMatches(state.node, observation)).toBe(true);
  state.list.addEventListener('click', () => { state.actions.options++; state.node.value = '开发成员'; state.list.hidden = true; });
  expect(await state.control.controller.write('开发成员')).toMatchObject({ status: 'written' });
  expect(stableAriaComboboxObservationMatches(state.node, observation)).toBe(true); expect(state.control.controller.verify('开发成员')).toBe(true);
  expect(state.actions).toEqual({ opens: 1, options: 1 });
});
it('观察不能通过克隆或 JSON 重建，且不进入扫描传输结果', () => {
  const state = fixture(); const observation = state.control.observation!;
  expect(stableAriaComboboxObservationMatches(state.node, { ...observation })).toBe(false);
  expect(stableAriaComboboxObservationMatches(state.node, JSON.parse(JSON.stringify(observation)))).toBe(false);
  expect(stableAriaComboboxObservationMatches(document.createElement('input'), observation)).toBe(false);
  expect(JSON.stringify(state.scan.result)).not.toContain('stable-aria-combobox');
});
it('已经共享列表的控件不签发观察，也不能被自动打开', async () => {
  const state = fixture(); document.body.insertAdjacentHTML('beforeend', '<input role="combobox" aria-controls="choices">');
  expect(observeStableAriaCombobox(state.node)).toBeUndefined(); expect(await createControlAdapter(state.node).open()).toBe(false);
  expect(state.actions.opens).toBe(0);
});
it('空列表延迟加载保留普通控件原能力，不伪造稳定观察', async () => {
  const state = fixture(); state.list.replaceChildren(); const scan = scanDocument();
  const field = scan.result.fields.find(field => field.type === 'aria-combobox')!; const control = scan.controls.get(field.id)!;
  expect(control.adapter === 'aria-combobox' && control.observation).toBeUndefined();
  state.node.addEventListener('click', () => { setTimeout(() => { state.list.innerHTML = '<div role="option">开发成员</div>'; }, 10); });
  state.list.addEventListener('click', () => { state.actions.options++; state.node.value = '开发成员'; });
  expect((await fillScan(scan, { scanId: scan.result.scanId, items: [{ fieldId: field.id, value: '开发成员', confirmed: true }] }))[0]?.status).toBe('filled');
  expect(state.actions).toEqual({ opens: 1, options: 1 });
});
it('已有相同答案保留，冲突答案不点击', async () => {
  const state = fixture(); state.node.value = '开发成员';
  expect(await state.control.controller.write('开发成员')).toMatchObject({ status: 'preserved' });
  expect(await state.control.controller.write('负责人')).toMatchObject({ status: 'request-human' });
  expect(state.actions).toEqual({ opens: 0, options: 0 });
});
it('中间容器同名替换即使保留原选项对象仍拒绝', () => {
  const state = fixture(); const wrapper = document.createElement('div'); state.list.append(wrapper); wrapper.append(...state.list.querySelectorAll('[role="option"]'));
  const observation = observeStableAriaCombobox(state.node)!;
  const replacement = wrapper.cloneNode(false) as Element; replacement.append(...wrapper.children); wrapper.replaceWith(replacement);
  expect(stableAriaComboboxObservationMatches(state.node, observation)).toBe(false);
});
it.each(['replace', 'cancel', 'manual'] as const)('稳定选项点击后等待回写时%s不报告成功', async mode => {
  const state = fixture(); const controller = new AbortController();
  state.list.addEventListener('click', () => {
    state.actions.options++;
    setTimeout(() => {
      if (mode === 'replace') state.list.firstElementChild!.replaceWith(state.list.firstElementChild!.cloneNode(true));
      if (mode === 'cancel') controller.abort();
      state.node.value = mode === 'manual' ? '手动答案' : '开发成员';
    }, 10);
  });
  expect(await state.control.controller.write('开发成员', controller.signal)).toMatchObject({ status: 'request-human' });
  expect(state.actions).toEqual({ opens: 1, options: 1 });
  expect(state.node.value).toBe(mode === 'manual' ? '手动答案' : '开发成员');
});
