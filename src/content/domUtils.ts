import type { FieldOption } from '../shared/types';
import { mobilePlaceholder } from './mobilePage';

export type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export const CONTROL_SELECTOR = 'input, textarea, select';

export function cleanText(value: string | null | undefined, limit = 240): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

/** Exclude values and text belonging to nested controls from semantic context. */
export function contextText(element: Element | null): string {
  if (!element) return '';
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(`${CONTROL_SELECTOR}, button, script, style, noscript, [contenteditable], [hidden]`)
    .forEach((child) => child.remove());
  return cleanText(clone.textContent);
}

export function controlLabels(node: FormControl): string {
  const labels = Array.from(node.labels ?? []).map(contextText).filter(Boolean);
  return cleanText([...new Set(labels)].join(' '));
}

export function ariaLabel(node: FormControl): string {
  const references = (node.getAttribute('aria-labelledby') ?? '').trim().split(/\s+/u).filter(Boolean);
  const referencedText = references.map((id) => contextText(node.ownerDocument.getElementById(id))).filter(Boolean).join(' ');
  return cleanText(referencedText || node.getAttribute('aria-label'));
}

export function parentText(node: FormControl): string {
  let parent = node.parentElement;
  for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
    if (parent.matches('form, body, html, table, tr, fieldset')) break;
    if (parent.querySelectorAll(CONTROL_SELECTOR).length !== 1) break;
    const text = contextText(parent);
    if (text) return text;
  }
  return '';
}

export function previousText(node: FormControl): string {
  let target: Element | null = node;
  for (let depth = 0; target && depth < 3; depth++, target = target.parentElement) {
    if (target.matches('body, form, fieldset, tr, table')) break;
    const sibling = target.previousElementSibling;
    if (sibling) {
      if (sibling.matches(`${CONTROL_SELECTOR}, button`) || sibling.querySelector(CONTROL_SELECTOR)) return '';
      const text = contextText(sibling);
      if (text) return text;
    }
    if ((target.parentElement?.querySelectorAll(CONTROL_SELECTOR).length ?? 0) > 1) break;
  }
  return '';
}

export function sectionText(node: FormControl): string {
  const fieldset = node.closest('fieldset');
  if (fieldset) {
    const legend = Array.from(fieldset.children).find((child) => child.tagName === 'LEGEND');
    const text = contextText(legend ?? null);
    if (text) return text;
  }
  let target: Element | null = node;
  for (let depth = 0; target && depth < 6; depth++, target = target.parentElement) {
    let sibling = target.previousElementSibling;
    for (let distance = 0; sibling && distance < 5; distance++, sibling = sibling.previousElementSibling) {
      if (sibling.matches('h1, h2, h3, h4, h5, h6, legend, [role="heading"]')) return contextText(sibling);
      if (!sibling.querySelector(CONTROL_SELECTOR)) {
        const headings = sibling.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
        if (headings.length === 1) return contextText(headings.item(0));
      }
      // A preceding section is not the section that owns this field.
      if (sibling.matches('section, fieldset, form')) break;
    }
    if (target.matches('form, section, body')) break;
  }
  return '';
}

export function tableHeader(node: FormControl): string {
  const cell = node.closest('td, th');
  const row = cell?.closest('tr');
  const table = row?.closest('table');
  if (!cell || !row || !table) return '';
  const explicit = (cell.getAttribute('headers') ?? '').split(/\s+/u).filter(Boolean)
    .map((id) => node.ownerDocument.getElementById(id))
    .filter((header) => header?.closest('table') === table)
    .map(contextText).filter(Boolean);
  if (explicit.length) return cleanText(explicit.join(' '));
  let previous = cell.previousElementSibling;
  while (previous) {
    if (previous.matches('th, td') && !previous.querySelector(CONTROL_SELECTOR)) {
      const text = contextText(previous);
      if (text) return text;
    }
    // Do not inherit a label across another editable cell.
    if (previous.querySelector(CONTROL_SELECTOR)) break;
    previous = previous.previousElementSibling;
  }
  const column = Array.from(row.children).indexOf(cell);
  // Only use a simple unmerged column header belonging to this table.
  const headerRows = Array.from(table.querySelectorAll('tr')).filter((candidate) => candidate.closest('table') === table);
  for (const candidate of headerRows) {
    if (candidate === row) break;
    const cells = Array.from(candidate.children);
    if (cells.some((item) => Number(item.getAttribute('colspan') ?? 1) !== 1 || Number(item.getAttribute('rowspan') ?? 1) !== 1)) continue;
    const header = cells[column];
    if (header?.matches('th') && !header.querySelector(CONTROL_SELECTOR)) return contextText(header);
  }
  return '';
}

export function selectOptions(node: HTMLSelectElement): FieldOption[] {
  return Array.from(node.options).map((option) => ({
    value: option.value,
    label: cleanText(option.label, 500),
    disabled: option.disabled || option.parentElement?.hasAttribute('disabled') === true,
  }));
}

export function isPlaceholderOption(option: HTMLOptionElement | undefined): boolean {
  if (!option) return true;
  const label = cleanText(option.label).replace(/^[-—–_\s]+|[-—–_\s]+$/gu, '');
  // An empty option value can still have a meaningful selected label. Preserve it.
  return label === '' || /^(?:请选择(?:.{0,24})?|请选(?:择)?|未选择|选择\.\.\.|please\s+(?:select|choose)(?:\s+.{0,30})?|select(?:\s+an?\s+option)?|choose(?:\s+an?\s+option)?)$/iu.test(label);
}

export function hasValue(node: FormControl): boolean {
  if (node.tagName === 'SELECT') {
    const select = node as HTMLSelectElement;
    return Array.from(select.selectedOptions).some((option) => !isPlaceholderOption(option));
  }
  if (node.tagName === 'INPUT' && ['radio', 'checkbox'].includes((node as HTMLInputElement).type)) return (node as HTMLInputElement).checked;
  return node.value !== '' && !mobilePlaceholder(node as HTMLInputElement | HTMLTextAreaElement);
}

export function hiddenReason(node: Element): string | undefined {
  const view = node.ownerDocument.defaultView;
  for (let current: Element | null = node; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return '隐藏或不可交互字段，需要人工处理';
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return '隐藏字段，不填写';
  }
  return undefined;
}

export function attributesFingerprint(node: Element): string {
  return JSON.stringify(Array.from(node.attributes).map(({ name, value }) => [name, value]).sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')));
}
