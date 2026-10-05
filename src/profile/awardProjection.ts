import { z } from 'zod';
import { profileDateSchema } from './calendarDates';
import { collectionFactSchema, collectionPresence } from './facts';
import { profileSchema, type UserProfile } from './schema';
const text = z.string().max(20_000).optional();
export const awardApplicantFactsSchema = z.object({ studentCadre: z.enum(['', '是', '否']).optional(),
  studentCadreDescription: text }).strict();
export type AwardApplicantFacts = Readonly<z.infer<typeof awardApplicantFactsSchema>>;
export const awardProjectionRequestSchema = z.object({ type: z.literal('RA_PROFILE_AWARDS') }).strict();
export const awardProjectionEntrySchema = z.object({ id: z.string().min(1).max(200), name: text, shortName: text,
  school: text, category: text, level: text, issuer: text, date: profileDateSchema, description: text, scholarshipLevel: text }).strict();
export type AwardProjectionEntry = z.infer<typeof awardProjectionEntrySchema>;
export const awardProjectionResponseSchema = z.object({ recordType: z.literal('award'), profileRevision: z.string().min(1).max(100),
  presence: z.enum(['known','none','unknown','not_applicable']), fact: collectionFactSchema.optional(),
  applicant: awardApplicantFactsSchema.optional(), awards: z.array(awardProjectionEntrySchema).max(100) }).strict().superRefine((value, context) => {
  if (new Set(value.awards.map(award => award.id)).size !== value.awards.length)
    context.addIssue({ code: 'custom', message: 'duplicate award identity' });
  if ((value.presence === 'none' || value.presence === 'not_applicable') && value.awards.length)
    context.addIssue({ code: 'custom', message: 'award presence conflicts with records' });
});
export type AwardProjectionResponse = Readonly<Omit<z.infer<typeof awardProjectionResponseSchema>, 'awards'> & { awards: readonly Readonly<AwardProjectionEntry>[] }>;

/** Private minimum award facts. This projection grants no model or click authority. */
export function awardProfile(profile: UserProfile): AwardProjectionResponse {
  const source = profileSchema.parse(profile);
  const result = awardProjectionResponseSchema.parse({ recordType: 'award',
    profileRevision: source.revision ?? source.updatedAt ?? 'profile-without-updated-at',
    presence: collectionPresence(source, 'awards'), ...(source.collectionFacts?.awards ? { fact: source.collectionFacts.awards } : {}),
    applicant: { ...(source.basic.studentCadre !== undefined ? {studentCadre: source.basic.studentCadre} : {}),
      ...(source.basic.studentCadreDescription !== undefined ? {studentCadreDescription: source.basic.studentCadreDescription} : {}) },
    awards: source.awards.map(award => ({ ...award })),
  });
  return Object.freeze({ ...result, ...(result.fact ? { fact: Object.freeze({ ...result.fact }) } : {}),
    ...(result.applicant ? {applicant:Object.freeze({...result.applicant})} : {}),
    awards: Object.freeze(result.awards.map(award => Object.freeze({ ...award }))) });
}
