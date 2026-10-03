import { z } from 'zod';
import { internshipProjectionEntrySchema, type InternshipProjectionEntry } from './internshipProjection';
import { internshipIdentityReady } from './internshipIdentityFacts';

export type InternshipFillOrder = Readonly<{ status: 'ready'; indices: readonly number[] }>
  | Readonly<{ status: 'request-human'; reason: 'internship-record-invalid' | 'internship-identity-incomplete' }>;
const recordsSchema = z.array(internshipProjectionEntrySchema).max(100);
/** Plan-local ordinals preserve the original array; IDs and date order are not sorting instructions. */
export function internshipFillOrder(records: readonly InternshipProjectionEntry[]): InternshipFillOrder {
  const reject = (reason: Extract<InternshipFillOrder, { status: 'request-human' }>['reason']): InternshipFillOrder => Object.freeze({ status: 'request-human', reason });
  const parsed = recordsSchema.safeParse(records);
  if (!parsed.success || new Set(parsed.data.map(record => record.id)).size !== parsed.data.length) return reject('internship-record-invalid');
  if (parsed.data.some(record => !internshipIdentityReady(record))) return reject('internship-identity-incomplete');
  return Object.freeze({ status: 'ready', indices: Object.freeze(parsed.data.map((_, index) => index)) });
}
