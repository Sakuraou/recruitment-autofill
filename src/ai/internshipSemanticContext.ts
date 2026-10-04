import { createEmptyProfile, profileSchema, type UserProfile } from '../profile/schema';
import { internshipProjectionResponseSchema } from '../profile/internshipProjection';
import type { ScanResult } from '../shared/types';
import type { ScanState } from '../content/scanner';
import { currentControlFingerprint } from '../content/controlObservation';
import { nativeRadioGroupCurrent } from '../content/controlAdapter';
import { resolveInternshipField, resolveBoundInternshipField, qualifyInternshipWeakMeaning, type InternshipFieldResolution } from '../matching/internshipFieldResolver';
import { isRecordPlanCurrentForSnapshot, isRecordTransactionCurrentForPlan,
  type ActiveRecordTransaction, type ReadyRecordPlan } from '../planner/recordPlanner';
import { matchesIssuedRecordRunTarget, RecordRunContext, type RecordRunCapture } from '../planner/recordRunContext';

export interface InternshipSemanticContext { readonly recordType: 'internship' }
interface Input {
  readonly plan: ReadyRecordPlan; readonly capture: RecordRunCapture; readonly activeTransaction: ActiveRecordTransaction;
  readonly runContext: RecordRunContext; readonly scanState: ScanState; readonly profile: UserProfile;
}
interface Local {
  readonly input: Input; readonly snapshot: string; readonly fields: ReadonlySet<string>; readonly editor: Element; readonly list: Element;
  readonly targets: readonly { readonly nodeId: string; readonly fieldId: string; readonly node: Element }[];
}
const contexts = new WeakMap<InternshipSemanticContext, Local>();
const snapshot = (scan: ScanResult, profile: UserProfile) => JSON.stringify({ scan, profile });
/** Only the strict projection-derived internal profile may be retained here. */
function minimalInternshipProfile(profile: UserProfile): boolean {
  const checked = profileSchema.safeParse(profile);
  if (!checked.success) return false;
  const projection = internshipProjectionResponseSchema.safeParse({ recordType: 'internship',
    profileRevision: checked.data.updatedAt, internships: checked.data.internships });
  if (!projection.success) return false;
  const minimum = createEmptyProfile(); minimum.updatedAt = projection.data.profileRevision;
  minimum.internships = projection.data.internships;
  return JSON.stringify(checked.data) === JSON.stringify(profileSchema.parse(minimum));
}
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
  return minimalInternshipProfile(profile) && runContext instanceof RecordRunContext && runContext.isCurrentCapture(capture)
    && plan.recordType === 'internship' && capture.snapshot.recordType === 'internship' && activeTransaction.recordType === 'internship'
    && plan.nextStep.kind === 'populate-editor' && isRecordPlanCurrentForSnapshot(plan, capture.snapshot)
    && isRecordTransactionCurrentForPlan(activeTransaction, plan, 'populate-editor')
    && scanState.document.URL === scan.url && local.editor.isConnected && local.editor.ownerDocument === scanState.document && local.editor.getRootNode() === scanState.document
    && matchesIssuedRecordRunTarget(capture, plan.nextStep.editorRecordNodeId, local.editor)
    && local.list.isConnected && local.list.ownerDocument === scanState.document && local.list.getRootNode() === scanState.document && local.list !== local.editor && inside(local.list, local.editor)
    && scanState.semanticTargets.get(plan.recordListNodeId) === local.list && matchesIssuedRecordRunTarget(capture, plan.recordListNodeId, local.list)
    && local.targets.every(target => target.node.isConnected && target.node.ownerDocument === scanState.document && target.node.getRootNode() === scanState.document && inside(local.editor, target.node)
      && scanState.semanticTargets.get(target.nodeId) === target.node && scanState.controls.get(target.fieldId)?.node === target.node
      && matchesIssuedRecordRunTarget(capture, target.nodeId, target.node))
    && [...local.fields].every(id => {
      const control = scanState.controls.get(id);
      return !!control && currentControlFingerprint(control, id) === control.fingerprint
        && (control.adapter !== 'radio-group' || nativeRadioGroupCurrent(control.members)
          && control.members.every(member => member.ownerDocument === scanState.document
            && member.getRootNode() === scanState.document && inside(local.editor, member)));
    })
    && snapshot(scan, profile) === local.snapshot;
}
/** Page-private current-record provenance, never a model index or execution grant. */
export function createInternshipSemanticContext(input: Input): InternshipSemanticContext | undefined {
  try {
    const { plan, capture, activeTransaction, scanState, profile } = input;
    if (!minimalInternshipProfile(profile) || plan.nextStep.kind !== 'populate-editor'
      || !Number.isSafeInteger(activeTransaction.intentIndex) || activeTransaction.intentIndex < 0 || !profile.internships[activeTransaction.intentIndex]
      || new Set(profile.internships.map(record => record.id)).size !== profile.internships.length) return undefined;
    const editor = scanState.semanticTargets.get(plan.nextStep.editorRecordNodeId);
    const list = scanState.semanticTargets.get(plan.recordListNodeId); if (!editor || !list) return undefined;
    const graph = scanState.result.semanticGraph; if (!graph) return undefined;
    const fields = new Set<string>(); const targets: Local['targets'][number][] = [];
    for (const nodeId of plan.nextStep.fieldNodeIds) {
      const node = graph.nodes.find(item => item.id === nodeId); const target = scanState.semanticTargets.get(nodeId);
      const control = node?.kind === 'field' ? scanState.controls.get(node.fieldId) : undefined;
      if (node?.kind !== 'field' || !target || !control || control.node !== target || !matchesIssuedRecordRunTarget(capture, nodeId, target)) return undefined;
      fields.add(node.fieldId); targets.push(Object.freeze({ nodeId, fieldId: node.fieldId, node: target }));
    }
    if (!fields.size || fields.size !== plan.nextStep.fieldNodeIds.length) return undefined;
    const local: Local = { input: Object.freeze({ ...input }), fields, editor, list, targets: Object.freeze(targets), snapshot: snapshot(scanState.result, profile) };
    if (!current(local, scanState.result, profile)) return undefined;
    const context = Object.freeze({ recordType: 'internship' as const }); contexts.set(context, local); return context;
  } catch { return undefined; }
}
export function internshipSemanticContextCurrent(context: InternshipSemanticContext, scan: ScanResult, profile: UserProfile, fieldIds: readonly string[]): boolean {
  try { const local = contexts.get(context); return !!local && current(local, scan, profile) && fieldIds.every(id => local.fields.has(id)); }
  catch { return false; }
}
/** Local field IDs narrow inference; they carry no record selection or action authority. */
export function internshipSemanticFieldIds(context: InternshipSemanticContext, scan: ScanResult, profile: UserProfile): readonly string[] | undefined {
  return internshipSemanticContextCurrent(context, scan, profile, []) ? Object.freeze([...contexts.get(context)!.fields]) : undefined;
}
export function resolveCurrentInternshipField(context: InternshipSemanticContext, scan: ScanResult, profile: UserProfile,
  fieldId: string, path: string): InternshipFieldResolution | undefined {
  if (!internshipSemanticContextCurrent(context, scan, profile, [fieldId])) return undefined;
  const local = contexts.get(context)!; const field = scan.fields.find(item => item.id === fieldId);
  if (!field) return undefined;
  const record=profile.internships[local.input.activeTransaction.intentIndex]!;
  const direct=resolveInternshipField(field,record);
  if (direct.status==='request-human' && direct.reason==='field-semantic-ambiguous') {
    const weak=qualifyInternshipWeakMeaning(field,record);
    if (weak.status!=='confirm' || weak.path!==path) return Object.freeze({status:'request-human',reason:'field-semantic-ambiguous'});
  }
  return resolveBoundInternshipField(field,record,path);
}

/** Only genuinely unknown meanings may be proposed; known missing facts remain local. */
export function internshipSemanticUnknownField(context: InternshipSemanticContext, scan: ScanResult, profile: UserProfile, fieldId: string): boolean {
  if (!internshipSemanticContextCurrent(context, scan, profile, [fieldId])) return false;
  const local = contexts.get(context)!; const field = scan.fields.find(item => item.id === fieldId);
  if (!field) return false;
  const result = resolveInternshipField(field, profile.internships[local.input.activeTransaction.intentIndex]!);
  return result.status === "request-human" && result.reason === "field-semantic-unknown";
}

/** A weak path is available only inside the original current-entry capability. */
export function internshipSemanticWeakPath(context:InternshipSemanticContext,scan:ScanResult,profile:UserProfile,fieldId:string):string|undefined {
  if (!internshipSemanticContextCurrent(context,scan,profile,[fieldId])) return undefined;
  const local=contexts.get(context)!;const field=scan.fields.find(item=>item.id===fieldId);
  if (!field) return undefined;
  const qualified=qualifyInternshipWeakMeaning(field,profile.internships[local.input.activeTransaction.intentIndex]!);
  return qualified.status==='confirm'?qualified.path:undefined;
}
