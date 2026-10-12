// DOM Standard's native author shadow hosts. Custom elements are rejected by
// the label/whole-page checks separately. Form controls' UA roots are not queried.
const nativeHosts = new Set(['article','aside','blockquote','body','div','footer','h1','h2','h3','h4','h5','h6','header','main','nav','p','section','span']);
/** Read the browser's extension API, never infer absence from shadowRoot===null.
 * https://developer.chrome.com/docs/extensions/reference/api/dom
 */
export type ShadowPaintStatus = 'clear' | 'component' | 'unavailable' | 'complex-page';
export function inspectShadowPaint(element: Element): Exclude<ShadowPaintStatus,'complex-page'> {
  if (element.shadowRoot || element.localName.includes('-')) return 'component';
  if (!(element instanceof HTMLElement) || !nativeHosts.has(element.localName)) return 'clear';
  try {
    if (typeof chrome === 'undefined' || typeof chrome.dom?.openOrClosedShadowRoot !== 'function') return 'unavailable';
    const root = chrome.dom.openOrClosedShadowRoot(element);
    return root === null ? 'clear' : root instanceof ShadowRoot ? 'component' : 'unavailable';
  } catch { return 'unavailable'; }
}
export function absentShadowPaint(element: Element): boolean { return inspectShadowPaint(element)==='clear'; }
export function isPainted(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const css = getComputedStyle(current);
    if (css.display === 'none' || css.visibility !== 'visible') return false;
  }
  return true;
}
/** Recheck after async boundaries: attaching a root need not mutate light DOM. */
export function currentShadowPaintStatus(): ShadowPaintStatus {
  const elements = [...document.querySelectorAll('*')];
  if (elements.length > 1500) return 'complex-page';
  for(const element of elements){if(!isPainted(element))continue;const status=inspectShadowPaint(element);if(status!=='clear')return status;}
  return 'clear';
}
export function currentShadowPaintAbsent(): boolean { return currentShadowPaintStatus()==='clear'; }
