import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createControlAdapter } from '../src/content/controlAdapter';

describe('control adapters', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('writes an empty native input and verifies the browser value', async () => {
    document.body.innerHTML = '<label>姓名<input id="name"></label>';
    const input = document.querySelector<HTMLInputElement>('#name')!;
    const adapter = createControlAdapter(input);
    await expect(adapter.write('林同学')).resolves.toMatchObject({ status: 'written' });
    expect(input.value).toBe('林同学');
    expect(adapter.verify('林同学')).toBe(true);
  });

  it('protects a non-empty native value and rejects a non-unique select option', async () => {
    document.body.innerHTML = '<input id="name" value="网页已有"><select id="level"><option value="">请选择</option><option value="x">重复</option><option value="x">重复</option></select>';
    const input = document.querySelector<HTMLInputElement>('#name')!;
    const select = document.querySelector<HTMLSelectElement>('#level')!;
    await expect(createControlAdapter(input).write('档案值')).resolves.toMatchObject({ status: 'request-human' });
    await expect(createControlAdapter(select).write('x')).resolves.toMatchObject({ status: 'request-human' });
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
    await expect(adapter.write('云南')).resolves.toMatchObject({ status: 'written' });
    expect(combo.value).toBe('云南');
    expect(adapter.readOptions()).toHaveLength(2);
  });

  it('stops on an ambiguous or unknown custom control without clicking broadly', async () => {
    document.body.innerHTML = '<div id="unknown" class="fancy-select">请选择</div><input id="combo" role="combobox" aria-expanded="true" aria-controls="list"><div id="list" role="listbox"><div role="option">相同</div><div role="option">相同</div></div>';
    const unknown = document.querySelector<HTMLElement>('#unknown')!;
    const combo = document.querySelector<HTMLInputElement>('#combo')!;
    const click = vi.spyOn(unknown, 'dispatchEvent');
    await expect(createControlAdapter(unknown).write('任意')).resolves.toMatchObject({ status: 'request-human' });
    await expect(createControlAdapter(combo).write('相同')).resolves.toMatchObject({ status: 'request-human' });
    expect(click).not.toHaveBeenCalled();
  });
});
