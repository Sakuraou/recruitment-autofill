import type { ProjectProjectionEntry } from '../profile/projection';
import type { RecordIdentitySignal, RecordIdentityVerdict } from '../planner/recordPlanner';
import { hiddenReason } from './domUtils';

/** Only this value-free result may leave the identity reader. */
export interface ProjectIdentityResult {
  readonly verdict: RecordIdentityVerdict;
  readonly signals: readonly RecordIdentitySignal[];
  readonly provenance: 'rule';
}

interface Evidence { name?: string; description?: string; startDate?: string; endDate?: string; conflict?: boolean }
type EvidenceKey = Exclude<keyof Evidence, 'conflict'>;
const excluded = 'input, select, textarea, button, script, style, noscript, [contenteditable], [role="button"], [role="textbox"]';
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
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === `${match[1]}-${match[2]}-${match[3]}`
    ? parsed.toISOString().slice(0, 10) : undefined;
}

/** Read only visible summary text, never control values or hidden alternate cards. */
function summaryText(element: Element, card: Element): string {
  if (!card.isConnected || !card.contains(element) || hiddenReason(element) || element.matches(excluded)
    || element.closest('form, [role="dialog"]')) return '';
  for (let ancestor: Element | null = element; ancestor && ancestor !== card; ancestor = ancestor.parentElement) {
    if (ancestor.matches('article, [role="listitem"], form, [role="dialog"]')) return '';
  }
  let count = 0;
  let text = '';
  const walk = (node: Node): void => {
    if (++count > 1_000 || text.length > 20_000) return;
    if (node.nodeType === 3) { text += node.textContent ?? ''; return; }
    if (node.nodeType !== 1) return;
    const child = node as Element;
    const style = child.ownerDocument.defaultView?.getComputedStyle(child);
    if (child.matches(excluded) || hiddenReason(child)
      || style?.textOverflow === 'ellipsis' || Number(style?.getPropertyValue('-webkit-line-clamp')) > 0
      || (child !== card && child.matches('article, [role="listitem"], form, [role="dialog"]'))) return;
    for (const nested of child.childNodes) walk(nested);
    text += ' ';
  };
  walk(element);
  return count > 1_000 || text.length > 20_000 ? '' : normalized(text);
}

/** Ephemeral page-local evidence; never add these values to graph nodes or logs. */
function evidence(card: Element | undefined): Evidence {
  if (!card?.isConnected || hiddenReason(card)) return {};
  const values: Record<EvidenceKey, string[]> = { name: [], description: [], startDate: [], endDate: [] };
  const add = (label: string, value: string): void => {
    const key = (Object.keys(labels) as EvidenceKey[]).find(candidate => labels[candidate].test(label.replace(/[:：]\s*$/u, '').trim()));
    if (key && complete(value)) values[key].push(value);
  };
  for (const term of card.querySelectorAll('dt')) {
    const detail = term.nextElementSibling;
    if (detail?.tagName === 'DD') add(summaryText(term, card), summaryText(detail, card));
  }
  for (const row of card.querySelectorAll('tr')) {
    const cells = Array.from(row.children).filter(cell => cell.matches('th, td'));
    if (cells.length === 2) add(summaryText(cells[0]!, card), summaryText(cells[1]!, card));
  }
  for (const paragraph of card.querySelectorAll('p')) {
    const text = summaryText(paragraph, card);
    const separator = text.search(/[:：]/u);
    if (separator > 0) add(text.slice(0, separator), text.slice(separator + 1).trim());
  }
  const headings = Array.from(card.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))
    .map(heading => summaryText(heading, card)).filter(complete);
  if (headings.length === 1) values.name.push(headings[0]!);
  const result: Evidence = {};
  for (const key of Object.keys(values) as EvidenceKey[]) {
    const distinct = [...new Set(values[key])];
    if (distinct.length === 1) result[key] = distinct[0];
    if (distinct.length > 1) result.conflict = true;
  }
  // Conflicting headings/labels must not fall back to another source.
  if (headings.length > 1) delete result.name;
  return result;
}

export function projectCardIdentityReady(card: Element | undefined): boolean {
  const observed = evidence(card);
  return !observed.conflict && complete(observed.name);
}

function compareEvidence(observed: Evidence, project: ProjectProjectionEntry): ProjectIdentityResult {
  const expectedName = normalized(project.name);
  const result = (verdict: RecordIdentityVerdict, signals: RecordIdentitySignal[]): ProjectIdentityResult =>
    Object.freeze({ verdict, signals: Object.freeze(signals), provenance: 'rule' });
  if (observed.conflict || !complete(observed.name) || !complete(expectedName)) return result('insufficient', []);
  if (observed.name !== expectedName) return result('different', ['primary']);
  const start = date(project.startDate); const end = date(project.endDate);
  const actualStart = date(observed.startDate); const actualEnd = date(observed.endDate);
  if ((observed.startDate && !actualStart) || (observed.endDate && !actualEnd)
    || (actualStart && actualEnd && actualStart > actualEnd)) return result('insufficient', ['primary']);
  const fullRange = start && end && actualStart && actualEnd && start <= end && actualStart <= actualEnd;
  if (fullRange && (start !== actualStart || end !== actualEnd)) return result('different', ['primary', 'start-date', 'end-date']);
  if ((start && actualStart && start !== actualStart) || (end && actualEnd && end !== actualEnd)) return result('insufficient', ['primary']);
  const description = normalized(project.description);
  const descriptionReady = complete(observed.description) && complete(description) && description.length >= 12;
  if (descriptionReady && observed.description !== description) return result('insufficient', ['primary']);
  if (fullRange) return result('same', ['primary', 'start-date', 'end-date']);
  if (descriptionReady && observed.description === description) return result('same', ['primary', 'secondary']);
  return result('insufficient', ['primary']);
}

export function compareProjectCard(card: Element | undefined, project: ProjectProjectionEntry): ProjectIdentityResult {
  return compareEvidence(evidence(card), project);
}

/** Read each card once per snapshot, then compare local projections without exposing text. */
export function projectCardComparator(card: Element | undefined): Readonly<{
  ready: boolean; compare: (project: ProjectProjectionEntry) => ProjectIdentityResult;
}> {
  const observed = evidence(card);
  return Object.freeze({ ready: !observed.conflict && complete(observed.name),
    compare: (project: ProjectProjectionEntry) => compareEvidence(observed, project) });
}
