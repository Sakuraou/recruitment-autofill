import { afterEach, expect, it } from 'vitest';
import { isInternshipProofQuestionGroup as isProof } from '../src/content/semantic/internshipQuestionGroup';

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; });
function install(markup = '<select><option>是</option><option>否</option></select>', legend = '是否有证明') {
  document.body.innerHTML = `<form id="current"><fieldset><legend>${legend}</legend>${markup}</fieldset></form>`;
  return document.querySelector('fieldset')!;
}
it.each(['是否有证明', '有无证明', '是否有实习证明', ' Has Proof? ', '是否有证明＊：'])('有限的明确标题 %s 可读取原生选择题形状', legend => {
  expect(isProof(install(undefined, legend))).toBe(true);
});
it('同名、同 form 的原生 radio 可读取，网页内部答案编码不参与判断', () => {
  expect(isProof(install('<label><input name="opaque" type="radio" value="0">是</label><label><input name="opaque" type="radio" value="1">否</label>'))).toBe(true);
});
it('同义 ARIA 名称与标题一致且原生角色正确时可读取', () => {
  const group = install('<select role="combobox"><option>是</option><option>否</option></select>');
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', '有无证明'); expect(isProof(group)).toBe(true);
});
it.each(['button', 'link', 'dialog', 'form', 'region'])('问题框的 %s 角色不能借为原生问题', role => {
  const group = install(); group.setAttribute('role', role); expect(isProof(group)).toBe(false);
});
it.each(['button', 'link', 'textbox', 'checkbox'])('select 的 %s 角色不能借为原生问题', role => {
  const group = install(); group.querySelector('select')!.setAttribute('role', role); expect(isProof(group)).toBe(false);
});
it.each(['missing', 'duplicate', 'nested', 'hidden', 'aria', 'referenced', 'editable', 'detached', 'no-form', 'foreign-form', 'different-name', 'blank-name', 'too-many'])('标题、归属或成员边界 %s 不授予透明继承', mode => {
  const group = install('<label><input name="proof" type="radio">是</label><label><input name="proof" type="radio">否</label>');
  if (mode === 'missing') group.querySelector('legend')!.remove();
  if (mode === 'duplicate') group.insertAdjacentHTML('beforeend', '<legend>是否有证明</legend>');
  if (mode === 'nested') { const legend = group.querySelector('legend')!; const wrapper = document.createElement('div'); legend.replaceWith(wrapper); wrapper.append(legend); }
  if (mode === 'hidden') group.querySelector('legend')!.setAttribute('hidden', '');
  if (mode === 'aria') group.setAttribute('aria-label', '教育经历');
  if (mode === 'referenced') group.setAttribute('aria-labelledby', 'current');
  if (mode === 'editable') group.setAttribute('contenteditable', 'false');
  if (mode === 'detached') group.remove();
  if (mode === 'no-form') document.body.append(group);
  if (mode === 'foreign-form') { document.body.insertAdjacentHTML('beforeend', '<form id="other"></form>'); group.querySelector('input')!.setAttribute('form', 'other'); }
  if (mode === 'different-name') group.querySelector('input')!.name = 'other';
  if (mode === 'blank-name') group.querySelectorAll('input').forEach(input => input.removeAttribute('name'));
  if (mode === 'too-many') group.insertAdjacentHTML('beforeend', '<input name="proof" type="radio">'.repeat(39));
  expect(isProof(group)).toBe(false);
});
it.each(['<fieldset><legend>其他问题</legend></fieldset>', '<section></section>', '<form></form>', '<article></article>',
  '<div role="group"></div>', '<input type="file">', '<input type="checkbox">', '<label>证明人电话<input></label>',
  '<button type="button">保存</button>', '<a href="/">证明</a>', '<div contenteditable="true"></div>', '<div role="textbox"></div>',
  '<div role="radio">其他答案</div>', '<div role="switch">其他题</div>', '<div role="spinbutton"></div>', '<div role="link">证明</div>'])('混合子边界或额外内容 %s 不授予透明继承', markup => {
  const group = install();
  if (markup === '<form></form>') group.append(document.createElement('form'));
  else group.insertAdjacentHTML('beforeend', markup);
  expect(isProof(group)).toBe(false);
});
