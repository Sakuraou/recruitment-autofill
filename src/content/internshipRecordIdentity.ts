import { internshipProjectionEntrySchema, type InternshipProjectionEntry } from '../profile/internshipProjection';
import { completeInternshipIdentity as complete, normalizeInternshipIdentity as normalize,
  internshipIdentityDate as date } from '../profile/internshipIdentityFacts';
import { endDateState, ongoingCaption } from '../profile/facts';
import type { RecordIdentitySignal, RecordIdentityVerdict } from '../planner/recordPlanner';
import { hiddenReason } from './domUtils';
import { recordSummaryText } from './recordSummaryText';
import { internshipFillOrder } from '../profile/internshipFillOrder';

export interface InternshipIdentityResult {
  readonly verdict: RecordIdentityVerdict; readonly signals: readonly RecordIdentitySignal[]; readonly provenance: 'rule';
}
type Key = 'organization' | 'role' | 'startDate' | 'endDate';
interface Evidence { organization?: string; heading?: string; role?: string; startDate?: string; endDate?: string; bad?: boolean }
const labels: Readonly<Record<Key, RegExp>> = {
  organization: /^(?:工作单位|实习单位|实习公司|公司名称|单位名称|所在公司|employer|company|organization)$/iu,
  role: /^(?:岗位|职位|职务|实习岗位|实习职位|实习职务|role|position|internship\s*role)$/iu,
  startDate: /^(?:入职日期|入职时间|开始日期|开始时间|起始日期|起始时间|start\s*date|joining\s*date|employment\s*start\s*date)$/iu,
  endDate: /^(?:离职日期|离职时间|结束日期|结束时间|end\s*date|leaving\s*date|employment\s*end\s*date)$/iu,
};
/** Private, bounded summary evidence; input values, editor drafts and other cards are excluded. */
function evidence(card?: Element): Evidence {
  if (!card?.isConnected || hiddenReason(card)) return {};
  if (card.querySelectorAll('dt,tr,p,h1,h2,h3,h4,h5,h6,[role="heading"]').length > 1000) return { bad: true };
  const values: Record<Key, string[]> = { organization: [], role: [], startDate: [], endDate: [] }; let bad = false;
  const add = (caption: string, value: string) => {
    const key = (Object.keys(labels) as Key[]).find(candidate => labels[candidate].test(caption.replace(/[:：]\s*$/u, '').trim()));
    if (!key) return;
    if (!complete(value)) { bad = true; return; }
    values[key].push(value);
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
  const headings = Array.from(card.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
    .map(heading => recordSummaryText(heading, card)).filter(Boolean);
  if (headings.length > 1 || headings.some(text => !complete(text))) bad = true;
  const result: Evidence = { bad, ...(headings.length === 1 ? { heading: headings[0] } : {}) };
  for (const key of Object.keys(values) as Key[]) {
    const distinct = [...new Set(values[key])]; if (distinct.length === 1) result[key] = distinct[0];
    if (distinct.length > 1) result.bad = true;
  }
  return result;
}
/** A heading may be a job title. Only a known company can supply an unlabelled employer. */
function resolveHeading(observed: Evidence, records: readonly InternshipProjectionEntry[]): Evidence {
  const companies = new Set(records.filter(record => complete(record.organization)).map(record => normalize(record.organization)));
  const roles = new Set(records.filter(record => complete(record.role)).map(record => normalize(record.role)));
  if (!observed.heading || !companies.has(observed.heading) || roles.has(observed.heading)) return observed;
  if (observed.organization && observed.organization !== observed.heading) return { ...observed, bad: true };
  return { ...observed, organization: observed.heading };
}
function compare(observed: Evidence, record: InternshipProjectionEntry): InternshipIdentityResult {
  const result = (verdict: RecordIdentityVerdict, signals: RecordIdentitySignal[] = []): InternshipIdentityResult =>
    Object.freeze({ verdict, signals: Object.freeze(signals), provenance: 'rule' });
  if (observed.bad || !internshipProjectionEntrySchema.safeParse(record).success
    || !complete(observed.organization) || !complete(record.organization)) return result('insufficient');
  if (observed.organization !== normalize(record.organization)) return result('different', ['primary']);
  const uncertain = () => result('insufficient', ['primary']);
  const state = endDateState(record); const expectedOngoing = state === 'ongoing';
  const actualOngoing = !!observed.endDate && ongoingCaption(observed.endDate);
  if (expectedOngoing !== actualOngoing && (expectedOngoing || actualOngoing)) return uncertain();
  const start = date(record.startDate); const end = state === 'known' ? date(record.endDate) : undefined;
  const actualStart = date(observed.startDate); const actualEnd = actualOngoing ? undefined : date(observed.endDate);
  if (observed.startDate && (!actualStart || !start) || observed.endDate && !actualOngoing && (!actualEnd || !end)
    || actualStart && actualEnd && actualStart > actualEnd) return uncertain();
  if (observed.role && !complete(record.role)) return uncertain();
  if (observed.role && observed.role !== normalize(record.role)) return result('different', ['primary', 'secondary']);
  const fullRange = start && end && actualStart && actualEnd;
  if (fullRange && (start !== actualStart || end !== actualEnd)) return result('different', ['primary', 'start-date', 'end-date']);
  if (actualStart && actualStart !== start || actualEnd && actualEnd !== end) return uncertain();
  if (fullRange || expectedOngoing && actualOngoing && start && actualStart === start) return result('same', ['primary', 'start-date', 'end-date']);
  if (observed.role) return result('same', ['primary', 'secondary']);
  return uncertain();
}
/** Only value-free conclusions leave this reader. No writes, selectors, model or action capabilities. */
export function compareInternshipCard(card: Element | undefined, record: InternshipProjectionEntry): InternshipIdentityResult {
  const parsed = internshipProjectionEntrySchema.safeParse(record);
  return compare(parsed.success ? resolveHeading(evidence(card), [parsed.data]) : { bad: true }, record);
}
/** Ephemeral evidence for one snapshot; later transaction steps must recapture. */
export function internshipCardComparator(card: Element | undefined, records?: readonly InternshipProjectionEntry[]): Readonly<{ ready: boolean; compare: (record: InternshipProjectionEntry) => InternshipIdentityResult }> {
  const observed = records === undefined ? evidence(card) : internshipFillOrder(records).status === 'ready'
    ? resolveHeading(evidence(card), records) : { bad: true };
  return Object.freeze({ ready: !observed.bad && complete(observed.organization),
    compare: (record: InternshipProjectionEntry) => compare(observed, record) });
}
