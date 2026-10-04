import { attributesFingerprint, hasValue, isPlaceholderOption, selectOptions } from './domUtils';

export type ControlAdapterKind = 'native-input' | 'native-textarea' | 'native-select' | 'native-checkbox' | 'aria-combobox' | 'aria-radio-group' | 'aria-checkbox' | 'unknown';

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
  open(signal?: AbortSignal): Promise<boolean>;
  readOptions(): readonly ControlAdapterOption[];
  write(value: string, signal?: AbortSignal): ControlAdapterResult | Promise<ControlAdapterResult>;
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

function visibleTree(node: Element): boolean {
  for (let current: Element | null = node; current; current = current.parentElement) {
    if (!visible(current)) return false;
  }
  return true;
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

function dispatchInput(node: Element, signal?: AbortSignal): void {
  const EventConstructor = node.ownerDocument.defaultView?.Event;
  if (!EventConstructor) throw new Error('event constructor unavailable');
  node.dispatchEvent(new EventConstructor('input', { bubbles: true, composed: true }));
  if (!signal?.aborted) node.dispatchEvent(new EventConstructor('change', { bubbles: true, composed: true }));
}

function unavailableReason(node: Element, kind: string): string | undefined {
  if (!node.isConnected) return `${kind}已被页面替换或移除，请重新扫描`;
  if (node.matches(':disabled') || node.closest('fieldset:disabled')) return `${kind}已禁用，需要人工处理`;
  if (node.closest('[aria-disabled="true"]')) return `${kind}已禁用，需要人工处理`;
  if (node.closest('[aria-readonly="true"]')) return `${kind}只读，需要人工处理`;
  if (node.closest('[hidden], [inert], [aria-hidden="true"]')) return `${kind}不可交互，需要人工处理`;
  if (!visibleTree(node)) return `${kind}不可交互，需要人工处理`;
  return undefined;
}

function selectableOptions(select: HTMLSelectElement, value: string): HTMLOptionElement[] {
  return Array.from(select.options).filter(option => option.value === value
    && !option.disabled && !option.parentElement?.hasAttribute('disabled') && !isPlaceholderOption(option));
}

/** Native radio groups are scoped by tree root and form, including open shadows. */
export function nativeRadioGroupCurrent(members: readonly HTMLInputElement[]): boolean {
  const first = members[0];
  if (!first || members.length > 500 || new Set(members).size !== members.length) return false;
  const root = first.getRootNode();
  if (!members.every(member => member.isConnected && member.type === 'radio'
    && member.ownerDocument === first.ownerDocument && member.getRootNode() === root
    && member.form === first.form && member.name === first.name)) return false;
  if (!first.name) return members.length === 1;
  const radios = (root as Document | ShadowRoot).querySelectorAll<HTMLInputElement>('input[type="radio"]');
  if (radios.length > 5000) return false;
  const cohort = Array.from(radios).filter(member => member.name === first.name && member.form === first.form);
  return cohort.length === members.length && cohort.every(member => members.includes(member));
}
export function verifyNativeRadioGroup(members: readonly HTMLInputElement[], value: string): boolean {
  if (!/^__radio_option_\d+$/u.test(value) || !nativeRadioGroupCurrent(members)) return false;
  const target = members[Number(value.slice('__radio_option_'.length))];
  return !!target && members.filter(member => member.checked).length === 1 && target.checked
    && !unavailableReason(target, '单选项') && target.validity.valid;
}

function waitForSelectableOption(select: HTMLSelectElement, value: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
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
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = (): void => finish(false);
    observer.observe(select, { childList: true, subtree: true, attributes: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) finish(false);
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
    open: async signal => !signal?.aborted,
    readOptions: () => inspect().options,
    write: (value: string, signal?: AbortSignal): ControlAdapterResult | Promise<ControlAdapterResult> => {
      if (signal?.aborted) return { status: 'request-human', reason: '填写已停止' };
      const originalUrl = node.ownerDocument.URL;
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      if (current.hasValue) return current.value === value
        ? { status: 'preserved', reason: '字段已有相同内容，保留原值' }
        : { status: 'request-human', reason: '字段已有内容，不覆盖' };
      if (!value.trim()) return { status: 'request-human', reason: '答案为空，不能猜测' };
      if (node.tagName === 'SELECT') {
        const select = node as HTMLSelectElement;
        const originalAttributes = attributesFingerprint(select);
        const applySelect = (): ControlAdapterResult => {
          if (signal?.aborted || select.ownerDocument.URL !== originalUrl) return { status: 'request-human', reason: '填写已停止或页面已变化' };
          const unavailable = unavailableReason(select, '下拉框');
          if (unavailable) return { status: 'request-human', reason: unavailable };
          if (attributesFingerprint(select) !== originalAttributes) return { status: 'request-human', reason: '等待期间下拉框属性已改变，请重新扫描' };
          if (hasValue(select)) return select.value === value
            ? { status: 'preserved', reason: '等待期间用户已选择相同答案，保留原值' }
            : { status: 'request-human', reason: '等待期间用户已选择其他答案，不覆盖' };
          if (selectableOptions(select, value).length !== 1) return { status: 'request-human', reason: '下拉选项不存在或不唯一' };
          try {
            nativeSetter(select)(value);
            dispatchInput(select, signal);
          } catch {
            return { status: 'request-human', reason: '控件未能安全写入' };
          }
          return !signal?.aborted && select.value === value && select.validity.valid
            ? { status: 'written', reason: '写入后已回读核验' }
            : { status: 'request-human', reason: '网页更新后未保留预期值' };
        };
        const candidates = selectableOptions(select, value);
        if (candidates.length !== 1) return waitForSelectableOption(select, value, signal).then((ready): ControlAdapterResult => ready
          ? applySelect() : { status: 'request-human', reason: '下拉选项未在限定时间内形成唯一匹配' });
        return applySelect();
      }
      try {
        nativeSetter(node)(value);
        dispatchInput(node, signal);
      } catch {
        return { status: 'request-human', reason: '控件未能安全写入' };
      }
      return !signal?.aborted && node.value === value && node.validity.valid
        ? { status: 'written', reason: '写入后已回读核验' }
        : { status: 'request-human', reason: '网页更新后未保留预期值' };
    },
    verify: (value: string) => node.value === value && node.validity.valid,
  };
}

function nativeCheckboxAdapter(node: HTMLInputElement): ControlAdapter {
  const inspect = (): ControlInspection => ({
    kind: 'native-checkbox', value: node.checked ? 'true' : 'false', hasValue: node.checked,
    options: [{ value: 'true', label: '是', disabled: false }, { value: 'false', label: '否', disabled: false }],
    ...(unavailableReason(node, '复选框') ? { blockedReason: unavailableReason(node, '复选框') }
      : node.indeterminate ? { blockedReason: '复选框状态不明确，需要人工处理' }
        : node.validity.customError ? { blockedReason: '网页为复选框设置了校验错误，需要人工处理' } : {}),
  });
  return {
    node, kind: 'native-checkbox', inspect,
    open: async signal => !signal?.aborted,
    readOptions: () => inspect().options,
    write: (value: string, signal?: AbortSignal): ControlAdapterResult => {
      if (signal?.aborted) return { status: 'request-human', reason: '填写已停止' };
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      const desired = booleanValue(value);
      if (desired === undefined) return { status: 'request-human', reason: '复选框答案不是明确的“是/否”，需要人工确认' };
      if (node.required && !desired) return { status: 'request-human', reason: '必选复选框不能保留未勾选状态，需要人工处理' };
      if (node.checked && desired === false) return { status: 'request-human', reason: '复选框已有选择，不自动取消已有内容' };
      if (node.checked === desired) return { status: 'preserved', reason: '复选框已有相同答案，保留原值' };
      try {
        // Native click is the browser's checkbox activation path: it updates
        // checked state and emits the event sequence used by React/Vue
        // controlled inputs. The scan already rejects hidden, disabled and
        // consent-like checkboxes, so this is one explicit semantic action,
        // not a broad click search.
        node.click();
      } catch { return { status: 'request-human', reason: '复选框未能安全选择' }; }
      return !signal?.aborted && node.checked && !node.indeterminate && node.validity.valid && !unavailableReason(node, '复选框')
        ? { status: 'written', reason: '复选框选择后已核验' } : { status: 'request-human', reason: '网页未保留有效的复选框答案' };
    },
    verify: (value: string) => {
      const desired = booleanValue(value);
      return desired !== undefined && !node.indeterminate && node.validity.valid
        && !unavailableReason(node, '复选框') && node.checked === desired;
    },
  };
}

function comboRefs(node: Element): string[] {
  return `${node.getAttribute('aria-controls') ?? ''} ${node.getAttribute('aria-owns') ?? ''}`
    .trim().split(/\s+/u).filter(Boolean);
}

/** ARIA roles do not remove native submit/reset/navigation activation. */
function ariaActivationProblem(node: Element): string | undefined {
  const seen = new Set<Element>(); let current: Element | null = node;
  for (let depth = 0; current && depth < 256; depth++) {
    if (seen.has(current)) return '控件激活关系不明确，需要人工处理';
    seen.add(current);
    if (current.tagName === 'BUTTON' && (current as HTMLButtonElement).type !== 'button'
      || current.tagName === 'INPUT' && ['submit', 'image', 'reset'].includes((current as HTMLInputElement).type))
      return '此控件带有原生提交或重置行为，不能自动点击';
    if (['A', 'AREA'].includes(current.tagName) && current.hasAttribute('href'))
      return '此控件带有链接导航行为，不能自动点击';
    if (current.tagName === 'LABEL') {
      const associated = (current as HTMLLabelElement).control;
      if (associated && associated !== node && (associated.tagName === 'BUTTON'
        || associated.tagName === 'INPUT' && ['checkbox', 'radio', 'submit', 'image', 'reset'].includes((associated as HTMLInputElement).type)))
        return '此控件会激活另一个表单控件，需要人工处理';
    }
    const root = current.getRootNode();
    current = current.parentElement ?? (root && 'host' in root ? (root as ShadowRoot).host : null);
  }
  return current ? '控件激活关系过深，需要人工处理' : undefined;
}

/** A scan-safe binding never opens the page and requires one explicit same-document listbox reference. */
export function stableAriaComboboxListbox(node: Element): HTMLElement | null {
  const refs = comboRefs(node);
  if (refs.length !== 1) return null;
  const root = node.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return null;
  const targets = Array.from((root as Document | ShadowRoot).querySelectorAll<HTMLElement>('[id]'))
    .filter(candidate => candidate.id === refs[0]);
  if (targets.length !== 1) return null;
  const target = targets[0];
  const owners = Array.from((root as Document | ShadowRoot).querySelectorAll('[role="combobox"], [aria-haspopup="listbox"]'))
    .filter(candidate => comboRefs(candidate).includes(refs[0]!));
  if (owners.length !== 1 || owners[0] !== node) return null;
  return target?.ownerDocument === node.ownerDocument && target.getAttribute('role') === 'listbox'
    ? target as HTMLElement : null;
}

/** Opaque, page-local provenance. Copies and serialized tokens carry no authority. */
export interface StableAriaComboboxObservation { readonly kind: 'stable-aria-combobox' }
interface ComboOptionObservation { readonly node: Element; readonly ancestors: readonly Element[]; readonly meaning: string }
interface ComboObservation {
  readonly node: Element; readonly list: Element; readonly root: Node; readonly url: string;
  readonly identity: string; readonly options: readonly ComboOptionObservation[];
}
const comboObservations = new WeakMap<StableAriaComboboxObservation, ComboObservation>();
const comboStateAttributes = new Set(['value', 'aria-valuetext', 'aria-expanded', 'aria-activedescendant', 'aria-invalid', 'class', 'style']);
const listStateAttributes = new Set(['hidden', 'aria-hidden', 'class', 'style']);
const optionStateAttributes = new Set(['aria-selected', 'aria-current', 'tabindex', 'class', 'style']);
function comboStructureAttributes(node: Element, ignored: ReadonlySet<string>): string {
  return JSON.stringify(Array.from(node.attributes).filter(attribute => !ignored.has(attribute.name))
    .map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')));
}
function observeComboStructure(node: Element): ComboObservation | undefined {
  if (!node.isConnected || ariaActivationProblem(node)) return undefined;
  const list = stableAriaComboboxListbox(node); if (!list?.isConnected) return undefined;
  const optionNodes = Array.from(list.querySelectorAll('[role="option"]'));
  if (!optionNodes.length || optionNodes.length > 1000 || optionNodes.some(option => option.closest('[role="listbox"]') !== list)) return undefined;
  const options = optionNodes.map(option => {
    const ancestors: Element[] = [];
    for (let parent = option.parentElement; parent && parent !== list && ancestors.length < 256; parent = parent.parentElement) ancestors.push(parent);
    return Object.freeze({ node: option, ancestors: Object.freeze(ancestors), meaning: JSON.stringify({
      label: radioOptionLabel(option), attributes: comboStructureAttributes(option, optionStateAttributes),
      ancestors: ancestors.map(parent => comboStructureAttributes(parent, optionStateAttributes)),
      unsafeActivation: Boolean(ariaActivationProblem(option)),
    }) });
  });
  if (options.some(option => option.ancestors.length === 256 && option.ancestors.at(-1)?.parentElement !== list)) return undefined;
  return { node, list, root: node.getRootNode(), url: node.ownerDocument.URL,
    identity: JSON.stringify([comboStructureAttributes(node, comboStateAttributes), comboStructureAttributes(list, listStateAttributes)]),
    options: Object.freeze(options) };
}
export function observeStableAriaCombobox(node: Element): StableAriaComboboxObservation | undefined {
  const data = observeComboStructure(node); if (!data) return undefined;
  const observation = Object.freeze({ kind: 'stable-aria-combobox' as const }); comboObservations.set(observation, data); return observation;
}
export function stableAriaComboboxObservationMatches(node: Element, observation: StableAriaComboboxObservation): boolean {
  const before = comboObservations.get(observation); if (!before || before.node !== node) return false;
  const current = observeComboStructure(node);
  return Boolean(current && current.root === before.root && current.url === before.url && current.list === before.list
    && current.identity === before.identity && current.options.length === before.options.length
    && current.options.every((option, index) => {
      const original = before.options[index]!;
      return option.node === original.node && option.meaning === original.meaning && option.ancestors.length === original.ancestors.length
        && option.ancestors.every((parent, depth) => parent === original.ancestors[depth]);
    }));
}

function comboListbox(node: Element): HTMLElement | null {
  const explicit = stableAriaComboboxListbox(node);
  if (explicit) return explicit;
  const refs = comboRefs(node);
  if (refs.length) return null;
  const candidates = Array.from(node.ownerDocument.querySelectorAll<HTMLElement>('[role="listbox"]')).filter(visibleTree);
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

function waitForAriaChecked(node: Element, desired: boolean, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  const originalUrl = node.ownerDocument.URL;
  const matches = (): boolean => !signal?.aborted && node.ownerDocument.URL === originalUrl
    && node.isConnected && (node.getAttribute('aria-checked') === 'true') === desired;
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
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = (): void => finish(false);
    observer.observe(node, { attributes: true, attributeFilter: ['aria-checked'] });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) finish(false);
  });
}

export function createAriaRadioGroupAdapter(group: Element, members: readonly Element[]): ControlAdapter {
  const inspect = (): ControlInspection => {
    const options = members.map(member => ({ value: radioOptionLabel(member), label: radioOptionLabel(member),
      disabled: Boolean(unavailableReason(member, '单选项') || ariaActivationProblem(member)) }));
    const selected = members.find(member => member.getAttribute('aria-checked') === 'true');
    return { kind: 'aria-radio-group', value: selected ? radioOptionLabel(selected) : '', hasValue: Boolean(selected), options,
      ...(unavailableReason(group, '单选组') || ariaActivationProblem(group)
        ? { blockedReason: unavailableReason(group, '单选组') || ariaActivationProblem(group) } : {}) };
  };
  return {
    node: group,
    kind: 'aria-radio-group',
    inspect,
    open: async signal => !signal?.aborted,
    readOptions: () => inspect().options,
    write: async (value: string, signal?: AbortSignal): Promise<ControlAdapterResult> => {
      if (signal?.aborted) return { status: 'request-human', reason: '填写已停止' };
      const originalUrl = group.ownerDocument.URL;
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      if (current.hasValue) return current.value === value
        ? { status: 'preserved', reason: '单选组已有相同答案，保留原值' }
        : { status: 'request-human', reason: '单选组已有答案，不覆盖' };
      const candidates = members.filter(member => radioOptionLabel(member) === value
        && !unavailableReason(member, '单选项') && !ariaActivationProblem(member));
      if (candidates.length !== 1) return { status: 'request-human', reason: '单选组没有唯一匹配选项' };
      const target = candidates[0]!;
      if (!target.isConnected || !group.contains(target)) return { status: 'request-human', reason: '单选组选项已被替换' };
      try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); }
      catch { return { status: 'request-human', reason: '单选项无法安全选择' }; }
      const checked = await waitForAriaChecked(target, true, signal);
      return checked && !signal?.aborted && group.ownerDocument.URL === originalUrl
        && target.isConnected && group.contains(target) && !unavailableReason(target, '单选项') && !ariaActivationProblem(target)
        ? { status: 'written', reason: '单选选择后已核验' }
        : { status: 'request-human', reason: '网页未保留预期单选答案' };
    },
    verify: (value: string) => {
      const selected = members.filter(member => member.getAttribute('aria-checked') === 'true');
      return selected.length === 1 && selected[0]!.isConnected && group.contains(selected[0]!)
        && !unavailableReason(group, '单选组') && !unavailableReason(selected[0]!, '单选项')
        && !ariaActivationProblem(selected[0]!) && radioOptionLabel(selected[0]!) === value;
    },
  };
}

export function booleanValue(value: string): boolean | undefined {
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
      ...(unavailableReason(node, '复选框') || ariaActivationProblem(node)
        ? { blockedReason: unavailableReason(node, '复选框') || ariaActivationProblem(node) }
        : rawChecked !== 'true' && rawChecked !== 'false' ? { blockedReason: '复选框状态不明确，需要人工处理' } : {}),
    };
  };
  return {
    node, kind: 'aria-checkbox', inspect,
    open: async signal => !signal?.aborted,
    readOptions: () => inspect().options,
    write: async (value: string, signal?: AbortSignal): Promise<ControlAdapterResult> => {
      if (signal?.aborted) return { status: 'request-human', reason: '填写已停止' };
      const originalUrl = node.ownerDocument.URL;
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      const desired = booleanValue(value);
      if (desired === undefined) return { status: 'request-human', reason: '复选框答案不是明确的“是/否”，需要人工确认' };
      const checked = current.value === 'true';
      if (checked && desired === false) return { status: 'request-human', reason: '复选框已有选择，不自动取消已有内容' };
      if (checked === desired) return { status: 'preserved', reason: '复选框已有相同答案，保留原值' };
      try { node.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); }
      catch { return { status: 'request-human', reason: '复选框无法安全选择' }; }
      const verifiedChecked = await waitForAriaChecked(node, true, signal);
      return verifiedChecked && !signal?.aborted && node.ownerDocument.URL === originalUrl
        && !unavailableReason(node, '复选框') && !ariaActivationProblem(node)
        ? { status: 'written', reason: '复选框选择后已核验' }
        : { status: 'request-human', reason: '网页未保留预期复选框答案' };
    },
    verify: (value: string) => {
      const desired = booleanValue(value);
      const rawChecked = node.getAttribute('aria-checked');
      return desired !== undefined && (rawChecked === 'true' || rawChecked === 'false')
        && (rawChecked === 'true') === desired && !unavailableReason(node, '复选框') && !ariaActivationProblem(node);
    },
  };
}

function comboOptions(node: Element): ControlAdapterOption[] {
  const list = comboListbox(node);
  if (!list) return [];
  // A collapsed listbox can still describe its choices during scanning. Only
  // ignore the listbox's own visibility, never hidden groups within it.
  const visibleWithinList = (option: Element): boolean => {
    for (let current: Element | null = option; current && current !== list; current = current.parentElement) {
      if (!visible(current)) return false;
    }
    return true;
  };
  return Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).filter(visibleWithinList).map((option) => ({
    value: option.getAttribute('data-value') ?? option.getAttribute('value') ?? option.id,
    label: clean(option.getAttribute('aria-label') || option.textContent),
    disabled: Boolean(option.closest('[aria-disabled="true"], [aria-readonly="true"], [inert], [disabled]')) || Boolean(ariaActivationProblem(option)),
  }));
}

function visibleComboOptions(node: Element, value: string): HTMLElement[] {
  const list = comboListbox(node);
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).filter(option => (
    visibleTree(option)
    && !option.hasAttribute('disabled') && !unavailableReason(option, '选项') && !ariaActivationProblem(option)
    && clean(option.getAttribute('aria-label') || option.textContent) === value
  ));
}

/** Polling also detects input.value changes, which do not generate DOM mutations. */
function waitForComboState(state: () => 'ready' | 'stop' | 'wait', signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const deadline = Date.now() + 500;
    let timer: ReturnType<typeof setTimeout> | undefined; let finished = false;
    const finish = (result: boolean): void => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(result);
    };
    const abort = (): void => finish(false);
    const check = (): void => {
      if (finished) return;
      if (signal?.aborted) { finish(false); return; }
      const current = state();
      if (current === 'ready') { finish(true); return; }
      if (current === 'stop' || Date.now() >= deadline) { finish(false); return; }
      timer = setTimeout(check, 16);
    };
    signal?.addEventListener('abort', abort, { once: true });
    check();
  });
}

function clickComboNode(node: Element): void {
  if (ariaActivationProblem(node)) throw new Error('unsafe native activation');
  const MouseEventConstructor = node.ownerDocument.defaultView?.MouseEvent;
  if (!MouseEventConstructor) throw new Error('event constructor unavailable');
  node.dispatchEvent(new MouseEventConstructor('click', { bubbles: true, composed: true }));
}

function verifyCombo(node: Element, value: string): boolean {
  if (unavailableReason(node, '组合框') || ariaActivationProblem(node)) return false;
  const selected = Array.from(comboListbox(node)?.querySelectorAll('[role="option"][aria-selected="true"]') ?? []);
  if (selected.length > 1 || (selected.length === 1 && radioOptionLabel(selected[0]!) !== value)) return false;
  const current = comboValue(node);
  return current === value || (!comboHasValue(current) && selected.length === 1 && selected[0]!.isConnected);
}

function comboAdapter(node: Element, observation?: StableAriaComboboxObservation): ControlAdapter {
  const structureCurrent = (): boolean => !observation || stableAriaComboboxObservationMatches(node, observation);
  const inspect = (): ControlInspection => ({
    kind: 'aria-combobox', value: comboValue(node), hasValue: comboHasValue(comboValue(node)), options: comboOptions(node),
    ...(unavailableReason(node, '组合框') || ariaActivationProblem(node)
      ? { blockedReason: unavailableReason(node, '组合框') || ariaActivationProblem(node) } : {}),
  });
  return {
    node,
    kind: 'aria-combobox',
    inspect,
    open: signal => structureCurrent() ? thisOpen(node, signal).then(opened => opened && structureCurrent()) : Promise.resolve(false),
    readOptions: () => comboOptions(node),
    write: async (value: string, signal?: AbortSignal): Promise<ControlAdapterResult> => {
      if (signal?.aborted) return { status: 'request-human', reason: '填写已停止' };
      if (!structureCurrent()) return { status: 'request-human', reason: '组合框原列表或选项已改变，请重新扫描' };
      const originalUrl = node.ownerDocument.URL;
      const current = inspect();
      if (current.blockedReason) return { status: 'request-human', reason: current.blockedReason };
      if (current.hasValue) return current.value === value
        ? { status: 'preserved', reason: '组合框已有相同内容，保留原值' }
        : { status: 'request-human', reason: '组合框已有内容，不覆盖' };
      const originalRefs = comboRefs(node).join(' ');
      const originalList = comboListbox(node);
      if (!await thisOpen(node, signal) || signal?.aborted || node.ownerDocument.URL !== originalUrl || !structureCurrent()) return { status: 'request-human', reason: '组合框未能安全打开' };
      const list = comboListbox(node);
      const refs = comboRefs(node).join(' ');
      if (refs !== originalRefs || (originalList !== null && list !== originalList)) return { status: 'request-human', reason: '打开期间组合框绑定已改变，请重新扫描' };
      const stillAvailable = (): boolean => !signal?.aborted && node.ownerDocument.URL === originalUrl && !unavailableReason(node, '组合框')
        && !ariaActivationProblem(node) && structureCurrent() && comboListbox(node) === list && comboRefs(node).join(' ') === refs;
      if (!await waitForComboState(() => {
        if (!stillAvailable() || comboHasValue(comboValue(node))) return 'stop';
        return visibleComboOptions(node, value).length === 1 ? 'ready' : 'wait';
      }, signal)) return { status: 'request-human', reason: '组合框选项或当前答案已改变，未形成唯一匹配' };
      // Opening and loading can synchronously update a controlled field. Check
      // again at the action boundary, before dispatching the option click.
      if (!stillAvailable() || comboHasValue(comboValue(node))) return { status: 'request-human', reason: '组合框已有新答案或已不可交互，不覆盖' };
      const visibleMatches = visibleComboOptions(node, value);
      if (visibleMatches.length !== 1) return { status: 'request-human', reason: '组合框没有唯一可见匹配选项' };
      const target = list && visibleMatches[0];
      if (!target) return { status: 'request-human', reason: '组合框选项已被替换' };
      try { clickComboNode(target); }
      catch { return { status: 'request-human', reason: '组合框选项无法选择' }; }
      const verified = await waitForComboState(() => {
        if (signal?.aborted || node.ownerDocument.URL !== originalUrl || unavailableReason(node, '组合框') || comboRefs(node).join(' ') !== refs || !structureCurrent()) return 'stop';
        const currentValue = comboValue(node);
        if (comboHasValue(currentValue) && currentValue !== value) return 'stop';
        if (verifyCombo(node, value)) return 'ready';
        if (comboListbox(node) !== list || !target.isConnected) return 'stop';
        return 'wait';
      }, signal);
      return verified && !signal?.aborted && node.ownerDocument.URL === originalUrl && structureCurrent() && verifyCombo(node, value)
        ? { status: 'written', reason: '组合框选择后已核验' }
        : { status: 'request-human', reason: '网页未保留组合框选择' };
    },
    verify: (value: string) => structureCurrent() && verifyCombo(node, value),
  };
}

async function thisOpen(node: Element, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || unavailableReason(node, '组合框') || ariaActivationProblem(node)) return false;
  if (comboRefs(node).length && !stableAriaComboboxListbox(node)) return false;
  const originalUrl = node.ownerDocument.URL;
  if (node.getAttribute('aria-expanded') !== 'true') {
    try { clickComboNode(node); } catch { return false; }
  }
  return waitForComboState(() => signal?.aborted || node.ownerDocument.URL !== originalUrl || unavailableReason(node, '组合框') || ariaActivationProblem(node) ? 'stop'
    : comboListbox(node) !== null ? 'ready' : 'wait', signal);
}

export function createControlAdapter(node: Element, observation?: StableAriaComboboxObservation): ControlAdapter {
  if (node.getAttribute('role') === 'combobox') return comboAdapter(node, observation);
  if (node.getAttribute('role') === 'checkbox') return createAriaCheckboxAdapter(node);
  if (node.tagName === 'INPUT' && (node as HTMLInputElement).type === 'checkbox') return nativeCheckboxAdapter(node as HTMLInputElement);
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
