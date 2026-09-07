import { contextualAliases, fieldAliases, sectionAliases, type AliasScope, type FieldAlias } from '../profile/aliases';
import type { FieldDescriptor } from '../shared/types';
import { containsAlias, normalize } from './confidence';

export interface DetectedField { alias: FieldAlias; confidence: number; source: 'rule' | 'alias'; ambiguous: boolean }

export function directTexts(field: FieldDescriptor): string[] {
  return [field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder].filter(Boolean);
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
    return /^(?:最高学历|最高|硕士研究生|博士研究生|硕士|博士|本科|专科|研究生|bachelor|master|doctor|undergraduate)$/u.test(prefix);
  }
  return false;
}

function matchText(text: string, scope: AliasScope | undefined, fallback: boolean): DetectedField | undefined {
  const dictionary = [...fieldAliases, ...contextualAliases.filter((entry) => entry.scope === scope)];
  const matches = dictionary.flatMap((entry) => entry.aliases.filter((alias) => containsAlias(text, alias)).map((alias) => {
    const exact = normalize(text) === normalize(alias);
    const inContext = scope === entry.scope;
    // Prefer a long, specific phrase to its contained generic alias (e.g. 专业类别 > 专业).
    const rank = normalize(alias).length + (exact ? 30 : 0) + (inContext ? 2 : 0);
    return { entry, rank, exact, knownWrapper: knownLabelWrapper(text, alias, entry.scope) };
  })).sort((a, b) => b.rank - a.rank);
  const best = matches[0];
  if (!best) return undefined;
  const tied = matches.filter((candidate) => candidate.rank >= best.rank - 1
    && (candidate.entry.scope !== best.entry.scope || candidate.entry.key !== best.entry.key));
  return { alias: best.entry, confidence: fallback ? (best.exact ? 0.92 : 0.82) : best.exact ? 1 : best.knownWrapper ? 0.96 : 0.82,
    source: best.exact ? 'rule' : 'alias', ambiguous: tied.length > 0 };
}

export function detectField(field: FieldDescriptor): DetectedField | undefined {
  const scope = contextualScope(field);
  // Short, associated labels take precedence over input IDs and large parent containers.
  for (const text of directTexts(field)) {
    const detected = matchText(text, scope, false);
    if (detected) return detected;
  }
  for (const text of [field.name, field.htmlId].filter(Boolean)) {
    const detected = matchText(text, scope, false);
    if (detected) return { ...detected, confidence: Math.min(detected.confidence, 0.95) };
  }
  for (const text of [field.previousText, field.parentText].filter((value) => value.length <= 120 && value.length > 0)) {
    const detected = matchText(text, scope, true);
    if (detected) return detected;
  }
  return undefined;
}
