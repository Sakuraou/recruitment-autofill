import { afterEach, expect, it } from 'vitest';
import { bindRecordEditor } from '../src/planner/recordEditorBinder';
import { lifecycle } from './fixtures/record-editor-context';

afterEach(() => { document.body.innerHTML = ''; });
function fixture() {
  const text = document.createElement('input');
  const first = document.createElement('input'); first.type = 'radio'; first.name = 'fictional-choice'; first.value = 'inside';
  const second = document.createElement('input'); second.type = 'radio'; second.name = first.name; second.value = 'second';
  const state = lifecycle([text, first], new Map([[first, [first, second]]]));
  let clicks = 0; first.addEventListener('click', () => clicks++); second.addEventListener('click', () => clicks++);
  const bind = (option = 1, rescan = () => state.context.capture(state.fixture.source), allowExpansion = false) => bindRecordEditor({
    plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
    runContext: state.context, scanState: state.fixture.scanState,
    provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? '虚构测试文本' : `__radio_option_${option}`,
    rescan, allowExpansion,
  });
  return { ...state, text, first, second, bind, clicks: () => clicks };
}
it.each([0, 1])('同组有外部成员，选择第 %i 项也必须整条零写入', async option => {
  const page = fixture(); document.body.append(page.second);
  const result = await page.bind(option);
  expect(result).toMatchObject({ status: 'request-human', writtenFieldCount: 0 });
  expect(page.clicks()).toBe(0); expect(page.first.checked).toBe(false); expect(page.second.checked).toBe(false);
  expect(page.text.value).toBe('');
});
it('前一字段事件把单选项移出编辑器，后一个选项不能被点击', async () => {
  const page = fixture(); page.text.addEventListener('input', () => document.body.append(page.second));
  const result = await page.bind();
  expect(result.status).toBe('request-human'); expect(page.clicks()).toBe(0); expect(page.second.checked).toBe(false);
});
it('选项激活后被移出编辑器，不能签发回执或点击另一项制造恢复', async () => {
  const page = fixture(); page.second.addEventListener('click', () => document.body.append(page.second));
  const result = await page.bind();
  expect(result).toMatchObject({ status: 'request-human', rollbackComplete: false });
  expect(page.clicks()).toBe(1); expect(page.second.checked).toBe(true);
});
it('等待联动时选项移出编辑器，不能把仍选中当成核验成功', async () => {
  const page = fixture(); page.second.addEventListener('click', () => setTimeout(() => document.body.append(page.second), 20));
  const result = await page.bind(1, undefined, true);
  expect(result).toMatchObject({ status: 'request-human', rollbackComplete: false });
  expect(page.clicks()).toBe(1); expect(page.second.checked).toBe(true);
});
it('重扫中选项移出编辑器，不能签发保存回执', async () => {
  const page = fixture();
  const result = await page.bind(1, () => { document.body.append(page.second); return page.context.capture(page.fixture.source); });
  expect(result).toMatchObject({ status: 'request-human', rollbackComplete: false });
  expect(page.clicks()).toBe(1); expect(page.second.checked).toBe(true);
});
it('正常整组仍可逐字段填写且不点击 Save', async () => {
  const page = fixture(); let saves = 0; page.fixture.editor.querySelector('button')!.addEventListener('click', () => saves++);
  expect((await page.bind()).status).toBe('advanced'); expect(page.clicks()).toBe(1);
  expect(page.text.value).toBe('虚构测试文本'); expect(page.second.checked).toBe(true); expect(saves).toBe(0);
});
it.each(['detached', 'foreign-document', 'shadow', 'different-form', 'duplicate', 'blank-names'])('成员%s时整条预检拒绝，已知文本也不写', async mode => {
  const page = fixture();
  if (mode === 'detached') page.second.remove();
  if (mode === 'foreign-document') document.implementation.createHTMLDocument().body.append(page.second);
  if (mode === 'shadow') { const host = document.createElement('div'); page.fixture.editor.append(host); host.attachShadow({ mode: 'open' }).append(page.second); }
  if (mode === 'different-form') { const form = document.createElement('form'); form.id = 'foreign-form'; document.body.append(form); page.second.setAttribute('form', form.id); }
  if (mode === 'duplicate') { const control = page.fixture.scanState.controls.get('scan:1')!; if (control.adapter === 'radio-group') control.members.push(page.second); }
  if (mode === 'blank-names') { page.first.name = ''; page.second.name = ''; }
  expect(await page.bind()).toMatchObject({ status: 'request-human', writtenFieldCount: 0 });
  expect(page.clicks()).toBe(0); expect(page.text.value).toBe('');
});
it.each(['inside', 'outside', 'hidden'])('同原生组新增未签发的%s成员时不能影响该成员已有选择', async mode => {
  const page = fixture(); const extra = document.createElement('input'); extra.type = 'radio'; extra.name = page.first.name; extra.checked = true;
  if (mode === 'hidden') extra.hidden = true;
  (mode === 'inside' ? page.fixture.editor : document.body).append(extra);
  expect(await page.bind()).toMatchObject({ status: 'request-human', writtenFieldCount: 0 });
  expect(extra.checked).toBe(true); expect(page.clicks()).toBe(0); expect(page.text.value).toBe('');
});
it('前一个字段事件添加同组外部选项时，零外部点击且保留外部原值', async () => {
  const page = fixture(); const extra = document.createElement('input'); extra.type = 'radio'; extra.name = page.first.name;
  page.text.addEventListener('input', () => { document.body.append(extra); extra.checked = true; });
  expect((await page.bind()).status).toBe('request-human');
  expect(extra.checked).toBe(true); expect(page.clicks()).toBe(0);
});
it.each(['before', 'during'])('原编辑器%s移出原列表时，不继续写或恢复外部字段', async mode => {
  const page = fixture();
  if (mode === 'before') document.body.append(page.fixture.editor);
  else page.text.addEventListener('input', () => document.body.append(page.fixture.editor));
  expect((await page.bind()).status).toBe('request-human'); expect(page.clicks()).toBe(0);
  if (mode === 'before') expect(page.text.value).toBe(''); else expect(page.text.value).toBe('虚构测试文本');
});
