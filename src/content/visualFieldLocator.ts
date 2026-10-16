import type { AgentPageLease } from '../agent/pageLease';
import { agentOptionFieldIds } from '../agent/optionFieldScope';
import { detectField } from '../matching/fieldMatcher';
import { captureControlLabels, sameControlLabels } from '../visual/controlLabels';
import { planCropGeometry, type CssRect } from '../visual/cropGeometry';
import { inspectSemanticLabelPaint } from '../visual/semanticLabelRegion';
import { scanDocument, type ScanState } from './scanner';
import { verifyScanObservation } from './scanFreshness';

export interface VisualFieldLocatorDependencies {
  lease: AgentPageLease;
  getScan(): ScanState | undefined;
  occupied(): boolean;
  /** Must consult the local candidate registry, never a model/message flag. */
  hasVisualCandidates(scan: ScanState): boolean;
}
export type VisualFieldLocation =
  | { state: 'located'; scan: ScanState; fieldId: string; moved: boolean }
  | { state: 'manual'; reason: 'busy' | 'stale' | 'scope' | 'layout' | 'existing-candidates' | 'budget' | 'cancelled' };
const manual = (reason: Extract<VisualFieldLocation, { state: 'manual' }>['reason']): VisualFieldLocation => ({ state: 'manual', reason });
const textTypes = new Set(['text', 'search', 'email', 'tel', 'url']);
function bounds(nodes: readonly Element[]): CssRect {
  const rectangles = nodes.map(node => node.getBoundingClientRect());
  const left = Math.min(...rectangles.map(rect => rect.left)), top = Math.min(...rectangles.map(rect => rect.top));
  return { left, top, width: Math.max(...rectangles.map(rect => rect.right)) - left, height: Math.max(...rectangles.map(rect => rect.bottom)) - top };
}
function nestedScroller(nodes: readonly Element[], doc: Document): boolean {
  for (const node of nodes) {
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor === doc.scrollingElement || ancestor === doc.documentElement || ancestor === doc.body) continue;
      const css = getComputedStyle(ancestor);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowX) && ancestor.scrollWidth > ancestor.clientWidth
        || ['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowY) && ancestor.scrollHeight > ancestor.clientHeight) return true;
    }
  }
  return false;
}

/** Local controller used before the Agent's separately consented visual fallback.
 * One native window scroll before any visual candidates, then a fresh scan.
 * It cannot issue capture proofs, send images, select values or write fields.
 * The caller must install the returned scan and rebuild all candidates before
 * any later capture; old scan references must never be carried across a move.
 */
export class VisualFieldLocator {
  readonly #deps: VisualFieldLocatorDependencies;
  #used = false;
  constructor(dependencies: VisualFieldLocatorDependencies) { this.#deps = dependencies; }

  async locate(scanId: string, fieldId: string, signal: AbortSignal): Promise<VisualFieldLocation> {
    if (signal.aborted) return manual('cancelled');
    if (this.#used) return manual('budget');
    if (this.#deps.lease.holdsPage() || this.#deps.occupied()) return manual('busy');
    let token: string | undefined;
    try {
      const scan = this.#deps.getScan();
      if (!scan || scan.result.scanId !== scanId || scan.document !== document || document.defaultView?.top !== document.defaultView
        || !verifyScanObservation(scan)) return manual('stale');
      if (this.#deps.hasVisualCandidates(scan)) return manual('existing-candidates');
      const field = scan.result.fields.find(value => value.id === fieldId), control = scan.controls.get(fieldId);
      if (!field || !control || control.adapter !== undefined || field.hasValue || field.disabled || field.readOnly || field.blockedReason
        || !agentOptionFieldIds(scan.result).has(fieldId) || detectField(field)) return manual('scope');
      const node = control.node;
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
        || node instanceof HTMLInputElement && !textTypes.has(node.type) || node.value !== '' || node.disabled || node.readOnly) return manual('scope');
      const labels = captureControlLabels(node);
      if (!labels || !labels.every(label => inspectSemanticLabelPaint(node, label).state === 'eligible')) return manual('layout');
      const doc = scan.document, view = doc.defaultView!, root = doc.scrollingElement;
      if (!root || nestedScroller([node, ...labels], doc) || getComputedStyle(doc.documentElement).writingMode !== 'horizontal-tb'
        || getComputedStyle(doc.documentElement).direction !== 'ltr') return manual('layout');
      const originalUrl = doc.URL;
      const viewport = () => ({ width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio, scrollX: view.scrollX,
        scrollY: view.scrollY, visualScale: view.visualViewport?.scale ?? 1, offsetLeft: view.visualViewport?.offsetLeft ?? 0, offsetTop: view.visualViewport?.offsetTop ?? 0 });
      const geometry = () => {
        const current = viewport();
        return planCropGeometry({ viewport: current, image: { width: Math.round(current.width * current.dpr), height: Math.round(current.height * current.dpr) }, target: bounds([node, ...labels]), masks: [] });
      };
      const before = geometry();
      if (before.state === 'rejected' && before.reason !== 'target-not-visible') return manual('layout');
      token = this.#deps.lease.begin();
      if (before.state === 'planned') return { state: 'located', scan, fieldId, moved: false };
      const rectangle = bounds([node, ...labels]), original = viewport(), inset = 16;
      if (rectangle.width > original.width - 2 * inset || rectangle.height > original.height - 2 * inset) return manual('layout');
      const left = Math.max(0, Math.min(root.scrollWidth - root.clientWidth, original.scrollX + rectangle.left - (original.width - rectangle.width) / 2));
      const top = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, original.scrollY + rectangle.top - (original.height - rectangle.height) / 2));
      const projectedLeft = original.scrollX + rectangle.left - left, projectedTop = original.scrollY + rectangle.top - top;
      if (![left, top, projectedLeft, projectedTop].every(Number.isFinite) || projectedLeft < 0 || projectedTop < 0
        || projectedLeft + rectangle.width > original.width || projectedTop + rectangle.height > original.height) return manual('layout');

      let changed = false;
      const interrupt = () => { changed = true; };
      const observer = new MutationObserver(interrupt);
      observer.observe(doc.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
      const events = ['input', 'change', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
      for (const event of events) doc.addEventListener(event, interrupt, true);
      signal.addEventListener('abort', interrupt, { once: true });
      const detach = this.#deps.lease.onEnd(interrupt);
      const current = () => !changed && !signal.aborted && !observer.takeRecords().length && this.#deps.getScan() === scan
        && doc.URL === originalUrl && this.#deps.lease.mayWrite(token) && !this.#deps.occupied() && !this.#deps.hasVisualCandidates(scan)
        && scan.controls.get(fieldId)?.node === node && node.isConnected && node.value === '' && !node.disabled && !node.readOnly
        && sameControlLabels(node, labels);
      try {
        if (!current()) return manual('stale');
        this.#used = true;
        view.scrollTo({ left, top, behavior: 'instant' });
        let settled = 0;
        for (let attempt = 0; attempt < 25; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 20));
          if (!current()) return manual(signal.aborted ? 'cancelled' : 'stale');
          if (Math.abs(view.scrollX - left) <= 1 && Math.abs(view.scrollY - top) <= 1) settled++; else settled = 0;
          if (settled >= 4) break;
        }
        if (settled < 4 || geometry().state !== 'planned') return manual('layout');
        const graph = scan.result.semanticGraph;
        if (!graph) return manual('stale');
        // The ordinary verifier must still reject the original viewport after
        // a move. Compare a private projection of exactly this native scroll;
        // preserve every node, fingerprint, field and graph relation. Do not
        // mutate the original scan or weaken normal scan verification.
        const dx = view.scrollX - original.scrollX, dy = view.scrollY - original.scrollY;
        const translated = { ...scan, result: { ...scan.result, semanticGraph: { ...graph, nodes: graph.nodes.map(item =>
          item.bounds?.coordinateSpace === 'viewport' ? { ...item, bounds: { ...item.bounds, x: item.bounds.x - dx, y: item.bounds.y - dy } } : item) } } };
        if (!current() || !verifyScanObservation(translated) || !labels.every(label => inspectSemanticLabelPaint(node, label).state === 'eligible')) return manual('stale');
        const fresh = scanDocument(doc), next = [...fresh.controls].find(([, value]) => value.node === node);
        if (!current() || !next || fresh.result.scanId === scanId) return manual('stale');
        return { state: 'located', scan: fresh, fieldId: next[0], moved: true };
      } finally {
        observer.disconnect(); detach(); signal.removeEventListener('abort', interrupt);
        for (const event of events) doc.removeEventListener(event, interrupt, true);
      }
    } catch { return manual(signal.aborted ? 'cancelled' : 'stale'); }
    finally { if (token) this.#deps.lease.end(token); }
  }
}
