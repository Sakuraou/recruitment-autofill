import { projectProjectionRequestSchema, projectProjectionResponseSchema,
  type ProjectProjectionResponse } from '../profile/projection';
import { educationProjectionRequestSchema, educationProjectionResponseSchema,
  type EducationProjectionResponse } from '../profile/educationProjection';
import { internshipProjectionRequestSchema, internshipProjectionResponseSchema,
  type InternshipProjectionResponse } from '../profile/internshipProjection';
import { awardProjectionRequestSchema, awardProjectionResponseSchema,
  type AwardProjectionResponse } from '../profile/awardProjection';
import { publicationProjectionRequestSchema, publicationProjectionResponseSchema,
  type PublicationProjectionResponse } from '../profile/publicationProjection';

/** Fixed paper-only request. No profile path, record index, applicant facts or page selector. */
export async function requestPublicationProjection(): Promise<PublicationProjectionResponse> {
  const response = await chrome.runtime.sendMessage(publicationProjectionRequestSchema.parse({ type: 'RA_PROFILE_PUBLICATIONS' })) as unknown;
  if (!response || typeof response !== 'object' || (response as { ok?: unknown }).ok !== true) throw new Error('无法读取论文档案投影');
  const parsed = publicationProjectionResponseSchema.safeParse((response as { data?: unknown }).data);
  if (!parsed.success) throw new Error('论文档案投影格式无效');
  return Object.freeze({ ...parsed.data, ...(parsed.data.fact ? { fact: Object.freeze({ ...parsed.data.fact }) } : {}),
    publications: Object.freeze(parsed.data.publications.map(paper => Object.freeze({ ...paper }))) });
}

/** Fixed award-only facts and explicit cadre fields. Caller cannot name a record, profile path or selector. */
export async function requestAwardProjection(): Promise<AwardProjectionResponse> {
  const response = await chrome.runtime.sendMessage(awardProjectionRequestSchema.parse({type:'RA_PROFILE_AWARDS'})) as unknown;
  if (!response || typeof response !== 'object' || (response as {ok?:unknown}).ok !== true) throw new Error('无法读取奖励档案投影');
  const parsed=awardProjectionResponseSchema.safeParse((response as {data?:unknown}).data);
  if (!parsed.success) throw new Error('奖励档案投影格式无效');
  return Object.freeze({...parsed.data, ...(parsed.data.fact?{fact:Object.freeze({...parsed.data.fact})}:{}),
    ...(parsed.data.applicant?{applicant:Object.freeze({...parsed.data.applicant})}:{}),
    awards:Object.freeze(parsed.data.awards.map(award=>Object.freeze({...award})))});
}

/** Fixed current-page request. No profile values, record index or page selector is accepted. */
export async function requestInternshipProjection(): Promise<InternshipProjectionResponse> {
  const request = internshipProjectionRequestSchema.parse({ type: 'RA_PROFILE_INTERNSHIP' });
  const response = await chrome.runtime.sendMessage(request) as unknown;
  if (!response || typeof response !== 'object' || (response as { ok?: unknown }).ok !== true)
    throw new Error('无法读取实习档案投影');
  const parsed = internshipProjectionResponseSchema.safeParse((response as { data?: unknown }).data);
  if (!parsed.success) throw new Error('实习档案投影格式无效');
  return Object.freeze({ ...parsed.data, internships: Object.freeze(parsed.data.internships.map(record => Object.freeze({ ...record,
    ...(record.endDateFact ? { endDateFact: Object.freeze({ ...record.endDateFact }) } : {}),
  }))) });
}

/** Requests only the fixed project projection; no caller-provided path or selector is accepted. */
export async function requestProjectProjection(): Promise<ProjectProjectionResponse> {
  const request = projectProjectionRequestSchema.parse({ type: 'RA_PROFILE_PROJECT' });
  const response = await chrome.runtime.sendMessage(request) as unknown;
  if (!response || typeof response !== 'object' || (response as { ok?: unknown }).ok !== true) {
    throw new Error('无法读取项目档案投影');
  }
  const parsed = projectProjectionResponseSchema.safeParse((response as { data?: unknown }).data);
  if (!parsed.success || parsed.data.recordType !== 'project') throw new Error('项目档案投影格式无效');
  const ids = parsed.data.projects.map(project => project.id);
  if (new Set(ids).size !== ids.length) throw new Error('项目档案投影包含重复记录');
  return Object.freeze({ ...parsed.data, projects: Object.freeze(parsed.data.projects.map(project => Object.freeze({ ...project }))) });
}

/** Fixed education-only request; record choice remains inside the page-local session. */
export async function requestEducationProjection(): Promise<EducationProjectionResponse> {
  const request = educationProjectionRequestSchema.parse({ type: 'RA_PROFILE_EDUCATION' });
  const response = await chrome.runtime.sendMessage(request) as unknown;
  if (!response || typeof response !== 'object' || (response as { ok?: unknown }).ok !== true) {
    throw new Error('无法读取教育档案投影');
  }
  const parsed = educationProjectionResponseSchema.safeParse((response as { data?: unknown }).data);
  if (!parsed.success) throw new Error('教育档案投影格式无效');
  return Object.freeze({ ...parsed.data, education: Object.freeze(parsed.data.education.map(record => Object.freeze({ ...record,
    ...(record.endDateFact ? { endDateFact: Object.freeze({ ...record.endDateFact }) } : {}),
  }))) });
}
