import { z } from 'zod';
import type { PageSemanticGraph } from './semanticGraph';

export const PAGE_OPERATION_PORT = 'recruitment.page-operation.v1';
export const PAGE_OPERATION_DEADLINE_MS = 30_000;
export const fillRequestSchema = z.object({
  scanId: z.string().min(1).max(100),
  items: z.array(z.object({ fieldId: z.string().min(1).max(150), value: z.string().max(50_000), confirmed: z.boolean() }).strict()).max(500),
}).strict();
export const pageOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RA_FILL'), payload: fillRequestSchema }).strict(),
  z.object({ type: z.literal('RA_SCAN_SETTLED') }).strict(),
]);
export type PageOperation = z.infer<typeof pageOperationSchema>;
export const fillReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.array(z.object({ fieldId: z.string().min(1).max(150),
    status: z.enum(['filled', 'skipped', 'error']), reason: z.string().max(2000) }).strict()).max(500) }).strict(),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(2000) }).strict(),
]);
const fieldSchema = z.object({
  id: z.string().min(1).max(150), kind: z.enum(['input', 'textarea', 'select', 'radio', 'checkbox']),
  type: z.string(), label: z.string(), placeholder: z.string(), name: z.string(), htmlId: z.string(), ariaLabel: z.string(),
  title: z.string(), parentText: z.string(), previousText: z.string(), tableHeader: z.string(), sectionText: z.string(),
  groupId: z.string().optional(), options: z.array(z.object({ value: z.string(), label: z.string(), disabled: z.boolean() }).strict()).max(5000),
  maxLength: z.number().int().nullable(), required: z.boolean(), hasValue: z.boolean(), disabled: z.boolean(), readOnly: z.boolean(),
  blockedReason: z.string().optional(),
}).strict();
export const scanReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.object({ contentVersion: z.string().optional(), scanId: z.string().min(1).max(100),
    url: z.string(), title: z.string(), fields: z.array(fieldSchema).max(500), warnings: z.array(z.string()).max(100),
    semanticGraph: z.custom<PageSemanticGraph>().optional(),
  }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(2000) }).strict(),
]);
