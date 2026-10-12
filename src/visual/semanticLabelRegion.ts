import type { CssRect } from './cropGeometry';

export type SemanticLabelResult = { readonly state: 'eligible'; readonly region: CssRect }
  | { readonly state: 'rejected'; readonly reason: 'unproved-label-region' };

const rejected: SemanticLabelResult = Object.freeze({ state: 'rejected', reason: 'unproved-label-region' });
const boundedStyles: Readonly<Record<string, readonly string[]>> = {
  'background-image': ['none'], transform: ['none'], filter: ['none'], 'backdrop-filter': ['none'],
  '-webkit-backdrop-filter': ['none'], 'mix-blend-mode': ['normal'], 'mask-image': ['none'],
  '-webkit-mask-image': ['none'], 'mask-border-source': ['none'], 'clip-path': ['none'],
  'box-shadow': ['none'], 'text-shadow': ['none'], perspective: ['none'], translate: ['none'],
  rotate: ['none'], scale: ['none'], 'animation-name': ['none'], 'transition-property': ['none', 'all'],
  'content-visibility': ['visible'], '-webkit-box-reflect': ['none'], zoom: ['1', 'normal'],
  'border-image-source': ['none'], 'list-style-image': ['none'],
};
function normalize(text: string): string { return text.normalize('NFKC').replace(/\s/gu, '').toLocaleLowerCase('en-US'); }
function opaque(color: string): boolean {
  return /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/u.test(color)
    || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*1(?:\.0*)?\s*\)$/u.test(color);
}
function ordinaryPaint(element: Element): boolean {
  const css = getComputedStyle(element), value = (name: string) => css.getPropertyValue(name).trim();
  if (Object.entries(boundedStyles).some(([name, allowed]) => value(name) !== '' && !allowed.includes(value(name)))) return false;
  if (!['', '0s'].includes(value('transition-duration')) || !['', '1'].includes(value('opacity'))) return false;
  for (const pseudo of ['::before', '::after', '::first-letter', '::first-line', '::marker']) {
    const style = getComputedStyle(element, pseudo);
    if (!['', 'none', 'normal'].includes(style.getPropertyValue('content').trim())) return false;
    // Text pseudo-elements can change paint without generated content.
    if (pseudo === '::first-letter' || pseudo === '::first-line') {
      for (const name of ['background-image', 'text-shadow', 'transform', 'filter']) {
        const item = style.getPropertyValue(name).trim(); if (item && item !== 'none') return false;
      }
    }
  }
  return true;
}
function visible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const css = getComputedStyle(current);
    if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true'
      || css.getPropertyValue('display') === 'none' || css.getPropertyValue('visibility') !== 'visible') return false;
  }
  return true;
}
function intersects(a: CssRect, b: CssRect): boolean {
  return a.width > 0 && a.height > 0 && a.left < b.left + b.width + 1 && a.left + a.width > b.left - 1
    && a.top < b.top + b.height + 1 && a.top + a.height > b.top - 1;
}
function validBounds(rect: CssRect): boolean {
  return Object.values(rect).every(n => Number.isFinite(n) && Math.abs(n) <= 10_000_000) && rect.width >= 0 && rect.height >= 0;
}

const svgPaintTags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc', 'clipPath', 'mask']);
/** No outward clip expansion; the zero origin may be any edge inside the border box. */
function zeroClipMargin(css: CSSStyleDeclaration): boolean {
  return /^(?:|0px|(?:content|padding|border)-box(?:\s+0px)?)$/u.test(css.getPropertyValue('overflow-clip-margin').trim());
}
/** Only ordinary images and self-contained vector shapes can use this exception.
 * Their own clipping viewport, or a disjoint paint-containing ancestor, bounds
 * the paint. Foreign HTML, references, other media and shadow trees stay rejected.
 */
function clippedDecoration(element: Element, region: CssRect, label: HTMLLabelElement): boolean {
  if (element.localName === 'img') {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
  } else if (element.localName === 'svg') {
    const descendants = [element, ...element.querySelectorAll('*')];
    if (descendants.length > 100 || descendants.some(node => node.namespaceURI !== 'http://www.w3.org/2000/svg'
      || !svgPaintTags.has(node.localName) || [...node.attributes].some(attribute => /(?:^|:)href$/iu.test(attribute.name)
        || /url\s*\(/iu.test(attribute.value))
      || ['fill', 'stroke', 'marker-start', 'marker-mid', 'marker-end'].some(property => /url\s*\(/iu.test(getComputedStyle(node).getPropertyValue(property))))) return false;
  } else return false;
  const css = getComputedStyle(element), bounds = element.getBoundingClientRect();
  const own = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  // SVG2 §3.11: a hidden viewport clips; CSS Overflow 3 also defines clip edges.
  // Check computed overflow even for img: do not assume all replaced content clips
  // when an author explicitly requests visible overflow or expands its clip margin.
  // https://www.w3.org/TR/SVG2/render.html#OverflowProperty
  // https://www.w3.org/TR/css-overflow-3/#overflow-properties
  if (validBounds(own) && own.width > 0 && own.height > 0 && !intersects(own, region)
    && !element.contains(label) && ordinaryPaint(element)
    && ['hidden', 'clip'].includes(css.overflowX) && ['hidden', 'clip'].includes(css.overflowY)
    && zeroClipMargin(css) && ['none', ''].includes(css.outlineStyle)
    && (element instanceof SVGSVGElement || (element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0))) return true;
  for (let ancestor = element.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
    const css = getComputedStyle(ancestor);
    const contain = css.getPropertyValue('contain').trim().split(/\s+/u);
    if (!contain.some(value => ['paint', 'strict', 'content'].includes(value))) continue;
    // CSS Containment 1 §3.3 excludes non-atomic inline/internal boxes.
    // Level 2 also lets overflow-clip-margin expand paint beyond the box.
    // https://www.w3.org/TR/css-contain-1/#paint-containment
    if (!['block', 'inline-block', 'flow-root', 'flex', 'inline-flex', 'grid', 'inline-grid'].includes(css.display)
      || !['', '0px'].includes(css.getPropertyValue('overflow-clip-margin').trim())) continue;
    const bounds = ancestor.getBoundingClientRect();
    const clip = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    if (validBounds(clip) && clip.width > 0 && clip.height > 0 && ordinaryPaint(ancestor)
      && !ancestor.contains(label) && !intersects(clip, region)) return true;
  }
  return false;
}

/** Local DOM eligibility only: short, clipped, opaque label pixels, never control pixels.
 * privateFacts comes from the local profile; absence of a match does not prove all text public.
 * This numerical result is not a private capture proof or image-send authority.
 */
function inspectLabelRegion(
  node: HTMLInputElement | HTMLTextAreaElement, label: HTMLLabelElement, privateFacts: readonly string[], requireFacts: boolean,
): SemanticLabelResult {
  try {
    if (document.defaultView?.top !== document.defaultView || !/^https?:/u.test(document.URL)
      || !(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) || !(label instanceof HTMLLabelElement)
      || node.ownerDocument !== document || label.ownerDocument !== document || !node.isConnected || !label.isConnected
      || node.getRootNode() !== document || label.getRootNode() !== document || !node.id || label.htmlFor !== node.id
      || label.control !== node || node.labels?.length !== 1 || node.labels[0] !== label
      || [...document.querySelectorAll('[id]')].filter(e => e.id === node.id).length !== 1
      || node.value !== '' || node.disabled || node.readOnly || node.matches(':disabled') || !visible(node) || !visible(label)
      || node.placeholder !== '' || label.childElementCount !== 0 || label.closest('a,button,[contenteditable]')
      || !Array.isArray(privateFacts) || (requireFacts && privateFacts.length === 0) || privateFacts.length > 256
      || privateFacts.some(fact => typeof fact !== 'string' || fact.trim().length < 2 || fact.length > 500)) return rejected;
    if (node instanceof HTMLInputElement && !['text', 'search', 'email', 'tel', 'url'].includes(node.type)) return rejected;
    const text = label.textContent?.trim() ?? '', normalized = normalize(text);
    if (text.length < 2 || text.length > 32 || !/^[\p{L}\p{M}\s·（）()、，：:?？*]+$/u.test(text)
      || privateFacts.some(fact => normalized.includes(normalize(fact)))) return rejected;
    const css = getComputedStyle(label);
    if (!opaque(css.getPropertyValue('background-color')) || !opaque(css.getPropertyValue('color'))
      || !['hidden', 'clip'].includes(css.getPropertyValue('overflow-x')) || !['hidden', 'clip'].includes(css.getPropertyValue('overflow-y'))
      || !['', 'border-box'].includes(css.getPropertyValue('background-clip')) || css.getPropertyValue('display') === 'contents') return rejected;
    const bounds = label.getBoundingClientRect(), region = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    if (!validBounds(region) || region.width < 8 || region.width > 512 || region.height < 8 || region.height > 96) return rejected;
    const all = [...document.querySelectorAll('*')]; if (all.length > 1500) return rejected;
    // Top-layer paint can escape ancestor containment. This conservative test
    // also rejects visible nonmodal dialogs instead of making a modal inference.
    if (document.fullscreenElement || [...document.querySelectorAll('dialog[open], [popover]')].some(visible)) return rejected;
    for (const element of all) {
      if (!visible(element)) continue;
      if (element.shadowRoot || element.localName.includes('-')) return rejected;
      if (element.matches('svg,canvas,video,img,iframe,object,embed') && !clippedDecoration(element, region, label)) return rejected;
      // Overflowing generated paint or shadows cannot be bounded by element rectangles.
      if (!ordinaryPaint(element)) return rejected;
      const r = element.getBoundingClientRect(); if (!validBounds({ left: r.left, top: r.top, width: r.width, height: r.height })) return rejected;
      if (element !== label && !element.contains(label) && intersects(r, region)) return rejected;
    }
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      if (current.parentElement === label || !current.textContent?.trim() || !current.parentElement || !visible(current.parentElement)
        || current.parentElement.closest('script,style,template')) continue;
      const range = document.createRange(); range.selectNodeContents(current);
      for (const r of range.getClientRects()) {
        if (!validBounds({ left: r.left, top: r.top, width: r.width, height: r.height }) || intersects(r, region)) return rejected;
      }
      range.detach();
    }
    return Object.freeze({ state: 'eligible', region: Object.freeze(region) });
  } catch { return rejected; }
}

/** Pixel layout only, not privacy authority. Must be paired with a current trusted label receipt. */
export function inspectSemanticLabelPaint(node: HTMLInputElement | HTMLTextAreaElement,label: HTMLLabelElement): SemanticLabelResult {
 return inspectLabelRegion(node,label,[],false);
}
/** Legacy local private-fact path retains its nonempty-fact requirement. */
export function inspectSemanticLabelRegion(node: HTMLInputElement | HTMLTextAreaElement,label: HTMLLabelElement,privateFacts:readonly string[]): SemanticLabelResult {
 return inspectLabelRegion(node,label,privateFacts,true);
}
