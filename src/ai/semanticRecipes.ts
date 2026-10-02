import type { UserProfile } from '../profile/schema';
import type { ScanResult } from '../shared/types';
import { EXTENSION_VERSION } from '../shared/version';
import { semanticSessionObservations, verifiedSemanticRecipes, type BindingValidation, type SemanticBindingSession } from './semanticBinding';
import type { SemanticBindingPath, SemanticProposal } from './semanticProtocol';

interface Recipe { path: SemanticBindingPath; evidence: 'label' | 'context' | 'options'; createdAt: number }
export const SEMANTIC_RECIPE_TTL_MS = 600_000;
export interface SemanticRecipes {
  propose(session: SemanticBindingSession, scan: ScanResult, profile: UserProfile, signal?: AbortSignal): SemanticProposal | undefined | Promise<SemanticProposal | undefined>;
  remember(result: BindingValidation, scan: ScanResult, profile: UserProfile, signal?: AbortSignal): boolean | Promise<boolean>;
}
export function semanticRecipeFieldKey(field: SemanticBindingSession['request']['fields'][number], observation: string): string {
  return JSON.stringify({ field: { ...field, ref: undefined }, observation });
}
export function semanticRecipeGraphKey(scan: ScanResult): string {
  const ids = new Map(scan.fields.map((field, index) => [field.id, index]));
  return JSON.stringify({ ...scan.semanticGraph, nodes: scan.semanticGraph!.nodes.map(node => ({ ...node, bounds: undefined,
    ...(node.kind === 'field' ? { fieldId: ids.get(node.fieldId) } : {}) })) });
}
export function semanticRecipeScope(scan: ScanResult, profile: UserProfile): string | undefined {
  if (!scan.semanticGraph || scan.contentVersion !== EXTENSION_VERSION || !profile.revision
    || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(profile.revision)) return undefined;
  return JSON.stringify({ url: scan.url, version: EXTENSION_VERSION, revision: profile.revision });
}

/** Private memory only, whole-batch hits only. Stored meanings cannot authorize writes or retain personal answers. */
export class SemanticRecipeCache {
  #recipes = new Map<string, Recipe>();
  #scope?: string;
  #capacity: number;
  constructor(maxEntries = 100) { this.#capacity = Number.isFinite(maxEntries) ? Math.max(1, Math.min(100, Math.floor(maxEntries))) : 100; }
  clear(): void { this.#recipes.clear(); this.#scope = undefined; }
  #prepare(scan: ScanResult, profile: UserProfile): string | undefined {
    const scope = semanticRecipeScope(scan, profile); if (!scope) return undefined;
    // Only routing, version and opaque revision are held here; no profile serialization or value-derived hash.
    if (scope !== this.#scope) { this.clear(); this.#scope = scope; }
    const now = Date.now();
    for (const [key, value] of this.#recipes) if (now < value.createdAt || now - value.createdAt > SEMANTIC_RECIPE_TTL_MS) this.#recipes.delete(key);
    return semanticRecipeGraphKey(scan);
  }
  remember(result: BindingValidation, scan: ScanResult, profile: UserProfile): boolean {
    const recipes = verifiedSemanticRecipes(result, scan, profile);
    if (!recipes) return false;
    const graph = this.#prepare(scan, profile); if (!graph) return false;
    let stored = 0;
    for (const recipe of recipes) {
      if (!recipe.observation) continue;
      const key = `${graph}\n${semanticRecipeFieldKey(recipe.field, recipe.observation)}`;
      this.#recipes.delete(key);
      this.#recipes.set(key, { path: recipe.path, evidence: recipe.evidence, createdAt: Date.now() });
      while (this.#recipes.size > this.#capacity) this.#recipes.delete(this.#recipes.keys().next().value!);
      stored++;
    }
    return stored > 0;
  }
  propose(session: SemanticBindingSession, scan: ScanResult, profile: UserProfile): SemanticProposal | undefined {
    const observations = semanticSessionObservations(session, scan, profile); if (!observations) return undefined;
    const graph = this.#prepare(scan, profile); if (!graph) return undefined;
    const bindings: SemanticProposal['bindings'] = [];
    for (const field of session.request.fields) {
      const observation = observations.get(field.ref); if (!observation) return undefined;
      const key = `${graph}\n${semanticRecipeFieldKey(field, observation)}`; const recipe = this.#recipes.get(key);
      if (!recipe) return undefined;
      bindings.push({ ref: field.ref, fingerprint: field.fingerprint, path: recipe.path, certainty: 'certain', evidence: recipe.evidence });
    }
    if (!bindings.length) return undefined;
    return { requestId: session.request.requestId, status: 'mapped', bindings };
  }
}
