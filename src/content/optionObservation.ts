import { describeAriaCombobox, scanDocument, type ScanState, type ScannedControl } from './scanner';
import { stableAriaComboboxListbox } from './controlAdapter';
import { currentControlFingerprint } from './controlObservation';
import { hiddenReason } from './domUtils';
import { verifyScanObservation } from './scanFreshness';
import { waitForDomStability } from './domStability';
export interface OptionObservationCapability { readonly kind: 'option-observation' }
export type OptionObservationResult = Readonly<{ status: 'observed'; optionCount: number } | { status: 'pending'; reason: string }>;
type Combo = Extract<ScannedControl, { adapter: 'aria-combobox' }>;
interface PrivateIssue {
  scan: ScanState; id: string; control: Combo; list: Element; value: string;
  meaning: string; nodeAttributes: string; listAttributes: string;
  ancestors: Array<{ node: Element; parent: Element | null; attributes: string }>;
  used: boolean;
  outside: Array<{ node: Node; parent: Node | null; children: Node[]; text: string | null; attributes?: string }>;
}
const issues = new WeakMap<OptionObservationCapability, PrivateIssue>();
const observations = new WeakMap<OptionObservationResult, ScanState>();
const emptyObservations = new WeakMap<OptionObservationResult, {
  scan: ScanState; issue: PrivateIssue; signal: AbortSignal; current: () => boolean;
}>();
const protectedMeaning = /验证码|身份认证|密码|口令|同意|协议|隐私|授权|承诺|声明|captcha|verification|password|consent|agreement|privacy|authoriz/iu;
function attrs(node: Element, allowed: readonly string[] = []): string {
  return JSON.stringify([...node.attributes].filter(a => !allowed.includes(a.name))
    .map(a => [a.name, a.value]).sort(([a], [b]) => a!.localeCompare(b!)));
}
function meaning(control: Combo, id: string): string {
  const field = describeAriaCombobox(control.node, id, control.controller);
  return JSON.stringify({ ...field, id: undefined, options: undefined, hasValue: undefined, groupId: undefined });
}
function pending(reason: string): OptionObservationResult { return Object.freeze({ status: 'pending', reason }); }

/** This private authority can only open an existing, uniquely owned empty list. */
export function captureOptionObservation(scan: ScanState, fieldId: string): OptionObservationCapability | undefined {
  try {
    const control = scan.controls.get(fieldId);
    if (control?.adapter !== 'aria-combobox' || scan.document !== document
      || control.node.getRootNode() !== scan.document || !/^https?:/u.test(scan.document.URL)
      || !['BUTTON', 'DIV', 'SPAN'].includes(control.node.tagName)
      || scan.document.defaultView?.frameElement !== null) return undefined;
    const inspection = control.controller.inspect(), field = describeAriaCombobox(control.node, fieldId, control.controller);
    const list = stableAriaComboboxListbox(control.node);
    if (!list || list.getRootNode() !== scan.document || inspection.hasValue || inspection.blockedReason
      || field.blockedReason || !field.label || protectedMeaning.test([field.label, field.name, field.htmlId, field.ariaLabel, field.title].join(' '))
      || list.querySelector('[role="option"], [role="listbox"]') || list.children.length || list.textContent?.trim()
      || control.node.getAttribute('aria-expanded') === 'true' || !verifyScanObservation(scan)) return undefined;
    const ancestors: PrivateIssue['ancestors'] = [];
    for (const anchor of [control.node, list]) {
      for (let node = anchor.parentElement; node; node = node.parentElement) {
        if (!ancestors.some(item => item.node === node)) ancestors.push({ node, parent: node.parentElement, attributes: attrs(node) });
        if (ancestors.length > 128) return undefined;
      }
    }
    const capability = Object.freeze({ kind: 'option-observation' as const });
    const outside: PrivateIssue['outside'] = [];
    const walker = scan.document.createTreeWalker(scan.document.documentElement, NodeFilter.SHOW_ALL);
    for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
      if (node !== list && list.contains(node)) continue;
      outside.push({ node, parent: node.parentNode, children: node === list ? [] : [...node.childNodes],
        text: node.nodeType === Node.TEXT_NODE ? node.nodeValue : null,
        ...(node instanceof Element ? { attributes: attrs(node, node === list ? ['hidden', 'aria-hidden', 'class', 'style']
          : node === control.node ? ['aria-expanded', 'aria-activedescendant'] : []) } : {}) });
      if (outside.length > 1500) return undefined;
    }
    issues.set(capability, { scan, id: fieldId, control, list, value: inspection.value, meaning: meaning(control, fieldId),
      nodeAttributes: attrs(control.node, ['aria-expanded', 'aria-activedescendant']),
      listAttributes: attrs(list, ['hidden', 'aria-hidden', 'class', 'style']), ancestors, outside, used: false });
    return capability;
  } catch { return undefined; }
}

function issueCurrent(issue: PrivateIssue, signal: AbortSignal, current: () => boolean): boolean {
  if (signal.aborted || !current() || issue.scan.document.URL !== issue.scan.result.url
    || !issue.control.node.isConnected || !issue.list.isConnected
    || stableAriaComboboxListbox(issue.control.node) !== issue.list
    || attrs(issue.control.node, ['aria-expanded', 'aria-activedescendant']) !== issue.nodeAttributes
    || attrs(issue.list, ['hidden', 'aria-hidden', 'class', 'style']) !== issue.listAttributes
    || meaning(issue.control, issue.id) !== issue.meaning
    || issue.control.controller.inspect().value !== issue.value
    || issue.ancestors.some(item => !item.node.isConnected || item.node.parentElement !== item.parent || attrs(item.node) !== item.attributes)) return false;
  if (issue.outside.some(item => !item.node.isConnected || item.node.parentNode !== item.parent
    || (item.node !== issue.list && (item.children.length !== item.node.childNodes.length
      || item.children.some((child, i) => child !== item.node.childNodes[i])))
    || (item.text !== null && item.text !== item.node.nodeValue)
    || (item.node instanceof Element && item.attributes !== attrs(item.node, item.node === issue.list ? ['hidden', 'aria-hidden', 'class', 'style']
      : item.node === issue.control.node ? ['aria-expanded', 'aria-activedescendant'] : [])))) return false;
  for (const [id, control] of issue.scan.controls) {
    if (id !== issue.id) {
      const fingerprint = currentControlFingerprint(control, id);
      if (!fingerprint || withoutContext(fingerprint) !== withoutContext(control.fingerprint)) return false;
    }
  }
  return true;
}

// The opened list legitimately changes surrounding section text. Outside-list text and topology
// are proven above; only these derived context strings may differ in other control descriptors.
function withoutContext(fingerprint: string): string {
  return JSON.stringify(JSON.parse(fingerprint), (key, value: unknown) =>
    ['parentText', 'previousText', 'sectionText'].includes(key) ? undefined : value);
}

function visibleEmptyList(issue: PrivateIssue): boolean {
  return issue.control.node.getAttribute('aria-expanded') === 'true'
    && !hiddenReason(issue.list) && issue.list.children.length === 0 && !issue.list.textContent?.trim();
}

function freshOriginalControls(issue: PrivateIssue): ScanState | undefined {
  const fresh = scanDocument(issue.scan.document);
  return fresh.controls.size === issue.scan.controls.size
    && [...fresh.controls.values()].every(control => [...issue.scan.controls.values()].some(original => original.node === control.node))
    ? fresh : undefined;
}

/** One bounded expansion; there is deliberately no write, selection, save or arbitrary click path. */
export async function observeOptions(capability: OptionObservationCapability, signal: AbortSignal,
  current: () => boolean): Promise<OptionObservationResult> {
  const issue = issues.get(capability);
  if (!issue || issue.used) return pending('unissued-or-consumed');
  issue.used = true;
  try {
    if (!issueCurrent(issue, signal, current) || !verifyScanObservation(issue.scan)) return pending('stale-before-opening');
    if (!await issue.control.controller.open(signal) || !issueCurrent(issue, signal, current)) return pending('opening-incomplete');
    const settled = await waitForDomStability({ root: issue.scan.document.documentElement, signal,
      quietWindowMs: 35, timeoutMs: 650, observe: { characterData: true }, predicate: () => {
        if (!issueCurrent(issue, signal, current)) throw new Error('observation invalidated');
        if (hiddenReason(issue.list)) return false;
        const options = [...issue.list.querySelectorAll('[role="option"]')];
        if (!options.length || options.length > 200 || options.some(option => option.closest('[role="listbox"]') !== issue.list
          || option.getAttribute('aria-selected') === 'true' || hiddenReason(option))) return false;
        const inspection = issue.control.controller.inspect();
        return inspection.options.length === options.length ? options.length : false;
      } });
    // Only a bounded timeout with all original evidence still current can be
    // classified as empty. Invalid/hidden/selected/oversized lists remain errors.
    if (settled.status === 'timeout' && issueCurrent(issue, signal, current) && visibleEmptyList(issue)) {
      const fresh = freshOriginalControls(issue);
      if (!fresh || !issueCurrent(issue, signal, current) || !visibleEmptyList(issue)) return pending('page-structure-changed');
      const result = pending('options-empty');
      emptyObservations.set(result, { scan: fresh, issue, signal, current });
      return result;
    }
    if (settled.status !== 'stable' || !issueCurrent(issue, signal, current)) return pending('options-not-stable');
    const fresh = freshOriginalControls(issue);
    if (!fresh) return pending('page-structure-changed');
    const result = Object.freeze({ status: 'observed' as const, optionCount: settled.value });
    observations.set(result, fresh);
    return result;
  } catch { return pending('observation-invalidated'); }
}

/** Local fresh scan only; serialized or stale results cannot authorize a later action. */
export function readOptionObservation(result: OptionObservationResult): ScanState | undefined {
  const scan = observations.get(result);
  return scan && verifyScanObservation(scan) ? scan : undefined;
}

/** Private evidence of an unanswered original empty list; never a selected answer. */
export function readEmptyOptionObservation(result: OptionObservationResult): ScanState | undefined {
  const empty = emptyObservations.get(result);
  try {
    return empty && issueCurrent(empty.issue, empty.signal, empty.current) && visibleEmptyList(empty.issue)
      && verifyScanObservation(empty.scan) ? empty.scan : undefined;
  } catch { return undefined; }
}
