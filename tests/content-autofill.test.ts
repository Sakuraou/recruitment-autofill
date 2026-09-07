import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillScan } from '../src/content/autofill';
import { scanDocument, type ScanState } from '../src/content/scanner';

beforeEach(() => { document.body.innerHTML = ''; });
function prepare(html: string): ScanState { document.body.innerHTML = html; return scanDocument(); }
function fill(state: ScanState, values: string[], confirmed = true) {
  return fillScan(state, { scanId: state.result.scanId, items: values.map((value, index) => ({ fieldId: state.result.fields[index]?.id ?? '', value, confirmed })) });
}

describe('安全填写原生 HTML 控件', () => {
  it('填写文本、多行、下拉、完整日期，仅触发 input/change，不点击或提交', async () => {
    const state = prepare('<form><input><textarea></textarea><select><option value="-1">请选择</option><option value="m">硕士</option></select><input type="date"><button type="submit">提交</button></form>');
    const events: string[] = [];
    const form = document.querySelector('form');
    for (const event of ['input', 'change', 'blur', 'click', 'submit', 'keydown']) form?.addEventListener(event, () => events.push(event));
    const outcomes = await fill(state, ['用户姓名', '研究方向\n来自真实档案', 'm', '2000-02-29']);
    expect(outcomes.every((outcome) => outcome.status === 'filled')).toBe(true);
    expect(events).toEqual(['input', 'change', 'input', 'change', 'input', 'change', 'input', 'change']);
  });

  it('使用原生 setter 兼容前端自定义实例 setter', async () => {
    const state = prepare('<input>');
    const node = document.querySelector('input');
    const custom = vi.fn();
    Object.defineProperty(node, 'value', { get() { return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get?.call(this) as string; }, set: custom, configurable: true });
    const [outcome] = await fill(state, ['真实姓名']);
    expect(outcome?.status).toBe('filled');
    expect(custom).not.toHaveBeenCalled();
  });

  it('不覆盖已有值、用户扫描后填写值以及非空白占位答案', async () => {
    const state = prepare('<input value="已有姓名"><input><select><option value="m">硕士</option></select>');
    document.querySelectorAll('input')[1]!.value = '用户后来填写';
    const outcomes = await fill(state, ['新姓名', '新值', 'm']);
    expect(outcomes.every((outcome) => outcome.status === 'skipped')).toBe(true);
    expect(document.querySelector('input')?.value).toBe('已有姓名');
  });

  it('必须确认，过期 scanId 和页面 URL 改变也跳过', async () => {
    const state = prepare('<input>');
    expect((await fill(state, ['真实姓名'], false))[0]?.status).toBe('skipped');
    expect((await fillScan(state, { scanId: 'old', items: [{ fieldId: state.result.fields[0]!.id, value: '真实姓名', confirmed: true }] }))[0]?.status).toBe('skipped');
    state.result.url += '#old';
    expect((await fill(state, ['真实姓名']))[0]?.reason).toContain('地址');
  });

  it('字段实例被替换、标签或约束变化均需重扫', async () => {
    const state = prepare('<label>姓名<input></label><label>邮箱<input></label><input>');
    document.querySelector('input')?.replaceWith(document.createElement('input'));
    document.querySelectorAll('label')[1]!.firstChild!.textContent = '验证码';
    document.querySelectorAll('input')[2]!.maxLength = 2;
    const outcomes = await fill(state, ['用户', 'mail@example.test', '用户姓名']);
    expect(outcomes.every((outcome) => outcome.status === 'skipped')).toBe(true);
    expect(Array.from(document.querySelectorAll('input')).every((node) => node.value === '')).toBe(true);
  });

  it('联动修改后续选项时跳过后续项', async () => {
    const state = prepare('<input><select><option value="">请选择</option><option value="a">原选项</option></select>');
    document.querySelector('input')!.addEventListener('change', () => { document.querySelector('select')!.options[1]!.textContent = '新选项'; });
    const outcomes = await fill(state, ['真实值', 'a']);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['filled', 'skipped']);
    expect(document.querySelector('select')?.value).toBe('');
  });

  it('不截断超长答案，不推测日期，不写入错误格式或不存在的选项', async () => {
    const state = prepare('<textarea maxlength="2"></textarea><input type="date"><input type="email"><input type="number" min="0" max="4"><select><option value="">请选择</option><option value="x">真实选项</option></select>');
    const outcomes = await fill(state, ['长度超限', '2027-06', 'invalid-address', '5', '不存在']);
    expect(outcomes.every((outcome) => outcome.status === 'skipped')).toBe(true);
    expect(document.querySelector('textarea')?.value).toBe('');
    expect(outcomes[1]?.reason).toContain('不会推测');
  });

  it('始终阻止密码、验证码、同意框、上传与隐藏字段，即使请求 confirmed', async () => {
    const state = prepare('<input type="password"><input autocomplete="one-time-code"><input type="checkbox"><input type="radio"><input type="file"><input type="hidden">');
    const outcomes = await fill(state, Array<string>(6).fill('unsafe'));
    expect(outcomes.every((outcome) => outcome.status === 'skipped')).toBe(true);
  });

  it('页面拒绝或改写已写入答案时报告失败，不再次覆盖', async () => {
    const state = prepare('<input>');
    document.querySelector('input')!.addEventListener('input', (event) => { (event.target as HTMLInputElement).value = '网页改写'; });
    expect((await fill(state, ['真实姓名']))[0]?.status).toBe('error');
    expect(document.querySelector('input')?.value).toBe('网页改写');
  });

  it('禁用和重复下拉选项不能被强制填写', async () => {
    const state = prepare('<select><option value="">请选择</option><option disabled value="x">禁用</option></select><select><option value="">请选择</option><option value="x">甲</option><option value="x">乙</option></select>');
    expect((await fill(state, ['x', 'x'])).every((outcome) => outcome.status === 'skipped')).toBe(true);
  });
});
