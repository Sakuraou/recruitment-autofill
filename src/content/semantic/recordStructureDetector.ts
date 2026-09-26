import type { SemanticSectionRole } from '../../shared/semanticGraph';
import { contextText } from '../domUtils';
import type { ClassifiedAction } from './actionClassifier';

export type RepeatableSectionRole = Extract<SemanticSectionRole,
  | 'education'
  | 'student-work'
  | 'internship'
  | 'project'
  | 'award'
  | 'publication'
  | 'language'
  | 'skill'
  | 'family'>;

export type TargetedActionKind = Extract<ClassifiedAction['action'],
  'add-record' | 'edit-record' | 'save-record' | 'cancel-record' | 'delete-record'>;

export type TargetedClassifiedAction = ClassifiedAction & { action: TargetedActionKind };

export interface RecordTopologyActionDraft {
  element: Element;
  framePath: readonly number[];
  classified: TargetedClassifiedAction;
}

export interface RecordTopologyFieldDraft {
  fieldId: string;
  element: Element;
}

export interface DetectedSummaryRecord {
  root: Element;
  index: number;
  editActions: readonly RecordTopologyActionDraft[];
  deleteActions: readonly RecordTopologyActionDraft[];
}

export interface DetectedEditorRecord {
  root: Element;
  state: 'creating' | 'editing' | 'unknown';
  /** Summary index proven by a unique aria-controls/aria-owns relation; otherwise null. */
  sourceIndex: number | null;
  fields: readonly RecordTopologyFieldDraft[];
  saveActions: readonly RecordTopologyActionDraft[];
  cancelActions: readonly RecordTopologyActionDraft[];
}

export type DetectedActionOwner =
  | { kind: 'record-list'; root: Element }
  | { kind: 'summary-record'; root: Element }
  | { kind: 'editor-record'; root: Element };

export interface DetectedActionOwnership {
  /** The exact object supplied to detectRecordStructures, for identity-based consumption tracking. */
  action: RecordTopologyActionDraft;
  owner: DetectedActionOwner;
}

export interface DetectedRecordList {
  root: Element;
  recordType: RepeatableSectionRole;
  summaryRecords: readonly DetectedSummaryRecord[];
  editor?: DetectedEditorRecord;
  addActions: readonly RecordTopologyActionDraft[];
  actionOwnerships: readonly DetectedActionOwnership[];
}

export interface RecordStructureDetectionInput {
  sectionRoot: Element;
  sectionRole: SemanticSectionRole;
  actions: readonly RecordTopologyActionDraft[];
  fields: readonly RecordTopologyFieldDraft[];
}

const REPEATABLE_ROLES: ReadonlySet<SemanticSectionRole> = new Set([
  'education', 'student-work', 'internship', 'project', 'award', 'publication', 'language', 'skill', 'family',
]);

const CARD_SELECTOR = '[role="listitem"], article, li, tr';
const EXPLICIT_LIST_SELECTOR = '[role="list"], ul, ol, table, tbody';
const EDITOR_SELECTOR = 'form, fieldset, [role="dialog"]';
const FORBIDDEN_CONTEXT_SELECTOR = [
  'nav',
  '[role="navigation"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="tablist"]',
  '[role="listbox"]',
].join(',');

const ROLE_TERMS: Readonly<Record<RepeatableSectionRole, RegExp>> = {
  education: /(?:教育|学历|院校|education)/iu,
  'student-work': /(?:校内|校园|学生工作|学生干部|职务|社团|student\s*work|campus)/iu,
  internship: /(?:实习|工作经历|社会实践|internship|work\s*experience)/iu,
  project: /(?:项目|project)/iu,
  award: /(?:奖励|奖项|竞赛|荣誉|award|honou?r|competition)/iu,
  publication: /(?:论文|论著|著作|publication|paper)/iu,
  language: /(?:语言|外语|language)/iu,
  skill: /(?:技能|特长|skill)/iu,
  family: /(?:家庭|家属|成员|family)/iu,
};

function isRepeatableRole(role: SemanticSectionRole): role is RepeatableSectionRole {
  return REPEATABLE_ROLES.has(role);
}

function sameFramePath(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  const view = element.ownerDocument.defaultView;
  const visited = new Set<Element>();
  for (let current: Element | null = element; current && !visited.has(current);) {
    visited.add(current);
    if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    if (current.parentElement) {
      current = current.parentElement;
    } else {
      const root = current.getRootNode();
      current = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root
        ? (root as ShadowRoot).host : null;
    }
  }
  const closedDetails = element.closest('details:not([open])');
  return !closedDetails || element.matches('summary') || closedDetails.querySelector(':scope > summary')?.contains(element) === true;
}

function isInsideForbiddenContext(element: Element, sectionRoot: Element): boolean {
  const forbidden = element.closest(FORBIDDEN_CONTEXT_SELECTOR);
  return Boolean(forbidden && forbidden !== sectionRoot && sectionRoot.contains(forbidden));
}

function isScopedElement(element: Element, sectionRoot: Element): boolean {
  return element.getRootNode() === sectionRoot.getRootNode()
    && (element === sectionRoot || sectionRoot.contains(element))
    && isVisible(element)
    && !isInsideForbiddenContext(element, sectionRoot);
}

function referencedText(element: Element): string {
  const references = (element.getAttribute('aria-labelledby') ?? '').trim().split(/\s+/u).filter(Boolean);
  if (!references.length) return '';
  const root = element.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
  const queryRoot = root as Document | ShadowRoot;
  return references.map((reference) => {
    const target = Array.from(queryRoot.querySelectorAll<HTMLElement>('[id]'))
      .find(candidate => candidate.id === reference);
    return contextText(target ?? null);
  }).filter(Boolean).join(' ');
}

/** Used only while detecting structure. The returned text is never exposed by this module. */
function transientActionName(element: Element): string {
  const ariaName = referencedText(element) || element.getAttribute('aria-label') || '';
  if (ariaName.trim()) return ariaName.replace(/\s+/gu, ' ').trim();
  if (element.tagName === 'INPUT') return (element.getAttribute('value') ?? '').replace(/\s+/gu, ' ').trim();
  return contextText(element);
}

function transientReferencedElements(element: Element, attributeNames: readonly string[]): Element[] {
  const references = attributeNames.flatMap(name => (element.getAttribute(name) ?? '').trim().split(/\s+/u).filter(Boolean));
  if (!references.length) return [];
  const root = element.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return [];
  const candidates = Array.from((root as Document | ShadowRoot).querySelectorAll<Element>('[id]'));
  return uniqueElements(references
    .map(reference => candidates.find(candidate => candidate.id === reference))
    .filter((candidate): candidate is Element => Boolean(candidate)));
}

function isExplicitAdd(action: RecordTopologyActionDraft, role: RepeatableSectionRole): boolean {
  if (action.classified.action !== 'add-record') return false;
  const name = transientActionName(action.element);
  if (!name || /^(?:\+|新增|添加|新建|填写|add|new|create)$/iu.test(name)) return false;
  const hasAddVerb = /(?:新增|添加|新建|填写|add|new|create)/iu.test(name);
  const hasGenericRecord = /(?:经历|记录|record|experience)/iu.test(name);
  return hasAddVerb && (ROLE_TERMS[role].test(name) || hasGenericRecord);
}

function nearestCard(element: Element, listRoot: Element): Element | undefined {
  const card = element.closest(CARD_SELECTOR);
  return card && card !== listRoot && listRoot.contains(card) ? card : undefined;
}

function nearestEditor(element: Element, listRoot: Element): Element | undefined {
  const editor = element.closest(EDITOR_SELECTOR);
  return editor && editor !== listRoot && listRoot.contains(editor) ? editor : undefined;
}

function uniqueElements(elements: readonly Element[]): Element[] {
  return [...new Set(elements)];
}

function potentialListRoots(sectionRoot: Element): Element[] {
  const roots = new Set<Element>();
  for (const explicit of Array.from(sectionRoot.querySelectorAll<Element>(EXPLICIT_LIST_SELECTOR))) {
    if (isScopedElement(explicit, sectionRoot)) roots.add(explicit);
  }
  const cards = Array.from(sectionRoot.querySelectorAll<Element>(CARD_SELECTOR))
    .filter(card => isScopedElement(card, sectionRoot));
  for (const card of cards) {
    if (card.parentElement && card.parentElement !== sectionRoot && isScopedElement(card.parentElement, sectionRoot)) {
      roots.add(card.parentElement);
    }
  }
  return [...roots];
}

function cardsForList(listRoot: Element, sectionRoot: Element): Element[] {
  const cards = Array.from(listRoot.querySelectorAll<Element>(CARD_SELECTOR))
    .filter(card => isScopedElement(card, sectionRoot))
    .filter((card) => {
      const nestedList = card.parentElement?.closest(EXPLICIT_LIST_SELECTOR);
      if (listRoot.matches(EXPLICIT_LIST_SELECTOR)) return nestedList === listRoot;
      return card.parentElement === listRoot;
    })
    .filter(card => card.tagName !== 'TR'
      || Array.from(card.children).some(cell => cell.tagName === 'TD'));
  return uniqueElements(cards);
}

function editorHasCreatingHeading(editor: Element): boolean {
  const directHeading = Array.from(editor.children)
    .find(child => child.matches('legend, h1, h2, h3, h4, h5, h6, [role="heading"]'));
  const evidence = [
    editor.getAttribute('aria-label') ?? '',
    referencedText(editor),
    contextText(directHeading ?? null),
  ].join(' ').replace(/编辑器|editor/giu, ' ');
  return /(?:新增|添加|新建|create|adding|new)/iu.test(evidence);
}

function editorIdentity(editor: Element, summaries: readonly DetectedSummaryRecord[]): Pick<DetectedEditorRecord, 'state' | 'sourceIndex'> {
  const controllingSummaries = summaries.filter(summary => summary.editActions.some((action) => {
    const controlled = transientReferencedElements(action.element, ['aria-controls', 'aria-owns']);
    return controlled.length === 1 && controlled[0] === editor;
  }));
  const creating = editorHasCreatingHeading(editor);
  if (!creating && controllingSummaries.length === 1) {
    return { state: 'editing', sourceIndex: controllingSummaries[0]!.index };
  }
  if (creating && controllingSummaries.length === 0) return { state: 'creating', sourceIndex: null };
  return { state: 'unknown', sourceIndex: null };
}

interface CandidateList {
  detected: DetectedRecordList;
  framePath: readonly number[];
}

function detectCandidate(input: RecordStructureDetectionInput, recordType: RepeatableSectionRole,
  listRoot: Element, scopedActions: readonly RecordTopologyActionDraft[],
  scopedFields: readonly RecordTopologyFieldDraft[]): CandidateList | undefined {
  if (!isScopedElement(listRoot, input.sectionRoot) || listRoot.matches(FORBIDDEN_CONTEXT_SELECTOR)) return undefined;
  const cards = cardsForList(listRoot, input.sectionRoot);
  if (!cards.length) return undefined;

  const addActions = scopedActions.filter(action => isExplicitAdd(action, recordType))
    .filter(action => listRoot.contains(action.element))
    .filter(action => !nearestCard(action.element, listRoot) && !nearestEditor(action.element, listRoot));
  if (addActions.length !== 1) return undefined;
  const framePath = addActions[0]!.framePath;

  const summaries: DetectedSummaryRecord[] = [];
  for (const [index, card] of cards.entries()) {
    const local = scopedActions.filter(action => card.contains(action.element)
      && nearestCard(action.element, listRoot) === card
      && sameFramePath(action.framePath, framePath));
    const editActions = local.filter(action => action.classified.action === 'edit-record');
    const deleteActions = local.filter(action => action.classified.action === 'delete-record');
    if (editActions.length !== 1 || deleteActions.length !== 1) return undefined;
    summaries.push({ root: card, index, editActions, deleteActions });
  }
  if (summaries.length < 2 && summaries.length !== 1) return undefined;

  const validEditors: DetectedEditorRecord[] = [];
  for (const editor of Array.from(listRoot.querySelectorAll<Element>(EDITOR_SELECTOR))) {
    if (!isScopedElement(editor, input.sectionRoot) || nearestCard(editor, listRoot)) continue;
    const fields = scopedFields.filter(field => editor.contains(field.element)
      && nearestEditor(field.element, listRoot) === editor
      && !field.element.matches('input[type="hidden"]'));
    if (fields.length < 2) continue;
    const localActions = scopedActions.filter(action => editor.contains(action.element)
      && nearestEditor(action.element, listRoot) === editor
      && sameFramePath(action.framePath, framePath));
    const saveActions = localActions.filter(action => action.classified.action === 'save-record');
    const cancelActions = localActions.filter(action => action.classified.action === 'cancel-record');
    if (saveActions.length !== 1 || cancelActions.length !== 1) continue;
    const identity = editorIdentity(editor, summaries);
    validEditors.push({ root: editor, ...identity, fields, saveActions, cancelActions });
  }
  if (validEditors.length > 1) return undefined;
  const editor = validEditors[0];

  const actionOwnerships: DetectedActionOwnership[] = [
    ...addActions.map(action => ({ action, owner: { kind: 'record-list' as const, root: listRoot } })),
    ...summaries.flatMap(summary => [
      ...summary.editActions.map(action => ({ action, owner: { kind: 'summary-record' as const, root: summary.root } })),
      ...summary.deleteActions.map(action => ({ action, owner: { kind: 'summary-record' as const, root: summary.root } })),
    ]),
    ...(editor ? [
      ...editor.saveActions.map(action => ({ action, owner: { kind: 'editor-record' as const, root: editor.root } })),
      ...editor.cancelActions.map(action => ({ action, owner: { kind: 'editor-record' as const, root: editor.root } })),
    ] : []),
  ];

  return {
    framePath,
    detected: {
      root: listRoot,
      recordType,
      summaryRecords: summaries,
      editor,
      addActions,
      actionOwnerships,
    },
  };
}

/**
 * Conservatively detects one repeatable-record topology inside a verified semantic section.
 *
 * The detector is read-only: it never reads live control values or state, focuses, clicks,
 * scrolls, dispatches events, or mutates the DOM. Human-readable text is used transiently
 * to disambiguate explicit actions/editor state and is never included in the result.
 */
export function detectRecordStructures(input: RecordStructureDetectionInput): DetectedRecordList[] {
  const role = input.sectionRole;
  if (!isRepeatableRole(role) || input.sectionRoot.matches(FORBIDDEN_CONTEXT_SELECTOR)
    || !isScopedElement(input.sectionRoot, input.sectionRoot)) return [];
  const scopedActions = input.actions.filter(action => isScopedElement(action.element, input.sectionRoot))
    .filter(action => !action.element.matches('[role="tab"], [role="menuitem"], [role="option"]'));
  const scopedFields = input.fields.filter(field => isScopedElement(field.element, input.sectionRoot));
  const candidates = potentialListRoots(input.sectionRoot)
    .map(root => detectCandidate(input, role, root, scopedActions, scopedFields))
    .filter((candidate): candidate is CandidateList => Boolean(candidate));

  // Nested/overlapping candidates or multiple separate lists are ambiguous in this first slice.
  if (candidates.length !== 1) return [];
  const candidate = candidates[0]!;
  const consumedActions = new Set(candidate.detected.actionOwnerships.map(item => item.action));
  const conflictingTargetedAction = scopedActions.some(action => sameFramePath(action.framePath, candidate.framePath)
    && candidate.detected.root.contains(action.element)
    && !consumedActions.has(action));
  return conflictingTargetedAction ? [] : [candidate.detected];
}
