import type { AgentPageLease } from '../agent/pageLease';
import type { ScanState } from '../content/scanner';
import type { CropGeometryResult, CssRect, ViewportGeometry } from './cropGeometry';
import { inspectSemanticLabelPaint, inspectSemanticLabelRegion } from './semanticLabelRegion';
import { ScanCropAdmission } from './scanCropAdmission';
import type { CropEvidence } from './cropEvidence';
import { verifyScanObservation } from '../content/scanFreshness';
import { agentOptionFieldIds } from '../agent/optionFieldScope';
import { detectField } from '../matching/fieldMatcher';

export interface SemanticCropDependencies {
  lease: AgentPageLease; getScan(): ScanState | undefined; occupied(): boolean;
  viewport(): ViewportGeometry; privateFacts(): readonly string[]; labelPermission?(token:string,fieldId:string,label:string):boolean; clock?(): number;
}
export interface SemanticCropProof { readonly kind: 'semantic-label-proof' }
export type SemanticCropPlan = { readonly state: 'planned'; readonly geometry: CropGeometryResult & { readonly state: 'planned' }; readonly label: CssRect; readonly keep: CssRect }
  | { readonly state: 'rejected' };

/** Binds the conservative label pixel range to the existing private scanner/owner gate. */
export class SemanticCropAdmission {
  readonly #deps: SemanticCropDependencies; readonly #base: ScanCropAdmission;
  readonly #proofs = new WeakMap<SemanticCropProof, { base: CropEvidence; token: string; scan: ScanState; node: HTMLInputElement | HTMLTextAreaElement; label: HTMLLabelElement; fieldId:string }>();
  readonly #plans = new WeakMap<object, { token: string; scan: ScanState; node: HTMLInputElement | HTMLTextAreaElement; label: HTMLLabelElement; fieldId:string; width: number; height: number; viewport: string; facts: string; time: number }>();
  constructor(dependencies: SemanticCropDependencies) { this.#deps = dependencies; this.#base = new ScanCropAdmission(dependencies); }
  #field(scan: ScanState, fieldId: string): { node: HTMLInputElement | HTMLTextAreaElement; label: HTMLLabelElement } | undefined {
    const field = scan.result.fields.find(f => f.id === fieldId), control = scan.controls.get(fieldId);
    if (scan.document !== document || !field || !control || control.adapter !== undefined
      || !(control.node instanceof HTMLInputElement || control.node instanceof HTMLTextAreaElement)
      || field.hasValue || field.blockedReason || field.disabled || field.readOnly
      || !agentOptionFieldIds(scan.result).has(fieldId) || detectField(field) || !verifyScanObservation(scan)) return undefined;
    const labels = control.node.labels;
    return labels?.length === 1 && labels[0] instanceof HTMLLabelElement ? { node: control.node, label: labels[0] } : undefined;
  }
  #eligible(token:string,fieldId:string,node:HTMLInputElement|HTMLTextAreaElement,label:HTMLLabelElement):boolean {
    return this.#deps.labelPermission
      ? this.#deps.labelPermission(token,fieldId,label.textContent?.trim()??'') && inspectSemanticLabelPaint(node,label).state==='eligible'
      : inspectSemanticLabelRegion(node,label,this.#deps.privateFacts()).state==='eligible';
  }
  issue(token: string, fieldId: string): SemanticCropProof | undefined {
    try {
      if (!this.#deps.lease.holdsPage() || !this.#deps.lease.mayWrite(token) || this.#deps.occupied()) return undefined;
      const scan = this.#deps.getScan(), field = scan && this.#field(scan, fieldId); if (!scan || !field) return undefined;
      if (!this.#eligible(token,fieldId,field.node,field.label)) return undefined;
      const base = this.#base.issue(token, fieldId); if (!base) return undefined;
      const proof = Object.freeze({ kind: 'semantic-label-proof' as const });
      this.#proofs.set(proof, { base, token, scan, fieldId, ...field }); return proof;
    } catch { return undefined; }
  }
  plan(proof: SemanticCropProof, image: { width: number; height: number }): SemanticCropPlan {
    const owned = this.#proofs.get(proof); if (!owned) return { state: 'rejected' };
    this.#proofs.delete(proof);
    try {
      if (this.#deps.getScan() !== owned.scan || !this.#deps.lease.mayWrite(owned.token)
        || !this.#eligible(owned.token,owned.fieldId,owned.node,owned.label)) {
        this.#base.stop(owned.token); return { state: 'rejected' };
      }
      const geometry = this.#base.plan(owned.base, image);
      if (!geometry || geometry.state !== 'planned') return { state: 'rejected' };
      const bounds = owned.label.getBoundingClientRect(), label = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
      const viewport = this.#deps.viewport(), sx = image.width / viewport.width, sy = image.height / viewport.height;
      const crop = geometry.crop;
      // Keep only interior pixels: rounding outward could retain neighboring paint.
      const left = Math.max(0, Math.ceil(label.left * sx) + 1 - crop.left), top = Math.max(0, Math.ceil(label.top * sy) + 1 - crop.top);
      const right = Math.min(crop.width, Math.floor((label.left + label.width) * sx) - 1 - crop.left), bottom = Math.min(crop.height, Math.floor((label.top + label.height) * sy) - 1 - crop.top);
      if (right <= left || bottom <= top) { this.#base.stop(owned.token); return { state: 'rejected' }; }
      const keep = { left, top, width: right - left, height: bottom - top };
      const plan = Object.freeze({ state: 'planned' as const, geometry, label: Object.freeze(label), keep: Object.freeze(keep) });
      this.#plans.set(plan, { ...owned, width: image.width, height: image.height, viewport: JSON.stringify(viewport), facts: JSON.stringify(this.#deps.privateFacts()), time: (this.#deps.clock ?? (() => performance.now()))() }); return plan;
    } catch { this.#base.stop(owned.token); return { state: 'rejected' }; }
  }
  /** Only this admission instance can consume its plan; clones and replay fail. */
  consumePlan(plan: SemanticCropPlan, image: { width: number; height: number }): Extract<SemanticCropPlan, { state: 'planned' }> | undefined {
    const owned = this.#plans.get(plan); if (!owned || plan.state !== 'planned') return undefined;
    this.#plans.delete(plan);
    try {
      const now = (this.#deps.clock ?? (() => performance.now()))();
      if (!Number.isFinite(now) || now < owned.time || now - owned.time > 1000 || this.#deps.occupied()
        || !this.#deps.lease.holdsPage() || !this.#deps.lease.mayWrite(owned.token) || this.#deps.getScan() !== owned.scan
        || !verifyScanObservation(owned.scan) || JSON.stringify(this.#deps.viewport()) !== owned.viewport
        || JSON.stringify(this.#deps.privateFacts()) !== owned.facts || image.width !== owned.width || image.height !== owned.height
        || !this.#eligible(owned.token,owned.fieldId,owned.node,owned.label)) return undefined;
      const bounds = owned.label.getBoundingClientRect();
      if (bounds.left !== plan.label.left || bounds.top !== plan.label.top || bounds.width !== plan.label.width || bounds.height !== plan.label.height) return undefined;
      return plan;
    } catch { return undefined; }
  }
  stop(token: string): boolean { return this.#base.stop(token); }
}
