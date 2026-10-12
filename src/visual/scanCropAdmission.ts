import type { AgentPageLease } from '../agent/pageLease';
import type { ScanState } from '../content/scanner';
import type { CropGeometryResult, ViewportGeometry } from './cropGeometry';
import { createCropEvidenceSession, type CropEvidence, type CropEvidenceSession } from './cropEvidence';
import { verifyScanObservation } from '../content/scanFreshness';
import { agentOptionFieldIds } from '../agent/optionFieldScope';
import { detectField } from '../matching/fieldMatcher';
import { captureControlLabels, sameControlLabels } from './controlLabels';
export interface ScanCropDependencies {
  lease: AgentPageLease; getScan(): ScanState | undefined; occupied(): boolean;
  viewport(): ViewportGeometry; clock?(): number;
}
/** Isolated scanner gate for numerical planning only, not screenshot or privacy authority. */
export class ScanCropAdmission {
  readonly #deps: ScanCropDependencies;
  readonly #proofs = new WeakMap<CropEvidence, { token: string; session: CropEvidenceSession }>();
  #ledger?: { token: string; owner: object; nodes: WeakSet<Element>; count: number; revoked: boolean };
  #active?: { token: string; session: CropEvidenceSession };
  constructor(dependencies: ScanCropDependencies) { this.#deps = dependencies; }
  #holds(token: string, scan?: ScanState): boolean {
    return this.#deps.lease.holdsPage() && this.#deps.lease.mayWrite(token) && !this.#deps.occupied()
      && (!scan || this.#deps.getScan() === scan);
  }
  #field(scan: ScanState, fieldId: string): { node: HTMLInputElement | HTMLTextAreaElement; label: HTMLLabelElement; labels: readonly HTMLLabelElement[] } | undefined {
    const field = scan.result.fields.find(f => f.id === fieldId), control = scan.controls.get(fieldId);
    if (scan.document !== document || !field || !control || control.adapter !== undefined
      || !(control.node instanceof HTMLInputElement || control.node instanceof HTMLTextAreaElement)
      || field.hasValue || field.blockedReason || field.disabled || field.readOnly
      || !agentOptionFieldIds(scan.result).has(fieldId) || detectField(field) || !verifyScanObservation(scan)) return undefined;
    const labels = captureControlLabels(control.node);
    return labels ? { node: control.node, label: labels[0]!, labels } : undefined;
  }
  issue(token: string, fieldId: string): CropEvidence | undefined {
    try {
      if (!this.#holds(token)) return undefined;
      if (this.#active?.token !== token) { this.#active?.session.cancel(); this.#active = undefined; }
      if (this.#active) return undefined;
      const scan = this.#deps.getScan(); if (!scan) return undefined;
      const field = this.#field(scan, fieldId); if (!field) return undefined;
      if (this.#ledger?.token !== token) this.#ledger = { token, owner: {}, nodes: new WeakSet(), count: 0, revoked: false };
      const ledger = this.#ledger;
      if (ledger.revoked || ledger.count >= 4 || ledger.nodes.has(field.node)) return undefined;
      const controller = new AbortController();
      const session = createCropEvidenceSession(() => {
        if (!this.#holds(token, scan) || this.#ledger !== ledger || ledger.revoked) return undefined;
        const current = this.#field(scan, fieldId);
        return current?.node === field.node && sameControlLabels(current.node, field.labels)
          ? { owner: ledger.owner, scan, ...field, scope: 'ordinary', unanswered: true, signal: controller.signal } : undefined;
      }, this.#deps.viewport, this.#deps.clock);
      const proof = session.issue();
      if (!proof) { session.cancel(); return undefined; }
      ledger.nodes.add(field.node); ledger.count++;
      this.#proofs.set(proof, { token, session }); this.#active = { token, session };
      return proof;
    } catch { return undefined; }
  }
  plan(proof: CropEvidence, image: { width: number; height: number }): CropGeometryResult | undefined {
    const owned = this.#proofs.get(proof); if (!owned) return undefined;
    this.#proofs.delete(proof);
    try {
      const result = owned.session.plan(proof, image);
      if (result?.state !== 'planned' && this.#ledger?.token === owned.token) this.#ledger.revoked = true;
      return result;
    } finally { owned.session.cancel(); if (this.#active?.session === owned.session) this.#active = undefined; }
  }
  stop(token: string): boolean {
    if (!this.#deps.lease.holdsPage() || !this.#deps.lease.mayWrite(token) || this.#ledger?.token !== token || this.#ledger.revoked) return false;
    this.#ledger.revoked = true; this.#active?.session.cancel(); this.#active = undefined; return true;
  }
}
