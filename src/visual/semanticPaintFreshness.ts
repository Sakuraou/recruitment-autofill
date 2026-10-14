import { captureControlLabels, sameControlLabels } from './controlLabels';

/** A local read-only predicate, not a capture proof or permission to write. */
export interface SemanticPaintFreshness { isCurrent(): boolean }
const originalNodes = new WeakMap<SemanticPaintFreshness, HTMLInputElement | HTMLTextAreaElement>();
/** Private local identity only; structural copies and wire objects do not match. */
export function semanticPaintFreshnessMatches(guard: SemanticPaintFreshness, node: HTMLInputElement | HTMLTextAreaElement): boolean {
  return originalNodes.get(guard) === node;
}
const pseudoProperties = ['content','display','visibility','opacity','font-family','font-size','font-weight','font-style',
  'line-height','letter-spacing','word-spacing','text-indent','text-transform','text-shadow','color','background-color',
  'background-image','transform','filter','position','left','top','width','height'];
type SheetState = { roots: CSSStyleSheet[]; sheets: CSSStyleSheet[]; signature: string };

/** Stylesheet mutations do not necessarily produce a DOM mutation. Read only:
 * do not patch the page's CSS APIs, load stylesheets or send their contents.
 */
function sheetState(doc: Document): SheetState {
  const sheets: CSSStyleSheet[] = [], records: unknown[] = [];
  let characters = 0, ruleCount = 0;
  const visit = (sheet: CSSStyleSheet) => {
    if (sheets.includes(sheet)) return;
    if (sheets.length >= 64) throw Error('paint scope too large');
    sheets.push(sheet);
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; }
    catch (error) {
      // Cross-origin CSS remains opaque; computed styles of original targets
      // are still compared. Do not fetch or claim to inspect inaccessible CSS.
      if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error;
      records.push([sheet.disabled,sheet.media.mediaText,'opaque']); return;
    }
    const text: string[] = [];
    for (const rule of rules) {
      const value = rule.cssText;
      if (++ruleCount > 4096 || (characters += value.length) > 512_000) throw Error('paint scope too large');
      text.push(value);
      if (rule instanceof CSSImportRule && rule.styleSheet) visit(rule.styleSheet);
    }
    records.push([sheet.disabled,sheet.media.mediaText,text]);
  };
  const roots=[...doc.styleSheets,...doc.adoptedStyleSheets];
  if (roots.length > 64) throw Error('paint scope too large');
  for (const sheet of roots) visit(sheet);
  return { roots, sheets, signature: JSON.stringify(records) };
}
function viewportSignature(doc: Document): string {
  const view = doc.defaultView;
  if (!view) throw Error('page unavailable');
  return JSON.stringify([doc.URL,view.innerWidth,view.innerHeight,view.devicePixelRatio,view.scrollX,view.scrollY,
    view.visualViewport?.scale ?? 1,view.visualViewport?.offsetLeft ?? 0,view.visualViewport?.offsetTop ?? 0]);
}
function elementSignature(node: Element): string {
  const view = node.ownerDocument.defaultView;
  if (!view) throw Error('page unavailable');
  const css = view.getComputedStyle(node), bounds = node.getBoundingClientRect();
  const rect = [bounds.left,bounds.top,bounds.width,bounds.height];
  if (rect.some(value => !Number.isFinite(value))) throw Error('invalid paint bounds');
  return JSON.stringify([rect,[...css].map(name=>[name,css.getPropertyValue(name)]),
    ['::before','::after','::first-letter','::first-line','::marker'].map(pseudo=>{
      const style = view.getComputedStyle(node,pseudo); return pseudoProperties.map(name=>style.getPropertyValue(name));
    })]);
}
function textGeometry(labels: readonly HTMLLabelElement[]): string {
  const records: number[][] = []; let count = 0;
  for (const label of labels) {
    const walker = label.ownerDocument.createTreeWalker(label,NodeFilter.SHOW_TEXT);
    for (let node=walker.nextNode();node;node=walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range=label.ownerDocument.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const values=[rect.left,rect.top,rect.width,rect.height];
        if (++count > 128 || values.some(value=>!Number.isFinite(value))) throw Error('invalid text bounds');
        records.push(values);
      }
      range.detach();
    }
  }
  return JSON.stringify(records);
}

/** Bind original label/control/ancestor paint while capture and inference wait.
 * Cross-origin CSS is compared through target computed styles, not downloaded.
 * No profile, CSS, pixel or DOM values leave this closure.
 */
export function createSemanticPaintFreshness(node: HTMLInputElement | HTMLTextAreaElement): SemanticPaintFreshness | undefined {
  try {
    const doc=node.ownerDocument,labels=captureControlLabels(node); if (!labels || doc!==document) return undefined;
    const elements = new Set<Element>([node]);
    for (const label of labels) {
      elements.add(label); for (const child of label.querySelectorAll('*')) elements.add(child);
      for (let ancestor=label.parentElement;ancestor;ancestor=ancestor.parentElement) elements.add(ancestor);
    }
    if (elements.size > 128) return undefined;
    const targets=[...elements].map(element=>({element,parent:element.parentNode,signature:elementSignature(element)}));
    if (targets.reduce((size,target)=>size+target.signature.length,0)>512_000) return undefined;
    const sheets=sheetState(doc),viewport=viewportSignature(doc),text=textGeometry(labels);
    let ended = false;
    const guard=Object.freeze({isCurrent(): boolean {
      if (ended) return false;
      try {
        const next=sheetState(doc);
        const current=node.isConnected && node.ownerDocument===doc && sameControlLabels(node,labels)
          && viewportSignature(doc)===viewport && textGeometry(labels)===text
          && next.signature===sheets.signature && next.sheets.length===sheets.sheets.length
          && next.roots.length===sheets.roots.length && next.roots.every((sheet,index)=>sheet===sheets.roots[index])
          && next.sheets.every((sheet,index)=>sheet===sheets.sheets[index])
          && targets.every(target=>target.element.isConnected && target.element.parentNode===target.parent
            && elementSignature(target.element)===target.signature);
        if (!current) ended=true;
        return current;
      } catch { ended=true; return false; }
    }});
    originalNodes.set(guard,node); return guard;
  } catch { return undefined; }
}
