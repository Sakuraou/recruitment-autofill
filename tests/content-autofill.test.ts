import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillScan } from '../src/content/autofill';
import { scanDocument, type ScanState } from '../src/content/scanner';

beforeEach(() => { document.body.innerHTML = ''; });
function prepare(html: string): ScanState { document.body.innerHTML = html; return scanDocument(); }
function fill(state: ScanState, values: string[], confirmed = true) {
  return fillScan(state, { scanId: state.result.scanId, items: values.map((value, index) => ({ fieldId: state.result.fields[index]?.id ?? '', value, confirmed })) });
}

describe('安全填写原生 HTML 控件', () => {
  it('整批核对发现后填字段清空前面答案时不再假报成功', async () => {
    const state = prepare('<input><input>');
    const [first, second] = document.querySelectorAll('input');
    second!.addEventListener('change', () => { first!.value = ''; });
    expect((await fill(state, ['原答案', '后续答案'])).map(item => item.status)).toEqual(['error', 'filled']);
    expect(first!.value).toBe('');
  });

  it('短暂延迟的网页回滚也报告失败，且不再次写入', async () => {
    const state = prepare('<input>');
    const node = document.querySelector('input')!;
    let changes = 0;
    node.addEventListener('change', () => { changes++; setTimeout(() => { node.value = '网页回滚'; }, 30); });
    expect((await fill(state, ['原答案']))[0]?.status).toBe('error');
    expect(changes).toBe(1);
    expect(node.value).toBe('网页回滚');
  });

  it('联动移除已填控件或增加校验错误时整批复核失败', async () => {
    const state = prepare('<input><input><input>');
    const [first, second, third] = document.querySelectorAll('input');
    third!.addEventListener('change', () => { first!.remove(); second!.setCustomValidity('网页验证失败'); });
    expect((await fill(state, ['甲', '乙', '丙'])).map(item => item.status)).toEqual(['error', 'error', 'filled']);
  });
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

  it('填写普通 radio 组但不点击控件或提交表单', async () => {
    const state = prepare('<form><span>性别</span><label><input type="radio" name="gender" value="M">男</label><label><input type="radio" name="gender" value="F">女</label><button type="submit">提交</button></form>');
    let clicks = 0; let submits = 0;
    document.querySelector('form')!.addEventListener('click', () => { clicks++; });
    document.querySelector('form')!.addEventListener('submit', event => { submits++; event.preventDefault(); });
    const outcomes = await fill(state, ['__radio_option_0']);
    expect(outcomes[0]?.status).toBe('filled');
    expect(document.querySelector<HTMLInputElement>('input[value="M"]')?.checked).toBe(true);
    expect(clicks).toBe(0);
    expect(submits).toBe(0);
  });

  it('填写同源 iframe、开放 Shadow DOM 和空的只读日期字段', async () => {
    document.body.innerHTML = '<label>出生日期<input id="birthday" readonly></label><iframe></iframe><div id="host"></div>';
    document.querySelector('iframe')!.contentDocument!.body.innerHTML = '<label>邮箱<input id="frame-email"></label>';
    document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<label>手机号<input id="shadow-phone"></label>';
    const state = scanDocument(document);
    const values = new Map([['出生日期', '2002-04-15'], ['邮箱', 'test@example.invalid'], ['手机号', '00000000000']]);
    const items = state.result.fields.map(field => ({ fieldId: field.id, value: values.get(field.label)!, confirmed: true }));
    const outcomes = await fillScan(state, { scanId: state.result.scanId, items });
    expect(outcomes.every((outcome) => outcome.status === 'filled')).toBe(true);
    expect((document.querySelector('#birthday') as HTMLInputElement).value).toBe('2002-04-15');
    expect((document.querySelector('iframe')!.contentDocument!.querySelector('#frame-email') as HTMLInputElement).value).toBe('test@example.invalid');
    expect((document.querySelector('#host')!.shadowRoot!.querySelector('#shadow-phone') as HTMLInputElement).value).toBe('00000000000');
  });

  it('填写带唯一显式 listbox 绑定的 ARIA combobox', async () => {
    document.body.innerHTML = '<label id="degree-label">最高学历</label><input id="degree" role="combobox" aria-labelledby="degree-label" aria-controls="degree-list" aria-expanded="false"><div id="degree-list" role="listbox" hidden><div role="option">本科</div><div role="option">硕士研究生</div></div>';
    const combo = document.querySelector<HTMLInputElement>('#degree')!;
    const list = document.querySelector<HTMLElement>('#degree-list')!;
    combo.addEventListener('click', () => { combo.setAttribute('aria-expanded', 'true'); list.hidden = false; });
    list.addEventListener('click', event => { combo.value = (event.target as HTMLElement).textContent?.trim() ?? ''; });
    const state = scanDocument(document);
    const field = state.result.fields.find(item => item.type === 'aria-combobox')!;
    const outcomes = await fillScan(state, { scanId: state.result.scanId,
      items: [{ fieldId: field.id, value: '硕士研究生', confirmed: true }] });
    expect(outcomes).toEqual([expect.objectContaining({ status: 'filled' })]);
    expect(combo.value).toBe('硕士研究生');
  });

  it('填写普通 ARIA radiogroup，但不代替协议单选', async () => {
    document.body.innerHTML = '<span id="gender-label">性别</span><div id="gender" role="radiogroup" aria-labelledby="gender-label"><div role="radio" aria-checked="false">男</div><div role="radio" aria-checked="false">女</div></div>';
    const group = document.querySelector<HTMLElement>('#gender')!;
    const members = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
    group.addEventListener('click', event => members.forEach(member => member.setAttribute('aria-checked', member === event.target ? 'true' : 'false')));
    const state = scanDocument(document);
    const field = state.result.fields.find(item => item.kind === 'radio')!;
    const outcomes = await fillScan(state, { scanId: state.result.scanId,
      items: [{ fieldId: field.id, value: '女', confirmed: true }] });
    expect(outcomes).toEqual([expect.objectContaining({ status: 'filled' })]);
    expect(members[1]?.getAttribute('aria-checked')).toBe('true');
  });

  it('填写普通 ARIA checkbox，明确“是/否”且不触碰协议复选框', async () => {
    document.body.innerHTML = '<span id="remote-label">有远程实习经历</span><div id="remote" role="checkbox" aria-labelledby="remote-label" aria-checked="false"></div><span id="consent-label">我同意隐私协议</span><div id="consent" role="checkbox" aria-labelledby="consent-label" aria-checked="false"></div>';
    const remote = document.querySelector<HTMLElement>('#remote')!;
    remote.addEventListener('click', () => remote.setAttribute('aria-checked', 'true'));
    const state = scanDocument(document);
    const fields = state.result.fields;
    const remoteField = fields.find(field => field.htmlId === 'remote')!;
    const consentField = fields.find(field => field.htmlId === 'consent')!;
    const outcomes = await fillScan(state, { scanId: state.result.scanId, items: [
      { fieldId: remoteField.id, value: 'true', confirmed: true },
      { fieldId: consentField.id, value: 'true', confirmed: true },
    ] });
    expect(outcomes.map(outcome => outcome.status)).toEqual(['filled', 'skipped']);
    expect(remote.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('#consent')?.getAttribute('aria-checked')).toBe('false');
  });

  it('填写带明确事实标签的原生 checkbox，但不自动取消已有勾选', async () => {
    document.body.innerHTML = '<label>是否学生干部<input id="cadre" type="checkbox"></label><label>我同意隐私协议<input id="consent" type="checkbox"></label>';
    const cadre = document.querySelector<HTMLInputElement>('#cadre')!;
    const state = scanDocument(document);
    const cadreField = state.result.fields.find(field => field.htmlId === 'cadre')!;
    const consentField = state.result.fields.find(field => field.htmlId === 'consent')!;
    const events: string[] = [];
    cadre.addEventListener('input', () => events.push('input'));
    cadre.addEventListener('change', () => events.push('change'));
    const outcomes = await fillScan(state, { scanId: state.result.scanId, items: [
      { fieldId: cadreField.id, value: 'true', confirmed: true },
      { fieldId: consentField.id, value: 'true', confirmed: true },
    ] });
    expect(outcomes.map(outcome => outcome.status)).toEqual(['filled', 'skipped']);
    expect(cadre.checked).toBe(true);
    expect(events).toEqual(['input', 'change']);
    cadre.checked = true;
    const rescanned = scanDocument(document);
    const current = rescanned.result.fields.find(field => field.htmlId === 'cadre')!;
    expect((await fillScan(rescanned, { scanId: rescanned.result.scanId, items: [{ fieldId: current.id, value: 'false', confirmed: true }] }))[0]?.status).toBe('skipped');
    expect(cadre.checked).toBe(true);
  });

  it('等待受控框架异步回写 ARIA checkbox 状态，且只点击一次', async () => {
    document.body.innerHTML = '<span id="label">有远程经历</span><div id="remote" role="checkbox" aria-labelledby="label" aria-checked="false"></div>';
    const remote = document.querySelector<HTMLElement>('#remote')!;
    let clicks = 0;
    remote.addEventListener('click', () => { clicks++; setTimeout(() => remote.setAttribute('aria-checked', 'true'), 25); });
    const state = scanDocument(document);
    const field = state.result.fields[0]!;
    expect((await fillScan(state, { scanId: state.result.scanId, items: [{ fieldId: field.id, value: 'true', confirmed: true }] }))[0]?.status).toBe('filled');
    expect(clicks).toBe(1);
  });

  it('等待受控框架异步回写 ARIA radiogroup 状态，且不重复点击', async () => {
    document.body.innerHTML = '<span id="label">性别</span><div id="gender" role="radiogroup" aria-labelledby="label"><div role="radio" aria-checked="false">男</div><div role="radio" aria-checked="false">女</div></div>';
    const group = document.querySelector<HTMLElement>('#gender')!;
    const members = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
    let clicks = 0;
    group.addEventListener('click', event => {
      clicks++;
      setTimeout(() => members.forEach(member => member.setAttribute('aria-checked', member === event.target ? 'true' : 'false')), 25);
    });
    const state = scanDocument(document);
    const field = state.result.fields[0]!;
    expect((await fillScan(state, { scanId: state.result.scanId, items: [{ fieldId: field.id, value: '女', confirmed: true }] }))[0]?.status).toBe('filled');
    expect(clicks).toBe(1);
  });
});
