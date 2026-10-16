import type { ScanState } from './scanner';
import { captureControlLabels, sameControlLabels } from '../visual/controlLabels';
import { semanticPaintFreshnessMatches, type SemanticPaintFreshness } from '../visual/semanticPaintFreshness';
import { inspectSemanticLabelPaint } from '../visual/semanticLabelRegion';
type Entry = { fieldId: string; node: HTMLInputElement | HTMLTextAreaElement; labels: readonly HTMLLabelElement[]; guard: SemanticPaintFreshness; stale: boolean };

/** Restrict a previously produced visual candidate until its original write.
 * Entries come from the local visual coordinator, never a wire message. This
 * registry supplies no values, paths, capture permission or action authority.
 */
export class VisualCandidatePaint {
  readonly #scans = new WeakMap<ScanState, Map<string, Entry>>();
  /** Presence stays true even after staleness; location cannot renew old candidates. */
  hasCandidates(scan: ScanState): boolean { return (this.#scans.get(scan)?.size ?? 0) > 0; }
  remember(scan: ScanState, fieldId: string, guard: SemanticPaintFreshness): boolean {
    try {
      const node=scan.controls.get(fieldId)?.node;
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
        || !semanticPaintFreshnessMatches(guard,node) || !guard.isCurrent()) return false;
      const labels=captureControlLabels(node); if (!labels) return false;
      const entries=this.#scans.get(scan) ?? new Map<string,Entry>();
      if (entries.has(fieldId)) return this.isCurrent(scan,fieldId);
      if (entries.size>=32 || !labels.every(label=>inspectSemanticLabelPaint(node,label).state==='eligible')) return false;
      entries.set(fieldId,{fieldId,node,labels,guard,stale:false}); this.#scans.set(scan,entries); return true;
    } catch { return false; }
  }
  isCurrent(scan: ScanState, fieldId?: string): boolean {
    const entries=this.#scans.get(scan); if (!entries) return true;
    const selected=fieldId===undefined ? [...entries.values()] : [entries.get(fieldId)].filter((entry): entry is Entry=>!!entry);
    return selected.every(entry=>{
      if (entry.stale) return false;
      try {
        const current=scan.document===entry.node.ownerDocument && scan.controls.get(entry.fieldId)?.node===entry.node
          && entry.guard.isCurrent() && sameControlLabels(entry.node,entry.labels)
          && entry.labels.every(label=>inspectSemanticLabelPaint(entry.node,label).state==='eligible');
        if (!current) entry.stale=true;
        return current;
      } catch { entry.stale=true; return false; }
    });
  }
}
