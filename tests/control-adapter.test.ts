import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAriaRadioGroupAdapter, createControlAdapter } from '../src/content/controlAdapter';

describe('control adapters', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each(['mixed', 'required-false', 'custom-error'])('rejects invalid native checkbox states without clicking: %s', async mode => {
    document.body.innerHTML = '<label>是否学生干部<input type="checkbox"></label>';
    const checkbox = document.querySelector('input')!;
    if (mode === 'mixed') checkbox.indeterminate = true;
    if (mode === 'required-false') checkbox.required = true;
    if (mode === 'custom-error') checkbox.setCustomValidity('测试校验错误');
    const adapter = createControlAdapter(checkbox);
    const click = vi.spyOn(checkbox, 'click');
    const value = mode === 'required-false' ? 'false' : 'true';
    expect(await adapter.write(value)).toMatchObject({ status: 'request-human' });
    expect(adapter.verify(value)).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('writes an empty native input and verifies the browser value', async () => {
    document.body.innerHTML = '<label>姓名<input id="name"></label>';
    const input = document.querySelector<HTMLInputElement>('#name')!;
    const adapter = createControlAdapter(input);
    await expect(await adapter.write('林同学')).toMatchObject({ status: 'written' });
    expect(input.value).toBe('林同学');
    expect(adapter.verify('林同学')).toBe(true);
  });

  it('protects a non-empty native value and rejects a non-unique select option', async () => {
    document.body.innerHTML = '<input id="name" value="网页已有"><select id="level"><option value="">请选择</option><option value="x">重复</option><option value="x">重复</option></select>';
    const input = document.querySelector<HTMLInputElement>('#name')!;
    const select = document.querySelector<HTMLSelectElement>('#level')!;
    await expect(await createControlAdapter(input).write('档案值')).toMatchObject({ status: 'request-human' });
    await expect(await createControlAdapter(select).write('x')).toMatchObject({ status: 'request-human' });
    expect(input.value).toBe('网页已有');
    expect(select.value).toBe('');
  });

  it('opens an async ARIA listbox and selects exactly one matching option', async () => {
    document.body.innerHTML = '<input id="city" role="combobox" aria-expanded="false" aria-controls="cities"><div id="cities" role="listbox" hidden></div>';
    const combo = document.querySelector<HTMLInputElement>('#city')!;
    const list = document.querySelector<HTMLElement>('#cities')!;
    combo.addEventListener('click', () => {
      combo.setAttribute('aria-expanded', 'true');
      list.hidden = false;
      list.innerHTML = '<div role="option" data-value="yn">云南</div><div role="option" data-value="hn">湖南</div>';
    });
    list.addEventListener('click', event => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) return;
      combo.value = option.textContent?.trim() ?? '';
      option.setAttribute('aria-selected', 'true');
    });
    const adapter = createControlAdapter(combo);
    await expect(await adapter.write('云南')).toMatchObject({ status: 'written' });
    expect(combo.value).toBe('云南');
    expect(adapter.readOptions()).toHaveLength(2);
  });

  it('waits for asynchronously inserted portal options and selects only the unique visible match', async () => {
    document.body.innerHTML = '<input id="city" role="combobox" aria-expanded="false" aria-controls="cities"><div id="cities" role="listbox" hidden></div>';
    const combo = document.querySelector<HTMLInputElement>('#city')!;
    const list = document.querySelector<HTMLElement>('#cities')!;
    combo.addEventListener('click', () => {
      combo.setAttribute('aria-expanded', 'true');
      list.hidden = false;
      setTimeout(() => { list.innerHTML = '<div role="option">云南</div>'; }, 25);
    });
    list.addEventListener('click', event => { combo.value = (event.target as HTMLElement).textContent?.trim() ?? ''; });
    await expect(await createControlAdapter(combo).write('云南')).toMatchObject({ status: 'written' });
    expect(combo.value).toBe('云南');
  });

  it('stops an async combobox when the user types before options arrive', async () => {
    document.body.innerHTML = '<input id="city" role="combobox" aria-expanded="false" aria-controls="cities"><div id="cities" role="listbox" hidden></div>';
    const combo = document.querySelector<HTMLInputElement>('#city')!;
    const list = document.querySelector<HTMLElement>('#cities')!;
    combo.addEventListener('click', () => {
      combo.setAttribute('aria-expanded', 'true');
      list.hidden = false;
      setTimeout(() => { combo.value = '用户手动输入'; list.innerHTML = '<div role="option">云南</div>'; }, 25);
    });
    const events = vi.spyOn(combo, 'dispatchEvent');
    await expect(await createControlAdapter(combo).write('云南')).toMatchObject({ status: 'request-human' });
    expect(combo.value).toBe('用户手动输入');
    expect(events).toHaveBeenCalledTimes(1);
  });

  it('stops on an ambiguous or unknown custom control without clicking broadly', async () => {
    document.body.innerHTML = '<div id="unknown" class="fancy-select">请选择</div><input id="combo" role="combobox" aria-expanded="true" aria-controls="list"><div id="list" role="listbox"><div role="option">相同</div><div role="option">相同</div></div>';
    const unknown = document.querySelector<HTMLElement>('#unknown')!;
    const combo = document.querySelector<HTMLInputElement>('#combo')!;
    const click = vi.spyOn(unknown, 'dispatchEvent');
    await expect(await createControlAdapter(unknown).write('任意')).toMatchObject({ status: 'request-human' });
    await expect(await createControlAdapter(combo).write('相同')).toMatchObject({ status: 'request-human' });
    expect(click).not.toHaveBeenCalled();
  });

  it('stops when an async page replaces the original native node', async () => {
    document.body.innerHTML = '<input id="dynamic">';
    const original = document.querySelector<HTMLInputElement>('#dynamic')!;
    const adapter = createControlAdapter(original);
    original.replaceWith(document.createElement('input'));
    await expect(await adapter.write('不应写入旧节点')).toMatchObject({ status: 'request-human' });
    expect(original.value).toBe('');
  });

  it('waits for a delayed native select option without defaulting to the first item', async () => {
    document.body.innerHTML = '<select id="level"><option value="">请选择</option></select>';
    const select = document.querySelector<HTMLSelectElement>('#level')!;
    const pending = createControlAdapter(select).write('master');
    setTimeout(() => select.append(new Option('硕士研究生', 'master')), 20);
    await expect(await pending).toMatchObject({ status: 'written' });
    expect(select.value).toBe('master');
  });

  it('supports one uniquely visible portal listbox outside the combobox container', async () => {
    document.body.innerHTML = '<section><input id="portal-combo" role="combobox" aria-expanded="false"></section><div id="portal" role="listbox" hidden><div role="option">计算机类</div></div>';
    const combo = document.querySelector<HTMLInputElement>('#portal-combo')!;
    const portal = document.querySelector<HTMLElement>('#portal')!;
    combo.addEventListener('click', () => { combo.setAttribute('aria-expanded', 'true'); portal.hidden = false; });
    portal.addEventListener('click', event => { combo.value = (event.target as HTMLElement).textContent?.trim() ?? ''; });
    await expect(await createControlAdapter(combo).write('计算机类')).toMatchObject({ status: 'written' });
    expect(combo.value).toBe('计算机类');
  });

  it('refuses an unowned portal when more than one visible listbox exists', async () => {
    document.body.innerHTML = '<input id="ambiguous-combo" role="combobox" aria-expanded="true"><div role="listbox"><div role="option">甲</div></div><div role="listbox"><div role="option">甲</div></div>';
    const combo = document.querySelector<HTMLInputElement>('#ambiguous-combo')!;
    await expect(await createControlAdapter(combo).write('甲')).toMatchObject({ status: 'request-human' });
    expect(combo.value).toBe('');
  });

  it('does not write a detached select after its delayed options arrive', async () => {
    document.body.innerHTML = '<select id="replace-select"><option value="">请选择</option></select>';
    const original = document.querySelector<HTMLSelectElement>('#replace-select')!;
    const dispatch = vi.spyOn(original, 'dispatchEvent');
    const pending = createControlAdapter(original).write('master');
    setTimeout(() => {
      original.replaceWith(document.createElement('select'));
      original.append(new Option('硕士研究生', 'master'));
    }, 20);
    await expect(await pending).toMatchObject({ status: 'request-human' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('selects an ordinary ARIA checkbox only for an explicit true answer and never clears an existing selection', async () => {
    document.body.innerHTML = '<div id="flag" role="checkbox" aria-checked="false"></div>';
    const checkbox = document.querySelector<HTMLElement>('#flag')!;
    let clicks = 0;
    checkbox.addEventListener('click', () => { clicks++; checkbox.setAttribute('aria-checked', 'true'); });
    const adapter = createControlAdapter(checkbox);
    await expect(await adapter.write('否')).toMatchObject({ status: 'preserved' });
    expect(clicks).toBe(0);
    await expect(await adapter.write('是')).toMatchObject({ status: 'written' });
    expect(clicks).toBe(1);
    await expect(await adapter.write('否')).toMatchObject({ status: 'request-human' });
    expect(clicks).toBe(1);
  });

  it('writes an ordinary labelled native checkbox through input/change and preserves checked state', async () => {
    document.body.innerHTML = '<label>是否学生干部<input id="cadre" type="checkbox"></label>';
    const checkbox = document.querySelector<HTMLInputElement>('#cadre')!;
    const events: string[] = [];
    checkbox.addEventListener('input', () => events.push('input'));
    checkbox.addEventListener('change', () => events.push('change'));
    const adapter = createControlAdapter(checkbox);
    await expect(await adapter.write('是')).toMatchObject({ status: 'written' });
    expect(checkbox.checked).toBe(true);
    expect(events).toEqual(['input', 'change']);
    await expect(await adapter.write('否')).toMatchObject({ status: 'request-human' });
    expect(checkbox.checked).toBe(true);
  });

  it.each(['user-answer', 'disabled', 'binding-change'])('protects a native select changed during async loading: %s', async change => {
    document.body.innerHTML = '<select><option value="">请选择</option><option value="user">用户答案</option></select>';
    const select = document.querySelector('select')!;
    const events = vi.spyOn(select, 'dispatchEvent');
    const pending = createControlAdapter(select).write('master');
    if (change === 'user-answer') select.value = 'user';
    else if (change === 'disabled') select.disabled = true;
    else select.dataset.binding = 'changed';
    select.append(new Option('硕士研究生', 'master'));
    expect(await pending).toMatchObject({ status: 'request-human' });
    expect(select.value).toBe(change === 'user-answer' ? 'user' : '');
    expect(events).not.toHaveBeenCalled();
  });

  it('preserves a target selected by the user while a native option is loading', async () => {
    document.body.innerHTML = '<select><option value="">请选择</option></select>';
    const select = document.querySelector('select')!;
    const events = vi.spyOn(select, 'dispatchEvent');
    const pending = createControlAdapter(select).write('master');
    select.append(new Option('硕士研究生', 'master'));
    select.value = 'master';
    expect(await pending).toMatchObject({ status: 'preserved' });
    expect(events).not.toHaveBeenCalled();
  });

  it.each(['mixed', null])('never treats indeterminate or absent checkbox state as false: %s', async state => {
    document.body.innerHTML = '<div role="checkbox" aria-label="有实习经历"></div>';
    const checkbox = document.querySelector('[role="checkbox"]')!;
    if (state !== null) checkbox.setAttribute('aria-checked', state);
    const adapter = createControlAdapter(checkbox);
    const events = vi.spyOn(checkbox, 'dispatchEvent');
    expect(await adapter.write('否')).toMatchObject({ status: 'request-human' });
    expect(await adapter.write('是')).toMatchObject({ status: 'request-human' });
    expect(adapter.verify('否')).toBe(false);
    expect(events).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'inert', 'aria-disabled', 'aria-readonly'])('never clicks a checkbox in an unavailable ancestor: %s', async attribute => {
    document.body.innerHTML = '<section><div role="checkbox" aria-label="有实习经历" aria-checked="false"></div></section>';
    document.querySelector('section')!.setAttribute(attribute, attribute.startsWith('aria-') ? 'true' : '');
    const checkbox = document.querySelector('[role="checkbox"]')!;
    const events = vi.spyOn(checkbox, 'dispatchEvent');
    expect(await createControlAdapter(checkbox).write('是')).toMatchObject({ status: 'request-human' });
    expect(events).not.toHaveBeenCalled();
  });

  it('does not verify a removed or multiply selected ARIA radio option', async () => {
    document.body.innerHTML = '<div role="radiogroup" aria-label="性别"><div role="radio" aria-checked="false">男</div><div role="radio" aria-checked="false">女</div></div>';
    const group = document.querySelector('[role="radiogroup"]')!;
    const members = [...group.querySelectorAll('[role="radio"]')];
    const adapter = createAriaRadioGroupAdapter(group, members);
    members[0]!.setAttribute('aria-checked', 'true');
    members[1]!.setAttribute('aria-checked', 'true');
    expect(adapter.verify('男')).toBe(false);
    members[1]!.setAttribute('aria-checked', 'false');
    members[0]!.remove();
    expect(adapter.verify('男')).toBe(false);
  });

  it('waits for the combobox selection to be committed asynchronously, with one option click', async () => {
    document.body.innerHTML = '<input role="combobox" aria-expanded="true" aria-controls="list"><div id="list" role="listbox"><div role="option">硕士</div></div>';
    const combo = document.querySelector('input')!;
    const option = document.querySelector('[role="option"]')!;
    let clicks = 0;
    option.addEventListener('click', () => { clicks++; setTimeout(() => { combo.value = '硕士'; }, 25); });
    const adapter = createControlAdapter(combo);
    expect(await adapter.write('硕士')).toMatchObject({ status: 'written' });
    expect(adapter.verify('硕士')).toBe(true);
    expect(clicks).toBe(1);
  });

  it('protects a user answer entered while opening an already populated combobox', async () => {
    document.body.innerHTML = '<input role="combobox" aria-controls="list"><div id="list" role="listbox" hidden><div role="option">硕士</div></div>';
    const combo = document.querySelector('input')!;
    const list = document.querySelector<HTMLElement>('#list')!;
    combo.addEventListener('click', () => { combo.value = '用户答案'; list.hidden = false; });
    const click = vi.spyOn(list.firstElementChild!, 'dispatchEvent');
    expect(await createControlAdapter(combo).write('硕士')).toMatchObject({ status: 'request-human' });
    expect(combo.value).toBe('用户答案');
    expect(click).not.toHaveBeenCalled();
  });

  it.each(['aria-disabled', 'css-hidden'])('does not open a combobox in an unavailable ancestor: %s', async attribute => {
    document.body.innerHTML = '<section><input role="combobox" aria-controls="list"></section><div id="list" role="listbox"><div role="option">硕士</div></div>';
    const section = document.querySelector('section')!;
    if (attribute === 'css-hidden') section.style.display = 'none';
    else section.setAttribute(attribute, 'true');
    const combo = document.querySelector('input')!;
    const click = vi.spyOn(combo, 'dispatchEvent');
    expect(await createControlAdapter(combo).write('硕士')).toMatchObject({ status: 'request-human' });
    expect(click).not.toHaveBeenCalled();
  });

  it('never verifies an ambiguous selection or a detached selected option', async () => {
    document.body.innerHTML = '<input role="combobox" aria-controls="list"><div id="list" role="listbox"><div role="option" aria-selected="true">硕士</div><div role="option" aria-selected="true">本科</div></div>';
    const combo = document.querySelector('input')!;
    combo.value = '硕士';
    const adapter = createControlAdapter(combo);
    expect(adapter.verify('硕士')).toBe(false);
    combo.value = '';
    const option = document.querySelector('[role="option"]')!;
    document.querySelector('[role="option"] + [role="option"]')!.remove();
    option.addEventListener('click', () => { option.remove(); });
    expect(await adapter.write('硕士')).toMatchObject({ status: 'request-human' });
  });

  it('excludes options inside hidden or disabled groups', async () => {
    document.body.innerHTML = '<input role="combobox" aria-expanded="true" aria-controls="list"><div id="list" role="listbox"><div style="display:none"><div role="option">硕士</div></div><div aria-disabled="true"><div role="option">硕士</div></div></div>';
    const combo = document.querySelector('input')!;
    const adapter = createControlAdapter(combo);
    expect(adapter.readOptions().filter(option => !option.disabled)).toEqual([]);
    expect(await adapter.write('硕士')).toMatchObject({ status: 'request-human' });
  });
});
