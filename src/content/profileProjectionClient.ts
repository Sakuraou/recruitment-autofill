import { projectProjectionRequestSchema, projectProjectionResponseSchema,
  type ProjectProjectionResponse } from '../profile/projection';

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
