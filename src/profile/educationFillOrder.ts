import { educationProjectionEntrySchema, type EducationProjectionEntry } from './educationProjection';

const ranks = { 专科: 1, 本科: 2, 硕士研究生: 3, 博士研究生: 4 } as const;
export type EducationFillOrder = Readonly<{ status: 'ready'; indices: readonly number[] }>
  | Readonly<{ status: 'request-human'; reason: 'education-record-invalid' | 'education-stage-unknown' | 'education-identity-incomplete' }>;
/** Page-local plan only; source order and personal facts stay unchanged. */
export function educationFillOrder(records: readonly EducationProjectionEntry[]): EducationFillOrder {
  const reject = (reason: Extract<EducationFillOrder, { status: 'request-human' }>['reason']): EducationFillOrder => Object.freeze({ status: 'request-human', reason });
  if (records.length > 30 || new Set(records.map(record => record.id)).size !== records.length
    || records.some(record => !educationProjectionEntrySchema.safeParse(record).success)) return reject('education-record-invalid');
  if (records.some(record => record.level === '其他')) return reject('education-stage-unknown');
  if (records.some(record => !record.school?.trim())) return reject('education-identity-incomplete');
  const indices = records.map((_, index) => index).sort((a, b) =>
    ranks[records[a]!.level as keyof typeof ranks] - ranks[records[b]!.level as keyof typeof ranks] || a - b);
  return Object.freeze({ status: 'ready', indices: Object.freeze(indices) });
}
