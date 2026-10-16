import { z } from 'zod';
import { scanReplySchema } from './pageOperationProtocol';

export const VISUAL_LOCATION_PORT = 'recruitment.visual-location.v1';
export const VISUAL_LOCATION_DEADLINE_MS = 6000;
const scanId = z.string().min(1).max(100), fieldId = z.string().min(1).max(150);
export const visualLocationRequestSchema = z.object({ type: z.literal('locate'), scanId, fieldId }).strict();
export const visualLocationReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(false), error: z.string().min(1).max(200) }).strict(),
  z.object({ ok: z.literal(true), scanId, originalFieldId: fieldId, result: z.discriminatedUnion('state', [
    z.object({ state: z.literal('manual'), reason: z.enum(['busy', 'stale', 'scope', 'layout', 'existing-candidates', 'budget', 'cancelled']) }).strict(),
    z.object({ state: z.literal('located'), moved: z.boolean(), fieldId, scan: scanReplySchema.options[0].shape.data }).strict(),
  ]) }).strict(),
]);
export type VisualLocationResult = Extract<z.infer<typeof visualLocationReplySchema>, { ok: true }>['result'];
