import type { UserProfile } from '../profile/schema';
import type { FieldDescriptor, MatchResult } from '../shared/types';
import { matchField } from './ruleMatcher';

const scopes = ['education', 'projects', 'internships', 'studentWork', 'awards', 'certificates'] as const;
export interface RecordCandidate { label: string; match: MatchResult }

/** Only an explicit structural group and unique properties qualify for batch choice. */
export function relatedRecordChoices(fields: FieldDescriptor[], candidates: Map<string, RecordCandidate[]>, fieldId: string, profileKey: string): MatchResult[] {
  const group = fields.find(field => field.id === fieldId)?.groupId;
  const prefix = /^(education|projects|internships|studentWork|awards|certificates)\.\d+\./.exec(profileKey)?.[0];
  if (!group || !prefix || !candidates.get(fieldId)?.some(choice => choice.match.matchedProfileKey === profileKey)) return [];
  const matches = fields.filter(field => field.groupId === group).flatMap(field => {
    const choice = candidates.get(field.id)?.find(item => item.match.matchedProfileKey?.startsWith(prefix));
    return choice ? [choice.match] : [];
  });
  // Repeated properties usually represent several editors, not one record.
  if (new Set(matches.map(match => match.matchedProfileKey)).size !== matches.length) return [];
  return matches.length > 1 ? matches : [];
}

/** Resolve only an otherwise ambiguous record; every choice still requires review. */
export function recordCandidates(field: FieldDescriptor, profile: UserProfile): RecordCandidate[] {
  const original = matchField(field, profile);
  if (original.status !== 'review' || original.value !== undefined) return [];
  const scope = scopes.find(key => original.matchedProfileKey?.startsWith(`${key}.`)
    && !/^\d+\./.test(original.matchedProfileKey.slice(key.length + 1)));
  if (!scope || profile[scope].length < 2) return [];
  return profile[scope].flatMap((entry, index) => {
    const candidate = matchField(field, { ...profile, [scope]: [entry] });
    if (candidate.value === undefined || !['auto', 'review'].includes(candidate.status)
      || !candidate.matchedProfileKey?.startsWith(`${scope}.0.`)) return [];
    const record = entry as Record<string, unknown>;
    const parts = scope === 'education' ? [record.level, record.school, record.major]
      : [record.name ?? record.organization, record.startDate, record.endDate];
    const label = `${index + 1}. ${parts.filter(part => typeof part === 'string' && part).join(' · ') || '未命名经历'}`;
    return [{ label, match: { ...candidate,
      matchedProfileKey: candidate.matchedProfileKey.replace(`${scope}.0.`, `${scope}.${index}.`),
      status: 'review' as const, confidence: Math.min(candidate.confidence, 0.85),
      reason: `已选择“${label}”。${candidate.reason}请核对该字段对应的经历后勾选填写。`,
    } }];
  });
}
