import type { ScanState } from '../content/scanner';
import { isValidSemanticGraph } from '../shared/semanticGraphValidation';
import { educationProjectionResponseSchema } from '../profile/educationProjection';
import { projectProjectionResponseSchema } from '../profile/projection';
import { internshipProjectionResponseSchema } from '../profile/internshipProjection';
import { awardProjectionResponseSchema } from '../profile/awardProjection';
import { educationCardComparator } from '../content/educationRecordIdentity';
import { projectCardComparator } from '../content/projectRecordIdentity';
import { internshipCardComparator } from '../content/internshipRecordIdentity';
import { awardCardComparator } from '../content/awardRecordIdentity';
import { hiddenReason } from '../content/domUtils';
import { verifyScanObservation } from '../content/scanFreshness';
export interface RecordPresenceResult { readonly state: 'all-present' | 'pending' | 'unverified'; readonly total: number; readonly matched: number }

/** Read-only identity proof for a fresh private scan. Counts alone never mean records are complete. */
export function verifyRecordPresence(scan: ScanState, projection: unknown): RecordPresenceResult {
  const fail = (total = 0): RecordPresenceResult => ({ state: 'unverified', total, matched: 0 });
  const education = educationProjectionResponseSchema.safeParse(projection);
  const project = projectProjectionResponseSchema.safeParse(projection);
  const internship = internshipProjectionResponseSchema.safeParse(projection);
  const award = awardProjectionResponseSchema.safeParse(projection);
  const records = education.success ? education.data.education : project.success ? project.data.projects : internship.success ? internship.data.internships : award.success ? award.data.awards : undefined;
  const kind = education.success ? 'education' : project.success ? 'project' : internship.success ? 'internship' : award.success ? 'award' : undefined;
  if (!records || !kind || !records.length || new Set(records.map(record => record.id)).size !== records.length) return fail();
  const graph = scan.result.semanticGraph; const total = records.length;
  if (!verifyScanObservation(scan)) return fail(total);
  if (!graph || scan.document.URL !== scan.result.url || !isValidSemanticGraph(graph, scan.result.fields.map(field => field.id))) return fail(total);
  const lists = graph.nodes.filter(node => node.kind === 'record-list' && node.recordType === kind);
  if (lists.length !== 1) return fail(total);
  const list = lists[0]!;
  if (list.kind !== 'record-list' || list.editorState !== 'closed' || (list.framePath?.length ?? 0) > 0) return fail(total);
  const target = scan.semanticTargets.get(list.id);
  if (!target?.isConnected || target.ownerDocument !== scan.document || target.getRootNode() !== scan.document || hiddenReason(target)) return fail(total);
  const summaries = graph.nodes.filter(node => node.kind === 'record' && node.parentId === list.id && node.state === 'summary');
  if (summaries.length !== list.existingRecordCount) return fail(total);
  const evidence: string[][] = [];
  for (const summary of summaries) {
    const card = scan.semanticTargets.get(summary.id);
    if (!card?.isConnected || card.ownerDocument !== scan.document || !target.contains(card) || hiddenReason(card)) return fail(total);
    let ready = false; let verdicts: string[] = [];
    if (education.success) { const comparator = educationCardComparator(card, education.data.education); ready = comparator.ready; verdicts = education.data.education.map(record => comparator.compare(record).verdict); }
    else if (project.success) { const comparator = projectCardComparator(card, project.data.projects); ready = comparator.ready; verdicts = project.data.projects.map(record => comparator.compare(record).verdict); }
    else if (internship.success) { const comparator = internshipCardComparator(card, internship.data.internships); ready = comparator.ready; verdicts = internship.data.internships.map(record => comparator.compare(record).verdict); }
    else if (award.success) { const comparator = awardCardComparator(card, award.data.awards); ready = comparator.ready; verdicts = award.data.awards.map(record => comparator.compare(record).verdict); }
    // A card cannot prove multiple distinct source records. Uncertain identity must not disappear in a count.
    if (!ready || verdicts.filter(verdict => verdict === 'same').length > 1 || verdicts.includes('insufficient')) return fail(total);
    evidence.push(verdicts);
  }
  const matched = records.filter((_record, index) => evidence.some(verdicts => verdicts[index] === 'same')).length;
  return { state: matched === total ? 'all-present' : 'pending', total, matched };
}
