import { profileSchema, type UserProfile } from '../profile/schema';
import type { ScanResult } from '../shared/types';
import type { ScanState } from '../content/scanner';
import { currentControlFingerprint } from '../content/controlObservation';
import { resolveBoundProjectField, type ProjectFieldResolution } from '../matching/projectFieldResolver';
import { isRecordPlanCurrentForSnapshot, isRecordTransactionCurrentForPlan, type ActiveRecordTransaction, type ReadyRecordPlan } from '../planner/recordPlanner';
import { matchesIssuedRecordRunTarget, RecordRunContext, type RecordRunCapture } from '../planner/recordRunContext';

export interface ProjectSemanticContext { readonly recordType: 'project' }
interface Input {
  readonly plan: ReadyRecordPlan; readonly capture: RecordRunCapture; readonly activeTransaction: ActiveRecordTransaction;
  readonly runContext: RecordRunContext; readonly scanState: ScanState; readonly profile: UserProfile;
}
interface Local { readonly input: Input; readonly snapshot: string; readonly fields: ReadonlySet<string>; readonly editor: Element;
  readonly targets: readonly { readonly nodeId: string; readonly fieldId: string; readonly node: Element }[] }
const contexts = new WeakMap<ProjectSemanticContext, Local>();
const snapshot = (scan: ScanResult, profile: UserProfile) => JSON.stringify({ scan, profile });
function inside(editor: Element, target: Element): boolean {
  let current: Node | null = target;
  for (let depth = 0; current && depth < 256; depth++) {
    if (current === editor) return true;
    const root = current.getRootNode(); current = current.parentNode ?? (root && 'host' in root ? (root as ShadowRoot).host : null);
  }
  return false;
}
function current(local: Local, scan: ScanResult, profile: UserProfile): boolean {
  const { plan, capture, activeTransaction, runContext, scanState } = local.input;
  return runContext instanceof RecordRunContext && runContext.isCurrentCapture(capture)
    && plan.recordType === 'project' && capture.snapshot.recordType === 'project' && activeTransaction.recordType === 'project'
    && plan.nextStep.kind === 'populate-editor' && isRecordPlanCurrentForSnapshot(plan, capture.snapshot)
    && isRecordTransactionCurrentForPlan(activeTransaction, plan, 'populate-editor')
    && scanState.document.URL === scan.url && local.editor.isConnected && local.editor.ownerDocument === scanState.document
    && matchesIssuedRecordRunTarget(capture, plan.nextStep.editorRecordNodeId, local.editor)
    && local.targets.every(target => target.node.isConnected && target.node.ownerDocument === scanState.document && inside(local.editor, target.node)
      && scanState.semanticTargets.get(target.nodeId) === target.node && scanState.controls.get(target.fieldId)?.node === target.node
      && matchesIssuedRecordRunTarget(capture, target.nodeId, target.node))
    && [...local.fields].every(id => {
      const control = scanState.controls.get(id); return !!control && currentControlFingerprint(control, id) === control.fingerprint;
    })
    && snapshot(scan, profile) === local.snapshot;
}
/** Internal planner capability only. No record index, value or action is exposed to the model. */
export function createProjectSemanticContext(input: Input): ProjectSemanticContext | undefined {
  try {
    const { plan, capture, activeTransaction, scanState, profile } = input;
    if (!profileSchema.safeParse(profile).success || plan.nextStep.kind !== 'populate-editor'
      || !Number.isInteger(activeTransaction.intentIndex) || activeTransaction.intentIndex < 0 || !profile.projects[activeTransaction.intentIndex]
      || new Set(profile.projects.map(project => project.id)).size !== profile.projects.length) return undefined;
    const editor = scanState.semanticTargets.get(plan.nextStep.editorRecordNodeId); if (!editor) return undefined;
    const graph = scanState.result.semanticGraph; if (!graph) return undefined;
    const fields = new Set<string>(); const targets: Local['targets'][number][] = [];
    for (const nodeId of plan.nextStep.fieldNodeIds) {
      const node = graph.nodes.find(item => item.id === nodeId); const target = scanState.semanticTargets.get(nodeId);
      const control = node?.kind === 'field' ? scanState.controls.get(node.fieldId) : undefined;
      if (node?.kind !== 'field' || !target || !control || control.node !== target || !matchesIssuedRecordRunTarget(capture, nodeId, target)) return undefined;
      fields.add(node.fieldId); targets.push(Object.freeze({ nodeId, fieldId: node.fieldId, node: target }));
    }
    if (!fields.size || fields.size !== plan.nextStep.fieldNodeIds.length) return undefined;
    const local: Local = { input: Object.freeze({ ...input }), fields, editor, targets: Object.freeze(targets), snapshot: snapshot(scanState.result, profile) };
    if (!current(local, scanState.result, profile)) return undefined;
    const context = Object.freeze({ recordType: 'project' as const }); contexts.set(context, local); return context;
  } catch { return undefined; }
}
export function projectSemanticContextCurrent(context: ProjectSemanticContext, scan: ScanResult, profile: UserProfile, fieldIds: readonly string[]): boolean {
  try { const local = contexts.get(context); return !!local && current(local, scan, profile) && fieldIds.every(id => local.fields.has(id)); }
  catch { return false; }
}
export function resolveCurrentProjectField(context: ProjectSemanticContext, scan: ScanResult, profile: UserProfile, fieldId: string, path: string): ProjectFieldResolution | undefined {
  if (!projectSemanticContextCurrent(context, scan, profile, [fieldId])) return undefined;
  const local = contexts.get(context)!; const field = scan.fields.find(item => item.id === fieldId);
  return field ? resolveBoundProjectField(field, profile.projects[local.input.activeTransaction.intentIndex]!, path) : undefined;
}
