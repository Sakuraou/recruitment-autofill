import type { FieldDescriptor, FillOutcome, FillRequest } from '../shared/types';
import { effectiveMaxLength } from '../matching/profileResolver';
import { belongsToDocument, cleanText, hasValue, isPlaceholderOption, type FormControl } from './domUtils';
import { ariaCheckboxFingerprint, ariaComboboxFingerprint, ariaRadioGroupFingerprint, controlFingerprint, describeAriaCheckbox, describeAriaCombobox, describeAriaRadioGroup, describeControl, describeRadioGroup, radioGroupFingerprint, type ScanState } from './scanner';
import { describeMobileSelect, fillMobileSelect, mobileFingerprint } from './mobileSelect';
import { createControlAdapter } from './controlAdapter';

function nativeSet(node: FormControl, value: string): void {
  const view = node.ownerDocument.defaultView;
  if (!view) throw new Error('无法访问页面控件');
  const prototype: object = node.tagName === 'INPUT' ? view.HTMLInputElement.prototype
    : node.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('浏览器不支持安全填写此控件');
  setter.call(node, value);
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}

function candidateProblem(node: FormControl, value: string, field: FieldDescriptor): string | undefined {
  if (value.trim() === '') return '没有可靠的非空答案，需要人工填写';
  // Checkbox answers are represented by checked state, not the input's
  // string value. Validate the explicit boolean in its adapter instead of
  // mutating a detached clone's `.value` and applying text-field rules.
  if (field.kind === 'checkbox') return undefined;
  if (value.length > 50_000) return '答案过长，请在档案中维护合适的版本';
  const limit = effectiveMaxLength(field);
  if (limit !== null && value.length > limit) return '答案超过网页说明的长度限制；请修改后确认';
  if ('maxLength' in node && node.maxLength >= 0 && value.length > node.maxLength) return '答案超过字段长度限制；不会自动截断，请修改后确认';
  if (node.tagName === 'INPUT') {
    const type = (node as HTMLInputElement).type;
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return '日期需要完整且真实的 YYYY-MM-DD；不会推测具体日期';
    if (type === 'month' && !/^\d{4}-\d{2}$/u.test(value)) return '月份需要 YYYY-MM 格式，请核实档案';
  }
  if (node.tagName === 'SELECT') {
    const options = Array.from((node as HTMLSelectElement).options).filter((option) => option.value === value);
    if (options.length !== 1) return '下拉选项不存在或存在重复值，请重新扫描或人工选择';
    const option = options[0];
    if (!option || option.disabled || option.parentElement?.hasAttribute('disabled') || isPlaceholderOption(option)) return '不能选择禁用选项或占位选项';
  }
  if (node.validity.customError) return '网页为字段设置了验证错误，请人工处理后重新扫描';
  // Validate on a detached clone first, without changing the live form or firing events.
  const candidate = node.cloneNode(true) as FormControl;
  nativeSet(candidate, value);
  if (candidate.value !== value) return '浏览器不接受该值或会改变其格式，请人工确认';
  if (!candidate.validity.valid) return '答案不符合网页格式、范围或长度规则，请人工检查';
  return undefined;
}

/** Only explicit requests from the extension UI are executed; the page is never submitted. */
export async function fillScan(state: ScanState, request: FillRequest): Promise<FillOutcome[]> {
  const outcomes: FillOutcome[] = [];
  const seen = new Set<string>();
  for (const item of request.items) {
    const skip = (reason: string): void => { outcomes.push({ fieldId: item.fieldId, status: 'skipped', reason }); };
    if (request.scanId !== state.result.scanId) { skip('扫描已过期，请重新扫描'); continue; }
    if (state.document.URL !== state.result.url) { skip('页面地址已改变，请重新扫描'); continue; }
    if (!item.confirmed) { skip('尚未确认填写此答案'); continue; }
    if (seen.has(item.fieldId)) { skip('同一字段在本次请求中重复'); continue; }
    seen.add(item.fieldId);
    const control = state.controls.get(item.fieldId);
    if (!control) { skip('未找到本次扫描中的字段，请重新扫描'); continue; }
    if (control.adapter === 'aria-combobox') {
      const { node, controller } = control;
      if (!belongsToDocument(node, state.document)) { skip('字段已被替换或移除，请重新扫描'); continue; }
      const current = describeAriaCombobox(node, item.fieldId, controller);
      if (current.blockedReason) { skip(current.blockedReason); continue; }
      if (current.hasValue) { skip('组合框已有选择，不覆盖'); continue; }
      if (ariaComboboxFingerprint(node, current, controller) !== control.fingerprint) { skip('组合框标签、选项或内容已改变，请重新扫描'); continue; }
      try {
        const pending = controller.write(item.value);
        const result = isPromiseLike(pending) ? await pending : pending;
        outcomes.push({ fieldId: item.fieldId, status: result.status === 'written' ? 'filled' : 'error', reason: result.reason });
      } catch { outcomes.push({ fieldId: item.fieldId, status: 'error', reason: 'ARIA 组合框未能安全完成选择，请人工检查' }); }
      continue;
    }
    if (control.adapter === 'aria-radio-group') {
      const { node, members, controller } = control;
      if (!belongsToDocument(node, state.document) || members.some(member => !belongsToDocument(member, state.document))) {
        skip('单选组已被替换或移除，请重新扫描'); continue;
      }
      const current = describeAriaRadioGroup(node, members, item.fieldId, controller);
      if (current.blockedReason) { skip(current.blockedReason); continue; }
      if (current.hasValue) { skip('单选组已有答案，不覆盖'); continue; }
      if (ariaRadioGroupFingerprint(node, members, current, controller) !== control.fingerprint) { skip('单选组选项或标签已改变，请重新扫描'); continue; }
      try {
        const pending = controller.write(item.value);
        const result = isPromiseLike(pending) ? await pending : pending;
        outcomes.push({ fieldId: item.fieldId, status: result.status === 'written' ? 'filled' : 'error', reason: result.reason });
      } catch { outcomes.push({ fieldId: item.fieldId, status: 'error', reason: 'ARIA 单选组未能安全完成选择，请人工检查' }); }
      continue;
    }
    if (control.adapter === 'aria-checkbox') {
      const { node, controller } = control;
      if (!belongsToDocument(node, state.document)) { skip('复选框已被替换或移除，请重新扫描'); continue; }
      const current = describeAriaCheckbox(node, item.fieldId, controller);
      if (current.blockedReason) { skip(current.blockedReason); continue; }
      if (ariaCheckboxFingerprint(node, current, controller) !== control.fingerprint) { skip('复选框标签、选项或内容已改变，请重新扫描'); continue; }
      try {
        const pending = controller.write(item.value);
        const result = isPromiseLike(pending) ? await pending : pending;
        const successful = result.status === 'written' || result.status === 'preserved';
        outcomes.push({ fieldId: item.fieldId, status: successful ? 'filled' : 'error', reason: result.reason });
      } catch { outcomes.push({ fieldId: item.fieldId, status: 'error', reason: 'ARIA 复选框未能安全完成选择，请人工检查' }); }
      continue;
    }
    if (control.adapter === 'mobile-select') {
      const { node } = control;
      if (!node.isConnected || node.ownerDocument !== state.document) { skip('字段已被替换或移除，请重新扫描'); continue; }
      const current = describeMobileSelect(node, item.fieldId);
      if (current.blockedReason) { skip(current.blockedReason); continue; }
      if (current.hasValue) { skip('字段已有选择，不覆盖'); continue; }
      if (mobileFingerprint(node, current) !== control.fingerprint) { skip('字段标签、选项或内容已改变，请重新扫描'); continue; }
      try {
        const filled = await fillMobileSelect(node, item.value);
        outcomes.push({ fieldId: item.fieldId, status: filled ? 'filled' : 'error', reason: filled ? '已通过移动网站的选项事件选择，请复核' : '网站未保留预期选择，请人工检查并重新扫描' });
      } catch { outcomes.push({ fieldId: item.fieldId, status: 'error', reason: '下拉选择失败，请人工检查' }); }
      continue;
    }
    if (control.adapter === 'radio-group') {
      const { members } = control;
      if (!members.length || members.some((member) => !belongsToDocument(member, state.document))) { skip('单选组已被页面替换或移除，请重新扫描'); continue; }
      const current = describeRadioGroup(members, item.fieldId);
      if (current.blockedReason) { skip(current.blockedReason); continue; }
      if (current.hasValue) { skip('单选组已有答案，不覆盖'); continue; }
      if (radioGroupFingerprint(members, current) !== control.fingerprint) { skip('单选组选项、标签或内容已改变，请重新扫描'); continue; }
      const optionIndex = current.options.findIndex((option) => option.value === item.value && !option.disabled);
      const target = members[optionIndex];
      if (optionIndex < 0 || !target) { skip('没有唯一可用的单选项，请重新扫描或人工选择'); continue; }
      try {
        // Activate the unique semantic option through the browser's native
        // radio path so controlled React/Vue groups receive their normal
        // click/change sequence. No selector search or broad click is used.
        target.click();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        outcomes.push({ fieldId: item.fieldId, status: target.checked ? 'filled' : 'error',
          reason: target.checked ? '已选择唯一匹配的单选项；请在提交前复核' : '网页未保留预期单选答案，请人工检查' });
      } catch { outcomes.push({ fieldId: item.fieldId, status: 'error', reason: '单选控件未能安全完成填写，请人工检查' }); }
      continue;
    }
    const { node } = control;
    if (!belongsToDocument(node, state.document)) { skip('字段已被页面替换或移除，请重新扫描'); continue; }
    const current = describeControl(node, item.fieldId);
    if (current.blockedReason) { skip(current.blockedReason); continue; }
    if (hasValue(node)) { skip('字段已有内容，不覆盖网页或您填写的信息'); continue; }
    if (controlFingerprint(node, current) !== control.fingerprint) { skip('字段标签、选项、属性或当前内容已改变，请重新扫描'); continue; }
    try {
      const problem = candidateProblem(node, item.value, current);
      if (problem) { skip(problem); continue; }
      const adapter = createControlAdapter(node);
      const pending = adapter.write(item.value);
      const result = isPromiseLike(pending) ? await pending : pending;
      if (result.status === 'preserved') {
        outcomes.push({ fieldId: item.fieldId, status: 'skipped', reason: result.reason });
      } else if (result.status === 'written' && belongsToDocument(node, state.document) && adapter.verify(item.value)) {
        outcomes.push({ fieldId: item.fieldId, status: 'filled', reason: '已填写并检查当前值；请在提交前复核' });
      } else {
        outcomes.push({ fieldId: item.fieldId, status: 'error', reason: result.reason || '网页更新后未保留预期答案，请检查并重新扫描' });
      }
    } catch {
      outcomes.push({ fieldId: item.fieldId, status: 'error', reason: '网页控件未能安全完成填写，请人工检查' });
    }
  }
  // A later field can reset an earlier one. Recheck the whole batch after a short
  // settling window; never retry a rejected write or overwrite the site's result.
  if (outcomes.some(outcome => outcome.status === 'filled')) {
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    for (const outcome of outcomes) {
      if (outcome.status !== 'filled') continue;
      const control = state.controls.get(outcome.fieldId);
      const value = request.items.find(item => item.fieldId === outcome.fieldId)?.value;
      let retained = Boolean(control && value !== undefined && state.document.URL === state.result.url
        && belongsToDocument(control.node, state.document));
      if (control && retained) {
        if (control.adapter === 'mobile-select') {
          const field = describeMobileSelect(control.node, outcome.fieldId);
          const expected = field.options.find(option => option.value === value);
          retained = Boolean(expected && !expected.disabled && cleanText(control.node.querySelector(':scope > span')?.textContent) === expected.label);
        } else if (control.adapter === 'radio-group') {
          const index = Number(value?.replace('__radio_option_', ''));
          retained = Number.isInteger(index) && control.members[index]?.checked === true;
        } else if (control.adapter === 'aria-combobox') {
          retained = control.controller.verify(value ?? '');
        } else if (control.adapter === 'aria-radio-group') {
          retained = control.controller.verify(value ?? '');
        } else if (control.adapter === 'aria-checkbox') {
          retained = control.controller.verify(value ?? '');
        } else if (control.node.tagName === 'INPUT' && (control.node as HTMLInputElement).type === 'checkbox') {
          const checked = (control.node as HTMLInputElement).checked;
          retained = value === 'true' ? checked : value === 'false' ? !checked : false;
        } else retained = control.node.value === value && control.node.validity.valid;
      }
      if (!retained) {
        outcome.status = 'error';
        outcome.reason = '整批复核发现页面联动改写、移除了答案或验证未通过。没有重复覆盖，请检查网页后重新扫描。';
      }
    }
  }
  console.info('[校招网申助手]', {
    event: 'fill', requested: outcomes.length,
    filled: outcomes.filter((outcome) => outcome.status === 'filled').length,
    skipped: outcomes.filter((outcome) => outcome.status === 'skipped').length,
    errors: outcomes.filter((outcome) => outcome.status === 'error').length,
  });
  return outcomes;
}
