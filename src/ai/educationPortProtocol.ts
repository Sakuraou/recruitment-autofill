import { z } from 'zod';
import { semanticRequestSchema } from './semanticProtocol';
import { projectSemanticReplySchema, PROJECT_SEMANTIC_DEADLINE_MS } from './projectPortProtocol';

export const EDUCATION_SEMANTIC_PORT = 'recruitment-education-semantic-v2';
export const EDUCATION_SEMANTIC_DEADLINE_MS = PROJECT_SEMANTIC_DEADLINE_MS;
export const educationSemanticRequestSchema = z.object({ type: z.literal('RA_EDUCATION_SEMANTIC'),
  request: semanticRequestSchema.refine(request => request.protocol === 2
    && request.fields.every(field => field.section === 'education' && field.record === 'creating'), '只能识别当前教育编辑器') }).strict();
export const educationSemanticReplySchema = projectSemanticReplySchema;
