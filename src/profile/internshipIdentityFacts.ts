import { internshipProjectionEntrySchema, type InternshipProjectionEntry } from './internshipProjection';
import { calendarDateBounds } from './calendarDates';
import { endDateState } from './facts';

export const normalizeInternshipIdentity = (value?: string): string => (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
export function completeInternshipIdentity(value?: string): value is string {
  const text = normalizeInternshipIdentity(value);
  return Boolean(text && text.length <= 20_000 && !/…|\.{3}|请选择|尚未确认/iu.test(text)
    && !/^(?:未知|暂无|无|否|未填写|未确认|不适用|unknown|n\/a|none|null|-+)$/iu.test(text));
}
/** Full calendar days only; source months remain months and never acquire a day. */
export function internshipIdentityDate(value?: string): string | undefined {
  const match = /^(\d{4})[-/.](\d{2})[-/.](\d{2})$/u.exec(normalizeInternshipIdentity(value));
  if (!match) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return calendarDateBounds(date) ? date : undefined;
}
/** Source-side readiness for a later transaction, with no page or model authority. */
export function internshipIdentityReady(record: InternshipProjectionEntry): boolean {
  if (!internshipProjectionEntrySchema.safeParse(record).success || !completeInternshipIdentity(record.organization)) return false;
  if (completeInternshipIdentity(record.role)) return true;
  const start = internshipIdentityDate(record.startDate); const state = endDateState(record);
  return Boolean(start && (state === 'ongoing' || state === 'known' && internshipIdentityDate(record.endDate)));
}
