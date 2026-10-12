import { z } from 'zod';
import { semanticRequestSchema } from './semanticProtocol';
import { projectSemanticReplySchema, PROJECT_SEMANTIC_DEADLINE_MS } from './projectPortProtocol';
export const AWARD_SEMANTIC_PORT = 'recruitment-award-semantic-v4';
export const AWARD_SEMANTIC_DEADLINE_MS = PROJECT_SEMANTIC_DEADLINE_MS;
export const awardSemanticRequestSchema = z.object({ type: z.literal('RA_AWARD_SEMANTIC'),
  request: semanticRequestSchema.refine(request => request.protocol === 4
    && request.fields.every(field => field.section === 'award' && field.record === 'creating'), '只能识别当前奖励编辑器') }).strict();
export const awardSemanticReplySchema = projectSemanticReplySchema;
