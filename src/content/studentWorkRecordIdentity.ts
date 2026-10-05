import { studentWorkProjectionEntrySchema, type StudentWorkProjectionEntry } from '../profile/studentWorkProjection';
import { calendarDateBounds } from '../profile/calendarDates';
import { endDateState, ongoingCaption } from '../profile/facts';
import type { RecordIdentitySignal, RecordIdentityVerdict } from '../planner/recordPlanner';
import { hiddenReason } from './domUtils';
import { recordSummaryText } from './recordSummaryText';
export interface StudentWorkIdentityResult {
  readonly verdict: RecordIdentityVerdict; readonly signals: readonly RecordIdentitySignal[]; readonly provenance: 'rule';
}
type Key = 'organization' | 'role' | 'startDate' | 'endDate';
type Evidence = Partial<Record<Key, string>> & { bad?: boolean };
const normalize = (value?: string): string => (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
function complete(value?: string): value is string {
  const text = normalize(value);
  return Boolean(text && text.length <= 20_000 && !/…|\.{3}|请选择|尚未确认/iu.test(text)
    && !/^(?:未知|暂无|无|否|未填写|未确认|待补充|待填写|不适用|unknown|n\/a|none|null|-+)$/iu.test(text));
}
function date(value?: string): string | undefined {
  const match = /^(\d{4})[-/.](\d{2})[-/.](\d{2})$/u.exec(normalize(value));
  if (!match) return undefined;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  return calendarDateBounds(day) ? day : undefined;
}
const labels: Readonly<Record<Key, RegExp>> = {
  organization: /^(?:组织团体名称|组织名称|organization)$/iu,
  role: /^(?:担任职务|职务名称|role|position)$/iu,
  startDate: /^(?:开始日期|开始时间|起始日期|start\s*date)$/iu,
  endDate: /^(?:结束日期|结束时间|end\s*date)$/iu,
};
/** A term is identity evidence only with full calendar days or an explicit ongoing caption. */
function ready(observed: Evidence): boolean {
  const start = date(observed.startDate); const end = date(observed.endDate);
  return Boolean(!observed.bad && complete(observed.organization) && complete(observed.role) && start
    && (end && start <= end || ongoingCaption(observed.endDate ?? '')));
}
/** Private bounded snapshot, excluding editable, nested, clipped and hidden summaries. */
function evidence(card: Element | undefined): Evidence {
  if (!card?.isConnected || hiddenReason(card)) return {};
  if (card.querySelectorAll('*').length > 1000) return { bad: true };
  const values: Record<Key, string[]> = { organization: [], role: [], startDate: [], endDate: [] };
  let bad = false;
  const add = (caption: string, value: string) => {
    const key = (Object.keys(labels) as Key[]).find(candidate => labels[candidate].test(caption.replace(/[:：]\s*$/u, '').trim()));
    if (!key) return;
    if (!complete(value)) { bad = true; return; }
    values[key].push(normalize(value));
  };
  for (const term of card.querySelectorAll('dt')) {
    const detail = term.nextElementSibling;
    if (detail?.tagName === 'DD') add(recordSummaryText(term, card), recordSummaryText(detail, card));
  }
  for (const row of card.querySelectorAll('tr')) {
    const cells = Array.from(row.children).filter(cell => cell.matches('th,td'));
    if (cells.length === 2) add(recordSummaryText(cells[0]!, card), recordSummaryText(cells[1]!, card));
  }
  for (const paragraph of card.querySelectorAll('p')) {
    const text = recordSummaryText(paragraph, card); const split = text.search(/[:：]/u);
    if (split > 0) add(text.slice(0, split), text.slice(split + 1).trim());
  }
  const result: Evidence = { bad };
  for (const key of Object.keys(values) as Key[]) {
    const distinct = [...new Set(values[key])];
    if (distinct.length === 1) result[key] = distinct[0];
    if (distinct.length > 1) result.bad = true;
  }
  return result;
}
const result = (verdict: RecordIdentityVerdict, signals: RecordIdentitySignal[] = []): StudentWorkIdentityResult =>
  Object.freeze({ verdict, signals: Object.freeze(signals), provenance: 'rule' });
/** Source-only readiness; no card, action, array ordinal or model answer is accepted. */
export function studentWorkIdentityFactsReady(record: StudentWorkProjectionEntry): boolean {
  if (!studentWorkProjectionEntrySchema.safeParse(record).success || !complete(record.organization) || !complete(record.role)) return false;
  const start = date(record.startDate); const state = endDateState(record);
  return Boolean(start && (state === 'ongoing' || state === 'known' && date(record.endDate)));
}
function compare(observed: Evidence, record: StudentWorkProjectionEntry): StudentWorkIdentityResult {
  if (!ready(observed) || !studentWorkIdentityFactsReady(record)) return result('insufficient');
  const start = date(record.startDate); const state = endDateState(record);
  const end = state === 'known' ? date(record.endDate) : undefined;
  const ongoing = state === 'ongoing';
  if (!start || !end && !ongoing) return result('insufficient');
  const actualStart = date(observed.startDate)!; const actualEnd = date(observed.endDate);
  const actualOngoing = ongoingCaption(observed.endDate!);
  if (observed.organization !== normalize(record.organization)) return result('different', ['primary']);
  if (observed.role !== normalize(record.role)) return result('different', ['primary', 'secondary']);
  const signals: RecordIdentitySignal[] = ['primary', 'secondary', 'start-date', 'end-date'];
  if (start === actualStart && (ongoing && actualOngoing || end && end === actualEnd)) return result('same', signals);
  // Changed overlapping intervals may be corrections to one term, not a new record.
  if (end && actualEnd && (end < actualStart || actualEnd < start)) return result('different', signals);
  return result('insufficient', ['primary', 'secondary']);
}
/** Only value-free conclusions leave the reader; no count-based or model-supplied identity. */
export function compareStudentWorkCard(card: Element | undefined, record: StudentWorkProjectionEntry): StudentWorkIdentityResult {
  return compare(evidence(card), record);
}
export function studentWorkCardComparator(card: Element | undefined): Readonly<{ ready: boolean; compare: (record: StudentWorkProjectionEntry) => StudentWorkIdentityResult }> {
  const observed = evidence(card);
  return Object.freeze({ ready: ready(observed), compare: (record: StudentWorkProjectionEntry) => compare(observed, record) });
}
