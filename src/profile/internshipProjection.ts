import { z } from 'zod';
import { experienceSchema, type UserProfile } from './schema';
import { checkDateRange, profileDateSchema } from './calendarDates';
import { endDateFactSchema } from './facts';

export const internshipProjectionRequestSchema = z.object({ type: z.literal('RA_PROFILE_INTERNSHIP') }).strict();

const text = z.string().max(20_000).optional();
/** Explicit allowlist: Experience also contains third-party proof/contact fields. */
export const internshipProjectionEntrySchema = z.object({
  id: z.string().min(1).max(200), organization: text, department: text, role: text,
  startDate: profileDateSchema, endDate: profileDateSchema, endDateFact: endDateFactSchema.optional(),
  description: text, achievements: text, experienceType: text, workType: text, companyProperty: text,
  monthlySalary: text, hasProof: z.enum(['', '是', '否']).optional(),
}).strict().superRefine(checkDateRange);
export type InternshipProjectionEntry = z.infer<typeof internshipProjectionEntrySchema>;
export const internshipProjectionResponseSchema = z.object({ recordType: z.literal('internship'),
  profileRevision: z.string().min(1).max(100), internships: z.array(internshipProjectionEntrySchema).max(100),
}).strict().superRefine((data, context) => {
  if (new Set(data.internships.map(entry => entry.id)).size !== data.internships.length)
    context.addIssue({ code: 'custom', path: ['internships'], message: '实习记录 ID 必须唯一' });
});
export interface InternshipProjectionResponse {
  readonly recordType: 'internship'; readonly profileRevision: string;
  readonly internships: readonly InternshipProjectionEntry[];
}
/** Internal snapshot only. No runtime message or page/model authority is issued here. */
export function internshipProfile(profile: UserProfile): InternshipProjectionResponse {
  const source = z.array(experienceSchema).max(100).parse(profile.internships);
  const keys = Object.keys(internshipProjectionEntrySchema.shape);
  const data = internshipProjectionResponseSchema.parse({ recordType: 'internship',
    profileRevision: profile.revision ?? profile.updatedAt ?? 'profile-without-updated-at',
    internships: source.map(entry => Object.fromEntries(Object.entries(entry).filter(([key]) => keys.includes(key)))),
  });
  return Object.freeze({ ...data, internships: Object.freeze(data.internships.map(entry => Object.freeze({ ...entry,
    ...(entry.endDateFact ? { endDateFact: Object.freeze({ ...entry.endDateFact }) } : {}),
  }))) });
}
