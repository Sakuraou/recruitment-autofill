import { planCropGeometry, type CssRect, type CropGeometryResult, type ViewportGeometry } from './cropGeometry';

/** Local caller seam, never a model/message payload. Scanner admission is still required. */
export interface LocalCropContext {
  owner: object; scan: object; node: HTMLInputElement | HTMLTextAreaElement;
  label: HTMLLabelElement; scope: 'ordinary' | 'repeated' | 'protected';
  unanswered: boolean; signal: AbortSignal;
}
export interface CropEvidence { readonly kind: 'crop-geometry-proof' }
export interface CropEvidenceSession {
  issue(): CropEvidence | undefined;
  plan(proof: CropEvidence, image: { width: number; height: number }): CropGeometryResult | undefined;
  cancel(): void;
}
interface NodeSnapshot { node: Node; parent: Node | null; children: Node[]; fingerprint: string }
interface Issue {
  context: LocalCropContext; viewport: ViewportGeometry; target: CssRect; page: NodeSnapshot[];
  url: string; time: number; dirty: boolean; observer: MutationObserver; detach: () => void;
}
const protectedMeaning = /验证码|认证|密码|口令|协议|授权|隐私|同意|承诺|声明|上传|投递|提交|captcha|verification|password|consent|agreement|privacy|authoriz|one-time-code|submit|upload/iu;
function bounds(node: Element): CssRect {
  const r = node.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
function visible(node: Element): boolean {
  for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (ancestor.hasAttribute('hidden') || ancestor.getAttribute('aria-hidden') === 'true'
      || ancestor.hasAttribute('inert') || style.display === 'none' || style.visibility !== 'visible'
      || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
  }
  return true;
}
function admitted(c: LocalCropContext | undefined): c is LocalCropContext {
  if (!c || !c.owner || typeof c.owner !== 'object' || !c.scan || typeof c.scan !== 'object'
    || c.scope !== 'ordinary' || c.unanswered !== true || c.signal.aborted
    || document.defaultView?.top !== document.defaultView || !/^https?:/u.test(document.URL)
    || !(c.node instanceof HTMLInputElement || c.node instanceof HTMLTextAreaElement)
    || !(c.label instanceof HTMLLabelElement) || c.node.ownerDocument !== document
    || c.label.ownerDocument !== document || c.node.getRootNode() !== document || c.label.getRootNode() !== document
    || !c.node.isConnected || !c.label.isConnected || c.node.value !== '' || c.node.disabled || c.node.readOnly
    || c.node.matches(':disabled') || c.node.getAttribute('aria-disabled') === 'true'
    || c.node.getAttribute('aria-readonly') === 'true' || !visible(c.node) || !visible(c.label)
    || c.node.closest('a,button,[contenteditable="true"]') || !c.node.id || c.label.control !== c.node
    || !c.label.textContent?.trim() || c.label.htmlFor !== c.node.id
    || [...document.querySelectorAll('[id]')].filter(element => element.id === c.node.id).length !== 1) return false;
  if (c.node instanceof HTMLInputElement && !['text', 'search', 'email', 'tel', 'url'].includes(c.node.type)) return false;
  return !protectedMeaning.test([c.label.textContent, c.node.name, c.node.id, c.node.getAttribute('aria-label'),
    c.node.getAttribute('title'), c.node.getAttribute('placeholder'), c.node.getAttribute('autocomplete')].join(' '));
}
function footprint(node: Node): string {
  if (!(node instanceof Element)) return JSON.stringify(node.nodeValue);
  const style = getComputedStyle(node), r = bounds(node);
  if (Object.values(r).some(value => !Number.isFinite(value))) throw new Error('invalid bounds');
  const attrs = [...node.attributes].map(a => [a.name, a.value]).sort(([a], [b]) => a!.localeCompare(b!));
  const styles = Array.from(style).map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]);
  const value = node instanceof HTMLInputElement ? [node.value, node.checked, node.disabled, node.readOnly, node.files?.length]
    : node instanceof HTMLTextAreaElement ? [node.value, node.disabled, node.readOnly]
    : node instanceof HTMLSelectElement ? [node.value, node.selectedIndex, [...node.options].map(o => o.selected), node.disabled] : [];
  return JSON.stringify({ attrs, styles, r, value });
}
function pageSnapshot(): NodeSnapshot[] {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ALL), result: NodeSnapshot[] = [];
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (result.length >= 1500) throw new Error('page too large');
    result.push({ node, parent: node.parentNode, children: [...node.childNodes], fingerprint: footprint(node) });
  }
  return result;
}
function union(a: CssRect, b: CssRect): CssRect {
  const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top);
  return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top };
}
/** Original local evidence for numerical planning only. No capture, mask coverage or image-send authority. */
export function createCropEvidenceSession(current: () => LocalCropContext | undefined,
  viewport: () => ViewportGeometry, clock: () => number = () => performance.now()): CropEvidenceSession {
  const issues = new WeakMap<CropEvidence, Issue>();
  let outstanding: Issue | undefined, closed = false;
  function clear(issue: Issue): void {
    issue.observer.disconnect(); issue.detach(); if (outstanding === issue) outstanding = undefined;
  }
  function unchanged(issue: Issue): boolean {
    const c = current(), time = clock();
    if (closed || issue.dirty || issue.observer.takeRecords().length || !admitted(c)
      || c.owner !== issue.context.owner || c.scan !== issue.context.scan || c.node !== issue.context.node
      || c.label !== issue.context.label || c.signal !== issue.context.signal || !Number.isFinite(time)
      || time < issue.time || time - issue.time > 1000 || document.URL !== issue.url
      || JSON.stringify(viewport()) !== JSON.stringify(issue.viewport)) return false;
    return issue.page.every(p => p.node.isConnected && p.node.parentNode === p.parent
      && p.children.length === p.node.childNodes.length && p.children.every((n, i) => p.node.childNodes[i] === n)
      && footprint(p.node) === p.fingerprint);
  }
  return {
    issue() {
      try {
        if (closed || outstanding) return undefined;
        const context = current(), v = { ...viewport() }, time = clock();
        if (!admitted(context) || !Number.isFinite(time)) return undefined;
        const field = bounds(context.node), label = bounds(context.label);
        const image = { width: Math.round(v.width * v.dpr), height: Math.round(v.height * v.dpr) };
        if ([field, label].some(target => planCropGeometry({ viewport: v, image, target, masks: [] }).state !== 'planned')) return undefined;
        const target = union(field, label);
        if (planCropGeometry({ viewport: v, image, target, masks: [] }).state !== 'planned') return undefined;
        const page = pageSnapshot();
        const proof = Object.freeze({ kind: 'crop-geometry-proof' as const });
        const observer = new MutationObserver(() => { issue.dirty = true; });
        const invalidate = () => { issue.dirty = true; };
        const issue: Issue = { context: { ...context }, viewport: v, target, page, url: document.URL, time, dirty: false,
          observer, detach: () => {
            document.removeEventListener('input', invalidate, true); document.removeEventListener('change', invalidate, true);
            context.signal.removeEventListener('abort', invalidate);
          } };
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        document.addEventListener('input', invalidate, true); document.addEventListener('change', invalidate, true);
        context.signal.addEventListener('abort', invalidate, { once: true });
        issues.set(proof, issue); outstanding = issue;
        return proof;
      } catch { return undefined; }
    },
    plan(proof, image) {
      const issue = issues.get(proof);
      if (!issue) return undefined;
      issues.delete(proof);
      try {
        if (!unchanged(issue)) return undefined;
        // Empty masks deliberately do NOT mean this crop is safe to transmit.
        return planCropGeometry({ viewport: issue.viewport, image, target: issue.target, masks: [] });
      } catch { return undefined; }
      finally { clear(issue); }
    },
    cancel() { closed = true; if (outstanding) clear(outstanding); },
  };
}
