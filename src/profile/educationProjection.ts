import { z } from 'zod';
import { educationSchema, type UserProfile } from './schema';

/** Internal education-only data contract; no runtime message or model authority. */
export const educationProjectionEntrySchema = educationSchema.safeExtend({ id: z.string().min(1).max(200) });
export type EducationProjectionEntry = z.infer<typeof educationProjectionEntrySchema>;
export const educationProjectionResponseSchema = z.object({
  recordType: z.literal('education'), profileRevision: z.string().min(1).max(100),
  education: z.array(educationProjectionEntrySchema).max(30),
}).strict().superRefine((value, context) => {
  if (new Set(value.education.map(entry => entry.id)).size !== value.education.length)
    context.addIssue({ code: 'custom', path: ['education'], message: '教育记录 ID 必须唯一' });
});
export interface EducationProjectionResponse {
  readonly recordType: 'education'; readonly profileRevision: string;
  readonly education: readonly EducationProjectionEntry[];
}
/** Snapshot all original records in source order; never substitute the highest record. */
export function educationProfile(profile: UserProfile): EducationProjectionResponse {
  const data = educationProjectionResponseSchema.parse({ recordType: 'education',
    profileRevision: profile.revision ?? profile.updatedAt ?? 'profile-without-updated-at', education: profile.education });
  return Object.freeze({ ...data, education: Object.freeze(data.education.map(entry => Object.freeze({ ...entry,
    ...(entry.endDateFact ? { endDateFact: Object.freeze({ ...entry.endDateFact }) } : {}),
  }))) });
}
