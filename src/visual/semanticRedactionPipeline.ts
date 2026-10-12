import { redactLocalPixels, type PixelRedactionResult } from './localPixelRedaction';
import type { SemanticCropAdmission, SemanticCropPlan } from './semanticCropAdmission';

export interface RedactionImage { readonly width: number; readonly height: number; readonly rgba: Uint8ClampedArray }

/**
 * Binds the local pixel transform to a consumed semantic crop plan. It has no
 * network or model authority: callers receive only fresh RGBA bytes.
 */
export class SemanticRedactionPipeline {
  readonly #admission: SemanticCropAdmission;
  constructor(admission: SemanticCropAdmission) { this.#admission = admission; }
  redact(plan: SemanticCropPlan, image: RedactionImage): PixelRedactionResult {
    try {
      const owned = this.#admission.consumePlan(plan, image);
      if (!owned) return Object.freeze({ state: 'rejected', reason: 'unproved-redaction' });
      return redactLocalPixels({ image, crop: owned.geometry.crop, keep: owned.keeps ?? [owned.keep], masks: owned.geometry.masks });
    } catch { return Object.freeze({ state: 'rejected', reason: 'unproved-redaction' }); }
  }
}
