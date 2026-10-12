import { z } from 'zod';
import { semanticRequestSchema } from './semanticProtocol';
import { projectSemanticReplySchema, PROJECT_SEMANTIC_DEADLINE_MS } from './projectPortProtocol';
export const STUDENT_WORK_SEMANTIC_PORT = 'recruitment-student-work-semantic-v6';
export const STUDENT_WORK_SEMANTIC_DEADLINE_MS = PROJECT_SEMANTIC_DEADLINE_MS;
export const studentWorkSemanticRequestSchema = z.object({ type: z.literal('RA_STUDENT_WORK_SEMANTIC'),
  request: semanticRequestSchema.refine(request => request.protocol === 6
    && request.fields.every(field => field.section === 'student-work' && field.record === 'creating'), '只能识别当前校内职务编辑器') }).strict();
export const studentWorkSemanticReplySchema = projectSemanticReplySchema;
