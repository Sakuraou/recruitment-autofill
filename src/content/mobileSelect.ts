import type { FieldDescriptor } from '../shared/types';
import { attributesFingerprint, cleanText, hiddenReason } from './domUtils';
import { isMobileResume, mobileLabel, mobileSection } from './mobilePage';

export const MOBILE_SELECT_SELECTOR = '.resumeCon1 .secon dl dd > div.slt';
export const MOBILE_DATE_SELECTOR = '.resumeCon1 .secon dl dd > div.dateSlt';
export function mobileOptions(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(':scope > ul > li[data-code]'));
}
function selectedLabel(node: HTMLElement): string {
  return cleanText(node.querySelector(':scope > span')?.textContent);
}
function disabledOption(option: HTMLElement): boolean {
  return option.matches('[disabled], [aria-disabled="true"], .disabled, [hidden], [inert], [aria-hidden="true"]')
    || option.style.display === 'none' || option.style.visibility === 'hidden';
}
export function describeMobileSelect(node: HTMLElement, id: string): FieldDescriptor {
  const selected = selectedLabel(node);
  const date = node.matches('.dateSlt');
  const blockedReason = !isMobileResume(node.ownerDocument) ? '网站适配器不适用于此页面'
    : hiddenReason(node) ?? (node.closest('[aria-disabled="true"], [disabled], .disabled, [aria-readonly="true"]') ? '字段被禁用或只读，需要人工处理'
      : node.id === 'sltId' && node.closest('#baseInfo') ? '证件类型选择会联动改写出生日期和性别，请人工选择并核对'
      : date ? '移动网站日期选择器需要人工选择；请使用完整真实日期'
        : !node.matches(MOBILE_SELECT_SELECTOR) || !mobileOptions(node).length ? '下拉选项尚未加载，请展开该区域后重新扫描' : undefined);
  return {
    id, kind: 'select', type: date ? 'mobile-date' : 'mobile-select', label: mobileLabel(node),
    placeholder: '', name: '', htmlId: node.id, ariaLabel: '', title: cleanText(node.title),
    parentText: '', previousText: '', tableHeader: '', sectionText: mobileSection(node),
    options: mobileOptions(node).map(option => ({ value: option.getAttribute('data-code') ?? '', label: cleanText(option.textContent, 500),
      disabled: disabledOption(option) })),
    maxLength: null, required: Boolean(node.closest('dl')?.querySelector(':scope > dt .red')),
    hasValue: selected !== '' && selected !== '请选择', disabled: false, readOnly: false, blockedReason,
  };
}
export function mobileFingerprint(node: HTMLElement, field: FieldDescriptor): string {
  return JSON.stringify({ field, attributes: attributesFingerprint(node), selected: selectedLabel(node),
    options: mobileOptions(node).map(option => ({ attributes: attributesFingerprint(option), text: option.textContent })) });
}

/** Use the site's own option handler so its jQuery code cache and visible label agree. */
export async function fillMobileSelect(node: HTMLElement, value: string): Promise<boolean> {
  const field = describeMobileSelect(node, '');
  if (field.blockedReason || field.hasValue) return false;
  const matches = mobileOptions(node).filter(option => option.getAttribute('data-code') === value);
  const option = matches[0];
  if (matches.length !== 1 || !option || field.options.find(item => item.value === value)?.disabled
    || !value || !option.textContent?.trim() || option.textContent.trim() === '请选择'
    || option.querySelector('a, button, input, form') || option.hasAttribute('onclick')) return false;
  const expectedLabel = cleanText(option.textContent);
  option.click();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return node.isConnected && selectedLabel(node) === expectedLabel;
}
