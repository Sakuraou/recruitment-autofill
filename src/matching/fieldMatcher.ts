import { contextualAliases, fieldAliases, sectionAliases, type AliasScope, type FieldAlias } from '../profile/aliases';
import type { FieldDescriptor } from '../shared/types';
import { containsAlias, normalize } from './confidence';

export interface DetectedField {
  alias: FieldAlias;
  confidence: number;
  source: 'rule' | 'alias';
  ambiguous: boolean;
  /** The evidence that won after every available label source was compared. */
  evidence: string;
}

export function directTexts(field: FieldDescriptor): string[] {
  return [field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder].filter(Boolean);
}

function spacedIdentifier(value: string): string {
  return value.normalize('NFKC')
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .replace(/[_.:[\]()/\\-]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

/** Convert framework/resource IDs into low-priority semantic evidence. */
export function identifierTexts(field: FieldDescriptor): string[] {
  const result: string[] = [];
  for (const raw of [field.name, field.htmlId, field.label, field.ariaLabel]) {
    const spaced = spacedIdentifier(raw);
    if (!spaced || normalize(spaced) === normalize(raw) && !/[A-Z_:[\].-]/u.test(raw)) continue;
    result.push(spaced);
    const words = spaced.split(/\s+/u);
    for (const count of [3, 2, 1]) {
      if (words.length <= count) continue;
      const suffix = words.slice(-count).join(' ');
      if (count === 1 && /^(?:name|date|type|number|code|value|id|text)$/iu.test(suffix)) continue;
      result.push(suffix);
    }
    // Several older recruiting systems call an identity document a Certificate.
    // The surrounding Person/Profile namespace makes the intended owner explicit.
    if (/(?:person|candidate|applicant|resume)\s*profile/iu.test(spaced)) {
      if (/certificate\s*number$/iu.test(spaced)) result.push('证件号码');
      if (/certificate\s*type$/iu.test(spaced)) result.push('证件类型');
    }
  }
  return [...new Set(result)];
}

function looksHumanLabel(text: string): boolean {
  if (!text || text.length > 80) return false;
  if (/^(?:recruitment|portal|person|candidate|applicant|resume)[\w_.:[\]-]+$/iu.test(text.replace(/\s+/gu, ''))) return false;
  return /[\p{Script=Han}]/u.test(text) || /\s/u.test(text) || text.length <= 24;
}

/** Prefer a concise visible label in the popup instead of a framework resource key. */
export function bestFieldName(field: FieldDescriptor): string {
  const candidates = [field.tableHeader, field.label, field.ariaLabel, field.previousText, field.placeholder, field.title]
    .filter(looksHumanLabel);
  const exact = candidates.find((text) => matchText(text, contextualScope(field), false)?.confidence === 1);
  return exact || candidates[0] || identifierTexts(field).at(-1) || field.name || field.htmlId || '未命名字段';
}

export function fieldContext(field: FieldDescriptor): string {
  return [...directTexts(field), field.sectionText, field.name, field.htmlId].filter(Boolean).join(' ');
}

function contextualScope(field: FieldDescriptor): AliasScope | undefined {
  const contexts = [field.sectionText, ...directTexts(field)];
  for (const text of contexts) {
    const scopes = Object.entries(sectionAliases).filter(([, aliases]) => aliases?.some((alias) => containsAlias(text, alias)));
    if (scopes.length === 1) return scopes[0]?.[0] as AliasScope;
  }
  return undefined;
}

function knownLabelWrapper(text: string, alias: string, scope: AliasScope): boolean {
  const normalized = normalize(text)
    .replace(/(?:不超过|最多|限|上限)?\d+(?:个字符|字符|字)(?:以内|以下|为限)?$/u, '')
    .replace(/必填$/u, '')
    .replace(/^(?:(?:请填写|请输入|请选择|请提供|请简述|请|您的|你的|本人|申请人|应聘者))+/u, '');
  const target = normalize(alias);
  if (normalized === target) return true;
  if (scope === 'education' && normalized.endsWith(target)) {
    const prefix = normalized.slice(0, -target.length);
    return /^(?:最高学历|全日制最高学历|最高全日制学历|全日制最高|最高全日制|最高|highest|highestfulltime|fulltimehighest|highestqualification|highesteducation|highestfulltimequalification|highestfulltimeeducation|硕士研究生|博士研究生|硕士|博士|本科|专科|研究生|bachelor|master|doctor|undergraduate)$/u.test(prefix);
  }
  return false;
}

function matchText(text: string, scope: AliasScope | undefined, fallback: boolean): DetectedField | undefined {
  const dictionary = [...fieldAliases, ...contextualAliases.filter((entry) => entry.scope === scope)];
  const matches = dictionary.flatMap((entry) => entry.aliases.filter((alias) => containsAlias(text, alias)).map((alias) => {
    const exact = normalize(text) === normalize(alias);
    const inContext = scope === entry.scope;
    // Prefer a long, specific phrase to its contained generic alias (e.g. 专业类别 > 专业).
    const knownWrapper = knownLabelWrapper(text, alias, entry.scope);
    const rank = normalize(alias).length + (exact ? 30 : knownWrapper && entry.scope === 'education' ? 6 : 0) + (inContext ? 2 : 0);
    return { entry, rank, exact, knownWrapper };
  })).sort((a, b) => b.rank - a.rank);
  const best = matches[0];
  if (!best) return undefined;
  const tied = matches.filter((candidate) => candidate.rank >= best.rank - 1
    && (candidate.entry.scope !== best.entry.scope || candidate.entry.key !== best.entry.key));
  return { alias: best.entry, confidence: fallback ? (best.exact ? 0.92 : 0.82) : best.exact ? 1 : best.knownWrapper ? 0.96 : 0.82,
    source: best.exact ? 'rule' : 'alias', ambiguous: tied.length > 0, evidence: text };
}

function educationModeFromChoices(field: FieldDescriptor): FieldAlias | undefined {
  if (!['select', 'radio'].includes(field.kind)) return undefined;
  const labels = [field.label, field.ariaLabel, field.tableHeader].map(normalize).filter(Boolean);
  if (!labels.length || !labels.every(label => ['教育类型', 'educationtype'].includes(label))) return undefined;
  const choices = field.options.filter(option => option.value !== ''
    && !/^(?:请选择|选择|please select|select an option|--)/iu.test(option.label.trim()));
  const options = choices.filter(option => !option.disabled).map(option => normalize(option.label));
  const full = ['全日制', '普通全日制', 'fulltime']; const part = ['非全日制', 'parttime'];
  if (!options.some(option => full.includes(option)) || !options.some(option => part.includes(option))
    || choices.some(option => !full.includes(normalize(option.label)) && !part.includes(normalize(option.label)))) return undefined;
  return fieldAliases.find(alias => alias.scope === 'education' && alias.key === 'studyMode');
}

export function detectField(field: FieldDescriptor): DetectedField | undefined {
  const scope = contextualScope(field);
  const educationMode = educationModeFromChoices(field);
  const candidates: Array<DetectedField & { tier: number; order: number }> = [];
  let order = 0;
  // Compare every source. A precise visible row/header label must beat an earlier
  // framework key that merely contains an English alias.
  for (const text of directTexts(field)) {
    const detected: DetectedField | undefined = educationMode && ['教育类型', 'educationtype'].includes(normalize(text))
      ? { alias: educationMode, confidence: 1, source: 'rule', ambiguous: false, evidence: text }
      : matchText(text, scope, false);
    if (detected) candidates.push({ ...detected, tier: 3, order: order++ });
  }
  for (const text of identifierTexts(field)) {
    const detected = matchText(text, scope, false);
    if (detected) candidates.push({ ...detected,
      confidence: detected.confidence === 1 ? 0.94 : Math.min(detected.confidence, 0.9), tier: 2, order: order++ });
  }
  for (const text of [field.name, field.htmlId].filter(Boolean)) {
    const detected = matchText(text, scope, false);
    if (detected) candidates.push({ ...detected, confidence: Math.min(detected.confidence, 0.88), tier: 1, order: order++ });
  }
  for (const text of [field.previousText, field.parentText].filter((value) => value.length <= 120 && value.length > 0)) {
    const detected = matchText(text, scope, true);
    if (detected) candidates.push({ ...detected, tier: 1, order: order++ });
  }
  candidates.sort((a, b) => b.confidence - a.confidence || b.tier - a.tier
    || normalize(b.evidence).length - normalize(a.evidence).length || a.order - b.order);
  const best = candidates[0];
  if (!best) return undefined;
  const conflicts = candidates.filter((candidate) => candidate !== best
    && candidate.confidence >= best.confidence - 0.01 && candidate.tier === best.tier
    && (candidate.alias.scope !== best.alias.scope || candidate.alias.key !== best.alias.key));
  return {
    alias: best.alias,
    confidence: best.confidence,
    source: best.source,
    ambiguous: best.ambiguous || conflicts.length > 0,
    evidence: best.evidence,
  };
}
