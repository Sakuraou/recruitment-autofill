import { z } from 'zod';
import type { UserProfile } from '../profile/schema';
import type { ScanResult } from '../shared/types';
import { semanticSessionCurrent, semanticSessionObservations, verifiedSemanticRecipes,
  type BindingValidation, type SemanticBindingSession } from './semanticBinding';
import { SEMANTIC_BINDING_PATHS, type SemanticProposal } from './semanticProtocol';
import { semanticRecipeFieldKey, semanticRecipeGraphKey, semanticRecipeScope, SEMANTIC_RECIPE_TTL_MS, type SemanticRecipes } from './semanticRecipes';

export const SESSION_RECIPE_KEY = 'recruitment.semantic.recipes.session.v1';
export const SESSION_RECIPE_SECRET = 'recruitment.semantic.recipes.secret.v1';
const LOCK = 'recruitment-semantic-recipes';
const hex = z.string().regex(/^[a-f\d]{64}$/u);
const entrySchema = z.object({ key: hex, path: z.enum(SEMANTIC_BINDING_PATHS),
  evidence: z.enum(['label', 'context', 'options']), createdAt: z.number().int().nonnegative().safe() }).strict();
const payloadSchema = z.object({ version: z.literal(1), scope: hex, entries: z.array(entrySchema).max(100) }).strict();
const packetSchema = payloadSchema.extend({ signature: hex }).strict();
type Payload = z.infer<typeof payloadSchema>;
const encode = (value: string) => new TextEncoder().encode(value);
const toHex = (value: ArrayBuffer | Uint8Array) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) => Uint8Array.from(value.match(/../gu)!, byte => Number.parseInt(byte, 16));
const digest = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', encode(value)));
const signingKey = (secret: string) => crypto.subtle.importKey('raw', fromHex(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function trustedSession<T>(operation: (area: chrome.storage.StorageArea) => Promise<T>): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.storage?.session || !navigator.locks || !crypto.subtle)
    throw new Error('Session cache unavailable');
  return navigator.locks.request(LOCK, async () => {
    const area = chrome.storage.session;
    await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    return operation(area);
  });
}
async function loadPacket(data: Record<string, unknown>, scope: string): Promise<Payload | undefined> {
  const secret = hex.safeParse(data[SESSION_RECIPE_SECRET]);
  const raw = data[SESSION_RECIPE_KEY];
  if (!secret.success || JSON.stringify(raw)?.length > 35000) return undefined;
  const packet = packetSchema.safeParse(raw); if (!packet.success || packet.data.scope !== scope) return undefined;
  const { signature, ...payload } = packet.data;
  if (new Set(payload.entries.map(entry => entry.key)).size !== payload.entries.length) return undefined;
  if (!await crypto.subtle.verify('HMAC', await signingKey(secret.data), fromHex(signature), encode(JSON.stringify(payload)))) return undefined;
  const now = Date.now(); if (payload.entries.some(entry => entry.createdAt > now)) return undefined;
  return { ...payload, entries: payload.entries.filter(entry => now - entry.createdAt <= SEMANTIC_RECIPE_TTL_MS) };
}

/** Browser-session only. Compact signed meanings, not values, raw clues, selectors or execution permissions. */
export class SessionSemanticRecipes implements SemanticRecipes {
  readonly #connectionRevision?: string;
  readonly #enabled: boolean;
  constructor(connectionRevision?: string) {
    this.#enabled = connectionRevision === undefined || z.uuid().safeParse(connectionRevision).success;
    this.#connectionRevision = connectionRevision;
  }
  #scope(scan: ScanResult, profile: UserProfile): string | undefined {
    const base = semanticRecipeScope(scan, profile);
    return this.#enabled && base ? JSON.stringify({ base, connectionRevision: this.#connectionRevision }) : undefined;
  }
  async propose(session: SemanticBindingSession, scan: ScanResult, profile: UserProfile, signal?: AbortSignal): Promise<SemanticProposal | undefined> {
    try {
      if (session.request.protocol !== 1) return undefined;
      const observations = semanticSessionObservations(session, scan, profile); const scope = this.#scope(scan, profile);
      if (!observations || !scope || signal?.aborted) return undefined;
      return await trustedSession(async area => {
        const data = await area.get([SESSION_RECIPE_KEY, SESSION_RECIPE_SECRET]);
        if (signal?.aborted || !semanticSessionCurrent(session, scan, profile)) return undefined;
        const payload = await loadPacket(data, await digest(scope)); if (!payload) return undefined;
        const graph = semanticRecipeGraphKey(scan); const bindings: SemanticProposal['bindings'] = [];
        for (const field of session.request.fields) {
          const observation = observations.get(field.ref); if (!observation) return undefined;
          const key = await digest(`${graph}\n${semanticRecipeFieldKey(field, observation)}`);
          const recipe = payload.entries.find(entry => entry.key === key); if (!recipe) return undefined;
          bindings.push({ ref: field.ref, fingerprint: field.fingerprint, path: recipe.path, evidence: recipe.evidence, certainty: 'certain' });
        }
        if (signal?.aborted || !bindings.length || !semanticSessionCurrent(session, scan, profile)) return undefined;
        return { requestId: session.request.requestId, status: 'mapped', bindings };
      });
    } catch { return undefined; }
  }
  async remember(result: BindingValidation, scan: ScanResult, profile: UserProfile, signal?: AbortSignal): Promise<boolean> {
    try {
      const recipes = verifiedSemanticRecipes(result, scan, profile); const scope = this.#scope(scan, profile);
      if (!recipes || !scope || signal?.aborted || !recipes.some(recipe => recipe.observation)
        || recipes.some(recipe => recipe.field.section === 'education')) return false;
      return await trustedSession(async area => {
        const data = await area.get([SESSION_RECIPE_KEY, SESSION_RECIPE_SECRET]);
        if (signal?.aborted || !verifiedSemanticRecipes(result, scan, profile)) return false;
        const scopeKey = await digest(scope); const payload = await loadPacket(data, scopeKey);
        const entries = new Map(payload?.entries.map(entry => [entry.key, entry])); const graph = semanticRecipeGraphKey(scan);
        for (const recipe of recipes) {
          if (!recipe.observation) continue;
          const key = await digest(`${graph}\n${semanticRecipeFieldKey(recipe.field, recipe.observation)}`);
          const parsed = entrySchema.safeParse({ key, path: recipe.path, evidence: recipe.evidence, createdAt: Date.now() });
          if (!parsed.success) return false;
          entries.delete(key); entries.set(key, parsed.data);
          while (entries.size > 100) entries.delete(entries.keys().next().value!);
        }
        const existingSecret = hex.safeParse(data[SESSION_RECIPE_SECRET]);
        const secret = existingSecret.success ? existingSecret.data : toHex(crypto.getRandomValues(new Uint8Array(32)));
        const next: Payload = { version: 1, scope: scopeKey, entries: [...entries.values()] };
        const signature = toHex(await crypto.subtle.sign('HMAC', await signingKey(secret), encode(JSON.stringify(next))));
        if (signal?.aborted || !verifiedSemanticRecipes(result, scan, profile)) return false;
        await area.set({ [SESSION_RECIPE_SECRET]: secret, [SESSION_RECIPE_KEY]: { ...next, signature } }); return true;
      });
    } catch { return false; }
  }
}
export async function clearSessionSemanticRecipes(): Promise<void> {
  try { await trustedSession(area => area.remove([SESSION_RECIPE_KEY, SESSION_RECIPE_SECRET])); } catch { /* No cache is also safe. */ }
}
