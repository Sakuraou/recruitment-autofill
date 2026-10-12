import { createEmptyProfile, profileSchema, type UserProfile } from '../profile/schema';
import { publicationProjectionResponseSchema } from '../profile/publicationProjection';
import type { ScanResult } from '../shared/types';
import type { ScanState } from '../content/scanner';
import { currentControlFingerprint } from '../content/controlObservation';
import { nativeRadioGroupCurrent } from '../content/controlAdapter';
import { resolvePublicationField, resolveBoundPublicationField, type PublicationFieldResolution } from '../matching/publicationFieldResolver';
import { isRecordPlanCurrentForSnapshot, isRecordTransactionCurrentForPlan,
  type ActiveRecordTransaction, type ReadyRecordPlan } from '../planner/recordPlanner';
import { matchesIssuedRecordRunTarget, RecordRunContext, type RecordRunCapture } from '../planner/recordRunContext';

export interface PublicationSemanticContext { readonly recordType: 'publication' }
interface Input {
  readonly plan: ReadyRecordPlan; readonly capture: RecordRunCapture; readonly activeTransaction: ActiveRecordTransaction;
  readonly runContext: RecordRunContext; readonly scanState: ScanState; readonly profile: UserProfile;
}
interface Local {
  readonly input: Input; readonly snapshot: string; readonly fields: ReadonlySet<string>; readonly editor: Element; readonly list: Element;
  readonly targets: readonly { readonly nodeId: string; readonly fieldId: string; readonly node: Element }[];
}
const contexts = new WeakMap<PublicationSemanticContext, Local>();
const snapshot = (scan: ScanResult, profile: UserProfile) => JSON.stringify({ scan, profile });
/** Only the strict projection-derived internal profile may be retained here. */
function minimalPublicationProfile(profile: UserProfile): boolean {
  const checked = profileSchema.safeParse(profile); if (!checked.success) return false;
  const projection = publicationProjectionResponseSchema.safeParse({ recordType: 'publication', profileRevision: checked.data.updatedAt,
    presence: checked.data.research.papers.length ? 'known' : 'unknown', publications: checked.data.research.papers });
  return projection.success && JSON.stringify(checked.data) === JSON.stringify(publicationSemanticProfile(projection.data));
}
/** Internal content profile reconstructed only from the strict publication projection. */
export function publicationSemanticProfile(value: unknown): UserProfile {
  const projection = publicationProjectionResponseSchema.parse(value), profile = createEmptyProfile();
  profile.updatedAt = projection.profileRevision; profile.research.papers = projection.publications.map(record => ({...record}));
  return profileSchema.parse(profile);
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
  return minimalPublicationProfile(profile) && runContext instanceof RecordRunContext && runContext.isCurrentCapture(capture)
    && plan.recordType === 'publication' && capture.snapshot.recordType === 'publication' && activeTransaction.recordType === 'publication'
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
export function createPublicationSemanticContext(input: Input): PublicationSemanticContext | undefined {
  try {
    const { plan, capture, activeTransaction, scanState, profile } = input;
    if (!minimalPublicationProfile(profile) || plan.nextStep.kind !== 'populate-editor'
      || !Number.isSafeInteger(activeTransaction.intentIndex) || activeTransaction.intentIndex < 0 || !profile.research.papers[activeTransaction.intentIndex]
      || new Set(profile.research.papers.map(record => record.id)).size !== profile.research.papers.length) return undefined;
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
    const context = Object.freeze({ recordType: 'publication' as const }); contexts.set(context, local); return context;
  } catch { return undefined; }
}
export function publicationSemanticContextCurrent(context: PublicationSemanticContext, scan: ScanResult, profile: UserProfile, fieldIds: readonly string[]): boolean {
  try { const local = contexts.get(context); return !!local && current(local, scan, profile) && fieldIds.every(id => local.fields.has(id)); }
  catch { return false; }
}
/** Local field IDs narrow inference; they carry no record selection or action authority. */
export function publicationSemanticFieldIds(context: PublicationSemanticContext, scan: ScanResult, profile: UserProfile): readonly string[] | undefined {
  return publicationSemanticContextCurrent(context, scan, profile, []) ? Object.freeze([...contexts.get(context)!.fields]) : undefined;
}
export function resolveCurrentPublicationField(context: PublicationSemanticContext, scan: ScanResult, profile: UserProfile,
  fieldId: string, path: string): PublicationFieldResolution | undefined {
  if (!publicationSemanticContextCurrent(context, scan, profile, [fieldId])) return undefined;
  const local = contexts.get(context)!; const field = scan.fields.find(item => item.id === fieldId);
  if (!field) return undefined;
  const record=profile.research.papers[local.input.activeTransaction.intentIndex]!;

  return resolveBoundPublicationField(field,record,path);
}

/** Only genuinely unknown meanings may be proposed; known missing facts remain local. */
export function publicationSemanticUnknownField(context: PublicationSemanticContext, scan: ScanResult, profile: UserProfile, fieldId: string): boolean {
  if (!publicationSemanticContextCurrent(context, scan, profile, [fieldId])) return false;
  const local = contexts.get(context)!; const field = scan.fields.find(item => item.id === fieldId);
  if (!field) return false;
  const result = resolvePublicationField(field, profile.research.papers[local.input.activeTransaction.intentIndex]!);
  return result.status === "request-human" && result.reason === "field-semantic-unknown";
}

