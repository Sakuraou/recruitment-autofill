import { publicationProjectionEntrySchema, type PublicationProjectionEntry } from '../profile/publicationProjection';
import { calendarDateBounds } from '../profile/calendarDates';
import type { RecordIdentitySignal, RecordIdentityVerdict } from '../planner/recordPlanner';
import { hiddenReason } from './domUtils';
import { recordSummaryText } from './recordSummaryText';

export interface PublicationIdentityResult {
  readonly verdict: RecordIdentityVerdict;
  readonly signals: readonly RecordIdentitySignal[];
  readonly provenance: 'rule';
}
type Key = 'title' | 'doi' | 'venue' | 'date' | 'authorOrder' | 'status';
type Evidence = Partial<Record<Key, string>> & { heading?: string; bad?: boolean };
const labels: Record<Key, RegExp> = {
  title: /^(?:论著名称|论文名称|论文标题|publication\s*title|paper\s*title)$/iu,
  doi: /^doi$/iu,
  venue: /^(?:期刊名称|期刊\/会议名称|发表刊物|venue)$/iu,
  date: /^(?:日期|发表日期|publication\s*date)$/iu,
  authorOrder: /^(?:作者排序|作者排名|author\s*order)$/iu,
  status: /^(?:发表状态|论文状态|成就\s*[/／]\s*等级|publication\s*status)$/iu,
};
const normal = (value?: string) => (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const complete = (value?: string): value is string => Boolean(value?.trim() && value.length <= 20_000 && !/…|\.{3}|请选择|尚未确认/iu.test(value));
function doi(value?: string): string | undefined {
  const id = normal(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '').toLowerCase();
  return id.length <= 512 && /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/u.test(id) ? id : undefined;
}
function date(value?: string): string | undefined {
  const match = /^(\d{4})[-/.](\d{2})[-/.](\d{2})$/u.exec(normal(value));
  if (!match) return undefined;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  return calendarDateBounds(iso) ? iso : undefined;
}
function evidence(card?: Element): Evidence {
  if (!card?.isConnected || hiddenReason(card)) return {};
  if (card.querySelectorAll('dt,tr,p,h1,h2,h3,h4,h5,h6,[role="heading"]').length > 1000) return { bad: true };
  const values: Record<Key, string[]> = { title: [], doi: [], venue: [], date: [], authorOrder: [], status: [] };
  let bad = false;
  const add = (caption: string, value: string) => {
    const key = (Object.keys(labels) as Key[]).find(key => labels[key].test(caption.replace(/[:：]\s*$/u, '').trim()));
    if (!key) return;
    if (!complete(value)) { bad = true; return; }
    values[key].push(normal(value));
  };
  for (const term of card.querySelectorAll('dt')) {
    if (term.nextElementSibling?.tagName === 'DD') add(recordSummaryText(term, card), recordSummaryText(term.nextElementSibling, card));
  }
  for (const row of card.querySelectorAll('tr')) {
    const cells = [...row.children].filter(cell => cell.matches('th,td'));
    if (cells.length === 2) add(recordSummaryText(cells[0]!, card), recordSummaryText(cells[1]!, card));
  }
  for (const paragraph of card.querySelectorAll('p')) {
    const text = recordSummaryText(paragraph, card), separator = text.search(/[:：]/u);
    if (separator > 0) add(text.slice(0, separator), text.slice(separator + 1).trim());
  }
  const headings = [...card.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
    .map(heading => recordSummaryText(heading, card)).filter(Boolean);
  const result: Evidence = { bad: bad || headings.length > 1 || headings.some(text => !complete(text)),
    ...(headings.length === 1 ? { heading: headings[0] } : {}) };
  for (const key of Object.keys(values) as Key[]) {
    const distinct = [...new Set(values[key])];
    if (distinct.length === 1) result[key] = distinct[0];
    if (distinct.length > 1) result.bad = true;
  }
  return result;
}
function validSource(paper: PublicationProjectionEntry): boolean {
  return publicationProjectionEntrySchema.safeParse(paper).success && complete(paper.title)
    && (!paper.doi?.trim() || Boolean(doi(paper.doi)));
}
export function publicationIdentityFactsReady(paper: PublicationProjectionEntry): boolean {
  return validSource(paper) && (Boolean(doi(paper.doi)) || Boolean(date(paper.date) && complete(paper.venue) && complete(paper.authorOrder)));
}
function resolveHeading(observed: Evidence, papers: readonly PublicationProjectionEntry[]): Evidence {
  const titles = new Set(papers.map(paper => normal(paper.title)));
  const otherValues = new Set(papers.flatMap(paper => [paper.venue, paper.status, paper.authorOrder]).filter(complete).map(normal));
  if (!observed.heading || !titles.has(observed.heading) || otherValues.has(observed.heading)) return observed;
  return observed.title && observed.title !== observed.heading ? { ...observed, bad: true } : { ...observed, title: observed.heading };
}
function compare(observed: Evidence, paper: PublicationProjectionEntry): PublicationIdentityResult {
  const result = (verdict: RecordIdentityVerdict, signals: RecordIdentitySignal[]): PublicationIdentityResult =>
    Object.freeze({ verdict, signals: Object.freeze(signals), provenance: 'rule' });
  if (!validSource(paper) || observed.bad || !complete(observed.title)) return result('insufficient', []);
  if (observed.title !== normal(paper.title)) return result('different', ['primary']);
  const actualDoi = doi(observed.doi), expectedDoi = doi(paper.doi);
  const actualDate = date(observed.date), expectedDate = date(paper.date);
  if (observed.doi && !actualDoi || observed.date && !actualDate) return result('insufficient', ['primary']);
  if (actualDoi && expectedDoi && actualDoi !== expectedDoi) return result('different', ['primary', 'secondary']);
  if (complete(observed.authorOrder) && complete(paper.authorOrder) && observed.authorOrder !== normal(paper.authorOrder))
    return result('insufficient', ['primary']);
  if (complete(observed.status) && complete(paper.status) && observed.status !== normal(paper.status))
    return result('insufficient', ['primary']);
  const venueConflict = complete(observed.venue) && complete(paper.venue) && observed.venue !== normal(paper.venue);
  const dateConflict = Boolean(actualDate && paper.date && actualDate !== expectedDate);
  if (actualDoi && expectedDoi) return venueConflict || dateConflict ? result('insufficient', ['primary']) : result('same', ['primary', 'secondary']);
  if (venueConflict) return actualDate && expectedDate && complete(observed.authorOrder) && complete(paper.authorOrder)
    ? result('different', ['primary', 'start-date', 'secondary']) : result('insufficient', ['primary']);
  if (actualDate && expectedDate && actualDate !== expectedDate) return result('different', ['primary', 'start-date']);
  return actualDate && expectedDate && complete(observed.venue) && complete(paper.venue)
    && complete(observed.authorOrder) && complete(paper.authorOrder)
    ? result('same', ['primary', 'start-date', 'secondary']) : result('insufficient', ['primary']);
}
/** Visible card evidence stays private. A comparison snapshot grants no browser action authority. */
export function publicationCardComparator(card: Element | undefined, papers: readonly PublicationProjectionEntry[]):
Readonly<{ ready: boolean; compare: (paper: PublicationProjectionEntry) => PublicationIdentityResult }> {
  const sourceReady = Array.isArray(papers) && papers.length <= 100 && new Set(papers.map(paper => paper.id)).size === papers.length && papers.every(validSource);
  const observed = sourceReady ? resolveHeading(evidence(card), papers) : { bad: true };
  return Object.freeze({ ready: !observed.bad && complete(observed.title), compare: (paper: PublicationProjectionEntry) => compare(observed, paper) });
}
