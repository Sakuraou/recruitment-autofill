import { SEMANTIC_CANONICAL_ACTION_LABELS, type SemanticSectionRole } from '../../shared/semanticGraph';
import { contextText } from '../domUtils';
import { classifyAction, type ActionCandidate, type ClassifiedAction } from './actionClassifier';

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
  candidate: ActionCandidate;
  classified: ClassifiedAction;
}

export interface RecordTopologyTargetedActionDraft extends RecordTopologyActionDraft {
  classified: TargetedClassifiedAction;
}

export interface RecordTopologyFieldDraft {
  fieldId: string;
  element: Element;
}

export interface DetectedSummaryRecord {
  root: Element;
  index: number;
  editActions: readonly RecordTopologyTargetedActionDraft[];
  deleteActions: readonly RecordTopologyTargetedActionDraft[];
}

export interface DetectedEditorRecord {
  root: Element;
  state: 'creating' | 'editing' | 'unknown';
  /** Summary index proven by a unique aria-controls/aria-owns relation; otherwise null. */
  sourceIndex: number | null;
  fields: readonly RecordTopologyFieldDraft[];
  saveActions: readonly RecordTopologyTargetedActionDraft[];
  cancelActions: readonly RecordTopologyTargetedActionDraft[];
}

export type DetectedActionOwner =
  | { kind: 'record-list'; root: Element }
  | { kind: 'summary-record'; root: Element }
  | { kind: 'editor-record'; root: Element };

export interface DetectedActionOwnership {
  /** The exact object supplied to detectRecordStructures, for identity-based consumption tracking. */
  action: RecordTopologyTargetedActionDraft;
  owner: DetectedActionOwner;
}

export interface DetectedRecordList {
  root: Element;
  recordType: RepeatableSectionRole;
  summaryRecords: readonly DetectedSummaryRecord[];
  editor?: DetectedEditorRecord;
  addActions: readonly RecordTopologyTargetedActionDraft[];
  actionOwnerships: readonly DetectedActionOwnership[];
}

export interface RecordStructureDetectionInput {
  sectionRoot: Element | ShadowRoot;
  /** Optional heading-delimited range inside a shared sectionRoot. */
  sectionStart?: Element;
  sectionEnd?: Element;
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

function mentionedRoles(text: string): RepeatableSectionRole[] {
  const roles = (Object.entries(ROLE_TERMS) as Array<[RepeatableSectionRole, RegExp]>)
    .filter(([, pattern]) => pattern.test(text))
    .map(([role]) => role);
  // “学生工作经历/校内工作经历” contains the generic internship phrase “工作经历”,
  // but the more specific campus wording owns the meaning.
  if (roles.includes('student-work') && !/(?:实习|社会实践|internship|work\s*experience)/iu.test(text)) {
    return roles.filter(role => role !== 'internship');
  }
  return roles;
}

function roleMatchesOrIsGeneric(text: string, role: RepeatableSectionRole, generic: RegExp): boolean {
  const mentioned = mentionedRoles(text);
  if (mentioned.length) return mentioned.length === 1 && mentioned[0] === role;
  return generic.test(text);
}

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
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
      || style?.contentVisibility === 'hidden') return false;
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

function isInsideForbiddenContext(element: Element, sectionRoot: Element | ShadowRoot): boolean {
  const forbidden = element.closest(FORBIDDEN_CONTEXT_SELECTOR);
  return Boolean(forbidden && forbidden !== sectionRoot && sectionRoot.contains(forbidden));
}

function isInsideHeadingRange(element: Element, input: Pick<RecordStructureDetectionInput,
  'sectionRoot' | 'sectionStart' | 'sectionEnd'>): boolean {
  if (input.sectionRoot instanceof Element && element === input.sectionRoot) return true;
  if (input.sectionStart
    && (input.sectionStart.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return false;
  if (input.sectionEnd && (element.contains(input.sectionEnd)
    || (element.compareDocumentPosition(input.sectionEnd) & Node.DOCUMENT_POSITION_FOLLOWING) === 0)) return false;
  return true;
}

function isScopedElement(element: Element, input: Pick<RecordStructureDetectionInput,
  'sectionRoot' | 'sectionStart' | 'sectionEnd'>): boolean {
  return element.getRootNode() === input.sectionRoot.getRootNode()
    && ((input.sectionRoot instanceof Element && element === input.sectionRoot) || input.sectionRoot.contains(element))
    && isInsideHeadingRange(element, input)
    && isVisible(element)
    && !isInsideForbiddenContext(element, input.sectionRoot);
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

function transientReferenceTokens(element: Element, attributeNames: readonly string[]): string[] {
  return attributeNames.flatMap(name => (element.getAttribute(name) ?? '').trim().split(/\s+/u).filter(Boolean));
}

function transientReferencedElements(element: Element, attributeNames: readonly string[]): Element[] {
  const references = transientReferenceTokens(element, attributeNames);
  if (!references.length) return [];
  const root = element.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return [];
  const candidates = Array.from((root as Document | ShadowRoot).querySelectorAll<Element>('[id]'));
  const resolved = references
    .map(reference => {
      const matches = candidates.filter(candidate => candidate.id === reference);
      return matches.length === 1 ? matches[0] : undefined;
    })
    .filter((candidate): candidate is Element => Boolean(candidate));
  if (resolved.length !== references.length) return [];
  return uniqueElements(resolved);
}

function isTargetedAction(action: ClassifiedAction['action']): action is TargetedActionKind {
  return action === 'add-record' || action === 'edit-record' || action === 'save-record'
    || action === 'cancel-record' || action === 'delete-record';
}

function targetedDraft(action: RecordTopologyActionDraft): RecordTopologyTargetedActionDraft | undefined {
  return !isNavigatingAction(action) && isTargetedAction(action.classified.action)
    ? { ...action, classified: { ...action.classified, action: action.classified.action } }
    : undefined;
}

function isNavigatingAction(action: RecordTopologyActionDraft): boolean {
  return action.candidate.href === '__navigation__' || action.candidate.target === '__other__';
}

interface AddIntent {
  action: RecordTopologyTargetedActionDraft;
  explicit: boolean;
}

function addIntent(action: RecordTopologyActionDraft, role: RepeatableSectionRole): AddIntent | undefined {
  if (isNavigatingAction(action)) return undefined;
  const name = transientActionName(action.element);
  if (!name) return undefined;
  const bare = /^(?:\+|新增|添加|新建|填写|add|new|create)$/iu.test(name);
  const competingWidget = action.element.closest([
    'select',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="menu"]',
    '[role="menubar"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="tablist"]',
    '[role="tree"]',
    '[role="treeitem"]',
    '[role="spinbutton"]',
    '[role="grid"]',
    '[role="treegrid"]',
  ].join(','));
  if (action.element.hasAttribute('aria-haspopup') || (bare && (competingWidget
    || action.element.hasAttribute('aria-expanded')))) return undefined;
  if (bare) {
    const classified = classifyAction({ ...action.candidate, accessibleName: name, recordContext: true });
    if (classified.action !== 'add-record') return undefined;
    return { action: { ...action, classified: { ...classified, action: 'add-record' } }, explicit: false };
  }
  if (action.classified.action !== 'add-record') return undefined;
  const hasAddVerb = /(?:新增|添加|新建|填写|add|new|create)/iu.test(name);
  if (!hasAddVerb || !roleMatchesOrIsGeneric(name, role, /(?:经历|记录|record|experience)/iu)) return undefined;
  const targeted = targetedDraft(action);
  return targeted ? { action: targeted, explicit: true } : undefined;
}

function editorSaveIntent(action: RecordTopologyActionDraft): RecordTopologyTargetedActionDraft | undefined {
  const targeted = targetedDraft(action);
  if (targeted?.classified.action === 'save-record') return targeted;
  const name = transientActionName(action.element).replace(/\s+/gu, ' ').trim();
  const type = action.element.matches('button, input')
    ? (action.element as HTMLButtonElement | HTMLInputElement).type.toLowerCase() : '';
  if (action.classified.action !== 'submit' || type !== 'submit' || !/^(?:保存|save)$/iu.test(name)) return undefined;
  return {
    ...action,
    classified: {
      ...action.classified,
      action: 'save-record',
      risk: 'restricted',
      canonicalLabel: SEMANTIC_CANONICAL_ACTION_LABELS['save-record'],
    },
  };
}

function hasExplicitEmptyState(listRoot: Element, role: RepeatableSectionRole): boolean {
  const statusElements = Array.from(listRoot.querySelectorAll<Element>('[role="status"], [aria-live]'));
  return statusElements.some((element) => {
    if (!isVisible(element)) return false;
    const text = contextText(element);
    const empty = /(?:暂无|尚无|还没有|没有|无可用|no\s+(?:records?|entries|experience|projects?))/iu.test(text);
    return empty && roleMatchesOrIsGeneric(text, role, /(?:经历|记录|条目|records?|entries|experience)/iu);
  });
}

function nearestEditor(element: Element, listRoot: Element | ShadowRoot): Element | undefined {
  const editor = element.closest(EDITOR_SELECTOR);
  return editor && editor !== listRoot && listRoot.contains(editor) ? editor : undefined;
}

function uniqueElements(elements: readonly Element[]): Element[] {
  return [...new Set(elements)];
}

function standardCardsForList(listRoot: Element, input: RecordStructureDetectionInput): Element[] {
  const cards = Array.from(listRoot.querySelectorAll<Element>(CARD_SELECTOR))
    .filter(card => isScopedElement(card, input))
    .filter((card) => {
      const nestedList = card.parentElement?.closest(EXPLICIT_LIST_SELECTOR);
      if (listRoot.matches(EXPLICIT_LIST_SELECTOR)) return nestedList === listRoot;
      return card.parentElement === listRoot;
    })
    .filter(card => card.tagName !== 'TR'
      || Array.from(card.children).some(cell => cell.tagName === 'TD'));
  return uniqueElements(cards);
}

function genericCardSignature(card: Element, localActions: readonly RecordTopologyActionDraft[]): string {
  const childShape = Array.from(card.children).map(child => [
    child.tagName.toLowerCase(),
    child.getAttribute('role') ?? '',
    child.children.length,
  ].join(':')).join(',');
  const actionShape = localActions.map(action => action.classified.action).sort().join(',');
  return [card.tagName.toLowerCase(), card.getAttribute('role') ?? '', childShape, actionShape].join('|');
}

function genericCardsForList(listRoot: Element, input: RecordStructureDetectionInput,
  scopedActions: readonly RecordTopologyActionDraft[]): Element[] {
  const candidates = Array.from(listRoot.children).filter(child => isScopedElement(child, input));
  const cards = candidates.filter((child) => {
    const local = scopedActions.filter(action => child.contains(action.element));
    const edits = local.filter(action => action.classified.action === 'edit-record');
    const deletes = local.filter(action => action.classified.action === 'delete-record');
    const competing = local.filter(action => action.classified.action === 'add-record'
      || action.classified.action === 'save-record' || action.classified.action === 'cancel-record');
    return edits.length === 1 && deletes.length <= 1 && competing.length === 0;
  });
  if (cards.length < 2) return [];
  const cardKinds = new Set(cards.map(card => `${card.tagName}:${card.getAttribute('role') ?? ''}`));
  if (candidates.some(child => !cards.includes(child)
    && (cardKinds.has(`${child.tagName}:${child.getAttribute('role') ?? ''}`)
      || Boolean(child.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]'))))) return [];
  const signatures = new Set(cards.map(card => genericCardSignature(card,
    scopedActions.filter(action => card.contains(action.element)))));
  return signatures.size === 1 ? cards : [];
}

function potentialListRoots(input: RecordStructureDetectionInput,
  scopedActions: readonly RecordTopologyActionDraft[]): Element[] {
  const sectionRoot = input.sectionRoot;
  const roots = new Set<Element>();
  for (const explicit of Array.from(sectionRoot.querySelectorAll<Element>(EXPLICIT_LIST_SELECTOR))) {
    if (isScopedElement(explicit, input)) roots.add(explicit);
  }
  const cards = Array.from(sectionRoot.querySelectorAll<Element>(CARD_SELECTOR))
    .filter(card => isScopedElement(card, input));
  for (const card of cards) {
    if (card.parentElement && card.parentElement !== sectionRoot && isScopedElement(card.parentElement, input)) {
      roots.add(card.parentElement);
    }
  }
  const editActions = scopedActions.filter(action => action.classified.action === 'edit-record');
  for (const action of editActions) {
    for (let current = action.element.parentElement;
      current && current !== sectionRoot; current = current.parentElement) {
      if (!isScopedElement(current, input)) continue;
      if (genericCardsForList(current, input, scopedActions).length >= 2) roots.add(current);
    }
  }
  return [...roots];
}

function cardsForList(listRoot: Element, input: RecordStructureDetectionInput,
  scopedActions: readonly RecordTopologyActionDraft[]): Element[] {
  const standard = standardCardsForList(listRoot, input);
  return standard.length ? standard : genericCardsForList(listRoot, input, scopedActions);
}

function containingCard(element: Element, cards: readonly Element[]): Element | undefined {
  const matches = cards.filter(card => card.contains(element));
  return matches.length === 1 ? matches[0] : undefined;
}

function numberAttribute(element: Element, name: string): number | undefined {
  const raw = element.getAttribute(name);
  if (raw === null || !/^-?\d+$/u.test(raw.trim())) return undefined;
  return Number.parseInt(raw, 10);
}

function hasIncompleteCollectionEvidence(listRoot: Element, cards: readonly Element[],
  input: RecordStructureDetectionInput, scopedActions: readonly RecordTopologyActionDraft[]): boolean {
  const collectionAncestors: Element[] = [];
  for (let current: Element | null = listRoot; current; current = current.parentElement) {
    collectionAncestors.push(current);
    if (current === input.sectionRoot) break;
  }
  const paginationContainers = Array.from(input.sectionRoot.querySelectorAll<Element>([
      'nav',
      '[role="navigation"]',
      '[role="group"]',
      '[aria-busy="true"]',
      '[class*="pagination" i]',
      '[class*="pager" i]',
      '[aria-label*="pagination" i]',
    ].join(','))).filter(element => element.getRootNode() === input.sectionRoot.getRootNode()
      && input.sectionRoot.contains(element) && isInsideHeadingRange(element, input) && isVisible(element));
  if (collectionAncestors.some(element => element.matches('[role="feed"], [aria-busy="true"]'))
    || paginationContainers.some(element => element.matches('nav, [role="navigation"], [aria-busy="true"], '
      + '[class*="pagination" i], [class*="pager" i], [aria-label*="pagination" i]')
      || /(?:分页|页码|翻页|pagination|pager|page\s+nav(?:igation)?)/iu
        .test(referencedText(element) || element.getAttribute('aria-label') || '')
      || (element.matches('[role="group"]')
        && Array.from(element.querySelectorAll<Element>('button, a, [role="button"]'))
          .filter(control => isVisible(control) && /^\d+$/u.test(transientActionName(control))).length >= 2))
    || scopedActions.some(action => /^(?:下一页|上一页|加载更多|显示更多|next(?:\s*page)?|prev(?:ious)?(?:\s*page)?|load\s*more|show\s*more)$/iu
      .test(transientActionName(action.element)))) return true;
  const rowCounts = collectionAncestors.map(element => numberAttribute(element, 'aria-rowcount'))
    .filter((count): count is number => count !== undefined);
  if (new Set(rowCounts).size > 1) return true;
  const rowCount = rowCounts[0];
  if (rowCount !== undefined && (rowCount < 0 || rowCount !== cards.length)) return true;
  const setSizes = cards.map(card => numberAttribute(card, 'aria-setsize'));
  if (setSizes.some(size => size !== undefined)) {
    if (setSizes.some(size => size === undefined || size! < 0 || size !== cards.length)) return true;
  }
  const positions = cards.map(card => numberAttribute(card, 'aria-posinset'));
  if (positions.some(position => position !== undefined)) {
    if (positions.some(position => position === undefined || position! <= 0)) return true;
    const sorted = [...positions] as number[];
    sorted.sort((left, right) => left - right);
    if (sorted.some((position, index) => position !== index + 1)) return true;
  }
  return false;
}

function editorSemanticText(editor: Element): string {
  const directHeading = Array.from(editor.children)
    .find(child => child.matches('legend, h1, h2, h3, h4, h5, h6, [role="heading"]'));
  return [
    editor.getAttribute('aria-label') ?? '',
    referencedText(editor),
    contextText(directHeading ?? null),
  ].join(' ').replace(/编辑器|editor/giu, ' ');
}

type EditorIdentity = Pick<DetectedEditorRecord, 'state' | 'sourceIndex'>;

interface ControlRelation {
  present: boolean;
  valid: boolean;
  target?: Element;
}

function controlRelation(action: RecordTopologyActionDraft): ControlRelation {
  const attributes = ['aria-controls', 'aria-owns'] as const;
  const tokens = transientReferenceTokens(action.element, attributes);
  if (!tokens.length) return { present: false, valid: true };
  const targets = transientReferencedElements(action.element, attributes);
  return tokens.length === 1 && targets.length === 1
    ? { present: true, valid: true, target: targets[0] }
    : { present: true, valid: false };
}

function controlsEditor(action: RecordTopologyTargetedActionDraft, editor: Element): boolean {
  const relation = controlRelation(action);
  return relation.valid && relation.target === editor;
}

function editorIdentity(editor: Element, summaries: readonly DetectedSummaryRecord[],
  addActions: readonly RecordTopologyTargetedActionDraft[], role: RepeatableSectionRole): EditorIdentity | 'conflict' | undefined {
  const controllingSummaries = summaries.filter(summary => summary.editActions.some((action) => {
    return controlsEditor(action, editor);
  }));
  const controllingAdds = addActions.filter(action => controlsEditor(action, editor));
  const evidence = editorSemanticText(editor);
  const creating = /(?:新增|添加|新建|create|adding|new)/iu.test(evidence);
  const editing = /(?:编辑|修改|edit|modify)/iu.test(evidence);
  const semanticVerb = creating || editing;
  const compatible = semanticVerb
    && roleMatchesOrIsGeneric(evidence, role, /(?:经历|记录|record|experience)/iu);
  const mentionsOtherRole = mentionedRoles(evidence).some(mentioned => mentioned !== role);
  if (mentionsOtherRole || controllingSummaries.length > 1 || controllingAdds.length > 1
    || (controllingSummaries.length && controllingAdds.length) || (creating && editing)) return 'conflict';
  if (controllingSummaries.length === 1) {
    if (creating) return 'conflict';
    return { state: 'editing', sourceIndex: controllingSummaries[0]!.index };
  }
  if (controllingAdds.length === 1) {
    if (editing) return 'conflict';
    return { state: 'creating', sourceIndex: null };
  }
  if (!compatible) return undefined;
  if (creating) return { state: 'creating', sourceIndex: null };
  return { state: 'unknown', sourceIndex: null };
}

interface CandidateList {
  detected: DetectedRecordList;
  framePath: readonly number[];
}

function detectCandidate(input: RecordStructureDetectionInput, recordType: RepeatableSectionRole,
  listRoot: Element, scopedActions: readonly RecordTopologyActionDraft[],
  scopedFields: readonly RecordTopologyFieldDraft[]): CandidateList | undefined {
  if (!isScopedElement(listRoot, input) || listRoot.matches(FORBIDDEN_CONTEXT_SELECTOR)) return undefined;
  const cards = cardsForList(listRoot, input, scopedActions);
  if (hasIncompleteCollectionEvidence(listRoot, cards, input, scopedActions)) return undefined;
  const addIntents = scopedActions.map(action => addIntent(action, recordType))
    .filter((intent): intent is AddIntent => Boolean(intent))
    .filter((intent) => {
      const inside = listRoot.contains(intent.action.element);
      if (!inside && !intent.explicit) {
        const relation = controlRelation(intent.action);
        if (!relation.valid || relation.target !== listRoot) return false;
      }
      if (inside) {
        return !containingCard(intent.action.element, cards)
          && !nearestEditor(intent.action.element, listRoot);
      }
      const otherExplicitList = intent.action.element.closest(EXPLICIT_LIST_SELECTOR);
      return !nearestEditor(intent.action.element, input.sectionRoot)
        && (!otherExplicitList || otherExplicitList === listRoot || !input.sectionRoot.contains(otherExplicitList));
    });
  if (addIntents.length !== 1) return undefined;
  const addIntentResult = addIntents[0]!;
  const addActions = [addIntentResult.action];
  const framePath = addIntentResult.action.framePath;
  const addRelation = controlRelation(addIntentResult.action);
  if (!addRelation.valid) return undefined;
  // An explicit, unique ARIA edge can prove a bare plus belongs to this list.
  // It does not prove emptiness, editor intent, or any summary card identity.
  const provenAddOwner = addIntentResult.explicit || addRelation.target === listRoot;
  if (addRelation.present && addRelation.target !== listRoot
    && (!addRelation.target || !isScopedElement(addRelation.target, input)
      || !addRelation.target.matches(EDITOR_SELECTOR))) return undefined;
  if (!listRoot.contains(addIntentResult.action.element)) {
    const explicitlyControlsList = addRelation.target === listRoot;
    const competingRecordAction = scopedActions.some((action) => {
      if (action.element === addIntentResult.action.element || listRoot.contains(action.element)) return false;
      const targeted = targetedDraft(action);
      return targeted?.classified.action === 'add-record' || targeted?.classified.action === 'edit-record'
        || targeted?.classified.action === 'delete-record';
    });
    if (competingRecordAction && !explicitlyControlsList) return undefined;
  }

  const summaries: DetectedSummaryRecord[] = [];
  for (const [index, card] of cards.entries()) {
    const local = scopedActions.filter(action => card.contains(action.element)
      && containingCard(action.element, cards) === card
      && sameFramePath(action.framePath, framePath));
    const editActions = local.map(targetedDraft)
      .filter((action): action is RecordTopologyTargetedActionDraft => action?.classified.action === 'edit-record');
    const deleteActions = local.map(targetedDraft)
      .filter((action): action is RecordTopologyTargetedActionDraft => action?.classified.action === 'delete-record');
    if (editActions.length !== 1 || deleteActions.length > 1) return undefined;
    const editRelation = controlRelation(editActions[0]!);
    if (!editRelation.valid || (editRelation.present
      && (!editRelation.target || !isScopedElement(editRelation.target, input)
        || !editRelation.target.matches(EDITOR_SELECTOR)))) return undefined;
    summaries.push({ root: card, index, editActions, deleteActions });
  }
  if (summaries.length === 1 && (summaries[0]!.deleteActions.length !== 1 || !provenAddOwner)) return undefined;
  if (summaries.length >= 2 && !addIntentResult.explicit && !listRoot.matches(EXPLICIT_LIST_SELECTOR)) return undefined;

  const validEditors: DetectedEditorRecord[] = [];
  let unverifiedEditorShellCount = 0;
  for (const editor of Array.from(input.sectionRoot.querySelectorAll<Element>(EDITOR_SELECTOR))) {
    if (!isScopedElement(editor, input)) continue;
    if (containingCard(editor, cards)) return undefined;
    const identity = editorIdentity(editor, summaries, addActions, recordType);
    if (identity === 'conflict') return undefined;
    const fields = scopedFields.filter(field => editor.contains(field.element)
      && nearestEditor(field.element, input.sectionRoot) === editor
      && !field.element.matches('input[type="hidden"]'));
    const localActions = scopedActions.filter(action => editor.contains(action.element)
      && nearestEditor(action.element, input.sectionRoot) === editor
      && sameFramePath(action.framePath, framePath));
    const saveActions = localActions.map(editorSaveIntent)
      .filter((action): action is RecordTopologyTargetedActionDraft => Boolean(action));
    const cancelActions = localActions.map(targetedDraft)
      .filter((action): action is RecordTopologyTargetedActionDraft => action?.classified.action === 'cancel-record');
    if (!identity) {
      if (fields.length >= 2 && saveActions.length === 1 && cancelActions.length === 1) {
        unverifiedEditorShellCount++;
      }
      continue;
    }
    if (fields.length < 2) return undefined;
    if (saveActions.length !== 1 || cancelActions.length !== 1) return undefined;
    validEditors.push({ root: editor, ...identity, fields, saveActions, cancelActions });
  }
  if (validEditors.length > 1 || unverifiedEditorShellCount > 1) return undefined;
  const editor = validEditors[0];
  if (!summaries.length) {
    const explicitlyEmpty = listRoot.matches(EXPLICIT_LIST_SELECTOR) && provenAddOwner
      && (hasExplicitEmptyState(listRoot, recordType) || editor?.state === 'creating');
    if (!explicitlyEmpty) return undefined;
  }

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
  if (!isRepeatableRole(role)
    || (input.sectionRoot instanceof Element
      && (input.sectionRoot.matches(FORBIDDEN_CONTEXT_SELECTOR) || !isVisible(input.sectionRoot)))) return [];
  if ((input.sectionStart && (!input.sectionRoot.contains(input.sectionStart)
      || input.sectionStart.getRootNode() !== input.sectionRoot.getRootNode()))
    || (input.sectionEnd && (!input.sectionRoot.contains(input.sectionEnd)
      || input.sectionEnd.getRootNode() !== input.sectionRoot.getRootNode()))
    || (input.sectionStart && input.sectionEnd
      && (input.sectionStart.compareDocumentPosition(input.sectionEnd) & Node.DOCUMENT_POSITION_FOLLOWING) === 0)) return [];
  const scopedActions = input.actions.filter(action => isScopedElement(action.element, input))
    .filter(action => !action.element.matches('[role="tab"], [role="menuitem"], [role="option"]'));
  const scopedFields = input.fields.filter(field => isScopedElement(field.element, input));
  const candidates = potentialListRoots(input, scopedActions)
    .map(root => detectCandidate(input, role, root, scopedActions, scopedFields))
    .filter((candidate): candidate is CandidateList => Boolean(candidate));

  // Nested/overlapping candidates or multiple separate lists are ambiguous in this first slice.
  if (candidates.length !== 1) return [];
  const candidate = candidates[0]!;
  const consumedElements = new Set(candidate.detected.actionOwnerships.map(item => item.action.element));
  const conflictingTargetedAction = scopedActions.some((action) => {
    // Save/cancel are meaningful only inside a verified editor. Global conflicts are
    // limited to actions that would create, edit, or delete a record.
    const targeted = targetedDraft(action);
    const recordIntent = targeted && (targeted.classified.action === 'add-record'
      || targeted.classified.action === 'edit-record' || targeted.classified.action === 'delete-record')
      ? targeted : addIntent(action, role)?.action;
    return Boolean(recordIntent && sameFramePath(action.framePath, candidate.framePath)
      && candidate.detected.root.contains(action.element)
      && !consumedElements.has(action.element));
  });
  return conflictingTargetedAction ? [] : [candidate.detected];
}
