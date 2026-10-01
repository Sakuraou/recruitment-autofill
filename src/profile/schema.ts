import { z } from 'zod';
import { checkDateRange, profileDateSchema as date } from './calendarDates';
import { collectionFactConflicts, collectionFactsSchema } from './facts';

const text = z.string().max(20000).optional();
const list = z.array(z.string().max(2000)).max(100).default([]);
export const textVariantsSchema = z.object({
  short: text, medium: text, long: text,
  byLimit: z.record(z.string().regex(/^\d{1,4}$/), z.string().max(20000)).default({}),
}).strict();
export type TextVariants = z.infer<typeof textVariantsSchema>;

export const educationSchema = z.object({
  id: z.string().min(1),
  level: z.enum(['专科', '本科', '硕士研究生', '博士研究生', '其他']),
  school: text, college: text, major: text, majorCategory: text,
  degree: text, startDate: date, endDate: date,
  studyMode: text, gpa: text, gpaScale: text, ranking: text,
  researchDirection: text, courses: text,
  educationType: text, schoolProperty: text, country: text, durationYears: text,
}).strict().superRefine(checkDateRange);
export type EducationExperience = z.infer<typeof educationSchema>;

export const projectSchema = z.object({
  id: z.string().min(1), name: text, role: text, startDate: date, endDate: date,
  organization: text,
  description: text, responsibilities: text, achievements: text, technologies: list,
}).strict().superRefine(checkDateRange);
export type ProjectExperience = z.infer<typeof projectSchema>;
export const experienceSchema = z.object({
  id: z.string().min(1), organization: text, department: text, role: text,
  startDate: date, endDate: date, description: text, achievements: text,
  experienceType: text, workType: text, companyProperty: text, monthlySalary: text,
  hasProof: z.enum(['', '是', '否']).optional(),
  certifierName: text, certifierRelation: text, certifierDuty: text, certifierCompany: text, certifierContact: text,
  cadreLevel: text, shortDuties: text,
}).strict().superRefine(checkDateRange);
export type Experience = z.infer<typeof experienceSchema>;
export const paperSchema = z.object({
  id: z.string().min(1), title: text, authors: text, venue: text, date,
  status: text, doi: text, description: text,
  shortTitle: text, abstract: text, authorOrder: text, publicationSituation: text, coauthors: text,
}).strict();
export const patentSchema = z.object({
  id: z.string().min(1), title: text, number: text, status: text, date, inventors: text,
}).strict();
export const awardSchema = z.object({
  id: z.string().min(1), name: text, level: text, issuer: text, date, description: text,
  school: text, category: text, scholarshipLevel: text, shortName: text,
}).strict();
export const certificateSchema = z.object({
  id: z.string().min(1), name: text, issuer: text, date, score: text, number: text,
}).strict();
export const familyMemberSchema = z.object({
  id: z.string().min(1), name: text, relationship: text, birthday: date,
  organization: text, role: text, phone: text, politicalStatus: text,
}).strict();
export const basicSchema = z.object({
  name: text, gender: text, birthday: date, phone: text, email: text,
  idType: text, idNumber: text, nationality: text, ethnicity: text,
  hometown: text, nativePlace: text, sourcePlace: text, householdLocation: text,
  politicalStatus: text, address: text, postalCode: text,
  interests: text,
  studentCadre: z.enum(['', '是', '否']).optional(), studentCadreDescription: text,
}).strict();
export const commonAnswersSchema = z.object({
  selfEvaluation: textVariantsSchema.optional(), personalStrengths: textVariantsSchema.optional(),
  careerPlan: textVariantsSchema.optional(), motivation: textVariantsSchema.optional(),
  jobFit: textVariantsSchema.optional(), researchSummary: textVariantsSchema.optional(),
  projectSummary: textVariantsSchema.optional(),
}).strict();

export const profileSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().optional(),
  basic: basicSchema,
  education: z.array(educationSchema).max(30),
  research: z.object({ researchDirection: text, summary: text,
    papers: z.array(paperSchema).max(100), patents: z.array(patentSchema).max(100),
  }).strict(),
  projects: z.array(projectSchema).max(100),
  internships: z.array(experienceSchema).max(100),
  studentWork: z.array(experienceSchema).max(100),
  awards: z.array(awardSchema).max(100),
  certificates: z.array(certificateSchema).max(100),
  skills: z.object({ programmingLanguages: list, frameworks: list, tools: list, other: list }).strict(),
  commonAnswers: commonAnswersSchema,
  family: z.array(familyMemberSchema).max(30),
  collectionFacts: collectionFactsSchema.optional(),
}).strict().superRefine((profile, context) => {
  for (const key of collectionFactConflicts(profile)) context.addIssue({ code: 'custom', path: ['collectionFacts', key],
    message: '没有或不适用与已录入的资料冲突。请修改状态，已有记录不会被删除。' });
});

export type UserProfile = z.infer<typeof profileSchema>;
export type Paper = z.infer<typeof paperSchema>;
export type Patent = z.infer<typeof patentSchema>;
export type Award = z.infer<typeof awardSchema>;
export type Certificate = z.infer<typeof certificateSchema>;
export type FamilyMember = z.infer<typeof familyMemberSchema>;

export function createEmptyProfile(): UserProfile {
  return profileSchema.parse({ schemaVersion: 1, basic: {}, education: [],
    research: { papers: [], patents: [] }, projects: [], internships: [], studentWork: [],
    awards: [], certificates: [], skills: {}, commonAnswers: {}, family: [],
  });
}

export function parseProfileJson(json: string): UserProfile {
  if (json.length > 2_000_000) throw new Error('档案超过 2 MB，请精简后导入。');
  return profileSchema.parse(JSON.parse(json) as unknown);
}
