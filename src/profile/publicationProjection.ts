import {z} from 'zod';
import {profileDateSchema} from './calendarDates';
import {collectionFactSchema,collectionPresence} from './facts';
import {profileSchema,type UserProfile} from './schema';
const text=z.string().max(20_000).optional();
export const publicationProjectionRequestSchema=z.object({type:z.literal('RA_PROFILE_PUBLICATIONS')}).strict();
export const publicationProjectionEntrySchema=z.object({id:z.string().min(1).max(200),title:text,shortTitle:text,
 authors:text,venue:text,date:profileDateSchema,status:text,doi:text,description:text,abstract:text,
 authorOrder:text,publicationSituation:text,coauthors:text}).strict();
export type PublicationProjectionEntry=z.infer<typeof publicationProjectionEntrySchema>;
export const publicationProjectionResponseSchema=z.object({recordType:z.literal('publication'),profileRevision:z.string().min(1).max(100),
 presence:z.enum(['known','none','unknown','not_applicable']),fact:collectionFactSchema.optional(),
 publications:z.array(publicationProjectionEntrySchema).max(100)}).strict().superRefine((value,ctx)=>{
 if(new Set(value.publications.map(paper=>paper.id)).size!==value.publications.length)ctx.addIssue({code:'custom',message:'duplicate publication identity'});
 if(['none','not_applicable'].includes(value.presence)&&value.publications.length)ctx.addIssue({code:'custom',message:'publication absence conflicts with records'});
});
export type PublicationProjectionResponse=Readonly<Omit<z.infer<typeof publicationProjectionResponseSchema>,'publications'> & {publications:readonly Readonly<PublicationProjectionEntry>[]} >;
/** Private paper facts only. No runtime entry, model data or page action authority. */
export function publicationProfile(profile:UserProfile):PublicationProjectionResponse{
 const source=profileSchema.parse(profile);const value=publicationProjectionResponseSchema.parse({recordType:'publication',
  profileRevision:source.revision??source.updatedAt??'profile-without-updated-at',presence:collectionPresence(source,'papers'),
  ...(source.collectionFacts?.papers?{fact:source.collectionFacts.papers}:{}),publications:source.research.papers.map(paper=>({...paper}))});
 return Object.freeze({...value,...(value.fact?{fact:Object.freeze({...value.fact})}:{}),publications:Object.freeze(value.publications.map(paper=>Object.freeze({...paper})))});
}
