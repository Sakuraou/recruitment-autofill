import { z } from 'zod';
import type { ProjectExperience, UserProfile } from './schema';

/** Fixed, payload-free request. The caller cannot choose a profile path or selector. */
export const projectProjectionRequestSchema = z.object({ type: z.literal('RA_PROFILE_PROJECT') }).strict();
export type ProjectProjectionRequest = z.infer<typeof projectProjectionRequestSchema>;

const optionalText = z.string().max(20_000).optional();
export const projectProjectionEntrySchema = z.object({
  id: z.string().min(1).max(200),
  name: optionalText,
  role: optionalText,
  organization: optionalText,
  startDate: optionalText,
  endDate: optionalText,
  description: optionalText,
  responsibilities: optionalText,
  achievements: optionalText,
  technologies: z.array(z.string().max(2_000)).max(100),
}).strict();
export type ProjectProjectionEntry = z.infer<typeof projectProjectionEntrySchema>;

export const projectProjectionResponseSchema = z.object({
  recordType: z.literal('project'),
  profileRevision: z.string().min(1).max(100),
  projects: z.array(projectProjectionEntrySchema).max(100),
}).strict();
export interface ProjectProjectionResponse {
  readonly recordType: 'project';
  readonly profileRevision: string;
  readonly projects: readonly ProjectProjectionEntry[];
}

function projectEntry(project: ProjectExperience): ProjectProjectionEntry {
  return Object.freeze({
    id: project.id,
    ...(project.name === undefined ? {} : { name: project.name }),
    ...(project.role === undefined ? {} : { role: project.role }),
    ...(project.organization === undefined ? {} : { organization: project.organization }),
    ...(project.startDate === undefined ? {} : { startDate: project.startDate }),
    ...(project.endDate === undefined ? {} : { endDate: project.endDate }),
    ...(project.description === undefined ? {} : { description: project.description }),
    ...(project.responsibilities === undefined ? {} : { responsibilities: project.responsibilities }),
    ...(project.achievements === undefined ? {} : { achievements: project.achievements }),
    technologies: [...project.technologies],
  });
}

/** Produces the smallest supported projection; basic identity and unrelated collections are excluded. */
export function projectProfile(profile: UserProfile): ProjectProjectionResponse {
  return Object.freeze({
    recordType: 'project',
    profileRevision: profile.updatedAt ?? 'profile-without-updated-at',
    projects: Object.freeze(profile.projects.map(projectEntry)),
  });
}
