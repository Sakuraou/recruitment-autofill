import { hasValue, isPlaceholderOption, selectOptions } from './domUtils';

export type ControlAdapterKind = 'native-input' | 'native-textarea' | 'native-select' | 'aria-combobox' | 'aria-radio-group' | 'aria-checkbox' | 'unknown';

export interface ControlAdapterOption {
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
}

export interface ControlInspection {
  readonly kind: ControlAdapterKind;
  readonly value: string;
  readonly hasValue: boolean;
  readonly options: readonly ControlAdapterOption[];
  readonly blockedReason?: string;
}

export type ControlAdapterResult = Readonly<{
  status: 'written' | 'preserved' | 'request-human';
  reason: string;
}>;

export interface ControlAdapter {
  readonly node: Element;
  readonly kind: ControlAdapterKind;
  inspect(): ControlInspection;
  open(): Promise<boolean>;
  readOptions(): readonly ControlAdapterOption[];
  write(value: string): ControlAdapterResult | Promise<ControlAdapterResult>;
  verify(value: string): boolean;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function visible(node: Element): boolean {
  if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
  const view = node.ownerDocument.defaultView;
  const style = view?.getComputedStyle(node);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

function nativeSetter(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): (value: string) => void {
  const view = node.ownerDocument.defaultView;
  if (!view) throw new Error('document unavailable');
  const prototype: object = node instanceof view.HTMLInputElement ? view.HTMLInputElement.prototype
    : node instanceof view.HTMLTextAreaElement ? view.HTMLTextAreaElement.prototype : view.HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('value setter unavailable');
  return (value: string) => setter.call(node, value);
}

function dispatchInput(node: Element): void {
  const EventConstructor = node.ownerDocument.defaultView?.Event;
  if (!EventConstructor) throw new Error('event constructor unavailable');
  node.dispatchEvent(new EventConstructor('input', { bubbles: true, composed: true }));
  node.dispatchEvent(new EventConstructor('change', { bubbles: true, composed: true }));
}

function unavailableReason(node: Element, kind: string): string | undefined {
  if (!node.isConnected) return `${kind}已被页面替换或移除，请重新扫描`;
  if (node.matches(':disabled') || node.closest('fieldset:disabled')) return `${kind}已禁用，需要人工处理`;
  if (node.closest('[aria-disabled="true"]')) return `${kind}已禁用，需要人工处理`;
  if (node.closest('[aria-readonly="true"]')) return `${kind}只读，需要人工处理`;
  if (node.closest('[hidden], [inert], [aria-hidden="true"]')) return `${kind}不可交互，需要人工处理`;
  return undefined;
}

function selectableOptions(select: HTMLSelectElement, value: string): HTMLOptionElement[] {
  return Array.from(select.options).filter(option => option.value === value
    && !option.disabled && !option.parentElement?.hasAttribute('disabled') && !isPlaceholderOption(option));
}

function waitForSelectableOption(select: HTMLSelectElement, value: string): Promise<boolean> {
  if (selectableOptions(select, value).length === 1) return Promise.resolve(true);
  const Observer = select.ownerDocument.defaultView?.MutationObserver;
  if (!Observer) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const observer = new Observer(() => {
      if (unavailableReason(select, '下拉框') || (hasValue(select) && select.value !== value)) finish(false);
      else if (selectableOptions(select, value).length === 1) finish(true);
    });
    const timer = setTimeout(() => finish(false), 500);
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      resolve(result);
    };
    observer.observe(select, { childList: true, subtree: true, attributes: true });
  });
}

function nativeAdapter(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): ControlAdapter {
  const kind: ControlAdapterKind = node.tagName === 'SELECT' ? 'native-select'
    : node.tagName === 'TEXTAREA' ? 'native-textarea' : 'native-input';
  const inspect = (): ControlInspection => ({
    kind,
    value: node.value,
    hasValue: hasValue(node),
    options: node.tagName === 'SELECT' ? selectOptions(node as HTMLSelectElement) : [],
    ...(unavailableReason(node, '控件') ? { blockedReason: unavailableReason(node, '控件') } : {}),
  });
  return {
    node,
    kind,
    inspect,
    open: async () => true,
    readOptions: () => inspect().options,
    write: (value: string): ControlAdapterResult | Promise<ControlAdapterResult> => {
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      if (current.hasValue) return current.value === value
        ? { status: 'preserved', reason: '字段已有相同内容，保留原值' }
        : { status: 'request-human', reason: '字段已有内容，不覆盖' };
      if (!value.trim()) return { status: 'request-human', reason: '答案为空，不能猜测' };
      if (node.tagName === 'SELECT') {
        const select = node as HTMLSelectElement;
        const applySelect = (): ControlAdapterResult => {
          const unavailable = unavailableReason(select, '下拉框');
          if (unavailable) return { status: 'request-human', reason: unavailable };
          if (selectableOptions(select, value).length !== 1) return { status: 'request-human', reason: '下拉选项不存在或不唯一' };
          try {
            nativeSetter(select)(value);
            dispatchInput(select);
          } catch {
            return { status: 'request-human', reason: '控件未能安全写入' };
          }
          return select.value === value && select.validity.valid
            ? { status: 'written', reason: '写入后已回读核验' }
            : { status: 'request-human', reason: '网页更新后未保留预期值' };
        };
        const candidates = selectableOptions(select, value);
        if (candidates.length !== 1) return waitForSelectableOption(select, value).then((ready): ControlAdapterResult => ready
          ? applySelect() : { status: 'request-human', reason: '下拉选项未在限定时间内形成唯一匹配' });
        return applySelect();
      }
      try {
        nativeSetter(node)(value);
        dispatchInput(node);
      } catch {
        return { status: 'request-human', reason: '控件未能安全写入' };
      }
      return node.value === value && node.validity.valid
        ? { status: 'written', reason: '写入后已回读核验' }
        : { status: 'request-human', reason: '网页更新后未保留预期值' };
    },
    verify: (value: string) => node.value === value && node.validity.valid,
  };
}

function comboRefs(node: Element): string[] {
  return `${node.getAttribute('aria-controls') ?? ''} ${node.getAttribute('aria-owns') ?? ''}`
    .trim().split(/\s+/u).filter(Boolean);
}

/** A scan-safe binding never opens the page and requires one explicit same-document listbox reference. */
export function stableAriaComboboxListbox(node: Element): HTMLElement | null {
  const refs = comboRefs(node);
  if (refs.length !== 1) return null;
  const root = node.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return null;
  const target = Array.from((root as Document | ShadowRoot).querySelectorAll<HTMLElement>('[id]'))
    .find(candidate => candidate.id === refs[0]);
  return target?.ownerDocument === node.ownerDocument && target.getAttribute('role') === 'listbox'
    ? target as HTMLElement : null;
}

function comboListbox(node: Element): HTMLElement | null {
  const explicit = stableAriaComboboxListbox(node);
  if (explicit) return explicit;
  const refs = comboRefs(node);
  if (refs.length) return null;
  const candidates = Array.from(node.ownerDocument.querySelectorAll<HTMLElement>('[role="listbox"]')).filter(visible);
  return candidates.length === 1 ? candidates[0]! : null;
}

function comboValue(node: Element): string {
  if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return (node as HTMLInputElement | HTMLTextAreaElement).value;
  return clean(node.getAttribute('aria-valuetext') || node.textContent);
}

function comboHasValue(value: string): boolean {
  return Boolean(value) && !/^(?:请选择(?:.{0,24})?|请选(?:择)?|未选择|选择\.\.\.|please\s+(?:select|choose)(?:\s+.{0,30})?)$/iu.test(value);
}

function radioOptionLabel(node: Element): string {
  return clean(node.getAttribute('aria-label') || node.textContent);
}

function waitForAriaChecked(node: Element, desired: boolean): Promise<boolean> {
  const matches = (): boolean => node.isConnected && (node.getAttribute('aria-checked') === 'true') === desired;
  if (matches()) return Promise.resolve(true);
  const Observer = node.ownerDocument.defaultView?.MutationObserver;
  if (!Observer) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const observer = new Observer(() => { if (matches()) finish(true); });
    const timer = setTimeout(() => finish(false), 500);
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      resolve(result);
    };
    observer.observe(node, { attributes: true, attributeFilter: ['aria-checked'] });
  });
}

export function createAriaRadioGroupAdapter(group: Element, members: readonly Element[]): ControlAdapter {
  const inspect = (): ControlInspection => {
    const options = members.map(member => ({ value: radioOptionLabel(member), label: radioOptionLabel(member),
      disabled: member.getAttribute('aria-disabled') === 'true' || member.hasAttribute('disabled') }));
    const selected = members.find(member => member.getAttribute('aria-checked') === 'true');
    return { kind: 'aria-radio-group', value: selected ? radioOptionLabel(selected) : '', hasValue: Boolean(selected), options,
      ...(unavailableReason(group, '单选组') ? { blockedReason: unavailableReason(group, '单选组') } : {}) };
  };
  return {
    node: group,
    kind: 'aria-radio-group',
    inspect,
    open: async () => true,
    readOptions: () => inspect().options,
    write: async (value: string): Promise<ControlAdapterResult> => {
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      if (current.hasValue) return current.value === value
        ? { status: 'preserved', reason: '单选组已有相同答案，保留原值' }
        : { status: 'request-human', reason: '单选组已有答案，不覆盖' };
      const candidates = members.filter(member => radioOptionLabel(member) === value
        && member.getAttribute('aria-disabled') !== 'true' && !member.hasAttribute('disabled'));
      if (candidates.length !== 1) return { status: 'request-human', reason: '单选组没有唯一匹配选项' };
      const target = candidates[0]!;
      if (!target.isConnected || !group.contains(target)) return { status: 'request-human', reason: '单选组选项已被替换' };
      try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); }
      catch { return { status: 'request-human', reason: '单选项无法安全选择' }; }
      return await waitForAriaChecked(target, true)
        ? { status: 'written', reason: '单选选择后已核验' }
        : { status: 'request-human', reason: '网页未保留预期单选答案' };
    },
    verify: (value: string) => {
      const selected = members.filter(member => member.getAttribute('aria-checked') === 'true');
      return selected.length === 1 && selected[0]!.isConnected && group.contains(selected[0]!)
        && radioOptionLabel(selected[0]!) === value;
    },
  };
}

function booleanValue(value: string): boolean | undefined {
  const normalized = clean(value).toLocaleLowerCase();
  if (/^(?:true|yes|y|on|checked|是|有|同意|已完成|具备)$/iu.test(normalized)) return true;
  if (/^(?:false|no|n|off|unchecked|否|无|不同意|未完成|不具备)$/iu.test(normalized)) return false;
  return undefined;
}

/** Safe adapter for ordinary ARIA checkboxes. Consent and authorization labels are blocked by the scanner. */
export function createAriaCheckboxAdapter(node: Element): ControlAdapter {
  const inspect = (): ControlInspection => {
    const rawChecked = node.getAttribute('aria-checked');
    const checked = rawChecked === 'true';
    return {
      kind: 'aria-checkbox', value: checked ? 'true' : 'false', hasValue: checked,
      options: [{ value: 'true', label: '是', disabled: false }, { value: 'false', label: '否', disabled: false }],
      ...(unavailableReason(node, '复选框') ? { blockedReason: unavailableReason(node, '复选框') }
        : rawChecked !== 'true' && rawChecked !== 'false' ? { blockedReason: '复选框状态不明确，需要人工处理' } : {}),
    };
  };
  return {
    node, kind: 'aria-checkbox', inspect,
    open: async () => true,
    readOptions: () => inspect().options,
    write: async (value: string): Promise<ControlAdapterResult> => {
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      const desired = booleanValue(value);
      if (desired === undefined) return { status: 'request-human', reason: '复选框答案不是明确的“是/否”，需要人工确认' };
      const checked = current.value === 'true';
      if (checked && desired === false) return { status: 'request-human', reason: '复选框已有选择，不自动取消已有内容' };
      if (checked === desired) return { status: 'preserved', reason: '复选框已有相同答案，保留原值' };
      try { node.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); }
      catch { return { status: 'request-human', reason: '复选框无法安全选择' }; }
      return await waitForAriaChecked(node, true)
        ? { status: 'written', reason: '复选框选择后已核验' }
        : { status: 'request-human', reason: '网页未保留预期复选框答案' };
    },
    verify: (value: string) => {
      const desired = booleanValue(value);
      const rawChecked = node.getAttribute('aria-checked');
      return desired !== undefined && (rawChecked === 'true' || rawChecked === 'false')
        && (rawChecked === 'true') === desired && !unavailableReason(node, '复选框');
    },
  };
}

function comboOptions(node: Element): ControlAdapterOption[] {
  const list = comboListbox(node);
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).filter(visible).map((option) => ({
    value: option.getAttribute('data-value') ?? option.getAttribute('value') ?? option.id,
    label: clean(option.getAttribute('aria-label') || option.textContent),
    disabled: option.getAttribute('aria-disabled') === 'true' || option.hasAttribute('disabled'),
  }));
}

function comboAdapter(node: Element): ControlAdapter {
  const inspect = (): ControlInspection => ({
    kind: 'aria-combobox', value: comboValue(node), hasValue: comboHasValue(comboValue(node)), options: comboOptions(node),
    ...(!node.isConnected ? { blockedReason: '控件已被页面替换或移除，请重新扫描' }
      : node.getAttribute('aria-disabled') === 'true' ? { blockedReason: '组合框已禁用，需要人工处理' } : {}),
  });
  return {
    node,
    kind: 'aria-combobox',
    inspect,
    open: async () => {
      if (node.getAttribute('aria-expanded') !== 'true') {
        try { node.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); } catch { return false; }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      return comboListbox(node) !== null;
    },
    readOptions: () => comboOptions(node),
    write: async (value: string): Promise<ControlAdapterResult> => {
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      if (current.hasValue) return current.value === value
        ? { status: 'preserved', reason: '组合框已有相同内容，保留原值' }
        : { status: 'request-human', reason: '组合框已有内容，不覆盖' };
      if (!await thisOpen(node)) return { status: 'request-human', reason: '组合框未能安全打开' };
      const options = comboOptions(node).filter(option => !option.disabled && option.label === value);
      if (options.length !== 1) return { status: 'request-human', reason: '组合框没有唯一匹配选项' };
      const list = comboListbox(node);
      const target = list && Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).find(option => (
        visible(option) && !option.hasAttribute('disabled') && option.getAttribute('aria-disabled') !== 'true'
        && clean(option.getAttribute('aria-label') || option.textContent) === value
      ));
      if (!target) return { status: 'request-human', reason: '组合框选项已被替换' };
      try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); }
      catch { return { status: 'request-human', reason: '组合框选项无法选择' }; }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return comboValue(node) === value || target.getAttribute('aria-selected') === 'true'
        ? { status: 'written', reason: '组合框选择后已核验' }
        : { status: 'request-human', reason: '网页未保留组合框选择' };
    },
    verify: (value: string) => comboValue(node) === value
      || comboListbox(node)?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.textContent?.trim() === value,
  };
}

async function thisOpen(node: Element): Promise<boolean> {
  if (node.getAttribute('aria-expanded') === 'true') return comboListbox(node) !== null;
  try { node.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); }
  catch { return false; }
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return comboListbox(node) !== null;
}

export function createControlAdapter(node: Element): ControlAdapter {
  if (node.getAttribute('role') === 'combobox') return comboAdapter(node);
  if (node.getAttribute('role') === 'checkbox') return createAriaCheckboxAdapter(node);
  if (node.tagName === 'INPUT' && !['radio', 'checkbox', 'file', 'hidden', 'submit', 'button'].includes((node as HTMLInputElement).type)) return nativeAdapter(node as HTMLInputElement);
  if (node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') return nativeAdapter(node as HTMLTextAreaElement | HTMLSelectElement);
  const blocked = Object.freeze({
    node,
    kind: 'unknown' as const,
    inspect: () => ({ kind: 'unknown' as const, value: '', hasValue: false, options: [], blockedReason: '未知自定义控件，需要人工处理' }),
    open: async () => false,
    readOptions: () => [],
    write: async () => ({ status: 'request-human' as const, reason: '未知自定义控件，需要人工处理' }),
    verify: () => false,
  });
  return blocked;
}
