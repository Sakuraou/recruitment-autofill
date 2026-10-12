import { z } from 'zod';
import { semanticRequestSchema } from './semanticProtocol';
import { projectSemanticReplySchema, PROJECT_SEMANTIC_DEADLINE_MS } from './projectPortProtocol';
export const PUBLICATION_SEMANTIC_PORT = 'recruitment-publication-semantic-v5';
export const PUBLICATION_SEMANTIC_DEADLINE_MS = PROJECT_SEMANTIC_DEADLINE_MS;
export const publicationSemanticRequestSchema = z.object({ type: z.literal('RA_PUBLICATION_SEMANTIC'),
  request: semanticRequestSchema.refine(request => request.protocol === 5
    && request.fields.every(field => field.section === 'publication' && field.record === 'creating'), '只能识别当前论文编辑器') }).strict();
export const publicationSemanticReplySchema = projectSemanticReplySchema;
