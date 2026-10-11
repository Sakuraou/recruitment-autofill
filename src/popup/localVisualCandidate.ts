import { semanticRedactor } from '../ai/semanticPrivacy';
import { createSemanticBindingSession, validateSemanticBindings } from '../ai/semanticBinding';
import { resolveSemanticCandidates } from '../ai/semanticCandidates';
import type { UserProfile } from '../profile/schema';
import type { ScanResult, MatchResult } from '../shared/types';
interface Context { scan: ScanResult; profile: UserProfile }
/** Trusted popup only: profile is captured privately; transport sees semantic request, never values. */
export function prepareLocalVisualCandidate(context: Context, fieldId: string, current: () => Context | undefined,
  live: () => boolean): { request: import('../ai/semanticBinding').SemanticBindingSession['request'];
    authorizeLabel(text: unknown): boolean;
    accept(proposal: unknown): { state: 'ready'; matches: MatchResult[] } | { state: 'manual' } } | undefined {
  if (!live() || !context.scan.fields.some(field => field.id === fieldId)) return undefined;
  const excluded = new Set(context.scan.fields.filter(field => field.id !== fieldId).map(field => field.id));
  const created = createSemanticBindingSession(context.scan, context.profile, excluded);
  if (!created.ok || created.session.request.fields.length !== 1) return undefined;
  let used = false, authorized = false;
  const snapshot = JSON.stringify(context), originalLabel = context.scan.fields.find(field => field.id === fieldId)!.label;
  const redact = semanticRedactor(context.profile);
  const fresh = () => { const latest = current(); return live() && !!latest && JSON.stringify(latest) === snapshot; };
  return Object.freeze({ request: created.session.request,
    authorizeLabel(text: unknown) {
      if (used || authorized || !fresh() || typeof text !== 'string' || !text.trim() || text.length > 120
        || text !== originalLabel || redact(text) !== text) return false;
      authorized = true; return true;
    }, accept(proposal: unknown) {
    if (used) return { state: 'manual' as const }; used = true;
    const latest = current();
    if (!authorized || !fresh() || !latest) return { state: 'manual' as const };
    const binding = validateSemanticBindings(created.session, proposal, latest.scan, latest.profile);
    if (!binding.ok) return { state: 'manual' as const };
    const candidates = resolveSemanticCandidates(binding, latest.scan, latest.profile);
    if (!live() || !candidates.ok || candidates.matches.length !== 1 || candidates.matches[0]?.fieldId !== fieldId)
      return { state: 'manual' as const };
    return { state: 'ready' as const, matches: candidates.matches };
  }});
}


