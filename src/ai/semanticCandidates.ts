import { fieldAliases } from '../profile/aliases';
import { profileSchema, type UserProfile } from '../profile/schema';
import type { FieldDescriptor, MatchResult, ScanResult } from '../shared/types';
import { bestFieldName } from '../matching/fieldMatcher';
import { finalizeCandidateValue, hasMeasurementUnits } from '../matching/candidateValue';
import { resolveProfileValue } from '../matching/profileResolver';
import { createSemanticBindingSession, semanticBindingsCurrent, validateSemanticBindings,
  type BindingValidation, type SemanticBindingPath, type SemanticBindingSession } from './semanticBinding';
import type { SemanticRecipeCache } from './semanticRecipes';

type CandidateResult = { ok: true; matches: MatchResult[] } | { ok: false; reason: 'stale-binding' | 'invalid-profile' };
function incompatibleControl(field: FieldDescriptor, path: SemanticBindingPath): boolean {
  if (field.type === 'email') return path !== 'basic.email';
  if (field.type === 'tel') return path !== 'basic.phone';
  if (field.type === 'url') return !path.startsWith('links.') && path !== 'projects.url';
  if (field.type === 'date' || field.type === 'month') return ![
    'basic.birthday', 'jobPreferences.earliestStartDate', 'projects.startDate', 'projects.endDate',
  ].includes(path);
  return false;
}

/** Produces review candidates only. No network, logging, writes, guessed record index or automatic approval. */
export function resolveSemanticCandidates(result: BindingValidation, scan: ScanResult, profile: UserProfile): CandidateResult {
  if (!result.ok || !semanticBindingsCurrent(result, scan, profile)) return { ok: false, reason: 'stale-binding' };
  if (!profileSchema.safeParse(profile).success) return { ok: false, reason: 'invalid-profile' };
  const byId = new Map(scan.fields.map(field => [field.id, field]));
  const matches = result.bindings.map(binding => {
    const field = byId.get(binding.fieldId)!;
    const base: MatchResult = { fieldId: field.id, fieldName: bestFieldName(field), matchedProfileKey: binding.path,
      source: 'llm', status: 'review', confidence: 0.9, sensitive: true, reason: 'AI 提议字段含义，请核对本地档案候选。' };
    if (incompatibleControl(field, binding.path)) return { ...base, reason: '控件类型与提议的资料含义不一致，未提供填写值。' };
    if ((binding.path === 'basic.heightCm' || binding.path === 'basic.weightKg')
      && !hasMeasurementUnits(field, binding.path === 'basic.heightCm' ? 'heightCm' : 'weightKg'))
      return { ...base, reason: '测量单位未唯一明确为厘米或千克，不能按模型提议推算。' };
    if (binding.path.startsWith('projects.')) return { ...base, reason: '项目字段需要记录规划器明确当前经历；模型绑定不会默认第一条。' };
    const alias = fieldAliases.find(item => `${item.scope}.${item.key}` === binding.path);
    if (!alias) return { ...base, reason: '本地尚未提供这个资料路径的取值规则。' };
    const resolved = resolveProfileValue(field, profile, alias);
    if (!resolved.value) return { ...base, status: resolved.review ? 'review' as const : 'missing' as const,
      reason: resolved.reason, confidence: 0 };
    const formatted = finalizeCandidateValue(field, { ...base, value: resolved.value, matchedProfileKey: resolved.key, reason: resolved.reason });
    // Option alias matching must not launder a model proposal into a deterministic source.
    return { ...formatted, source: 'llm' as const, status: 'review' as const,
      ...(formatted.source === 'fuzzy' || formatted.confidence < 0.9 ? { value: undefined,
        reason: '选项无法通过唯一精确或明确等价含义核验，未提供填写值。' } : {}) };
  });
  return { ok: true, matches };
}

export interface SemanticProvider {
  propose(request: SemanticBindingSession['request'], signal: AbortSignal): Promise<unknown>;
}
export interface SemanticInferenceOptions {
  timeoutMs?: number; signal?: AbortSignal;
  excludedFieldIds?: ReadonlySet<string>;
  recipes?: SemanticRecipeCache;
  currentContext?: () => { scan: ScanResult; profile: UserProfile } | Promise<{ scan: ScanResult; profile: UserProfile }>;
}
export interface SemanticInferenceResult {
  state: 'ready' | 'disabled' | 'no-candidates' | 'rejected' | 'unavailable' | 'timeout' | 'cancelled';
  matches: MatchResult[];
}
const empty = (state: SemanticInferenceResult['state']): SemanticInferenceResult => ({ state, matches: [] });

/** One bounded, abortable attempt; the provider receives no profile values, endpoint or caller-selected instructions. */
export async function inferSemanticCandidates(scan: ScanResult, profile: UserProfile, provider?: SemanticProvider,
  options: SemanticInferenceOptions = {}): Promise<SemanticInferenceResult> {
  if (options.signal?.aborted) return empty('cancelled');
  if (!provider) return empty('disabled');
  const created = createSemanticBindingSession(scan, profile, options.excludedFieldIds);
  if (!created.ok) return empty(created.reason === 'no-candidates' ? 'no-candidates' : 'rejected');
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(100, Math.min(options.timeoutMs!, 30_000)) : 15_000;
  let finish: (result: SemanticInferenceResult) => void = () => {};
  const cancelled = new Promise<SemanticInferenceResult>(resolve => { finish = resolve; });
  const cancel = () => { finish(empty('cancelled')); controller.abort(); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { finish(empty('timeout')); controller.abort(); }, timeoutMs);
  const operation = Promise.resolve().then(async (): Promise<SemanticInferenceResult> => {
    if (controller.signal.aborted) return empty('cancelled');
    const response = options.recipes?.propose(created.session, scan, profile) ?? await provider.propose(created.session.request, controller.signal);
    if (controller.signal.aborted) return empty('cancelled');
    const current = options.currentContext ? await options.currentContext() : { scan, profile };
    if (controller.signal.aborted) return empty('cancelled');
    const validated = validateSemanticBindings(created.session, response, current.scan, current.profile);
    if (!validated.ok) return empty('rejected');
    const candidates = resolveSemanticCandidates(validated, current.scan, current.profile);
    if (candidates.ok) options.recipes?.remember(validated, current.scan, current.profile);
    return candidates.ok ? { state: 'ready', matches: candidates.matches } : empty('rejected');
  }).catch(() => empty('unavailable'));
  try { return await Promise.race([operation, cancelled]); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}
