import { z } from 'zod';
import type { EndDateRecord } from './facts';

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** A month remains a range, never a guessed day. Years 0001–9999 are supported. */
export function calendarDateBounds(value: string): Readonly<{ earliest: string; latest: string }> | undefined {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/u.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]); const month = Number(match[2]); const day = match[3] === undefined ? undefined : Number(match[3]);
  if (year === 0 || (day !== undefined && day > daysInMonth(year, month))) return undefined;
  return Object.freeze(match[3] ? { earliest: value, latest: value }
    : { earliest: `${value}-01`, latest: `${value}-${daysInMonth(year, month)}` });
}

export const profileDateSchema = z.string().max(10).refine(value => value === '' || Boolean(calendarDateBounds(value)),
  '日期须为有效公历日期，使用 YYYY-MM 或 YYYY-MM-DD，不能补造具体日').optional();

export function dateRangePossible(start?: string, end?: string): boolean {
  if (start && !calendarDateBounds(start) || end && !calendarDateBounds(end)) return false;
  if (!start || !end) return true;
  return calendarDateBounds(start)!.earliest <= calendarDateBounds(end)!.latest;
}

export function checkDateRange(record: EndDateRecord & { startDate?: string }, context: z.RefinementCtx): void {
  const state = record.endDateFact?.state;
  if (state === 'known' && !record.endDate?.trim()) context.addIssue({ code: 'custom', path: ['endDate'], message: '明确结束日期须填写实际日期；不能推算今天。' });
  if (state && ['ongoing', 'none', 'not_applicable'].includes(state) && record.endDate?.trim()) context.addIssue({ code: 'custom', path: ['endDate'],
    message: '结束时间状态与已填写日期冲突，请核对；已有日期不会被删除。' });
  // Single-field validators report invalid dates; this check only adds range errors.
  if (!record.startDate || !record.endDate || !calendarDateBounds(record.startDate) || !calendarDateBounds(record.endDate)) return;
  if (!dateRangePossible(record.startDate, record.endDate)) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: '结束时间不能早于开始时间；月份精度不会自动补成具体日' });
  }
}
