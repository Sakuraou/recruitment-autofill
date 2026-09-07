import type { FieldDescriptor, ScanResult } from '../shared/types';
import { isMobileResume, mobileLabel, mobileMaxLength, mobilePlaceholder, mobileSection } from './mobilePage';
import { describeMobileSelect, MOBILE_DATE_SELECTOR, MOBILE_SELECT_SELECTOR, mobileFingerprint } from './mobileSelect';
import {
  ariaLabel, attributesFingerprint, cleanText, CONTROL_SELECTOR, controlLabels, hasValue,
  hiddenReason, parentText, previousText, sectionText, selectOptions, tableHeader,
  type FormControl,
} from './domUtils';

export type ScannedControl = { node: FormControl; fingerprint: string; adapter?: undefined }
  | { node: HTMLElement; fingerprint: string; adapter: 'mobile-select' };
export interface ScanState {
  result: ScanResult;
  document: Document;
  /** Private, page-local objects: never send through extension messaging or storage. */
  controls: Map<string, ScannedControl>;
}

function blockedReason(node: FormControl, field: FieldDescriptor): string | undefined {
  const identity = [field.label, field.ariaLabel, field.placeholder, field.name, field.htmlId, field.title, field.parentText, field.previousText, field.tableHeader].join(' ');
  if (/验证码|校验码|短信验证|短信码|动态码|图形码|动态口令|安全口令|身份认证|实名认证|人机验证|人脸识别|captcha|one[\s_-]?time[\s_-]?(?:code|password)|(?:^|[\s_-])otp(?:[\s_-]?(?:code|token))?(?:$|[\s_-])|sms[\s_-]?(?:code|token)|(?:verification|verify|auth|security)[\s_-]?code/iu.test(identity) || node.autocomplete === 'one-time-code') return '验证码、短信验证和身份认证必须人工完成';
  if (field.type === 'password' || /密码|口令|password|passwd|(?:^|[\s_-])pwd(?:$|[\s_-])/iu.test(identity)) return '密码或安全口令不填写';
  if (field.type === 'file') return '文件上传必须人工完成';
  if (field.type === 'hidden') return '隐藏字段不填写';
  if (field.disabled) return '字段被禁用，需要人工处理';
  if (field.readOnly) return '只读字段，需要人工处理';
  if (isMobileResume(node.ownerDocument) && node.matches('.resumeCon1 .secon input.inputStudy')) return '学校需要在移动网站目录中搜索并选择；请人工操作以确认学校代码和地区';
  if (field.kind === 'radio' || field.kind === 'checkbox') return '单选、复选及同意条款请人工选择';
  if (node.tagName === 'SELECT' && (node as HTMLSelectElement).multiple) return '多选下拉框暂不支持，请人工选择';
  if (node.closest('[role="combobox"], [aria-haspopup="listbox"], .ant-select, .el-select, .el-cascader, .ant-picker, .el-date-editor')) return '自定义选择器暂不支持，请人工操作';
  if (node.tagName === 'INPUT' && !['text', 'search', 'tel', 'email', 'url', 'number', 'date', 'month'].includes(field.type)) return '此控件类型暂不支持，请人工操作';
  return hiddenReason(node);
}

export function describeControl(node: FormControl, id: string): FieldDescriptor {
  const type = node.tagName === 'INPUT' ? (node as HTMLInputElement).type : node.tagName.toLowerCase();
  const kind = type === 'radio' || type === 'checkbox' ? type : node.tagName.toLowerCase() as 'input' | 'textarea' | 'select';
  const nativeLimit = 'maxLength' in node && node.maxLength >= 0 ? node.maxLength : undefined;
  const siteLimit = mobileMaxLength(node);
  const maxLength = nativeLimit === undefined ? siteLimit ?? null : Math.min(nativeLimit, siteLimit ?? nativeLimit);
  const field: FieldDescriptor = {
    id, kind, type, label: controlLabels(node) || mobileLabel(node), placeholder: cleanText(node.getAttribute('placeholder')) || (node.tagName !== 'SELECT' ? mobilePlaceholder(node as HTMLInputElement | HTMLTextAreaElement) : ''),
    name: cleanText(node.name), htmlId: cleanText(node.id), ariaLabel: ariaLabel(node), title: cleanText(node.title),
    parentText: parentText(node), previousText: previousText(node), tableHeader: tableHeader(node), sectionText: mobileSection(node) || sectionText(node),
    options: node.tagName === 'SELECT' ? selectOptions(node as HTMLSelectElement) : [],
    maxLength, required: node.required, hasValue: hasValue(node),
    disabled: node.disabled || node.matches(':disabled') || node.closest('[aria-disabled="true"]') !== null,
    readOnly: ('readOnly' in node && node.readOnly) || node.getAttribute('aria-readonly') === 'true',
  };
  field.blockedReason = blockedReason(node, field);
  return field;
}

/** Includes current values only inside private in-memory state, never ScanResult. */
export function controlFingerprint(node: FormControl, field: FieldDescriptor): string {
  return JSON.stringify({
    field,
    attributes: attributesFingerprint(node),
    value: node.value,
    checked: 'checked' in node ? node.checked : undefined,
    selected: node.tagName === 'SELECT' ? Array.from((node as HTMLSelectElement).options).map((option) => ({
      attributes: attributesFingerprint(option), selected: option.selected, label: option.label, text: option.text,
    })) : undefined,
  });
}

export function scanDocument(doc: Document = document): ScanState {
  const scanId = crypto.randomUUID();
  const controls = new Map<string, ScannedControl>();
  const fields: FieldDescriptor[] = [];
  const nodes = Array.from(doc.querySelectorAll<FormControl>(CONTROL_SELECTOR))
    .filter((node) => node.tagName !== 'INPUT' || !['button', 'submit', 'reset', 'image'].includes((node as HTMLInputElement).type));
  const warnings: string[] = ['仅支持当前页面主文档中的普通 HTML 表单；自定义控件、iframe 和 Shadow DOM 内容请人工处理。'];
  if (nodes.length > 500) warnings.push('本页字段过多，本次仅扫描前 500 个字段。');
  for (const [index, node] of nodes.slice(0, 500).entries()) {
    const id = `${scanId}:${index}`;
    const field = describeControl(node, id);
    fields.push(field);
    controls.set(id, { node, fingerprint: controlFingerprint(node, field) });
  }
  if (isMobileResume(doc)) {
    warnings[0] = '已启用中国移动校招适配：支持默认提示语识别和普通下拉菜单。请先手动打开要编辑的简历区域，再扫描；日期、城市联动、单选按钮、附件及保存提交仍需人工操作。';
    const customNodes = Array.from(doc.querySelectorAll<HTMLElement>(`${MOBILE_SELECT_SELECTOR}, ${MOBILE_DATE_SELECTOR}`));
    if (fields.length + customNodes.length > 500 && nodes.length <= 500) warnings.push('本页字段过多，本次仅扫描前 500 个字段。');
    for (const node of customNodes.slice(0, 500 - fields.length)) {
      const id = `${scanId}:${fields.length}`;
      const field = describeMobileSelect(node, id);
      fields.push(field);
      controls.set(id, { node, fingerprint: mobileFingerprint(node, field), adapter: 'mobile-select' });
    }
  }
  console.info('[校招网申助手]', { event: 'scan', fields: fields.length, blocked: fields.filter((field) => field.blockedReason).length });
  return { result: { scanId, url: doc.URL, title: cleanText(doc.title), fields, warnings }, document: doc, controls };
}
