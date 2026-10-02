import { z } from 'zod';
import { semanticProposalSchema, semanticRequestSchema } from './semanticProtocol';

export const PROJECT_SEMANTIC_PORT = 'recruitment-project-semantic-v1';
export const PROJECT_SEMANTIC_DEADLINE_MS = 15_000;
export const projectSemanticRequestSchema = z.object({ type: z.literal('RA_PROJECT_SEMANTIC'),
  request: semanticRequestSchema.refine(request => request.fields.every(field => field.section === 'project' && field.record === 'creating'),
    '只能识别当前项目编辑器') }).strict();
export const projectSemanticReplySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), proposal: semanticProposalSchema }).strict(),
  z.object({ state: z.enum(['disabled', 'rejected', 'unavailable', 'timeout']) }).strict(),
]);
