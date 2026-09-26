import type { FieldDescriptor, ScanResult } from '../shared/types';
import { EXTENSION_VERSION } from '../shared/version';
import { isMobileResume, mobileLabel, mobileMaxLength, mobilePlaceholder, mobileSection } from './mobilePage';
import { describeMobileSelect, MOBILE_DATE_SELECTOR, MOBILE_SELECT_SELECTOR, mobileFingerprint } from './mobileSelect';
import { buildPageSemanticGraph } from './semantic/graphBuilder';
import {
  ariaLabel, attributesFingerprint, cleanText, collectControls, controlLabels, hasValue,
  hiddenReason, parentText, previousText, sectionText, selectOptions, structuralLabel, tableHeader,
  type FormControl,
} from './domUtils';

export type ScannedControl = { node: FormControl; fingerprint: string; adapter?: undefined }
  | { node: HTMLElement; fingerprint: string; adapter: 'mobile-select' }
  | { node: HTMLInputElement; members: HTMLInputElement[]; fingerprint: string; adapter: 'radio-group' };
export interface ScanState {
  result: ScanResult;
  document: Document;
  /** Private, page-local objects: never send through extension messaging or storage. */
  controls: Map<string, ScannedControl>;
  /** Private semantic node targets: never send through extension messaging or storage. */
  semanticTargets: Map<string, Element>;
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
  if (field.kind === 'checkbox') return '复选框及同意条款请人工选择';
  if (field.kind === 'radio' && /同意|协议|隐私|授权|承诺|声明|consent|agreement|privacy|authorize/iu.test(identity)) return '协议、授权和声明必须人工选择';
  if (node.tagName === 'SELECT' && (node as HTMLSelectElement).multiple) return '多选下拉框暂不支持，请人工选择';
  if (node.closest('[role="combobox"], [aria-haspopup="listbox"], .ant-select, .el-select, .el-cascader, .ant-picker, .el-date-editor')) return '自定义选择器暂不支持，请人工操作';
  if (node.tagName === 'INPUT' && field.kind === 'input' && !['text', 'search', 'tel', 'email', 'url', 'number', 'date', 'month'].includes(field.type)) return '此控件类型暂不支持，请人工操作';
  return hiddenReason(node);
}

export function describeControl(node: FormControl, id: string): FieldDescriptor {
  const type = node.tagName === 'INPUT' ? (node as HTMLInputElement).type : node.tagName.toLowerCase();
  const kind = type === 'radio' || type === 'checkbox' ? type : node.tagName.toLowerCase() as 'input' | 'textarea' | 'select';
  const nativeLimit = 'maxLength' in node && node.maxLength >= 0 ? node.maxLength : undefined;
  const siteLimit = mobileMaxLength(node);
  const maxLength = nativeLimit === undefined ? siteLimit ?? null : Math.min(nativeLimit, siteLimit ?? nativeLimit);
  const rawReadOnly = ('readOnly' in node && node.readOnly) || node.getAttribute('aria-readonly') === 'true';
  const associatedLabel = controlLabels(node);
  const machineLabel = associatedLabel !== '' && !/[\p{Script=Han}\s]/u.test(associatedLabel)
    && /[_:[\].-]|[a-z\d][A-Z]/u.test(associatedLabel);
  const visibleStructure = tableHeader(node) || ((!associatedLabel || machineLabel) ? structuralLabel(node) : '');
  const dateIdentity = [associatedLabel, visibleStructure, ariaLabel(node), node.name, node.id, node.title, node.getAttribute('placeholder')].join(' ');
  const supportedReadOnlyDate = rawReadOnly && node.tagName === 'INPUT' && !node.value
    && (/^(?:date|month)$/u.test(type) || /出生|生日|入学|毕业|开始|结束|起始|截止|日期|时间|年月|birthday|birth\s*date|start\s*date|end\s*date|graduation|enrollment/iu.test(dateIdentity));
  const field: FieldDescriptor = {
    id, kind, type, label: associatedLabel || mobileLabel(node), placeholder: cleanText(node.getAttribute('placeholder')) || (node.tagName !== 'SELECT' ? mobilePlaceholder(node as HTMLInputElement | HTMLTextAreaElement) : ''),
    name: cleanText(node.name), htmlId: cleanText(node.id), ariaLabel: ariaLabel(node), title: cleanText(node.title),
    parentText: parentText(node), previousText: previousText(node), tableHeader: visibleStructure, sectionText: mobileSection(node) || sectionText(node),
    options: node.tagName === 'SELECT' ? selectOptions(node as HTMLSelectElement) : [],
    maxLength, required: node.required, hasValue: hasValue(node),
    disabled: node.disabled || node.matches(':disabled') || node.closest('[aria-disabled="true"]') !== null,
    readOnly: rawReadOnly && !supportedReadOnlyDate,
  };
  field.blockedReason = blockedReason(node, field);
  return field;
}

export function describeRadioGroup(members: HTMLInputElement[], id: string): FieldDescriptor {
  const first = members[0];
  if (!first) throw new Error('空的单选组');
  const base = describeControl(first, id);
  const question = tableHeader(first) || structuralLabel(first) || sectionText(first) || cleanText(first.name);
  const options = members.map((member, index) => ({
    value: `__radio_option_${index}`,
    label: controlLabels(member) || ariaLabel(member) || cleanText(member.value) || `选项 ${index + 1}`,
    disabled: member.disabled || member.matches(':disabled') || hiddenReason(member) !== undefined,
  }));
  const field: FieldDescriptor = { ...base, kind: 'radio', type: 'radio',
    label: question, tableHeader: tableHeader(first), parentText: parentText(first), previousText: previousText(first),
    options, hasValue: members.some((member) => member.checked), disabled: members.every((member) => member.disabled), readOnly: false,
  };
  field.blockedReason = blockedReason(first, field);
  return field;
}

export function radioGroupFingerprint(members: HTMLInputElement[], field: FieldDescriptor): string {
  return JSON.stringify({ field: { ...field, groupId: undefined }, members: members.map((member) => ({
    attributes: attributesFingerprint(member), value: member.value, checked: member.checked,
    label: controlLabels(member) || ariaLabel(member) || cleanText(member.value),
  })) });
}

/** Includes current values only inside private in-memory state, never ScanResult. */
export function controlFingerprint(node: FormControl, field: FieldDescriptor): string {
  return JSON.stringify({
    field: { ...field, groupId: undefined },
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
  const groups = new Map<Element, string>();
  const groupId = (node: Element): string | undefined => {
    const root = (isMobileResume(doc) ? node.closest('.resumeCon1 .secon') : null) ?? node.closest('fieldset, section, form');
    if (!root) return undefined;
    if (!groups.has(root)) groups.set(root, `${scanId}:group:${groups.size}`);
    return groups.get(root);
  };
  const collected = collectControls(doc);
  const nodes = collected.nodes
    .filter((node) => node.tagName !== 'INPUT' || !['button', 'submit', 'reset', 'image'].includes((node as HTMLInputElement).type));
  const warnings: string[] = ['已扫描主页面、可访问的同源 iframe 与开放 Shadow DOM；跨域 iframe、封闭 Shadow DOM 和特殊自定义控件仍需人工处理。'];
  if (collected.sameOriginFrameCount || collected.openShadowRootCount) warnings.push(`已额外读取 ${collected.sameOriginFrameCount} 个同源 iframe、${collected.openShadowRootCount} 个开放 Shadow DOM。`);
  if (collected.inaccessibleFrameCount) warnings.push(`另有 ${collected.inaccessibleFrameCount} 个跨域或不可访问 iframe，浏览器安全边界不允许从本页读取。`);
  if (nodes.length > 500) warnings.push('本页字段过多，本次仅扫描前 500 个字段。');
  const seenRadios = new Set<HTMLInputElement>();
  for (const node of nodes) {
    if (fields.length >= 500) break;
    if (node.tagName === 'INPUT' && (node as HTMLInputElement).type === 'radio') {
      const radio = node as HTMLInputElement;
      if (seenRadios.has(radio)) continue;
      const members = radio.name ? nodes.filter((candidate): candidate is HTMLInputElement => candidate.tagName === 'INPUT'
        && (candidate as HTMLInputElement).type === 'radio' && candidate.ownerDocument === radio.ownerDocument
        && (candidate as HTMLInputElement).name === radio.name && (candidate as HTMLInputElement).form === radio.form) : [radio];
      members.forEach((member) => seenRadios.add(member));
      const id = `${scanId}:${fields.length}`;
      const field = describeRadioGroup(members, id);
      field.groupId = groupId(radio);
      fields.push(field);
      controls.set(id, { node: radio, members, fingerprint: radioGroupFingerprint(members, field), adapter: 'radio-group' });
      continue;
    }
    const id = `${scanId}:${fields.length}`;
    const field = describeControl(node, id);
    field.groupId = groupId(node);
    fields.push(field);
    controls.set(id, { node, fingerprint: controlFingerprint(node, field) });
  }
  if (isMobileResume(doc)) {
    warnings[0] = '中国移动教育与项目可使用上方「连续填写」自动新增、填表、保存及滚动。下方逐字段模式用于其他信息；城市联动、附件及最终投递仍需你完成。';
    const customNodes = Array.from(doc.querySelectorAll<HTMLElement>(`${MOBILE_SELECT_SELECTOR}, ${MOBILE_DATE_SELECTOR}`));
    if (fields.length + customNodes.length > 500 && nodes.length <= 500) warnings.push('本页字段过多，本次仅扫描前 500 个字段。');
    for (const node of customNodes.slice(0, 500 - fields.length)) {
      const id = `${scanId}:${fields.length}`;
      const field = describeMobileSelect(node, id);
      field.groupId = groupId(node);
      fields.push(field);
      controls.set(id, { node, fingerprint: mobileFingerprint(node, field), adapter: 'mobile-select' });
    }
  }
  let semanticTargets = new Map<string, Element>();
  let semanticGraph: ScanResult['semanticGraph'];
  try {
    const semantic = buildPageSemanticGraph(doc, fields, controls);
    semanticGraph = semantic.graph;
    semanticTargets = semantic.targets;
  } catch {
    warnings.push('页面结构暂未通过语义校验；逐字段扫描仍可正常使用。');
  }
  console.info('[校招网申助手]', { event: 'scan', fields: fields.length, blocked: fields.filter((field) => field.blockedReason).length });
  return {
    result: { contentVersion: EXTENSION_VERSION, scanId, url: doc.URL, title: cleanText(doc.title), fields, semanticGraph, warnings },
    document: doc,
    controls,
    semanticTargets,
  };
}
