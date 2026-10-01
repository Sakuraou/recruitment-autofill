import { z } from 'zod';

export const collectionKeys = ['projects', 'internships', 'studentWork', 'awards', 'papers', 'patents', 'certificates', 'computerSkills'] as const;
export type CollectionKey = typeof collectionKeys[number];
export const collectionFactSchema = z.object({
  state: z.enum(['unknown', 'known', 'none', 'not_applicable']),
  source: z.enum(['user', 'import', 'document', 'legacy']),
  confirmed: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
}).strict();
export const collectionFactsSchema = z.object({
  projects: collectionFactSchema.optional(), internships: collectionFactSchema.optional(),
  studentWork: collectionFactSchema.optional(), awards: collectionFactSchema.optional(),
  papers: collectionFactSchema.optional(), patents: collectionFactSchema.optional(),
  certificates: collectionFactSchema.optional(), computerSkills: collectionFactSchema.optional(),
}).strict();
type FactRecord = { name?: string; title?: string; organization?: string; role?: string };
interface PresenceProfile {
  projects: readonly FactRecord[]; internships: readonly FactRecord[]; studentWork: readonly FactRecord[];
  awards: readonly FactRecord[]; certificates: readonly FactRecord[];
  research: { papers: readonly FactRecord[]; patents: readonly FactRecord[] };
  skills: { programmingLanguages: readonly string[]; frameworks: readonly string[]; tools: readonly string[]; other: readonly string[] };
  collectionFacts?: z.infer<typeof collectionFactsSchema>;
}
function entries(profile: PresenceProfile, key: CollectionKey): readonly (FactRecord | string)[] {
  if (key === 'computerSkills') return Object.values(profile.skills).flat();
  if (key === 'papers' || key === 'patents') return profile.research[key];
  return profile[key];
}
export function collectionPresence(profile: PresenceProfile, key: CollectionKey): 'known' | 'none' | 'unknown' | 'not_applicable' {
  const fact = profile.collectionFacts?.[key];
  // A blank editor draft has an ID, but does not prove an experience exists.
  const evidence = entries(profile, key).some(entry => typeof entry === 'string' ? !!entry.trim()
    : [entry.name, entry.title, entry.organization, entry.role].some(value => !!value?.trim()));
  if (evidence) return 'known';
  if (!fact?.confirmed || fact.source === 'legacy') return 'unknown';
  return fact.state;
}
export function collectionFactConflicts(profile: PresenceProfile): CollectionKey[] {
  return collectionKeys.filter(key => {
    const state = profile.collectionFacts?.[key]?.state;
    return (state === 'none' || state === 'not_applicable') && entries(profile, key).some(entry =>
      typeof entry === 'string' ? !!entry.trim() : true);
  });
}
