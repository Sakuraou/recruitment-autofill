import type { FieldDescriptor } from '../../shared/types';
import {
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ActionSemanticNode,
  type FieldSemanticNode,
  type PageSemanticGraph,
  type PageSemanticNode,
  type SectionSemanticNode,
  type SemanticActionKind,
  type SemanticBounds,
  type SemanticNode,
  type SemanticSectionRole,
} from '../../shared/semanticGraph';
import { semanticGraphProblems } from '../../shared/semanticGraphValidation';
import { contextText } from '../domUtils';
import { classifyAction, type ActionCandidate } from './actionClassifier';
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

function precedingSemanticHeading(element: Element,
  cache: HeadingLookupCache): { element: Element; role: SemanticSectionRole } | undefined {
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
  for (const heading of headings) {
    if ((heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue;
    if (heading.closest('fieldset, section, form, [role="region"], [role="group"], [role="form"]') !== boundary) continue;
    let role = cache.roles.get(heading);
    if (!role) {
      role = classifySection([{ text: contextText(heading), evidence: heading.tagName === 'LEGEND' ? 'legend' : 'heading' }]).role;
      cache.roles.set(heading, role);
    }
    if (role !== 'other') result = { element: heading, role };
  }
  return result;
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
  role: SemanticSectionRole;
  confidence: number;
  evidence: SectionLabelCandidate['evidence'][];
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
  return { anchor, ...nearby };
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

function actionableElements(roots: readonly RootEntry[]): Array<{ element: Element; framePath: number[] }> {
  const seen = new Set<Element>();
  const result: Array<{ element: Element; framePath: number[] }> = [];
  for (const entry of roots) {
    for (const element of Array.from(entry.root.querySelectorAll<Element>(ACTION_SELECTOR))) {
      if (seen.has(element) || element.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
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

  fields.forEach((field, index) => {
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
    parent.childIds.push(node.id);
    targets.set(node.id, element);
  });

  let actionIndex = 0;
  let omittedTargetedActionCount = 0;
  for (const { element, framePath } of actionableElements(roots)) {
    if (nodes.length >= 1498) break;
    const sectionMatch = sectionFor(element, headingCache);
    const classified = classifyAction(actionCandidate(element, false));
    const action = classified.action;
    if (isTargetedAction(action)) {
      omittedTargetedActionCount++;
      continue;
    }
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
    parent.childIds.push(node.id);
    targets.set(node.id, element);
  }

  const kindsById = new Map(nodes.map(node => [node.id, node.kind]));
  page.structuralFingerprint = fingerprintFor('page', doc.documentElement, [], siblingIndexes,
    page.childIds.map(id => kindsById.get(id) ?? 'field'));
  const graph: PageSemanticGraph = { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: page.id, nodes };
  const problems = semanticGraphProblems(graph, fields.map(field => field.id));
  if (problems.length) throw new Error('页面语义图未通过结构校验');
  return { graph, targets, omittedTargetedActionCount };
}
