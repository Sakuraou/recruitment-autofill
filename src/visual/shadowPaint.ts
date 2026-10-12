// DOM Standard's native author shadow hosts. Custom elements are rejected by
// the label/whole-page checks separately. Form controls' UA roots are not queried.
const nativeHosts = new Set(['article','aside','blockquote','body','div','footer','h1','h2','h3','h4','h5','h6','header','main','nav','p','section','span']);
/** Read the browser's extension API, never infer absence from shadowRoot===null.
 * https://developer.chrome.com/docs/extensions/reference/api/dom
 */
export function absentShadowPaint(element: Element): boolean {
  if (element.shadowRoot) return false;
  if (!(element instanceof HTMLElement) || !nativeHosts.has(element.localName)) return !element.localName.includes('-');
  try {
    return typeof chrome !== 'undefined' && typeof chrome.dom?.openOrClosedShadowRoot === 'function'
      && chrome.dom.openOrClosedShadowRoot(element) === null;
  } catch { return false; }
}
export function isPainted(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const css = getComputedStyle(current);
    if (css.display === 'none' || css.visibility !== 'visible') return false;
  }
  return true;
}
/** Recheck after async boundaries: attaching a root need not mutate light DOM. */
export function currentShadowPaintAbsent(): boolean {
  const elements = [...document.querySelectorAll('*')];
  return elements.length <= 1500 && elements.every(element => !isPainted(element) || absentShadowPaint(element));
}
