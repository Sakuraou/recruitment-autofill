import type { FieldDescriptor } from '../../shared/types';
import {
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ActionSemanticNode,
  type FieldSemanticNode,
  type PageSemanticGraph,
  type PageSemanticNode,
  type RecordListSemanticNode,
  type RecordSemanticNode,
  type SectionSemanticNode,
  type SemanticActionKind,
  type SemanticBounds,
  type SemanticNode,
  type SemanticSectionRole,
} from '../../shared/semanticGraph';
import { semanticGraphProblems } from '../../shared/semanticGraphValidation';
import { contextText } from '../domUtils';
import { isEducationHighestQuestionGroup } from './educationQuestionGroup';
import { classifyAction, type ActionCandidate, type ClassifiedAction } from './actionClassifier';
import {
  detectRecordStructures,
  type RecordTopologyActionDraft,
  type RecordTopologyFieldDraft,
  type RecordTopologyTargetedActionDraft,
} from './recordStructureDetector';
import { classifySection, type SectionLabelCandidate } from './sectionClassifier';
import { structuralFingerprint, type StructuralFingerprintInput } from './structuralFingerprint';

interface ControlReference { node: Element }

export interface SemanticGraphBuildResult {
  graph: PageSemanticGraph;
  /** Page-local references for future executors; never serialize or persist this map. */
  targets: Map<string, Element>;
  /** Targeted actions stay out of the graph until a real RecordList/Record target exists. */
  omittedTargetedActionCount: number;
}

interface RootEntry {
  root: Document | ShadowRoot;
  framePath: number[];
}

interface CollectedAction {
  element: Element;
  framePath: number[];
  sectionMatch?: SectionMatch;
  candidate: ActionCandidate;
  classified: ClassifiedAction;
}

const ACTION_SELECTOR = [
  'button',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="image"]',
  'input[type="file"]',
  'input[type="reset"]',
  'a[href]',
  'a[role="button"]',
  '[role="button"]',
  '[role="tab"]',
  '[aria-expanded]',
].join(',');

type TargetedActionKind = Extract<SemanticActionKind,
  'add-record' | 'edit-record' | 'save-record' | 'cancel-record' | 'delete-record'>;
const TARGETED_ACTIONS: ReadonlySet<TargetedActionKind> = new Set([
  'add-record', 'edit-record', 'save-record', 'cancel-record', 'delete-record',
]);

function isTargetedAction(action: SemanticActionKind): action is TargetedActionKind {
  return TARGETED_ACTIONS.has(action as TargetedActionKind);
}

function asRecordTopologyAction(draft: CollectedAction): RecordTopologyActionDraft {
  return {
    element: draft.element,
    framePath: draft.framePath,
    candidate: draft.candidate,
    classified: draft.classified,
  };
}

const CANONICAL_SECTION_HEADINGS: Readonly<Record<SemanticSectionRole, string>> = {
  basic: '基本信息',
  'job-intent': '求职意向',
  education: '教育经历',
  'student-work': '校内经历',
  internship: '实习与工作经历',
  project: '项目经历',
  award: '奖励与竞赛',
  publication: '论文与论著',
  language: '语言能力',
  skill: '技能特长',
  family: '家庭信息',
  other: '其他信息',
};

function rootsForDocument(doc: Document): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [doc];
  const seen = new Set<Document | ShadowRoot>(roots);
  const visit = (root: Document | ShadowRoot): void => {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (element.shadowRoot && !seen.has(element.shadowRoot)) {
        seen.add(element.shadowRoot);
        roots.push(element.shadowRoot);
        visit(element.shadowRoot);
      }
    }
  };
  visit(doc);
  return roots;
}

/** Enumerates accessible roots without retaining frame names, URLs, titles or DOM identifiers. */
function collectRoots(topDocument: Document): RootEntry[] {
  const result: RootEntry[] = [];
  const seenDocuments = new Set<Document>();
  const visitDocument = (doc: Document, framePath: number[]): void => {
    if (seenDocuments.has(doc)) return;
    seenDocuments.add(doc);
    const localRoots = rootsForDocument(doc);
    localRoots.forEach(root => result.push({ root, framePath }));
    const frames = localRoots.flatMap(root => Array.from(root.querySelectorAll<HTMLIFrameElement>('iframe, frame')));
    frames.forEach((frame, index) => {
      try {
        const child = frame.contentDocument;
        if (child) visitDocument(child, [...framePath, index]);
      } catch {
        // Browser origin boundaries are expected; inaccessible frames stay outside the graph.
      }
    });
  };
  visitDocument(topDocument, []);
  return result;
}

function siblingIndex(element: Element, cache: WeakMap<Element, number>): number {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const parent = element.parentElement;
  if (!parent) return 0;
  Array.from(parent.children).forEach((child, index) => cache.set(child, index));
  return cache.get(element) ?? 0;
}

function boundsFor(element: Element, framePath: readonly number[]): SemanticBounds | undefined {
  const rect = element.getBoundingClientRect();
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return undefined;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    coordinateSpace: framePath.length ? 'frame-viewport' : 'viewport',
  };
}

function fingerprintFor(kind: StructuralFingerprintInput['kind'], element: Element | undefined,
  framePath: readonly number[], siblingIndexes: WeakMap<Element, number>,
  childKinds: readonly StructuralFingerprintInput['kind'][] = []): string {
  const tagName = element?.tagName.toLowerCase();
  return structuralFingerprint({
    kind,
    tagName: element?.tagName,
    role: element?.getAttribute('role') ?? undefined,
    inputType: tagName === 'input' || tagName === 'button'
      ? (element as HTMLInputElement | HTMLButtonElement).type : undefined,
    siblingIndex: element ? siblingIndex(element, siblingIndexes) : 0,
    framePath,
    childKinds,
    attributeNames: element?.getAttributeNames(),
  });
}

function referencedText(element: Element): string {
  const ids = (element.getAttribute('aria-labelledby') ?? '').trim().split(/\s+/u).filter(Boolean);
  if (!ids.length) return '';
  const root = element.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
  const candidates = Array.from((root as Document | ShadowRoot).querySelectorAll<HTMLElement>('[id]'));
  return ids.map(id => candidates.find(candidate => candidate.id === id)).map(element => contextText(element ?? null)).filter(Boolean).join(' ');
}

function directHeadingElement(container: Element): Element | undefined {
  return Array.from(container.children)
    .find(element => element.matches('legend, h1, h2, h3, h4, h5, h6, [role="heading"]'));
}

interface HeadingLookupCache {
  headings: WeakMap<Node, Element[]>;
  roles: WeakMap<Element, SemanticSectionRole>;
}

interface SemanticHeadingMatch {
  element: Element;
  role: SemanticSectionRole;
  scopeRoot: Element | ShadowRoot;
  nextPeer?: Element;
}

function headingLevel(element: Element): number | undefined {
  const native = /^H([1-6])$/u.exec(element.tagName)?.[1];
  if (native) return Number.parseInt(native, 10);
  const aria = element.getAttribute('aria-level');
  return aria && /^[1-6]$/u.test(aria.trim()) ? Number.parseInt(aria, 10) : undefined;
}

function isSameOrHigherHeading(candidate: Element, reference: Element): boolean {
  const candidateLevel = headingLevel(candidate);
  const referenceLevel = headingLevel(reference);
  if (candidateLevel !== undefined && referenceLevel !== undefined) return candidateLevel <= referenceLevel;
  return candidate.tagName === reference.tagName;
}

function depthWithinScope(element: Element, scope: Node): number {
  let depth = 0;
  for (let current: Node | null = element; current && current !== scope; current = current.parentNode) depth++;
  return depth;
}

function isHeadingInsideRecordContainer(heading: Element, boundary: Element | null): boolean {
  const strongContainer = heading.closest('[role="listitem"], li, tr, [role="dialog"]');
  if (strongContainer && (!boundary || boundary.contains(strongContainer))) return true;
  const article = heading.closest('article');
  const list = article?.parentElement?.closest('[role="list"], ul, ol, table, tbody');
  return Boolean(article && list && (!boundary || boundary.contains(article)));
}

function precedingSemanticHeading(element: Element,
  cache: HeadingLookupCache): SemanticHeadingMatch | undefined {
  const root = element.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return undefined;
  const scope = element.closest('fieldset, section, form, [role="region"], [role="group"], [role="form"]')
    ?? root as Document | ShadowRoot;
  const boundary = element.closest('fieldset, section, form, [role="region"], [role="group"], [role="form"]');
  let headings = cache.headings.get(scope);
  if (!headings) {
    headings = Array.from(scope.querySelectorAll<Element>('legend, h1, h2, h3, h4, h5, h6, [role="heading"]'));
    cache.headings.set(scope, headings);
  }
  let result: { element: Element; role: SemanticSectionRole } | undefined;
  let unknownBoundary: Element | undefined;
  for (const heading of headings) {
    if ((heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue;
    if (heading.closest('fieldset, section, form, [role="region"], [role="group"], [role="form"]') !== boundary) continue;
    if (isHeadingInsideRecordContainer(heading, boundary)
      || !visibleActionElement(heading)) continue;
    if (result && !isSameOrHigherHeading(heading, result.element)) continue;
    if (!result && unknownBoundary && !isSameOrHigherHeading(heading, unknownBoundary)) continue;
    let role = cache.roles.get(heading);
    if (!role) {
      role = classifySection([{ text: contextText(heading), evidence: heading.tagName === 'LEGEND' ? 'legend' : 'heading' }]).role;
      cache.roles.set(heading, role);
    }
    if (result && role === result.role
      && depthWithinScope(heading, scope) > depthWithinScope(result.element, scope)) continue;
    if (role === 'other') {
      if (result) {
        unknownBoundary = heading;
        result = undefined;
      }
      continue;
    }
    result = { element: heading, role };
    unknownBoundary = undefined;
  }
  if (!result) return undefined;
  const startLevel = headingLevel(result.element);
  const startIndex = headings.indexOf(result.element);
  const nextPeer = headings.slice(startIndex + 1).find((heading) => {
    if (heading.closest('fieldset, section, form, [role="region"], [role="group"], [role="form"]') !== boundary) return false;
    if (isHeadingInsideRecordContainer(heading, boundary)) return false;
    if (!visibleActionElement(heading)) return false;
    let role = cache.roles.get(heading);
    if (!role) {
      role = classifySection([{ text: contextText(heading), evidence: heading.tagName === 'LEGEND' ? 'legend' : 'heading' }]).role;
      cache.roles.set(heading, role);
    }
    if (role === result!.role
      && depthWithinScope(heading, scope) > depthWithinScope(result!.element, scope)) return false;
    const level = headingLevel(heading);
    return startLevel === undefined ? heading.tagName === result!.element.tagName
      : level !== undefined && level <= startLevel;
  });
  const scopeRoot = scope.nodeType === Node.DOCUMENT_NODE
    ? result.element.ownerDocument.body ?? result.element.parentElement
    : scope as Element | ShadowRoot;
  return scopeRoot ? { ...result, scopeRoot, nextPeer } : undefined;
}

function candidatesFor(container: Element): SectionLabelCandidate[] {
  const result: SectionLabelCandidate[] = [];
  if (container.matches('fieldset')) {
    const legend = Array.from(container.children).find(child => child.tagName === 'LEGEND');
    const text = contextText(legend ?? null);
    if (text) result.push({ text, evidence: 'legend' });
  }
  const heading = contextText(directHeadingElement(container) ?? null);
  if (heading) result.push({ text: heading, evidence: 'heading' });
  const ariaName = referencedText(container) || container.getAttribute('aria-label') || '';
  if (ariaName) result.push({ text: ariaName, evidence: 'aria-name' });
  return result;
}

interface SectionMatch {
  container?: Element;
  anchor?: Element;
  scopeRoot?: Element | ShadowRoot;
  scopeStart?: Element;
  scopeEnd?: Element;
  role: SemanticSectionRole;
  confidence: number;
  evidence: SectionLabelCandidate['evidence'][];
}

/** One explicit education question inside an education editor is not a new section. */
function transparentEducationQuestion(container: Element): boolean {
  if (!isEducationHighestQuestionGroup(container)) return false;
  for (let ancestor = container.parentElement, depth = 0; ancestor && depth < 10; ancestor = ancestor.parentElement, depth++) {
    if (!ancestor.matches('fieldset,section,form,[role="region"],[role="group"],[role="form"]')) continue;
    const candidates = ancestor.matches('form') ? candidatesFor(ancestor).filter(item => item.evidence === 'aria-name') : candidatesFor(ancestor);
    if (!candidates.length) continue;
    const roles = new Set(candidates.map(candidate => classifySection([candidate]).role).filter(role => role !== 'other'));
    if (!roles.size && ancestor.matches('form')) continue;
    return roles.size === 1 && roles.has('education');
  }
  return false;
}

function sectionFor(element: Element, headingCache: HeadingLookupCache,
  supplementalHeading = ''): SectionMatch | undefined {
  const supplemental = classifySection(supplementalHeading ? [{ text: supplementalHeading, evidence: 'heading' }] : []);
  const nearbyHeading = precedingSemanticHeading(element, headingCache);
  if (supplemental.role !== 'other' && nearbyHeading && nearbyHeading.role !== supplemental.role) return undefined;
  const nearby = supplemental.role !== 'other' ? supplemental
    : classifySection(nearbyHeading ? [{ text: contextText(nearbyHeading.element), evidence: 'heading' }] : []);
  let current: Element | null = element;
  for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
    if (current.matches('fieldset, section, form, [role="region"], [role="group"], [role="form"]')) {
      if (transparentEducationQuestion(current)) continue;
      const isWholeForm = current.matches('form');
      if (isWholeForm && nearby.role !== 'other') continue;
      const candidates = isWholeForm
        ? candidatesFor(current).filter(candidate => candidate.evidence === 'aria-name')
        : candidatesFor(current);
      if (!candidates.length) continue;
      const candidateRoles = new Set(candidates.map(candidate => classifySection([candidate]).role).filter(role => role !== 'other'));
      if (candidateRoles.size > 1) return undefined;
      const classified = classifySection(candidates);
      if (classified.role === 'other') {
        if (!isWholeForm) return undefined;
        continue;
      }
      if (nearby.role !== 'other' && nearby.role !== classified.role) return undefined;
      return { container: current, ...classified };
    }
  }
  if (nearby.role === 'other') return undefined;
  const anchor = nearbyHeading?.element
    ?? element.closest('fieldset, section, [role="region"], [role="group"], [role="form"]')
    ?? element.parentElement
    ?? element;
  return {
    anchor,
    scopeRoot: nearbyHeading?.scopeRoot,
    scopeStart: nearbyHeading?.element,
    scopeEnd: nearbyHeading?.nextPeer,
    ...nearby,
  };
}

function actionName(element: Element): string {
  const ariaName = referencedText(element) || element.getAttribute('aria-label') || '';
  if (ariaName.trim()) return ariaName;
  if (element.tagName === 'INPUT') return element.getAttribute('value') ?? '';
  return contextText(element);
}

function actionCandidate(element: Element, recordContext: boolean): ActionCandidate {
  const tagName = element.tagName.toLowerCase();
  const isAnchor = tagName === 'a';
  const ariaExpanded = element.hasAttribute('aria-expanded')
    ? element.getAttribute('aria-expanded') === 'true' : undefined;
  return {
    accessibleName: actionName(element),
    tagName: element.tagName,
    role: element.getAttribute('role') ?? undefined,
    inputType: tagName === 'input' || tagName === 'button'
      ? (element as HTMLInputElement | HTMLButtonElement).type : undefined,
    disabled: (tagName === 'input' || tagName === 'button' ? (element as HTMLInputElement | HTMLButtonElement).disabled : false)
      || element.matches(':disabled') || element.closest('[aria-disabled="true"], [inert]') !== null,
    href: isAnchor && element.hasAttribute('href')
      ? (() => {
        const href = (element.getAttribute('href') ?? '').trim();
        return href === '' || href === '#' || /^javascript:\s*(?:;|void\s*\(\s*0\s*\)\s*;?)?$/iu.test(href)
          ? href : '__navigation__';
      })() : undefined,
    target: isAnchor && element.hasAttribute('target')
      ? (element.getAttribute('target')?.trim().toLowerCase() === '_self' ? '_self' : '__other__') : undefined,
    ariaExpanded,
    recordContext,
  };
}

function visibleActionElement(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  const visited = new Set<Element>();
  for (let current: Element | null = element; current && !visited.has(current);) {
    visited.add(current);
    if (current.hasAttribute('hidden') || current.hasAttribute('inert')
      || current.getAttribute('aria-hidden') === 'true') return false;
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
      || style?.contentVisibility === 'hidden') return false;
    if (current.parentElement) current = current.parentElement;
    else {
      const root = current.getRootNode();
      current = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root
        ? (root as ShadowRoot).host : null;
    }
  }
  const closedDetails = element.closest('details:not([open])');
  return !closedDetails || closedDetails.querySelector(':scope > summary')?.contains(element) === true;
}

function actionableElements(roots: readonly RootEntry[]): Array<{ element: Element; framePath: number[] }> {
  const seen = new Set<Element>();
  const result: Array<{ element: Element; framePath: number[] }> = [];
  for (const entry of roots) {
    for (const element of Array.from(entry.root.querySelectorAll<Element>(ACTION_SELECTOR))) {
      if (seen.has(element) || !visibleActionElement(element)) continue;
      seen.add(element);
      result.push({ element, framePath: entry.framePath });
      if (result.length >= 500) return result;
    }
  }
  return result;
}

/**
 * Builds a read-only, privacy-minimized view of the page. It never clicks, focuses,
 * scrolls, dispatches events or writes to the DOM.
 */
export function buildPageSemanticGraph(doc: Document, fields: readonly FieldDescriptor[],
  controls: ReadonlyMap<string, ControlReference>): SemanticGraphBuildResult {
  const roots = collectRoots(doc);
  const framePaths = new Map<Document | ShadowRoot, number[]>(roots.map(entry => [entry.root, entry.framePath]));
  const siblingIndexes = new WeakMap<Element, number>();
  const headingCache: HeadingLookupCache = { headings: new WeakMap(), roles: new WeakMap() };
  const nodes: SemanticNode[] = [];
  const targets = new Map<string, Element>();
  const page: PageSemanticNode = {
    id: 'page:0',
    kind: 'page',
    parentId: null,
    childIds: [],
    order: 0,
    structuralFingerprint: fingerprintFor('page', doc.documentElement, [], siblingIndexes, []),
    evidence: [],
    framePath: [],
  };
  nodes.push(page);
  if (doc.documentElement) targets.set(page.id, doc.documentElement);

  const sectionsByElement = new Map<Element, SectionSemanticNode>();
  const syntheticSections = new Map<string, SectionSemanticNode>();
  let sectionIndex = 0;
  const existingSection = (match: SectionMatch, framePath: readonly number[]): SectionSemanticNode | undefined => {
    const structuralAnchor = match.container ?? match.anchor;
    if (!structuralAnchor) return syntheticSections.get(`${framePath.join('.')}:${match.role}`);
    const existing = sectionsByElement.get(structuralAnchor);
    if (existing && existing.role !== match.role) throw new Error('同一栏目锚点出现互相冲突的语义');
    return existing;
  };
  const ensureSection = (match: SectionMatch, element: Element, framePath: number[]): SectionSemanticNode => {
    const syntheticKey = `${framePath.join('.')}:${match.role}`;
    const structuralAnchor = match.container ?? match.anchor;
    const existing = existingSection(match, framePath);
    if (existing) return existing;
    if (page.childIds.length >= 500) throw new Error('页面根节点的栏目数量超出上限');
    const container = structuralAnchor;
    const node: SectionSemanticNode = {
      id: `section:${sectionIndex++}`,
      kind: 'section',
      parentId: page.id,
      childIds: [],
      order: page.childIds.length,
      structuralFingerprint: fingerprintFor('section', container ?? element, framePath, siblingIndexes),
      evidence: match.evidence,
      framePath: [...framePath],
      bounds: boundsFor(container ?? element, framePath),
      heading: CANONICAL_SECTION_HEADINGS[match.role],
      role: match.role,
      confidence: match.confidence,
    };
    nodes.push(node);
    page.childIds.push(node.id);
    if (structuralAnchor) {
      sectionsByElement.set(structuralAnchor, node);
      targets.set(node.id, structuralAnchor);
    } else {
      syntheticSections.set(syntheticKey, node);
    }
    return node;
  };

  const nodeById = new Map<string, SemanticNode>([[page.id, page]]);
  const fieldNodesById = new Map<string, FieldSemanticNode>();
  const fieldDrafts: RecordTopologyFieldDraft[] = [];
  // Scanner control families are collected separately. Semantic order follows
  // the DOM so an appended native field cannot renumber an earlier ARIA choice.
  const rootOrder = new Map(roots.map((entry, index) => [entry.root as Node, index]));
  const orderedFields = [...fields].sort((first, second) => {
    const a = controls.get(first.id)?.node; const b = controls.get(second.id)?.node;
    if (!a || !b || a === b) return 0;
    const aRoot = a.getRootNode(); const bRoot = b.getRootNode();
    if (aRoot !== bRoot) return (rootOrder.get(aRoot) ?? roots.length) - (rootOrder.get(bRoot) ?? roots.length);
    const relation = a.compareDocumentPosition(b);
    if (relation & Node.DOCUMENT_POSITION_DISCONNECTED) return 0;
    return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : relation & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
  });
  orderedFields.forEach((field, index) => {
    const control = controls.get(field.id);
    if (!control) throw new Error('扫描字段缺少页面内控件引用');
    const element = control.node;
    const root = element.getRootNode();
    const framePath = framePaths.get(root as Document | ShadowRoot);
    if (!framePath) throw new Error('扫描字段不属于已登记的页面根节点');
    const sectionMatch = sectionFor(element, headingCache, field.sectionText);
    const parent = sectionMatch ? ensureSection(sectionMatch, element, framePath) : page;
    const node: FieldSemanticNode = {
      id: `field:${index}`,
      kind: 'field',
      parentId: parent.id,
      childIds: [],
      order: parent.childIds.length,
      structuralFingerprint: fingerprintFor('field', element, framePath, siblingIndexes),
      evidence: [],
      framePath: [...framePath],
      bounds: boundsFor(element, framePath),
      fieldId: field.id,
    };
    nodes.push(node);
    nodeById.set(node.id, node);
    fieldNodesById.set(field.id, node);
    fieldDrafts.push({ fieldId: field.id, element });
    parent.childIds.push(node.id);
    targets.set(node.id, element);
  });

  const collectedActions: CollectedAction[] = actionableElements(roots).map(({ element, framePath }) => {
    const candidate = actionCandidate(element, false);
    return {
      element,
      framePath,
      sectionMatch: sectionFor(element, headingCache),
      candidate,
      classified: classifyAction(candidate),
    };
  });
  const targetedDrafts = collectedActions.filter(draft => isTargetedAction(draft.classified.action));

  let actionIndex = 0;
  let listIndex = 0;
  let recordIndex = 0;
  const emittedTargetedElements = new Set<Element>();
  const topologyGroups = new Map<Element, { match: SectionMatch; framePath: number[]; actions: RecordTopologyActionDraft[] }>();
  for (const draft of collectedActions) {
    // A bare plus may be the only action in an empty collection. Seed inspection
    // without emitting a capability; the topology detector must prove ownership.
    if (!isTargetedAction(draft.classified.action)
      && (!(draft.element.hasAttribute('aria-controls') || draft.element.hasAttribute('aria-owns'))
        || classifyAction({ ...draft.candidate, recordContext: true }).action !== 'add-record')) continue;
    const match = draft.sectionMatch;
    const sectionRoot = match?.container ?? match?.anchor;
    if (!match || !sectionRoot) continue;
    if (!topologyGroups.has(sectionRoot)) {
      topologyGroups.set(sectionRoot, { match, framePath: draft.framePath, actions: [] });
    }
  }
  for (const draft of collectedActions) {
    const sectionRoot = draft.sectionMatch?.container ?? draft.sectionMatch?.anchor;
    const group = sectionRoot ? topologyGroups.get(sectionRoot) : undefined;
    if (group) group.actions.push(asRecordTopologyAction(draft));
  }

  const appendTargetedAction = (draft: RecordTopologyTargetedActionDraft,
    parent: RecordListSemanticNode | RecordSemanticNode): void => {
    const node: ActionSemanticNode = {
      id: `action:${actionIndex++}`,
      kind: 'action',
      parentId: parent.id,
      childIds: [],
      order: parent.childIds.length,
      structuralFingerprint: fingerprintFor('action', draft.element, draft.framePath, siblingIndexes),
      evidence: draft.classified.action === 'add-record' ? ['add-action']
        : draft.classified.action === 'edit-record' ? ['edit-action'] : ['editor-actions'],
      framePath: [...draft.framePath],
      bounds: boundsFor(draft.element, draft.framePath),
      action: draft.classified.action,
      risk: draft.classified.risk,
      disabled: draft.classified.disabled,
      canonicalLabel: draft.classified.canonicalLabel,
      targetId: parent.id,
    };
    nodes.push(node);
    nodeById.set(node.id, node);
    parent.childIds.push(node.id);
    targets.set(node.id, draft.element);
    emittedTargetedElements.add(draft.element);
  };

  for (const [sectionIdentity, group] of topologyGroups) {
    const currentSection = existingSection(group.match, group.framePath);
    const sectionFields = currentSection
      ? fieldDrafts.filter(field => fieldNodesById.get(field.fieldId)?.parentId === currentSection.id)
      : [];
    const detected = detectRecordStructures({
      sectionRoot: group.match.scopeRoot ?? sectionIdentity,
      sectionStart: group.match.scopeStart,
      sectionEnd: group.match.scopeEnd,
      sectionRole: group.match.role,
      actions: group.actions,
      fields: sectionFields,
    });
    if (detected.length !== 1) continue;
    const topology = detected[0]!;
    const editorFieldCount = topology.editor?.fields.length ?? 0;
    const targetedCount = topology.actionOwnerships.length;
    const extraNodeCount = 1 + topology.summaryRecords.length + (topology.editor ? 1 : 0) + targetedCount;
    const listChildCount = topology.summaryRecords.length + (topology.editor ? 1 : 0) + topology.addActions.length;
    const sectionNodeCount = currentSection ? 0 : 1;
    if (nodes.length + sectionNodeCount + extraNodeCount > 1500 || listChildCount > 500) continue;
    if (!currentSection && page.childIds.length >= 500) continue;
    if (topology.summaryRecords.some(record => record.editActions.length + record.deleteActions.length > 500)
      || editorFieldCount + (topology.editor?.saveActions.length ?? 0) + (topology.editor?.cancelActions.length ?? 0) > 500) continue;

    const section = ensureSection(group.match, sectionIdentity, group.framePath);
    if (section.childIds.length >= 500) continue;
    nodeById.set(section.id, section);
    const list: RecordListSemanticNode = {
      id: `record-list:${listIndex++}`,
      kind: 'record-list',
      parentId: section.id,
      childIds: [],
      order: section.childIds.length,
      structuralFingerprint: fingerprintFor('record-list', topology.root, group.framePath, siblingIndexes),
      evidence: topology.summaryRecords.length
        ? ['repeated-structure', 'add-action']
        : topology.editor ? ['add-action', 'editor-actions'] : ['add-action'],
      framePath: [...group.framePath],
      bounds: boundsFor(topology.root, group.framePath),
      recordType: topology.recordType,
      existingRecordCount: topology.summaryRecords.length,
      editorState: topology.editor?.state ?? 'closed',
    };
    nodes.push(list);
    nodeById.set(list.id, list);
    section.childIds.push(list.id);
    targets.set(list.id, topology.root);

    for (const summary of topology.summaryRecords) {
      const record: RecordSemanticNode = {
        id: `record:${recordIndex++}`,
        kind: 'record',
        parentId: list.id,
        childIds: [],
        order: list.childIds.length,
        structuralFingerprint: fingerprintFor('record', summary.root, group.framePath, siblingIndexes),
        evidence: ['repeated-structure', 'edit-action'],
        framePath: [...group.framePath],
        bounds: boundsFor(summary.root, group.framePath),
        index: summary.index,
        state: 'summary',
      };
      nodes.push(record);
      nodeById.set(record.id, record);
      list.childIds.push(record.id);
      targets.set(record.id, summary.root);
      summary.editActions.forEach(action => appendTargetedAction(action, record));
      summary.deleteActions.forEach(action => appendTargetedAction(action, record));
    }

    if (topology.editor) {
      const editor = topology.editor;
      const editorRecord: RecordSemanticNode = {
        id: `record:${recordIndex++}`,
        kind: 'record',
        parentId: list.id,
        childIds: [],
        order: list.childIds.length,
        structuralFingerprint: fingerprintFor('record', editor.root, group.framePath, siblingIndexes),
        evidence: ['editor-actions'],
        framePath: [...group.framePath],
        bounds: boundsFor(editor.root, group.framePath),
        index: editor.state === 'editing'
          ? (editor.sourceIndex ?? topology.summaryRecords.length)
          : topology.summaryRecords.length,
        state: editor.state,
      };
      nodes.push(editorRecord);
      nodeById.set(editorRecord.id, editorRecord);
      list.childIds.push(editorRecord.id);
      targets.set(editorRecord.id, editor.root);
      for (const field of editor.fields) {
        const fieldNode = fieldNodesById.get(field.fieldId);
        if (!fieldNode) continue;
        const oldParent = fieldNode.parentId ? nodeById.get(fieldNode.parentId) : undefined;
        if (oldParent) {
          oldParent.childIds = oldParent.childIds.filter(id => id !== fieldNode.id);
          oldParent.childIds.forEach((id, order) => {
            const child = nodeById.get(id);
            if (child) child.order = order;
          });
        }
        fieldNode.parentId = editorRecord.id;
        fieldNode.order = editorRecord.childIds.length;
        editorRecord.childIds.push(fieldNode.id);
      }
      editor.saveActions.forEach(action => appendTargetedAction(action, editorRecord));
      editor.cancelActions.forEach(action => appendTargetedAction(action, editorRecord));
    }
    topology.addActions.forEach(action => appendTargetedAction(action, list));
  }

  for (const { element, framePath, sectionMatch, classified } of collectedActions) {
    if (nodes.length >= 1498) break;
    const action = classified.action;
    if (emittedTargetedElements.has(element) || isTargetedAction(action)) continue;
    let parent: PageSemanticNode | SectionSemanticNode = page;
    if (sectionMatch) {
      const existing = existingSection(sectionMatch, framePath);
      if (!existing && page.childIds.length >= 500) continue;
      parent = existing ?? ensureSection(sectionMatch, element, framePath);
    }
    else if (classified.risk !== 'restricted') {
      const match: SectionMatch = { role: 'other', confidence: 0, evidence: [] };
      const existing = existingSection(match, framePath);
      if (!existing && page.childIds.length >= 500) continue;
      parent = existing ?? ensureSection(match, element, framePath);
    }
    if (parent.childIds.length >= 500) continue;
    const node: ActionSemanticNode = {
      id: `action:${actionIndex++}`,
      kind: 'action',
      parentId: parent.id,
      childIds: [],
      order: parent.childIds.length,
      structuralFingerprint: fingerprintFor('action', element, framePath, siblingIndexes),
      evidence: classified.action === 'expand' || classified.action === 'select-tab' ? ['aria-name'] : [],
      framePath: [...framePath],
      bounds: boundsFor(element, framePath),
      action,
      risk: classified.risk,
      disabled: classified.disabled,
      canonicalLabel: classified.canonicalLabel,
    };
    nodes.push(node);
    nodeById.set(node.id, node);
    parent.childIds.push(node.id);
    targets.set(node.id, element);
  }

  const omittedTargetedActionCount = targetedDrafts
    .filter(draft => !emittedTargetedElements.has(draft.element)).length;

  const kindsById = new Map(nodes.map(node => [node.id, node.kind]));
  page.structuralFingerprint = fingerprintFor('page', doc.documentElement, [], siblingIndexes,
    page.childIds.map(id => kindsById.get(id) ?? 'field'));
  const graph: PageSemanticGraph = { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: page.id, nodes };
  const problems = semanticGraphProblems(graph, fields.map(field => field.id));
  if (problems.length) throw new Error('页面语义图未通过结构校验');
  return { graph, targets, omittedTargetedActionCount };
}
