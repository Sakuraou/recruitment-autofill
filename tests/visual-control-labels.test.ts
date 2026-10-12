// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { captureControlLabels, sameControlLabels } from '../src/visual/controlLabels';

afterEach(() => { document.body.replaceChildren(); });
function fixture(count = 2) {
  document.body.innerHTML = Array.from({ length: count }, (_, index) => `<label for="opaque">陌生问题${index}</label>`).join('') + '<input id="opaque">';
  return document.querySelector<HTMLInputElement>('input')!;
}
describe('original explicit capture label identity', () => {
  it.each([1, 2, 3, 4])('retains every original label and its order for %s labels', count => {
    const node = fixture(count), labels = captureControlLabels(node)!;
    expect(labels).toHaveLength(count); expect(Object.isFrozen(labels)).toBe(true);
    expect(labels.every(label => label.control === node)).toBe(true);
    expect(sameControlLabels(node, labels)).toBe(true);
    expect(Object.keys(labels)).toHaveLength(count);
  });
  it.each([0, 5])('does not admit unbounded or missing labels: %s', count => {
    expect(captureControlLabels(fixture(count))).toBeUndefined();
  });
  it.each(['replace-label', 'remove-label', 'reorder', 'association', 'new-label', 'replace-control', 'disconnect', 'wrong-document'] as const)('rejects a changed original set: %s', mode => {
    const node = fixture(), labels = captureControlLabels(node)!;
    if (mode === 'replace-label') labels[1]!.replaceWith(labels[1]!.cloneNode(true));
    if (mode === 'remove-label') labels[1]!.remove();
    if (mode === 'reorder') document.body.prepend(labels[1]!);
    if (mode === 'association') labels[1]!.htmlFor = 'another';
    if (mode === 'new-label') { const label = document.createElement('label'); label.htmlFor = node.id; label.textContent = '新增标签'; document.body.prepend(label); }
    if (mode === 'replace-control') node.replaceWith(node.cloneNode(true));
    if (mode === 'disconnect') node.remove();
    if (mode === 'wrong-document') document.implementation.createHTMLDocument().body.append(node);
    expect(sameControlLabels(node, labels)).toBe(false);
  });
  it('does not select labels of a different control', () => {
    const node = fixture(), labels = captureControlLabels(node)!;
    document.body.insertAdjacentHTML('beforeend', '<label for="other">另一字段</label><input id="other">');
    expect(captureControlLabels(node)).toEqual(labels);
  });
  it('does not treat an implicit wrapping label as explicit capture authority', () => {
    document.body.innerHTML = '<label>嵌套字段<input id="opaque"></label>';
    expect(captureControlLabels(document.querySelector<HTMLInputElement>('input')!)).toBeUndefined();
  });
});
