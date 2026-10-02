import { afterEach, expect, it, vi } from 'vitest';
import { createControlAdapter, createAriaRadioGroupAdapter } from '../src/content/controlAdapter';
import { scanDocument } from '../src/content/scanner';
import { fillScan } from '../src/content/autofill';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; window.history.replaceState({}, '', '/'); vi.restoreAllMocks(); });
function delayed(mode: 'native' | 'combo') {
  document.body.innerHTML = mode === 'native' ? '<select><option value="">请选择</option></select>'
    : '<input role="combobox" aria-controls="choices" aria-expanded="false"><div id="choices" role="listbox" hidden></div>';
  const node = document.querySelector<HTMLInputElement | HTMLSelectElement>('input,select')!;
  const box = document.querySelector<HTMLElement>('[role="listbox"]');
  const counts = { open: 0, option: 0, change: 0 };
  node.addEventListener('change', () => counts.change++);
  node.addEventListener('click', () => { counts.open++; if (box) { box.hidden = false; node.setAttribute('aria-expanded', 'true'); } });
  box?.addEventListener('click', () => { counts.option++; node.value = '开发成员'; });
  const load = () => { if (box) box.innerHTML = '<div role="option">开发成员</div>';
    else node.insertAdjacentHTML('beforeend', '<option value="developer">开发成员</option>'); };
  return { node, box, counts, load, value: mode === 'native' ? 'developer' : '开发成员', adapter: createControlAdapter(node) };
}

it.each(['native', 'combo'] as const)('%s选项等待取消后迟到内容不能产生写入或点击', async mode => {
  const p = delayed(mode); const controller = new AbortController();
  const pending = p.adapter.write(p.value, controller.signal); controller.abort();
  expect(await pending).toMatchObject({ status: 'request-human' });
  p.load(); await new Promise(done => setTimeout(done, 40));
  expect(p.node.value).toBe(''); expect(p.counts.option).toBe(0); expect(p.counts.change).toBe(0);
});

it.each(['native', 'combo'] as const)('%s已经取消时零打开、零写入', async mode => {
  const p = delayed(mode); p.load(); const controller = new AbortController(); controller.abort();
  expect(await p.adapter.open(controller.signal)).toBe(false);
  expect(await p.adapter.write(p.value, controller.signal)).toMatchObject({ status: 'request-human' });
  expect(p.counts).toEqual({ open: 0, option: 0, change: 0 }); expect(p.node.value).toBe('');
});

it.each(['native', 'combo'] as const)('%s等待期间地址变化不能写入旧节点', async mode => {
  const p = delayed(mode); const pending = p.adapter.write(p.value);
  window.history.replaceState({}, '', '/other-form'); p.load();
  expect(await pending).toMatchObject({ status: 'request-human' });
  expect(p.node.value).toBe(''); expect(p.counts.option).toBe(0); expect(p.counts.change).toBe(0);
});

it.each(['native', 'combo'] as const)('%s选项到达的同一轮取消仍零写入', async mode => {
  const p = delayed(mode); const controller = new AbortController(); const pending = p.adapter.write(p.value, controller.signal);
  p.load(); controller.abort(); expect(await pending).toMatchObject({ status: 'request-human' });
  expect(p.node.value).toBe(''); expect(p.counts.option).toBe(0); expect(p.counts.change).toBe(0);
});

it.each(['input', 'textarea', 'checkbox', 'aria-checkbox', 'aria-radio'] as const)('已经取消的%s操作不能触发任何写入事件', async kind => {
  document.body.innerHTML = kind === 'input' ? '<input>' : kind === 'textarea' ? '<textarea></textarea>'
    : kind === 'checkbox' ? '<input type="checkbox">' : kind === 'aria-checkbox' ? '<div role="checkbox" aria-checked="false"></div>'
      : '<div role="radiogroup"><div role="radio" aria-checked="false">开发成员</div></div>';
  const node = document.body.firstElementChild!; const member = node.querySelector('[role="radio"]')!;
  const adapter = kind === 'aria-radio' ? createAriaRadioGroupAdapter(node, [member]) : createControlAdapter(node);
  const dispatch = vi.spyOn(node, 'dispatchEvent'); const click = vi.spyOn(node as HTMLElement, 'click');
  const controller = new AbortController(); controller.abort();
  expect(await adapter.write(kind.includes('checkbox') ? 'true' : '开发成员', controller.signal)).toMatchObject({ status: 'request-human' });
  expect(dispatch).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
  if (kind === 'aria-radio') expect(member.getAttribute('aria-checked')).toBe('false');
});

it.each(['native', 'combo'] as const)('%s取消在微任务内结束等待并移除计时器及监听', async mode => {
  vi.useFakeTimers(); const p = delayed(mode); const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = p.adapter.write(p.value, controller.signal);
  for (let tick = 0; tick < 4; tick++) await Promise.resolve();
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  controller.abort(); expect(await pending).toMatchObject({ status: 'request-human' });
  expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  p.load(); await vi.advanceTimersByTimeAsync(600);
  expect(p.counts.option).toBe(0); expect(p.counts.change).toBe(0);
});

it.each(['aria-checkbox', 'aria-radio'] as const)('%s已点击后的回读等待可取消，但不能再点击撤回', async kind => {
  vi.useFakeTimers(); document.body.innerHTML = kind === 'aria-checkbox' ? '<div role="checkbox" aria-checked="false"></div>'
    : '<div role="radiogroup"><div role="radio" aria-checked="false">开发成员</div></div>';
  const node = document.body.firstElementChild!; const target = kind === 'aria-checkbox' ? node : node.firstElementChild!;
  let clicks = 0; target.addEventListener('click', () => clicks++);
  const adapter = kind === 'aria-checkbox' ? createControlAdapter(node) : createAriaRadioGroupAdapter(node, [target]);
  const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = adapter.write(kind === 'aria-checkbox' ? 'true' : '开发成员', controller.signal);
  expect(clicks).toBe(1); expect(vi.getTimerCount()).toBe(1);
  controller.abort(); expect(await pending).toMatchObject({ status: 'request-human' });
  expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  target.setAttribute('aria-checked', 'true'); await vi.advanceTimersByTimeAsync(600); expect(clicks).toBe(1);
});

it('原生 input 事件取消后不再派发 change 或写后续字段', async () => {
  document.body.innerHTML = '<label>项目名称<input></label><label>项目简介<textarea></textarea></label>';
  const controller = new AbortController(); let changes = 0; let lateWrites = 0;
  document.querySelector('input')!.addEventListener('input', () => controller.abort());
  document.querySelector('input')!.addEventListener('change', () => changes++);
  document.querySelector('textarea')!.addEventListener('input', () => lateWrites++);
  const scan = scanDocument(); const outcomes = await fillScan(scan, { scanId: scan.result.scanId,
    items: scan.result.fields.map(field => ({ fieldId: field.id, value: '虚构答案', confirmed: true })) }, controller.signal);
  expect(outcomes.map(result => result.status)).toEqual(['error', 'skipped']);
  expect(changes).toBe(0); expect(lateWrites).toBe(0); expect(document.querySelector('textarea')!.value).toBe('');
});

it.each(['aria-checkbox', 'aria-radio'] as const)('%s同步回读就绪后取消也不能签发成功', async kind => {
  document.body.innerHTML = kind === 'aria-checkbox' ? '<div role="checkbox" aria-checked="false"></div>'
    : '<div role="radiogroup"><div role="radio" aria-checked="false">开发成员</div></div>';
  const node = document.body.firstElementChild!; const target = kind === 'aria-checkbox' ? node : node.firstElementChild!;
  let clicks = 0; target.addEventListener('click', () => { clicks++; target.setAttribute('aria-checked', 'true'); });
  const adapter = kind === 'aria-checkbox' ? createControlAdapter(node) : createAriaRadioGroupAdapter(node, [target]);
  const controller = new AbortController();
  const pending = adapter.write(kind === 'aria-checkbox' ? 'true' : '开发成员', controller.signal);
  controller.abort();
  expect(await pending).toMatchObject({ status: 'request-human' }); expect(clicks).toBe(1);
});

it.each(['aria-checkbox', 'aria-radio'] as const)('%s点击导致导航时不能核验旧文档成功', async kind => {
  document.body.innerHTML = kind === 'aria-checkbox' ? '<div role="checkbox" aria-checked="false"></div>'
    : '<div role="radiogroup"><div role="radio" aria-checked="false">开发成员</div></div>';
  const node = document.body.firstElementChild!; const target = kind === 'aria-checkbox' ? node : node.firstElementChild!;
  let clicks = 0; target.addEventListener('click', () => {
    clicks++; target.setAttribute('aria-checked', 'true'); window.history.replaceState({}, '', '/other-form');
  });
  const adapter = kind === 'aria-checkbox' ? createControlAdapter(node) : createAriaRadioGroupAdapter(node, [target]);
  expect(await adapter.write(kind === 'aria-checkbox' ? 'true' : '开发成员')).toMatchObject({ status: 'request-human' });
  expect(clicks).toBe(1);
});

it('原生勾选事件触发停止后不报告核验成功或再次点击', async () => {
  document.body.innerHTML = '<input type="checkbox">'; const node = document.querySelector('input')!;
  const controller = new AbortController(); let clicks = 0;
  node.addEventListener('click', () => { clicks++; controller.abort(); });
  expect(await createControlAdapter(node).write('true', controller.signal)).toMatchObject({ status: 'request-human' });
  expect(clicks).toBe(1);
});

it('原生选项异步等待被取消后，整批后续字段保持空且不触发点击', async () => {
  document.body.innerHTML = '<label>项目名称<input></label><label>项目角色<select><option value="">请选择</option></select></label><label>项目简介<textarea></textarea></label>';
  const controller = new AbortController(); const select = document.querySelector('select')!;
  let changes = 0; select.addEventListener('change', () => changes++);
  const scan = scanDocument(); const pending = fillScan(scan, { scanId: scan.result.scanId,
    items: scan.result.fields.map(field => ({ fieldId: field.id, value: field.kind === 'select' ? 'developer' : '虚构答案', confirmed: true })) }, controller.signal);
  controller.abort(); const outcomes = await pending;
  select.insertAdjacentHTML('beforeend', '<option value="developer">开发成员</option>'); await new Promise(done => setTimeout(done, 40));
  expect(outcomes.map(result => result.status)).toEqual(['filled', 'error', 'skipped']);
  expect(changes).toBe(0); expect(select.value).toBe(''); expect(document.querySelector('textarea')!.value).toBe('');
});
