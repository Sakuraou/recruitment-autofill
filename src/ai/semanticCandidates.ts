import { fieldAliases } from '../profile/aliases';
import { profileSchema, type UserProfile } from '../profile/schema';
import type { FieldDescriptor, MatchResult, ScanResult } from '../shared/types';
import { bestFieldName } from '../matching/fieldMatcher';
import { finalizeCandidateValue, hasMeasurementUnits } from '../matching/candidateValue';
import { resolveProfileValue } from '../matching/profileResolver';
import { createSemanticBindingSession, semanticBindingsCurrent, validateSemanticBindings,
  type BindingValidation, type SemanticBindingPath, type SemanticBindingSession } from './semanticBinding';
import type { SemanticRecipes } from './semanticRecipes';
import { projectSemanticContextCurrent, projectSemanticFieldIds, resolveCurrentProjectField, type ProjectSemanticContext } from './projectSemanticContext';
import { educationSemanticContextCurrent, educationSemanticFieldIds, resolveCurrentEducationField, type EducationSemanticContext } from './educationSemanticContext';

import { internshipSemanticContextCurrent, internshipSemanticFieldIds, resolveCurrentInternshipField, type InternshipSemanticContext } from './internshipSemanticContext';

type RecordSemanticContext = ProjectSemanticContext | EducationSemanticContext | InternshipSemanticContext;
type CandidateResult = { ok: true; matches: MatchResult[] } | { ok: false; reason: 'stale-binding' | 'invalid-profile' | 'invalid-project-context' | 'invalid-education-context' | 'invalid-internship-context' };
function incompatibleControl(field: FieldDescriptor, path: SemanticBindingPath): boolean {
  if (field.type === 'email') return path !== 'basic.email';
  if (field.type === 'tel') return path !== 'basic.phone';
  if (field.type === 'url') return !path.startsWith('links.') && path !== 'projects.url';
  if (field.type === 'date' || field.type === 'month') return ![
    'basic.birthday', 'jobPreferences.earliestStartDate', 'projects.startDate', 'projects.endDate', 'education.startDate', 'education.endDate', 'internships.startDate', 'internships.endDate',
  ].includes(path);
  return false;
}

/** Produces review candidates only. No network, logging, writes, guessed record index or automatic approval. */
export function resolveSemanticCandidates(result: BindingValidation, scan: ScanResult, profile: UserProfile, recordContext?: RecordSemanticContext): CandidateResult {
  if (!result.ok || !semanticBindingsCurrent(result, scan, profile)) return { ok: false, reason: 'stale-binding' };
  if (!profileSchema.safeParse(profile).success) return { ok: false, reason: 'invalid-profile' };
  const internshipContext = recordContext?.recordType === 'internship' ? recordContext : undefined;
  if (internshipContext && !internshipSemanticContextCurrent(internshipContext, scan, profile, result.bindings.map(binding => binding.fieldId)))
    return { ok: false, reason: 'invalid-internship-context' };
  const projectContext = recordContext?.recordType === 'project' ? recordContext : undefined;
  const educationContext = recordContext?.recordType === 'education' ? recordContext : undefined;
  if (projectContext && !projectSemanticContextCurrent(projectContext, scan, profile, result.bindings.map(binding => binding.fieldId)))
    return { ok: false, reason: 'invalid-project-context' };
  if (educationContext && !educationSemanticContextCurrent(educationContext, scan, profile, result.bindings.map(binding => binding.fieldId)))
    return { ok: false, reason: 'invalid-education-context' };
  const byId = new Map(scan.fields.map(field => [field.id, field]));
  const matches = result.bindings.map(binding => {
    const field = byId.get(binding.fieldId)!;
    const base: MatchResult = { fieldId: field.id, fieldName: bestFieldName(field), matchedProfileKey: binding.path,
      source: 'llm', status: 'review', confidence: 0.9, sensitive: true, reason: 'AI 提议字段含义，请核对本地档案候选。' };
    if (incompatibleControl(field, binding.path)) return { ...base, reason: '控件类型与提议的资料含义不一致，未提供填写值。' };
    if ((binding.path === 'basic.heightCm' || binding.path === 'basic.weightKg')
      && !hasMeasurementUnits(field, binding.path === 'basic.heightCm' ? 'heightCm' : 'weightKg'))
      return { ...base, reason: '测量单位未唯一明确为厘米或千克，不能按模型提议推算。' };
    if (binding.path.startsWith('internships.')) {
      const resolved = internshipContext ? resolveCurrentInternshipField(internshipContext, scan, profile, field.id, binding.path) : undefined;
      if (!resolved) return { ...base, reason: '实习字段需要当前经历上下文，不能默认第一条。' };
      return resolved.status === 'known' ? { ...base, value: resolved.value, confidence: resolved.confidence,
        reason: '从当前实习经历读取，并通过本地日期、长度与选项校验。' }
        : { ...base, confidence: 0, reason: '当前实习字段未通过本地校验：' + resolved.reason };
    }
    if (binding.path.startsWith('education.')) {
      const resolved = educationContext ? resolveCurrentEducationField(educationContext, scan, profile, field.id, binding.path) : undefined;
      if (!resolved) return { ...base, reason: '教育字段需要规划器明确当前经历；模型绑定不会默认第一条或最高记录。' };
      return resolved.status === 'known' ? { ...base, value: resolved.value, confidence: resolved.confidence,
        reason: '从当前教育经历读取，并通过本地日期、长度与选项校验。' }
        : { ...base, confidence: 0, reason: `当前教育字段未通过本地校验：${resolved.reason}` };
    }
    if (binding.path.startsWith('projects.')) {
      const resolved = projectContext ? resolveCurrentProjectField(projectContext, scan, profile, field.id, binding.path) : undefined;
      if (!resolved) return { ...base, reason: '项目字段需要记录规划器明确当前经历；模型绑定不会默认第一条。' };
      return resolved.status === 'known' ? { ...base, value: resolved.value, confidence: resolved.confidence,
        reason: '从当前规划项目读取，并通过本地日期、长度与选项校验。' }
        : { ...base, confidence: 0, reason: `当前项目字段未通过本地校验：${resolved.reason}` };
    }
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
  recipes?: SemanticRecipes;
  projectContext?: ProjectSemanticContext;
  educationContext?: EducationSemanticContext;
  internshipContext?: InternshipSemanticContext;
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
  if ([options.projectContext, options.educationContext, options.internshipContext].filter(Boolean).length > 1) return empty('rejected');
  const internshipFields = options.internshipContext ? internshipSemanticFieldIds(options.internshipContext, scan, profile) : undefined;
  if (options.internshipContext && !internshipFields) return empty('rejected');
  const projectFields = options.projectContext ? projectSemanticFieldIds(options.projectContext, scan, profile) : undefined;
  if (options.projectContext && !projectFields) return empty('rejected');
  const educationFields = options.educationContext ? educationSemanticFieldIds(options.educationContext, scan, profile) : undefined;
  if (options.educationContext && !educationFields) return empty('rejected');
  const excluded = new Set(options.excludedFieldIds);
  if (projectFields || educationFields || internshipFields) {
    const owned = new Set(internshipFields ?? projectFields ?? educationFields);
    for (const field of scan.fields) if (!owned.has(field.id)) excluded.add(field.id);
  }
  const projectCurrent = () => (!options.projectContext || projectSemanticContextCurrent(options.projectContext, scan, profile, []))
    && (!options.educationContext || educationSemanticContextCurrent(options.educationContext, scan, profile, []))
    && (!options.internshipContext || internshipSemanticContextCurrent(options.internshipContext, scan, profile, []));
  const created = createSemanticBindingSession(scan, profile, excluded, options.educationContext, options.internshipContext);
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
    if (!projectCurrent()) return empty('rejected');
    const cached = options.recipes ? await options.recipes.propose(created.session, scan, profile, controller.signal) : undefined;
    if (controller.signal.aborted) return empty('cancelled');
    if (!projectCurrent()) return empty('rejected');
    const response = cached ?? await provider.propose(created.session.request, controller.signal);
    if (controller.signal.aborted) return empty('cancelled');
    if (!projectCurrent()) return empty('rejected');
    const current = options.currentContext ? await options.currentContext() : { scan, profile };
    if (controller.signal.aborted) return empty('cancelled');
    const validated = validateSemanticBindings(created.session, response, current.scan, current.profile);
    if (!validated.ok) return empty('rejected');
    const candidates = resolveSemanticCandidates(validated, current.scan, current.profile, options.internshipContext ?? options.educationContext ?? options.projectContext);
    if (candidates.ok && options.recipes) await options.recipes.remember(validated, current.scan, current.profile, controller.signal);
    if (controller.signal.aborted) return empty('cancelled');
    if (!semanticBindingsCurrent(validated, current.scan, current.profile) || !projectCurrent()) return empty('rejected');
    return candidates.ok ? { state: 'ready', matches: candidates.matches } : empty('rejected');
  }).catch(() => empty('unavailable'));
  try { return await Promise.race([operation, cancelled]); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}
