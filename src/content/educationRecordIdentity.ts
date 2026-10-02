import { educationProjectionEntrySchema, type EducationProjectionEntry } from '../profile/educationProjection';
import type { RecordIdentitySignal, RecordIdentityVerdict } from '../planner/recordPlanner';
import { hiddenReason } from './domUtils';
import { recordSummaryText } from './recordSummaryText';
import { calendarDateBounds } from '../profile/calendarDates';
import { endDateState, ongoingCaption } from '../profile/facts';

export interface EducationIdentityResult {
  readonly verdict: RecordIdentityVerdict; readonly signals: readonly RecordIdentitySignal[]; readonly provenance: 'rule';
}
type Key = 'school' | 'level' | 'major' | 'startDate' | 'endDate';
interface Evidence { school?: string; level?: string; major?: string; startDate?: string; endDate?: string; bad?: boolean }
const labels: Record<Key, RegExp> = {
  school: /^(?:学校|学校名称|院校|院校名称|毕业院校|school|university)$/iu,
  level: /^(?:学历|教育程度|教育阶段|education\s*level|qualification)$/iu,
  major: /^(?:专业|所学专业|专业名称|major|field\s*of\s*study)$/iu,
  startDate: /^(?:入学日期|入学时间|入学年月|开始日期|开始时间|enrollment\s*date|start\s*date)$/iu,
  endDate: /^(?:毕业日期|毕业时间|毕业年月|结束日期|结束时间|graduation\s*date|end\s*date)$/iu,
};
const normalize = (value?: string): string => (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const complete = (value?: string): value is string => Boolean(value?.trim() && value.length <= 20_000 && !/…|\.{3}|请选择|尚未确认|未知|暂无/iu.test(value));
function date(value?: string): string | undefined {
  const match = /^(\d{4})[-/.](\d{2})(?:[-/.](\d{2}))?$/u.exec(normalize(value)); if (!match) return undefined;
  const result = `${match[1]}-${match[2]}${match[3] ? `-${match[3]}` : ''}`;
  return calendarDateBounds(result) ? result : undefined;
}
function level(value: string): EducationProjectionEntry['level'] | undefined {
  const groups: readonly [EducationProjectionEntry['level'], readonly string[]][] = [
    ['专科', ['专科', '大专', 'associate']], ['本科', ['本科', '大学本科', 'bachelor', 'undergraduate']],
    ['硕士研究生', ['硕士研究生', '硕士', 'master']], ['博士研究生', ['博士研究生', '博士', 'doctor', 'doctoral', 'phd']],
  ];
  return groups.find(([, values]) => values.includes(normalize(value).toLowerCase()))?.[0];
}
function evidence(card?: Element): Evidence {
  if (!card?.isConnected || hiddenReason(card)) return {};
  if (card.querySelectorAll('dt,tr,p,h1,h2,h3,h4,h5,h6,[role="heading"]').length > 1000) return { bad: true };
  const values: Record<Key, string[]> = { school: [], level: [], major: [], startDate: [], endDate: [] }; let bad = false;
  const add = (caption: string, text: string) => {
    const key = (Object.keys(labels) as Key[]).find(candidate => labels[candidate].test(caption.replace(/[:：]\s*$/u, '').trim()));
    if (!key) return; if (!complete(text)) { bad = true; return; } values[key].push(text);
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
    const text = recordSummaryText(paragraph, card); const split = text.search(/[:：]/u);
    if (split > 0) add(text.slice(0, split), text.slice(split + 1).trim());
  }
  const headings = Array.from(card.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
    .map(heading => recordSummaryText(heading, card)).filter(complete);
  if (headings.length === 1) values.school.push(headings[0]!);
  if (headings.length > 1) bad = true;
  const result: Evidence = { bad };
  for (const key of Object.keys(values) as Key[]) {
    const distinct = [...new Set(values[key])]; if (distinct.length === 1) result[key] = distinct[0];
    if (distinct.length > 1) result.bad = true;
  }
  return result;
}

function compare(observed: Evidence, record: EducationProjectionEntry): EducationIdentityResult {
  const result = (verdict: RecordIdentityVerdict, signals: RecordIdentitySignal[] = []): EducationIdentityResult => Object.freeze({ verdict, signals: Object.freeze(signals), provenance: 'rule' });
  if (observed.bad || !educationProjectionEntrySchema.safeParse(record).success
    || !complete(observed.school) || !complete(record.school)) return result('insufficient');
  if (observed.school !== normalize(record.school)) return result('different', ['primary']);
  const uncertain = () => result('insufficient', ['primary']);
  const actualLevel = observed.level ? level(observed.level) : undefined;
  if (observed.level && (!actualLevel || record.level === '其他')) return uncertain();
  const expectedState = endDateState(record); const expectedOngoing = expectedState === 'ongoing';
  const actualOngoing = !!observed.endDate && ongoingCaption(observed.endDate);
  if (expectedOngoing !== actualOngoing && (expectedOngoing || actualOngoing)) return uncertain();
  const start = date(record.startDate); const end = expectedState === 'known' ? date(record.endDate) : undefined;
  const actualStart = date(observed.startDate); const actualEnd = actualOngoing ? undefined : date(observed.endDate);
  if (observed.startDate && (!actualStart || !start || actualStart.length !== start.length)
    || observed.endDate && !actualOngoing && (!actualEnd || !end || actualEnd.length !== end.length)
    || actualStart && actualEnd && calendarDateBounds(actualStart)!.earliest > calendarDateBounds(actualEnd)!.latest) return uncertain();
  const fullRange = start && end && actualStart && actualEnd;
  if (fullRange && (start !== actualStart || end !== actualEnd)) return result('different', ['primary', 'start-date', 'end-date']);
  if (actualStart && actualStart !== start || actualEnd && actualEnd !== end) return uncertain();
  if (observed.major && !complete(record.major)) return uncertain();
  if (actualLevel && actualLevel !== record.level || observed.major && observed.major !== normalize(record.major)) return result('different', ['primary', 'secondary']);
  if (fullRange || expectedOngoing && actualOngoing && start && actualStart === start) return result('same', ['primary', 'start-date', 'end-date']);
  if (actualLevel || observed.major) return result('same', ['primary', 'secondary']);
  return uncertain();
}
/** Only value-free conclusions leave this reader; no writes or action capabilities. */
export function compareEducationCard(card: Element | undefined, record: EducationProjectionEntry): EducationIdentityResult {
  return compare(evidence(card), record);
}
/** Ephemeral snapshot reader; the caller must recapture before each transaction step. */
export function educationCardComparator(card: Element | undefined): Readonly<{ ready: boolean; compare: (record: EducationProjectionEntry) => EducationIdentityResult }> {
  const observed = evidence(card); return Object.freeze({ ready: !observed.bad && complete(observed.school), compare: (record: EducationProjectionEntry) => compare(observed, record) });
}
