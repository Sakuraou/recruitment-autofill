import {z} from 'zod';
import {profileSchema,type UserProfile} from './schema';
import {profileDateSchema,checkDateRange} from './calendarDates';
import {collectionFactSchema,collectionPresence,endDateFactSchema} from './facts';
const text=z.string().max(20_000).optional();
export const studentWorkProjectionRequestSchema=z.object({type:z.literal('RA_PROFILE_STUDENT_WORK')}).strict();
export const studentWorkProjectionEntrySchema=z.object({id:z.string().min(1).max(200),organization:text,department:text,role:text,
 startDate:profileDateSchema,endDate:profileDateSchema,endDateFact:endDateFactSchema.optional(),
 description:text,achievements:text,cadreLevel:text,shortDuties:text}).strict().superRefine(checkDateRange);
export type StudentWorkProjectionEntry=z.infer<typeof studentWorkProjectionEntrySchema>;
export const studentWorkProjectionResponseSchema=z.object({recordType:z.literal('student-work'),profileRevision:z.string().min(1).max(100),
 presence:z.enum(['known','none','unknown','not_applicable']),fact:collectionFactSchema.optional(),studentWork:z.array(studentWorkProjectionEntrySchema).max(100),
}).strict().superRefine((value,ctx)=>{
 if(new Set(value.studentWork.map(work=>work.id)).size!==value.studentWork.length)ctx.addIssue({code:'custom',message:'duplicate student work identity'});
 if(['none','not_applicable'].includes(value.presence)&&value.studentWork.length)ctx.addIssue({code:'custom',message:'student work absence conflicts with records'});
});
export type StudentWorkProjectionResponse=Readonly<Omit<z.infer<typeof studentWorkProjectionResponseSchema>,'studentWork'>&{studentWork:readonly Readonly<StudentWorkProjectionEntry>[]} >;
/** Pure isolated snapshot. This issues no runtime message, model data or page authority. */
export function studentWorkProfile(profile:UserProfile):StudentWorkProjectionResponse{
 const source=profileSchema.parse(profile);const allowed=new Set(Object.keys(studentWorkProjectionEntrySchema.shape));
 const data=studentWorkProjectionResponseSchema.parse({recordType:'student-work',profileRevision:source.revision??source.updatedAt??'profile-without-updated-at',
  presence:collectionPresence(source,'studentWork'),...(source.collectionFacts?.studentWork?{fact:source.collectionFacts.studentWork}:{}),
  studentWork:source.studentWork.map(work=>Object.fromEntries(Object.entries(work).filter(([key])=>allowed.has(key))))});
 return Object.freeze({...data,...(data.fact?{fact:Object.freeze({...data.fact})}:{}),studentWork:Object.freeze(data.studentWork.map(work=>Object.freeze({...work,
  ...(work.endDateFact?{endDateFact:Object.freeze({...work.endDateFact})}:{})})))});
}
