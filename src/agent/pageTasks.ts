import type { ScanResult, MatchResult } from '../shared/types';
import type { UserProfile } from '../profile/schema';
import { collectionPresence } from '../profile/facts';
import { isValidSemanticGraph } from '../shared/semanticGraphValidation';
import type { RecordWorkflowState } from '../workflow/recordState';
import type { RecordPresenceResult } from './recordCompletion';
import type { AgentObservation } from './nextStepWorkflow';
export type AgentRecordKind = 'education' | 'project' | 'internship' | 'award' | 'publication' | 'student-work';
export interface AgentRecordCheck { readonly state: RecordWorkflowState; readonly presence: RecordPresenceResult }
const supported = ['education', 'project', 'internship', 'award', 'publication', 'student-work'] as const;
const collectionKeys = {project:'projects',internship:'internships',award:'awards',publication:'papers','student-work':'studentWork'} as const;
const taskKinds = {education:'education-records',project:'project-records',internship:'internship-records',award:'award-records',publication:'publication-records','student-work':'student-work-records'} as const;
const repeatable = new Set(['education', 'project', 'internship', 'student-work', 'award', 'publication', 'language', 'skill', 'family']);

/** Ordinary page work cannot borrow an already-open record editor. */
export function agentOrdinaryFieldIds(scan: ScanResult): ReadonlySet<string> {
  const graph = scan.semanticGraph;
  if (!graph || !isValidSemanticGraph(graph, scan.fields.map(field => field.id))) return new Set();
  const nodes = new Map(graph.nodes.map(node => [node.id, node])); const blocked = new Set<string>();
  for (const node of graph.nodes) if (node.kind === 'field') {
    let parent = node.parentId ? nodes.get(node.parentId) : undefined;
    while (parent) {
      if (parent.kind === 'record' || parent.kind === 'record-list') { blocked.add(node.fieldId); break; }
      parent = parent.parentId ? nodes.get(parent.parentId) : undefined;
    }
  }
  return new Set(scan.fields.filter(field => !blocked.has(field.id)).map(field => field.id));
}
export function agentFieldFingerprint(scan: ScanResult): string {
  const allowed = agentOrdinaryFieldIds(scan);
  return JSON.stringify(scan.fields.filter(field => allowed.has(field.id)).map(field => ({ ...field, id: undefined, groupId: undefined })));
}

/** Local observation only. The caller separately proves live controls, profile and page ownership. */
export function buildAgentPageTasks(scan: ScanResult, matches: readonly MatchResult[], profile: UserProfile,
  checks: Readonly<Record<AgentRecordKind, AgentRecordCheck>>, attemptedFields: ReadonlySet<string>): Pick<AgentObservation, 'tasks' | 'pending'> | undefined {
  const graph = scan.semanticGraph;
  if (!graph || !isValidSemanticGraph(graph, scan.fields.map(field => field.id)) || matches.length !== scan.fields.length
    || new Set(matches.map(match => match.fieldId)).size !== matches.length
    || matches.some(match => !scan.fields.some(field => field.id === match.fieldId))) return undefined;
  const allowed = agentOrdinaryFieldIds(scan); const byField = new Map(scan.fields.map(field => [field.id, field]));
  // Hidden technical controls are not a user-visible pending question. Unsupported visible required controls still count.
  const pendingFields = matches.filter(match => allowed.has(match.fieldId) && match.status !== 'existing'
    && !byField.get(match.fieldId)!.hasValue && !/隐藏|hidden/iu.test(byField.get(match.fieldId)!.blockedReason ?? ''));
  const tasks: AgentObservation['tasks'][number][] = []; let records = 0; let blockers = 0;
  const canTryFields = pendingFields.some(match => match.status !== 'blocked');
  if (canTryFields && !attemptedFields.has(agentFieldFingerprint(scan))) tasks.push({ kind: 'fill-visible', count: pendingFields.length });
  if (pendingFields.some(match => match.status === 'blocked') || attemptedFields.has(agentFieldFingerprint(scan)) && pendingFields.length) blockers++;
  const expected = { education: profile.education.length, project: profile.projects.length, internship: profile.internships.length, award:profile.awards.length,publication:profile.research.papers.length,'student-work':profile.studentWork.length };
  for (const kind of supported) {
    const check = checks[kind];
    const present = graph.nodes.some(node => node.kind === 'record-list' && node.recordType === kind) || check.state.canStart;
    if (!present) continue;
    if (!expected[kind]) {
      const absence = kind === 'education' ? 'unknown' : collectionPresence(profile, collectionKeys[kind]);
      if (!['none','not_applicable'].includes(absence)
        || graph.nodes.some(node => node.kind === 'record-list' && node.recordType === kind
          && (node.existingRecordCount > 0 || node.editorState !== 'closed'))) blockers++;
      continue;
    }
    if (check.presence.total !== expected[kind] || check.presence.matched > expected[kind]) return undefined;
    if (check.presence.state === 'all-present' && check.presence.matched === expected[kind]) continue;
    records += expected[kind];
    if (check.state.canStart && !['preparing','running','pausing','paused','review'].includes(check.state.phase))
      tasks.push({ kind: taskKinds[kind], count: expected[kind] });
    else blockers++;
  }
  for (const list of graph.nodes.filter(node => node.kind === 'record-list')) {
    if (list.kind === 'record-list' && !supported.includes(list.recordType as AgentRecordKind)) blockers++;
  }
  // Unclassified Add or record controls must remain a visible limitation, not disappear into a "complete" response.
  if (graph.nodes.some(node => node.kind === 'action' && node.action === 'unknown')) blockers++;
  if (!scan.fields.length && !graph.nodes.some(node => node.kind === 'record-list' && repeatable.has(node.recordType))) blockers++;
  if (scan.warnings.some(warning => /另有.*iframe|跨域\s*iframe\s*无法|字段过多/iu.test(warning))) blockers++;
  if (graph.nodes.some(node => node.kind === 'action' && node.action === 'upload')) blockers++;
  for (const section of graph.nodes.filter(node => node.kind === 'section')) {
    if (section.kind === 'section' && repeatable.has(section.role) && !supported.includes(section.role as AgentRecordKind)
      && !graph.nodes.some(node => node.kind === 'record-list' && node.recordType === section.role)) blockers++;
    if(section.kind==='section' && (section.role==='award'||section.role==='publication'||section.role==='student-work') && !checks[section.role].state.canStart
      && !graph.nodes.some(node=>node.kind==='record-list'&&node.recordType===section.role))blockers++;
  }
  return { tasks, pending: { fields: pendingFields.length, records, blockers } };
}
