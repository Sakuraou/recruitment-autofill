import { describe, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { verifyScanObservation } from '../src/content/scanFreshness';

function setup() {
  document.body.innerHTML = '<section><h2>个人信息</h2><label>如何称呼您<input></label><label>如何联系您<select><option value="">请选择</option><option value="a">虚构选项甲</option></select></label></section>';
  return scanDocument();
}
describe('fresh DOM observation while a semantic response is pending', () => {
  it('checks a fresh scanner capture and actual node identities but keeps the original opaque field references', () => {
    const state = setup(); const before = document.body.innerHTML;
    expect(verifyScanObservation(state)).toBe(state.result);
    expect(document.body.innerHTML).toBe(before); expect(document.activeElement).toBe(document.body);
  });
  it.each(['value', 'label', 'type', 'disable', 'replace', 'remove', 'new-field', 'options', 'section', 'new-action'])('refuses a changed %s without filling anything', change => {
    const state = setup(); const input = document.querySelector('input')!;
    if (change === 'value') input.value = '手工内容';
    if (change === 'label') input.parentElement!.firstChild!.textContent = '另一问题';
    if (change === 'type') input.type = 'password';
    if (change === 'disable') input.disabled = true;
    if (change === 'replace') input.replaceWith(input.cloneNode(true));
    if (change === 'remove') input.remove();
    if (change === 'new-field') document.querySelector('section')!.insertAdjacentHTML('beforeend', '<label>新增问题<input></label>');
    if (change === 'options') document.querySelector('select')!.add(new Option('虚构选项乙', 'b'));
    if (change === 'section') document.querySelector('h2')!.textContent = '家庭成员';
    if (change === 'new-action') document.querySelector('section')!.insertAdjacentHTML('beforeend', '<button type="submit">提交</button>');
    const before = document.body.innerHTML;
    expect(verifyScanObservation(state)).toBeUndefined(); expect(document.body.innerHTML).toBe(before);
    if (change === 'value') expect(input.value).toBe('手工内容');
  });
  it('invalidates navigation, loss of the semantic graph and radio members replaced with lookalikes', () => {
    const state = setup(); state.result.url = 'https://another.example.test/';
    expect(verifyScanObservation(state)).toBeUndefined();
    const missing = setup(); delete missing.result.semanticGraph; expect(verifyScanObservation(missing)).toBeUndefined();
    document.body.innerHTML = '<fieldset><legend>个人信息</legend><label>一种称谓<input type="radio" name="t" value="a"></label><label>另一称谓<input type="radio" name="t" value="b"></label></fieldset>';
    const radio = scanDocument(); const second = document.querySelectorAll('input')[1]!; second.replaceWith(second.cloneNode(true));
    expect(verifyScanObservation(radio)).toBeUndefined();
  });
});
