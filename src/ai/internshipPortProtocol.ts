import { z } from 'zod';
import { semanticRequestSchema } from './semanticProtocol';
import { projectSemanticReplySchema, PROJECT_SEMANTIC_DEADLINE_MS } from './projectPortProtocol';

export const INTERNSHIP_SEMANTIC_PORT = 'recruitment-internship-semantic-v3';
export const INTERNSHIP_SEMANTIC_DEADLINE_MS = PROJECT_SEMANTIC_DEADLINE_MS;
export const internshipSemanticRequestSchema = z.object({ type: z.literal('RA_INTERNSHIP_SEMANTIC'),
  request: semanticRequestSchema.refine(request => request.protocol === 3
    && request.fields.every(field => field.section === 'internship' && field.record === 'creating'), '只能识别当前实习编辑器') }).strict();
export const internshipSemanticReplySchema = projectSemanticReplySchema;
