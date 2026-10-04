import { projectProjectionEntrySchema, type ProjectProjectionEntry } from '../profile/projection';
import type { RecordIdentitySignal, RecordIdentityVerdict } from '../planner/recordPlanner';
import { hiddenReason } from './domUtils';
import { recordSummaryText } from './recordSummaryText';
import { endDateState, ongoingCaption } from '../profile/facts';
import { calendarDateBounds } from '../profile/calendarDates';

/** Only this value-free result may leave the identity reader. */
export interface ProjectIdentityResult {
  readonly verdict: RecordIdentityVerdict;
  readonly signals: readonly RecordIdentitySignal[];
  readonly provenance: 'rule';
}

interface Evidence { heading?: string; name?: string; description?: string; startDate?: string; endDate?: string; conflict?: boolean }
type EvidenceKey = 'name' | 'description' | 'startDate' | 'endDate';
const labels: Readonly<Record<EvidenceKey, RegExp>> = {
  name: /^(?:项目名称|项目名|project\s*name)$/iu,
  description: /^(?:项目描述|项目简介|项目简述|project\s*(?:description|summary))$/iu,
  startDate: /^(?:开始时间|开始日期|项目开始日期|start\s*date)$/iu,
  endDate: /^(?:结束时间|结束日期|项目结束日期|end\s*date)$/iu,
};
function normalized(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
function complete(value: string | undefined): value is string {
  return Boolean(value?.trim() && value.length <= 20_000 && !/…|\.{3}|请选择|尚未确认/iu.test(value));
}
function date(value: string | undefined): string | undefined {
  const match = /^(\d{4})[-/.](\d{2})[-/.](\d{2})$/u.exec(normalized(value));
  if (!match) return undefined;
  const valueDate = `${match[1]}-${match[2]}-${match[3]}`;
  return calendarDateBounds(valueDate) ? valueDate : undefined;
}

/** Ephemeral page-local evidence; never add these values to graph nodes or logs. */
function evidence(card: Element | undefined): Evidence {
  if (!card?.isConnected || hiddenReason(card)) return {};
  if (card.querySelectorAll('dt,tr,p,h1,h2,h3,h4,h5,h6,[role="heading"]').length > 1000) return { conflict: true };
  const values: Record<EvidenceKey, string[]> = { name: [], description: [], startDate: [], endDate: [] };
  const add = (label: string, value: string): void => {
    const key = (Object.keys(labels) as EvidenceKey[]).find(candidate => labels[candidate].test(label.replace(/[:：]\s*$/u, '').trim()));
    if (key && complete(value)) values[key].push(value);
  };
  for (const term of card.querySelectorAll('dt')) {
    const detail = term.nextElementSibling;
    if (detail?.tagName === 'DD') add(recordSummaryText(term, card), recordSummaryText(detail, card));
  }
  for (const row of card.querySelectorAll('tr')) {
    const cells = Array.from(row.children).filter(cell => cell.matches('th, td'));
    if (cells.length === 2) add(recordSummaryText(cells[0]!, card), recordSummaryText(cells[1]!, card));
  }
  for (const paragraph of card.querySelectorAll('p')) {
    const text = recordSummaryText(paragraph, card);
    const separator = text.search(/[:：]/u);
    if (separator > 0) add(text.slice(0, separator), text.slice(separator + 1).trim());
  }
  const headings = Array.from(card.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))
    .map(heading => recordSummaryText(heading, card)).filter(Boolean);
  const result: Evidence = { conflict: headings.length > 1 || headings.some(text => !complete(text)),
    ...(headings.length === 1 ? { heading: headings[0] } : {}) };
  for (const key of Object.keys(values) as EvidenceKey[]) {
    const distinct = [...new Set(values[key])];
    if (distinct.length === 1) result[key] = distinct[0];
    if (distinct.length > 1) result.conflict = true;
  }
  return result;
}

/** A title may be a role or company. Only a known project name supplies primary evidence. */
function resolveHeading(observed: Evidence, records: readonly ProjectProjectionEntry[]): Evidence {
  const names = new Set(records.filter(record => complete(record.name)).map(record => normalized(record.name)));
  const secondary = new Set(records.flatMap(record => [record.role, record.organization]).filter(complete).map(normalized));
  if (!observed.heading || !names.has(observed.heading) || secondary.has(observed.heading)) return observed;
  if (observed.name && observed.name !== observed.heading) return { ...observed, conflict: true };
  return { ...observed, name: observed.heading };
}
function sourceReady(records: readonly ProjectProjectionEntry[]): boolean {
  return Array.isArray(records) && records.length <= 100
    && Array.from(records).every(record => projectProjectionEntrySchema.safeParse(record).success && complete(record.name))
    && new Set(records.map(record => record.id)).size === records.length;
}
export function projectCardIdentityReady(card: Element | undefined, records?: readonly ProjectProjectionEntry[]): boolean {
  const observed = records === undefined ? evidence(card) : sourceReady(records) ? resolveHeading(evidence(card), records) : { conflict: true };
  return !observed.conflict && complete(observed.name);
}

function compareEvidence(observed: Evidence, project: ProjectProjectionEntry): ProjectIdentityResult {
  const result = (verdict: RecordIdentityVerdict, signals: RecordIdentitySignal[]): ProjectIdentityResult =>
    Object.freeze({ verdict, signals: Object.freeze(signals), provenance: 'rule' });
  if (!projectProjectionEntrySchema.safeParse(project).success) return result('insufficient', []);
  const expectedName = normalized(project.name);
  if (observed.conflict || !complete(observed.name) || !complete(expectedName)) return result('insufficient', []);
  if (observed.name !== expectedName) return result('different', ['primary']);
  const endState = endDateState(project);
  const expectedOngoing = endState === 'ongoing';
  const actualOngoing = !!observed.endDate && ongoingCaption(observed.endDate);
  if (expectedOngoing !== actualOngoing && (expectedOngoing || actualOngoing)) return result('insufficient', ['primary']);
  const start = date(project.startDate); const end = endState === 'known' ? date(project.endDate) : undefined;
  const actualStart = date(observed.startDate); const actualEnd = date(observed.endDate);
  if ((observed.startDate && !actualStart) || (observed.endDate && !actualEnd && !actualOngoing)
    || (actualStart && actualEnd && actualStart > actualEnd)) return result('insufficient', ['primary']);
  const fullRange = start && end && actualStart && actualEnd && start <= end && actualStart <= actualEnd;
  if (fullRange && (start !== actualStart || end !== actualEnd)) return result('different', ['primary', 'start-date', 'end-date']);
  if ((start && actualStart && start !== actualStart) || (end && actualEnd && end !== actualEnd)) return result('insufficient', ['primary']);
  const description = normalized(project.description);
  const descriptionReady = complete(observed.description) && complete(description) && description.length >= 12;
  if (descriptionReady && observed.description !== description) return result('insufficient', ['primary']);
  if (expectedOngoing && actualOngoing && start && actualStart && start === actualStart) return result('same', ['primary', 'start-date', 'end-date']);
  if (fullRange) return result('same', ['primary', 'start-date', 'end-date']);
  if (descriptionReady && observed.description === description) return result('same', ['primary', 'secondary']);
  return result('insufficient', ['primary']);
}

export function compareProjectCard(card: Element | undefined, project: ProjectProjectionEntry): ProjectIdentityResult {
  const parsed = projectProjectionEntrySchema.safeParse(project);
  return compareEvidence(parsed.success ? resolveHeading(evidence(card), [parsed.data]) : { conflict: true }, project);
}

/** Read each card once per snapshot, then compare local projections without exposing text. */
export function projectCardComparator(card: Element | undefined, records?: readonly ProjectProjectionEntry[]): Readonly<{
  ready: boolean; compare: (project: ProjectProjectionEntry) => ProjectIdentityResult;
}> {
  const observed = records === undefined ? evidence(card) : sourceReady(records) ? resolveHeading(evidence(card), records) : { conflict: true };
  return Object.freeze({ ready: !observed.conflict && complete(observed.name),
    compare: (project: ProjectProjectionEntry) => compareEvidence(observed, project) });
}
