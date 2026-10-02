import { projectProjectionRequestSchema, projectProjectionResponseSchema,
  type ProjectProjectionResponse } from '../profile/projection';
import { educationProjectionRequestSchema, educationProjectionResponseSchema,
  type EducationProjectionResponse } from '../profile/educationProjection';

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
