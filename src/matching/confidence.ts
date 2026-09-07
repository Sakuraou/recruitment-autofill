import type { MatchResult, MatchSource } from '../shared/types';

export const AUTO_CONFIDENCE = 0.9;

export function candidateStatus(confidence: number, source: MatchSource): MatchResult['status'] {
  return confidence >= AUTO_CONFIDENCE && source !== 'llm' ? 'auto' : 'review';
}

export function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

export function containsAlias(text: string, alias: string): boolean {
  const normalized = normalize(text);
  const target = normalize(alias);
  if (normalized === target) return true;
  // English fragments must be whole words: "name" must not match "username".
  if (/^[a-z\s-]+$/i.test(alias)) {
    const words = text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
    const escaped = alias.toLowerCase().replace(/[-\s]+/g, '\\s*');
    return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`).test(words);
  }
  return target.length >= 2 && normalized.includes(target);
}
