import type { WorkflowField } from '../workflow/model';
import { isMobilePrompt } from './mobilePage';

export interface FlowIO { check(): void; wait(ms: number): Promise<void> }
export function visible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
export const normalized = (value: string | null | undefined): string => (value ?? '').replace(/\s+/gu, ' ').trim();
export const emptyValue = (value: string): boolean => !normalized(value) || isMobilePrompt(normalized(value))
  || ['请选择', '附件只支持zip和rar格式'].includes(normalized(value));
export function controlValue(element: Element): string {
  if (element instanceof HTMLSelectElement) return normalized(element.selectedOptions[0]?.textContent);
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? normalized(element.value) : normalized(element.querySelector(':scope > span')?.textContent);
}
export const canonical = (value: string): string => normalized(value).replace(/学位$/u, '').replace(/^大学(?=本科|专科)/u, '').replace(/^(?:工学|理学|文学|管理学|经济学|法学|教育学)(?=学士|硕士|博士)/u, '');
export function chooseOption(labels: string[], value: string, target: string): number {
  const exact = labels.map((label, index) => ({ label, index })).filter(item => canonical(item.label) === canonical(value));
  if (exact.length === 1) return exact[0]!.index;
  if (exact.length > 1) return -1;
  if (target === 'rank') {
    const percent = /^(?:专业|年级)?前(\d+(?:\.\d+)?)%$/u.exec(value);
    if (percent) {
      const desired = Number(percent[1]);
      const bounds = labels.map((label, index) => ({ index, match: /^前(\d+(?:\.\d+)?)%$/u.exec(normalized(label)) }))
        .filter(item => item.match && Number(item.match[1]) >= desired && desired > 0 && desired <= 100)
        .sort((a, b) => Number(a.match![1]) - Number(b.match![1]));
      if (bounds.length && (bounds.length === 1 || bounds[0]!.match![1] !== bounds[1]!.match![1])) return bounds[0]!.index;
    }
  }
  return -1;
}
export async function until<T>(read: () => T | undefined | false, io: FlowIO, timeout = 5000): Promise<T | undefined> {
  for (let elapsed = 0; elapsed <= timeout; elapsed += 100) {
    io.check(); const result = read(); if (result) return result;
    if (elapsed < timeout) await io.wait(100);
  }
  return undefined;
}
function click(element: Element | null | undefined, io: FlowIO): void {
  io.check();
  if (!element || !visible(element) || ('disabled' in element && element.disabled)) throw new Error('控件未就绪，请检查网页');
  element.click();
}
async function dateControl(element: HTMLElement, value: string, io: FlowIO, monthOnly = false): Promise<void> {
  if (!(monthOnly ? /^\d{4}-\d{2}$/u : /^\d{4}-\d{2}-\d{2}$/u).test(value)) throw new Error(monthOnly ? '获奖时间需填写有效年月' : '网站要求具体到日，请补全日期，或启动前启用月份日期约定');
  const [year, month, day] = (monthOnly ? `${value}-01` : value).split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('日期不是有效的日历日期');
  click(element, io);
  const years = element.querySelector('.slideConYear');
  if (!years) throw new Error('网站日期控件结构已变化');
  for (let page = 0; page < 20; page++) {
    const choices = [...years.querySelectorAll('ul > li')];
    const match = choices.find(item => normalized(item.textContent) === String(year));
    if (match) { click(match, io); break; }
    const first = Number(normalized(choices[0]?.textContent));
    if (!first || page === 19) throw new Error('日期年份超出控件可选范围');
    click(years.querySelector(year < first ? '.slideP .lf' : '.slideP .rg'), io);
    await io.wait(50);
  }
  click([...element.querySelectorAll('.slideConMon ul > li')].find(item => normalized(item.textContent) === String(month)), io);
  if (!monthOnly) click([...element.querySelectorAll('.slideConDay ul > li')].find(item => normalized(item.textContent) === String(day)), io);
  if (controlValue(element) !== value) throw new Error('日期控件没有保留所选日期');
}
const limits: Record<string, number> = { college1: 50, specialty1: 50, researchArea1: 100, course1: 100,
  organizationName: 50, schoolJob: 50, cadreLevel: 50, dutyAchievement: 50,
  companyName: 50, department: 50, job: 50, workDescription: 500,
  certifierName: 30, certifierRelation: 20, certifierDuty: 50, certifierCompany: 50, certifierContact: 11,
  computerSkillType: 100, skillCertificate: 100, skillScore: 10, certificateDesc: 500,
  treatiseName: 50, treatiseSynopsis: 50, treatiseArchievement: 50, treatiseSituation: 50, treatiseCoauther: 50,
  awardName: 50, awardSchool: 50, awardType: 50, awardSummary: 500, cadresDesc: 500,
  projectName: 100, projectCompany: 50, projectJob: 50, projectDuty: 500, projectDesc: 500, projectArchievement: 500 };
export async function fillWorkflowField(editor: HTMLElement, field: WorkflowField, io: FlowIO): Promise<void> {
  io.check();
  if (!field.value?.trim()) return;
  const value = field.value.trim();
  if (field.kind === 'radio') {
    const choices = [...editor.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${field.target}"]`)];
    const target = choices.find(item => item.dataset.code === value);
    if (!target || !visible(target)) return;
    if (!target.checked) click(target, io);
    if (!target.checked) throw new Error('单选按钮未保留选择');
    await io.wait(200);
    return;
  }
  const element = editor.querySelector<HTMLElement>(`#${field.target}`);
  if (!visible(element)) return;
  const before = controlValue(element);
  if (field.kind === 'school' && before === normalized(value) && editor.querySelector<HTMLInputElement>('#studyOther2')?.checked) return;
  if (before === normalized(value) && field.kind !== 'school') return;
  // A partially completed draft may contain corrections supplied by the user. Never overwrite it.
  if (!emptyValue(before) && before !== normalized(value)) {
    if (field.kind === 'select' && canonical(before) === canonical(value)) return;
    if (field.kind === 'select' && field.target === 'rank' && chooseOption([before], value, 'rank') === 0) return;
    throw new Error('网页已有不同内容，请核对该项；清空后可按档案重填');
  }
  if (field.kind === 'date' || field.kind === 'month') { await dateControl(element, value, io, field.kind === 'month'); return; }
  if (field.kind === 'select') {
    if (element instanceof HTMLSelectElement) {
      const options = [...element.options].filter(option => !option.disabled);
      const index = chooseOption(options.map(option => option.text), value, field.target);
      if (index < 0) throw new Error('下拉菜单中没有唯一对应选项，请补选');
      element.value = options[index]!.value;
      element.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    io.check(); element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const options = await until(() => { const items = [...element.querySelectorAll('ul > li[data-code]')].filter(item => visible(item) && !item.matches('[disabled],[aria-disabled="true"],.disabled')); return items.length ? items : undefined; }, io);
    const index = chooseOption(options?.map(option => normalized(option.textContent)) ?? [], value, field.target);
    if (!options || index < 0) { element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); throw new Error('下拉菜单中没有唯一对应选项，请补选'); }
    const label = normalized(options[index]!.textContent);
    click(options[index], io);
    element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    if (controlValue(element) !== label) throw new Error('下拉菜单未保留选择');
    return;
  }
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('输入控件结构已变化');
  const max = Math.min(element.maxLength < 0 ? Infinity : element.maxLength, limits[field.target] ?? Infinity);
  if (value.length > max) throw new Error(`内容超过网站 ${max} 字限制，请在网页精简该项`);
  element.focus();
  Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  if (field.kind === 'school') {
    const option = await until(() => {
      const list = [...(element.parentElement?.querySelectorAll('ul.inputStudyList li[data-code]') ?? [])]
        .filter(item => visible(item) && normalized(item.textContent) === value);
      return list.length === 1 ? list[0] : undefined;
    }, io);
    if (!option) throw new Error('学校目录没有唯一匹配项，请在网页选择学校');
    click(option, io);
  }
  element.blur();
  if (controlValue(element) !== normalized(value) || !element.checkValidity()) throw new Error('网站未接受该项内容，请检查格式');
}
export function requiredIssues(editor: HTMLElement): string[] {
  const issues: string[] = [];
  for (const row of editor.querySelectorAll('dl')) {
    if (!visible(row)) continue;
    const title = row.querySelector(':scope > dt');
    if (!title) continue;
    const stars = [...title.querySelectorAll('.red')];
    if (stars.length ? !stars.some(visible) : !title.textContent?.includes('*')) continue;
    const label = normalized([...title.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('')).split(/[（(*]/u)[0]!.trim() || '必填项';
    const controls = [...row.querySelectorAll('input:not([type="hidden"]), textarea, select, .slt, .dateSlt')].filter(visible);
    const radios = controls.filter((item): item is HTMLInputElement => item instanceof HTMLInputElement && item.type === 'radio');
    if (radios.length) {
      for (const name of new Set(radios.map(item => item.name))) if (!radios.some(item => item.name === name && item.checked)) issues.push(`${label}：需要补选`);
    }
    for (const control of controls) {
      if (control instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'file'].includes(control.type)) continue;
      if (emptyValue(controlValue(control))) issues.push(`${label}：需要补齐`);
    }
  }
  // The upload widget is validated from its visible success state, never from a synthetic file value.
  const upload = editor.querySelector('#eduCertificateFileTip');
  if (visible(upload)) {
    const row = upload.closest('dl');
    if (visible(row?.querySelector('dt .red') ?? null) && (emptyValue(controlValue(upload)) || !/上传成功/u.test(row?.textContent ?? ''))) issues.push('教育证明：请在网页上传，等待显示上传成功');
  }
  for (const control of editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="file"]):not([type="hidden"]), textarea')) {
    if (!visible(control) || ['checkbox', 'radio', 'button', 'submit'].includes(control.type) || emptyValue(controlValue(control))) continue;
    const label = normalized(control.closest('dl')?.querySelector('dt')?.textContent).replace(/\*/gu, '') || control.id;
    const max = Math.min(control.maxLength < 0 ? Infinity : control.maxLength, limits[control.id] ?? Infinity);
    if (control.value.length > max || !control.checkValidity()) issues.push(`${label}：请检查格式或字数限制`);
  }
  const dates = [...editor.querySelectorAll('.dateSlt')].filter(visible).map(controlValue);
  if (dates.length === 2 && dates.every(value => /^\d{4}-\d{2}-\d{2}$/u.test(value)) && dates[0]! > dates[1]!) issues.push('时间：开始日期不能晚于结束日期');
  const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (dates[0] && /^\d{4}-\d{2}-\d{2}$/u.test(dates[0]) && dates[0] > today) issues.push('时间：中国移动不接受尚未开始的经历，请核对开始日期');
  return [...new Set(issues)];
}
