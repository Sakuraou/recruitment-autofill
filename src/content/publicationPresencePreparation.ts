import { publicationProjectionResponseSchema, type PublicationProjectionResponse } from '../profile/publicationProjection';
import type { FieldDescriptor } from '../shared/types';
import { fillScan } from './autofill';
import { nativeRadioGroupCurrent } from './controlAdapter';
import { currentControlFingerprint } from './controlObservation';
import { hiddenReason } from './domUtils';
import { waitForDomStability } from './domStability';
import { publicationRecordAvailability } from './publicationRecordSession';
import type { RecordPagePreparation } from './recordWorkflow';
import { scanDocument, type ScannedControl, type ScanState } from './scanner';
import { isPublicationPresenceQuestionGroup } from './semantic/publicationQuestionGroup';
import { classifySection } from './semantic/sectionClassifier';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s*＊:：?？]/gu, '');
const questions = new Set(['是否有专业论著', '是否有论文论著', '是否有论文']);
const yes = new Set(['是', '有', '存在', 'yes', 'true']);
type NativeQuestionControl = Extract<ScannedControl, { adapter?: undefined } | { adapter: 'radio-group' }>;
interface Question {
  scan: ScanState; field: FieldDescriptor; control: NativeQuestionControl; section: Element; form: HTMLFormElement; root: Element; value: string;
}
function question(doc: Document, requireNoList: boolean): Question | undefined {
  if (!/^https?:/u.test(doc.URL)) return undefined;
  const scan = scanDocument(doc); const graph = scan.result.semanticGraph; if (!graph) return undefined;
  const sections = graph.nodes.filter(node => node.kind === 'section' && node.role === 'publication');
  if (sections.length !== 1) return undefined;
  const section = scan.semanticTargets.get(sections[0]!.id);
  if (!section?.isConnected || section.getRootNode() !== doc || !section.matches('section,[role="region"]')) return undefined;
  if (requireNoList && (graph.nodes.some(node => node.kind === 'record-list' && node.recordType === 'publication')
    || Array.from(section.querySelectorAll('[role="list"],ul,ol,table,article,[role="listitem"]')).some(node => !hiddenReason(node)))) return undefined;
  const candidates = scan.result.fields.filter(field => {
    const captions = [field.label, field.ariaLabel, field.tableHeader].filter(text => text.trim());
    return captions.length && captions.every(text => questions.has(normalize(text)));
  });
  if (candidates.length !== 1) return undefined;
  const field = candidates[0]!; const control = scan.controls.get(field.id);
  const node = graph.nodes.find(node => node.kind === 'field' && node.fieldId === field.id);
  if (!control || field.blockedReason || field.disabled || field.readOnly || node?.parentId !== sections[0]!.id
    || !section.contains(control.node) || control.node.getRootNode() !== doc) return undefined;
  if (!(control.adapter === 'radio-group' || control.adapter === undefined && control.node.tagName === 'SELECT')) return undefined;
  const form = control.node.closest('form'); if (!form?.isConnected || !section.contains(form)) return undefined;
  const aria = form.getAttribute('aria-label')?.trim();
  if (form.hasAttribute('aria-labelledby') || aria && !questions.has(normalize(aria))
    && classifySection([{ text: aria, evidence: 'aria-name' }]).role !== 'publication') return undefined;
  const root = control.node.closest('fieldset') ?? form;
  if (root.tagName === 'FIELDSET' && !isPublicationPresenceQuestionGroup(root)) return undefined;
  if (control.adapter === 'radio-group') {
    if (!nativeRadioGroupCurrent(control.members) || !control.members.every(member => member.form === form && root.contains(member))) return undefined;
  } else if (control.node.form !== form) return undefined;
  const options = field.options.filter(option => !option.disabled && yes.has(normalize(option.label)));
  if (options.length !== 1 || !options[0]!.value || field.options.length > 40) return undefined;
  return { scan, field, control, section, form, root, value: options[0]!.value };
}
/** Read-only eligibility; no record list is required before the finite existence answer. */
export function publicationWorkflowAvailability(doc: Document): Readonly<{ eligible: boolean; reason?: string }> {
  const list = publicationRecordAvailability(doc);
  return list.eligible || list.reason !== 'record-list-unverified' ? list : question(doc, true) ? { eligible: true } : list;
}
/** Private single-question operation, captured before loading profile facts. */
export function capturePublicationPresencePreparation(doc: Document): RecordPagePreparation<PublicationProjectionResponse> | undefined {
  if (publicationRecordAvailability(doc).eligible) return undefined;
  const original = question(doc, true); if (!original) return undefined;
  const url = doc.URL;
  return async (projection, context) => {
    const reject = (reason: string) => ({ ready: false as const, reason });
    const parsed = publicationProjectionResponseSchema.safeParse(projection);
    if (!parsed.success || !parsed.data.publications.length) return reject('profile-value-missing');
    const snapshot = JSON.stringify(parsed.data);
    const profileCurrent = async () => {
      const latest = publicationProjectionResponseSchema.safeParse(await context.refresh());
      return latest.success && JSON.stringify(latest.data) === snapshot;
    };
    const owns = (fingerprint: string | undefined) => {
      if (!context.current() || doc.URL !== url || !fingerprint || original.control.node.ownerDocument !== doc
        || !original.section.isConnected || !original.form.isConnected || !original.root.isConnected
        || !original.root.contains(original.control.node) || !original.section.contains(original.form)
        || currentControlFingerprint(original.control, original.field.id) !== fingerprint) return false;
      const fresh = question(doc, false);
      return !!fresh && fresh.control.node === original.control.node && fresh.section === original.section && fresh.form === original.form
        && fresh.root === original.root && fresh.value === original.value;
    };
    if (!owns(original.control.fingerprint)) return reject('page-preparation-changed');
    try { if (!await profileCurrent()) return reject('profile-changed'); }
    catch { return reject('profile-projection-unavailable'); }
    if (!owns(original.control.fingerprint)) return reject('page-preparation-changed');
    const selected = original.control.adapter === 'radio-group'
      ? original.control.members[original.field.options.findIndex(option => option.value === original.value)]?.checked
      : original.control.node.value === original.value;
    if (original.field.hasValue && !selected) return reject('existing-value-conflict');
    if (!selected) {
      const results = await fillScan(original.scan, { scanId: original.scan.result.scanId,
        items: [{ fieldId: original.field.id, value: original.value, confirmed: true }] }, context.signal, undefined,
      () => owns(original.control.fingerprint));
      if (!context.current()) return reject('step-aborted');
      if (results.length !== 1 || results[0]!.status !== 'filled') return reject('page-preparation-failed');
    }
    const accepted = currentControlFingerprint(original.control, original.field.id);
    if (!owns(accepted)) return reject('page-preparation-changed');
    const readyList = () => {
      if (!publicationRecordAvailability(doc).eligible) return undefined;
      const scan = scanDocument(doc);
      const lists = scan.result.semanticGraph?.nodes.filter(node => node.kind === 'record-list' && node.recordType === 'publication');
      const list = lists?.length === 1 ? scan.semanticTargets.get(lists[0]!.id) : undefined;
      return list && original.section.contains(list) ? list : undefined;
    };
    const stable = await waitForDomStability({ root: original.section, quietWindowMs: 100, timeoutMs: 2_500,
      signal: context.signal, predicate: () => {
        if (!owns(accepted)) throw new Error('preparation-target-changed');
        return readyList() ?? false;
      } });
    if (!context.current()) return reject('step-aborted');
    if (stable.status !== 'stable' || !owns(accepted)) return reject('page-preparation-unverified');
    try { if (!await profileCurrent()) return reject('profile-changed'); }
    catch { return reject('profile-projection-unavailable'); }
    return owns(accepted) && readyList() === stable.value ? { ready: true } : reject('page-preparation-changed');
  };
}
