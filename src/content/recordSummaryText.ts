import { hiddenReason } from './domUtils';

const excluded = 'input, select, textarea, button, script, style, noscript, [contenteditable], [role="button"], [role="textbox"]';
/** Bounded visible text inside one summary card; outer application forms are not editors in this card. */
export function recordSummaryText(element: Element, card: Element): string {
  if (!card.isConnected || !card.contains(element) || hiddenReason(element) || element.matches(excluded)) return '';
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (ancestor.matches(excluded) || style?.textOverflow === 'ellipsis'
      || Number(style?.getPropertyValue('-webkit-line-clamp')) > 0
      || ancestor !== card && ancestor.matches('article, [role="listitem"], form, [role="dialog"]')) return '';
    if (ancestor === card) break;
  }
  let count = 0; let text = ''; let truncated = false;
  const walk = (node: Node): void => {
    if (count >= 1000 || text.length > 20_000) { truncated = true; return; }
    count++;
    if (node.nodeType === 3) { text += node.textContent ?? ''; return; }
    if (node.nodeType !== 1) return;
    const child = node as Element; const style = child.ownerDocument.defaultView?.getComputedStyle(child);
    if (child.matches(excluded) || hiddenReason(child) || style?.textOverflow === 'ellipsis'
      || Number(style?.getPropertyValue('-webkit-line-clamp')) > 0
      || child !== card && child.matches('article, [role="listitem"], form, [role="dialog"]')) return;
    for (const nested of child.childNodes) {
      walk(nested);
      if (truncated) break;
    }
    text += ' ';
  };
  walk(element);
  return truncated || text.length > 20_000 ? '' : text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
