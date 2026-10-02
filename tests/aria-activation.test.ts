import { afterEach, expect, it } from 'vitest';
import { createAriaRadioGroupAdapter, createControlAdapter, stableAriaComboboxListbox } from '../src/content/controlAdapter';
import { scanDocument } from '../src/content/scanner';

afterEach(() => { document.body.innerHTML = ''; window.history.replaceState({}, '', '/'); });
it.each(['submit', 'reset', 'implicit'] as const)('组合框打开按钮%s不能触发原生动作', async mode => {
  document.body.innerHTML = `<form><button ${mode === 'implicit' ? '' : `type="${mode}"`} role="combobox" aria-label="学历" aria-controls="choices" aria-expanded="false">请选择</button>
    <div id="choices" role="listbox" hidden><div role="option">硕士</div></div></form>`;
  const node = document.querySelector('button')!; const list = document.querySelector<HTMLElement>('#choices')!;
  let actions = 0; let clicks = 0;
  for (const type of ['submit', 'reset']) document.querySelector('form')!.addEventListener(type, event => { actions++; event.preventDefault(); });
  node.addEventListener('click', () => { clicks++; node.setAttribute('aria-expanded', 'true'); list.hidden = false; });
  list.addEventListener('click', () => node.setAttribute('aria-valuetext', '硕士'));
  const result = await createControlAdapter(node).write('硕士'); expect(actions).toBe(0);
  expect(result).toMatchObject({ status: 'request-human' }); expect(clicks).toBe(0);
});
it.each(['submit', 'reset', 'implicit'] as const)('组合框%s选项不因 role 而获得安全点击权限', async mode => {
  document.body.innerHTML = `<form><input role="combobox" aria-controls="choices" aria-expanded="true"><div id="choices" role="listbox">
    <button ${mode === 'implicit' ? '' : `type="${mode}"`} role="option">硕士</button></div></form>`;
  const node = document.querySelector('input')!; let actions = 0; let clicks = 0;
  for (const type of ['submit', 'reset']) document.querySelector('form')!.addEventListener(type, event => { actions++; event.preventDefault(); });
  document.querySelector('button')!.addEventListener('click', () => { clicks++; node.value = '硕士'; });
  const result = await createControlAdapter(node).write('硕士'); expect(actions).toBe(0);
  expect(result).toMatchObject({ status: 'request-human' }); expect(clicks).toBe(0);
});
it.each(['checkbox', 'radio'] as const)('ARIA %s 不能点击原生提交按钮', async kind => {
  document.body.innerHTML = kind === 'checkbox' ? '<form><button type="submit" role="checkbox" aria-checked="false">有经历</button></form>'
    : '<form><div role="radiogroup"><button type="submit" role="radio" aria-checked="false">开发成员</button></div></form>';
  const node = document.querySelector('button')!; let actions = 0; let clicks = 0;
  document.querySelector('form')!.addEventListener('submit', event => { actions++; event.preventDefault(); });
  node.addEventListener('click', () => { clicks++; node.setAttribute('aria-checked', 'true'); });
  const adapter = kind === 'checkbox' ? createControlAdapter(node) : createAriaRadioGroupAdapter(document.querySelector('[role="radiogroup"]')!, [node]);
  const result = await adapter.write(kind === 'checkbox' ? 'true' : '开发成员'); expect(actions).toBe(0);
  expect(result).toMatchObject({ status: 'request-human' }); expect(clicks).toBe(0);
});
it('重复 ID 的列表不能被当成唯一明确绑定', () => {
  document.body.innerHTML = '<input role="combobox" aria-label="学历" aria-controls="choices"><div id="choices" role="listbox"><div role="option">硕士</div></div><div id="choices" role="listbox"><div role="option">本科</div></div>';
  const node = document.querySelector('input')!;
  expect(stableAriaComboboxListbox(node)).toBeNull();
  expect(scanDocument().result.fields.some(field => field.type === 'aria-combobox')).toBe(false);
});
it('无效显式列表绑定在打开前停止', async () => {
  document.body.innerHTML = '<button type="button" role="combobox" aria-controls="choices">请选择</button><div id="choices" role="listbox"></div><div id="choices"></div>';
  const node = document.querySelector('button')!; let clicks = 0; node.addEventListener('click', () => { clicks++; });
  expect(await createControlAdapter(node).write('硕士')).toMatchObject({ status: 'request-human' }); expect(clicks).toBe(0);
});
it.each(['combobox', 'checkbox', 'radio'] as const)('普通 type=button 的 ARIA %s 仍可选择', async kind => {
  document.body.innerHTML = `<form><div role="radiogroup"><button type="button" role="${kind}" aria-label="学历" aria-controls="choices" aria-expanded="false" aria-checked="false">请选择</button></div>
    <div id="choices" role="listbox" hidden><button type="button" role="option">硕士</button></div></form>`;
  const node = document.querySelector('button')!; const list = document.querySelector<HTMLElement>('#choices')!;
  let actions = 0; let clicks = 0; let options = 0;
  for (const type of ['submit', 'reset']) document.querySelector('form')!.addEventListener(type, event => { actions++; event.preventDefault(); });
  node.addEventListener('click', () => { clicks++; node.setAttribute('aria-expanded', 'true'); node.setAttribute('aria-checked', 'true'); list.hidden = false; });
  list.addEventListener('click', () => { options++; node.setAttribute('aria-valuetext', '硕士'); });
  const adapter = kind === 'radio' ? createAriaRadioGroupAdapter(document.querySelector('[role="radiogroup"]')!, [node]) : createControlAdapter(node);
  expect(await adapter.write(kind === 'combobox' ? '硕士' : kind === 'checkbox' ? 'true' : '学历')).toMatchObject({ status: 'written' });
  expect(actions).toBe(0); expect(clicks).toBe(1); expect(options).toBe(kind === 'combobox' ? 1 : 0);
});
it.each(['button', 'anchor', 'label', 'shadow-button'] as const)('不点击会连带激活%s的嵌套 ARIA 控件', async mode => {
  document.body.innerHTML = '<form><input id="other" type="checkbox"><div id="mount"></div></form>';
  const mount = document.querySelector('#mount')!;
  const markup = '<span role="checkbox" aria-label="有经历" aria-checked="false">有经历</span>';
  if (mode === 'button') mount.innerHTML = `<button>${markup}</button>`;
  if (mode === 'anchor') mount.innerHTML = `<a href="/danger">${markup}</a>`;
  if (mode === 'label') mount.innerHTML = `<label for="other">${markup}</label>`;
  let node: Element;
  if (mode === 'shadow-button') {
    mount.innerHTML = '<button><span id="host"></span></button>';
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' }); shadow.innerHTML = markup; node = shadow.querySelector('span')!;
  } else node = mount.querySelector('[role="checkbox"]')!;
  let clicks = 0; mount.addEventListener('click', () => { clicks++; });
  expect(await createControlAdapter(node).write('true')).toMatchObject({ status: 'request-human' });
  expect(clicks).toBe(0); expect((document.querySelector('#other') as HTMLInputElement).checked).toBe(false);
});
it('扫描结果显示原生激活限制，不把危险组合框显示为可填', () => {
  document.body.innerHTML = '<form><button role="combobox" aria-label="学历" aria-controls="choices">请选择</button><div id="choices" role="listbox"><div role="option">硕士</div></div></form>';
  expect(scanDocument().result.fields.find(field => field.type === 'aria-combobox')?.blockedReason).toContain('提交或重置');
});
it('选项带链接导航时扫描为禁用且不点击', async () => {
  document.body.innerHTML = '<input role="combobox" aria-label="学历" aria-controls="choices" aria-expanded="true"><div id="choices" role="listbox"><a href="/danger" role="option">硕士</a></div>';
  let clicks = 0; document.querySelector('a')!.addEventListener('click', () => { clicks++; });
  const adapter = createControlAdapter(document.querySelector('input')!);
  expect(adapter.readOptions()[0]?.disabled).toBe(true);
  expect(await adapter.write('硕士')).toMatchObject({ status: 'request-human' }); expect(clicks).toBe(0);
});
it('等待选项时打开按钮变为提交按钮，停止后续点击', async () => {
  document.body.innerHTML = '<form><button type="button" role="combobox" aria-label="学历" aria-controls="choices" aria-expanded="false">请选择</button><div id="choices" role="listbox" hidden></div></form>';
  const node = document.querySelector('button')!; const list = document.querySelector<HTMLElement>('#choices')!;
  let clicks = 0; let actions = 0;
  document.querySelector('form')!.addEventListener('submit', event => { actions++; event.preventDefault(); });
  node.addEventListener('click', () => { list.hidden = false; node.setAttribute('aria-expanded', 'true'); });
  const pending = createControlAdapter(node).write('硕士');
  setTimeout(() => { node.type = 'submit'; list.innerHTML = '<div role="option">硕士</div>'; list.addEventListener('click', () => { clicks++; }); }, 10);
  expect(await pending).toMatchObject({ status: 'request-human' }); expect(clicks).toBe(0); expect(actions).toBe(0);
});
it.each(['checkbox', 'radio'] as const)('ARIA %s 点击后变为提交按钮不能报告成功', async kind => {
  document.body.innerHTML = `<form><div role="radiogroup"><button type="button" role="${kind}" aria-checked="false">开发成员</button></div></form>`;
  const node = document.querySelector('button')!; let actions = 0;
  document.querySelector('form')!.addEventListener('submit', event => { actions++; event.preventDefault(); });
  node.addEventListener('click', () => { setTimeout(() => { node.type = 'submit'; node.setAttribute('aria-checked', 'true'); }, 10); });
  const adapter = kind === 'radio' ? createAriaRadioGroupAdapter(document.querySelector('[role="radiogroup"]')!, [node]) : createControlAdapter(node);
  expect(await adapter.write(kind === 'checkbox' ? 'true' : '开发成员')).toMatchObject({ status: 'request-human' });
  expect(adapter.verify(kind === 'checkbox' ? 'true' : '开发成员')).toBe(false); expect(actions).toBe(0);
});
