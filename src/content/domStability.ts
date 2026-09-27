export type DomStabilityRoot = Element | ShadowRoot;
type DomStabilityPending = false | null | undefined;

interface DomStabilityMeta {
  elapsedMs: number;
  relevantMutations: number;
}

export type DomStabilityResult<T> =
  | (DomStabilityMeta & { status: 'stable'; value: T })
  | (DomStabilityMeta & { status: 'timeout' | 'aborted' | 'root-disconnected' })
  | (DomStabilityMeta & { status: 'predicate-failed'; stage: 'connection' | 'predicate' | 'mutation-filter'; error: unknown });

type DomStabilityOutcome<T> =
  | { status: 'stable'; value: T }
  | { status: 'timeout' | 'aborted' | 'root-disconnected' }
  | { status: 'predicate-failed'; stage: 'connection' | 'predicate' | 'mutation-filter'; error: unknown };

export interface DomStabilityObservation {
  childList?: boolean;
  characterData?: boolean;
  attributes?: readonly string[];
}

export interface DomStabilityOptions<T> {
  root: DomStabilityRoot;
  /** A synchronous, read-only condition. Returning nullish or false means “keep waiting”. */
  predicate: () => T | DomStabilityPending;
  quietWindowMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  observe?: DomStabilityObservation;
  isRelevantMutation?: (mutation: MutationRecord) => boolean;
}

const MAX_TIMEOUT_MS = 60_000;
const MAX_FRAME_DEPTH = 10;
const MAX_ANCESTOR_DEPTH = 256;
const DEFAULT_ATTRIBUTES = [
  'aria-busy',
  'aria-checked',
  'aria-controls',
  'aria-current',
  'aria-disabled',
  'aria-expanded',
  'aria-haspopup',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'aria-level',
  'aria-multiselectable',
  'aria-owns',
  'aria-posinset',
  'aria-pressed',
  'aria-readonly',
  'aria-required',
  'aria-rowcount',
  'aria-selected',
  'aria-setsize',
  'checked',
  'class',
  'contenteditable',
  'disabled',
  'for',
  'form',
  'hidden',
  'href',
  'id',
  'inert',
  'multiple',
  'open',
  'readonly',
  'required',
  'role',
  'selected',
  'style',
  'tabindex',
  'target',
  'type',
] as const;

function timing(name: string, value: number, maximum = MAX_TIMEOUT_MS): void {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be a finite positive number no greater than ${maximum}`);
  }
}

function normalizedObservation(observe: DomStabilityObservation | undefined): MutationObserverInit {
  const childList = observe?.childList ?? true;
  const characterData = observe?.characterData ?? false;
  const attributes = [...new Set(observe?.attributes ?? DEFAULT_ATTRIBUTES)];
  if (attributes.some(name => !name.trim())) throw new TypeError('Observed attribute names must not be empty');
  if (!childList && !characterData && attributes.length === 0) throw new TypeError('At least one mutation type must be observed');
  return {
    subtree: true,
    childList,
    characterData,
    attributes: attributes.length > 0,
    ...(attributes.length ? { attributeFilter: attributes } : {}),
  };
}

function shadowHost(node: Node): Element | undefined {
  if (node.nodeType !== 11) return undefined;
  const host = (node as unknown as { host?: Node }).host;
  return host?.nodeType === 1 ? host as Element : undefined;
}

interface FrameBoundary {
  document: Document;
  frame: Element & { contentDocument: Document | null };
}

interface ConnectionContext {
  root: DomStabilityRoot;
  anchors: Node[];
  documents: Document[];
  frames: FrameBoundary[];
}

interface DocumentLifecycle {
  view: Window;
  navigation?: EventTarget & { readonly transition?: unknown };
}

function frameBoundary(documentNode: Document): FrameBoundary | undefined {
  try {
    const frame = documentNode.defaultView?.frameElement;
    if (!frame || !('contentDocument' in frame)) return undefined;
    return { document: documentNode, frame: frame as FrameBoundary['frame'] };
  } catch {
    return undefined;
  }
}

function connectionContext(root: DomStabilityRoot): ConnectionContext {
  const rootAnchor = shadowHost(root) ?? root;
  const frames: FrameBoundary[] = [];
  let documentNode: Document | null = root.ownerDocument;
  const seenDocuments = new Set<Document>();
  while (documentNode) {
    if (seenDocuments.has(documentNode)) throw new RangeError('DOM connection chain contains a document cycle');
    seenDocuments.add(documentNode);
    const boundary = frameBoundary(documentNode);
    if (!boundary) break;
    if (frames.length >= MAX_FRAME_DEPTH) throw new RangeError(`DOM frame depth exceeds ${MAX_FRAME_DEPTH}`);
    frames.push(boundary);
    documentNode = boundary.frame.ownerDocument;
  }
  return { root, frames, documents: [...seenDocuments], anchors: [rootAnchor, ...frames.map(boundary => boundary.frame)] };
}

function documentLifecycles(context: ConnectionContext): DocumentLifecycle[] {
  return context.documents.flatMap(documentNode => {
    const view = documentNode.defaultView;
    if (!view) return [];
    const navigation = (view as Window & { navigation?: DocumentLifecycle['navigation'] }).navigation;
    return [{ view, ...(navigation && typeof navigation.addEventListener === 'function' ? { navigation } : {}) }];
  });
}

function navigationInProgress(context: ConnectionContext, lifecycles: readonly DocumentLifecycle[]): boolean {
  if (lifecycles.some(lifecycle => Boolean(lifecycle.navigation?.transition))) return true;
  return context.documents.some(documentNode => {
    const view = documentNode.defaultView;
    if (!view) return true;
    try {
      return view.location.href !== documentNode.URL;
    } catch {
      return true;
    }
  });
}

function connected(context: ConnectionContext): boolean {
  const host = shadowHost(context.root);
  if (!context.root.ownerDocument.defaultView || !context.root.isConnected || (host && !host.isConnected)) return false;
  return context.frames.every(boundary => {
    try {
      return boundary.frame.isConnected && boundary.frame.contentDocument === boundary.document;
    } catch {
      return false;
    }
  });
}

function appendParentTargets(anchor: Node, targets: Node[], seen: Set<Node>): void {
  let current: Node | null = anchor;
  for (let depth = 0; current; depth++) {
    if (depth >= MAX_ANCESTOR_DEPTH) throw new RangeError(`DOM ancestor depth exceeds ${MAX_ANCESTOR_DEPTH}`);
    const parentNode: Node | null = current.parentNode;
    if (parentNode) {
      if (!seen.has(parentNode)) { seen.add(parentNode); targets.push(parentNode); }
      current = parentNode;
      continue;
    }
    const host = shadowHost(current);
    current = host ?? null;
  }
}

function connectionTargets(context: ConnectionContext): Node[] {
  const targets: Node[] = [];
  const seen = new Set<Node>();
  for (const anchor of context.anchors) appendParentTargets(anchor, targets, seen);
  return targets;
}

function removedConnectionAnchor(records: readonly MutationRecord[], anchors: readonly Node[]): boolean {
  return records.some(record => [...record.removedNodes].some(removed => anchors.some(anchor => removed === anchor || removed.contains(anchor))));
}

function changedFrameSource(records: readonly MutationRecord[], frames: readonly FrameBoundary[]): boolean {
  return records.some(record => record.type === 'attributes'
    && (record.attributeName === 'src' || record.attributeName === 'srcdoc')
    && frames.some(boundary => record.target === boundary.frame));
}

function matched<T>(value: T | false | null | undefined): value is T {
  return value !== false && value !== null && value !== undefined;
}

function thenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    && typeof (value as { then?: unknown }).then === 'function';
}

function consumeThenable(value: PromiseLike<unknown>): void {
  try {
    void Promise.resolve(value).catch(() => undefined);
  } catch {
    // The synchronous predicate error below remains the public failure reason.
  }
}

/**
 * Arms observers synchronously and resolves only after a matching predicate survives a quiet window.
 * For action postconditions, create this waiter before triggering the action so navigation cannot be missed.
 */
export function waitForDomStability<T, Predicate extends () => T | DomStabilityPending>(
  options: DomStabilityOptions<T> & { predicate: Predicate }
    & (ReturnType<Predicate> extends PromiseLike<unknown> ? never : unknown),
): Promise<DomStabilityResult<T>> {
  timing('timeoutMs', options.timeoutMs);
  timing('quietWindowMs', options.quietWindowMs, options.timeoutMs);
  const observation = normalizedObservation(options.observe);
  const startedAt = performance.now();
  const deadline = startedAt + options.timeoutMs;
  const immediate = (result: Exclude<DomStabilityOutcome<T>, { status: 'stable' }>): Promise<DomStabilityResult<T>> => Promise.resolve({
    ...result,
    elapsedMs: Math.max(0, performance.now() - startedAt),
    relevantMutations: 0,
  } as DomStabilityResult<T>);
  if (options.signal?.aborted) return immediate({ status: 'aborted' });
  let connection: ConnectionContext;
  let connectionPath: Node[];
  let lifecycles: DocumentLifecycle[];
  try {
    connection = connectionContext(options.root);
    connectionPath = connectionTargets(connection);
    lifecycles = documentLifecycles(connection);
  } catch (error) {
    return immediate({ status: 'predicate-failed', stage: 'connection', error });
  }
  if (performance.now() >= deadline) return immediate({ status: 'timeout' });
  if (!connected(connection) || navigationInProgress(connection, lifecycles)) return immediate({ status: 'root-disconnected' });

  return new Promise(resolve => {
    let settled = false;
    let relevantMutations = 0;
    let lastRelevantAt = startedAt;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;

    const elapsed = (): number => Math.max(0, performance.now() - startedAt);
    const rootObserver = new MutationObserver(records => { handleRecords(records); });
    const connectionObserver = new MutationObserver(records => {
      if (settled) return;
      if (performance.now() >= deadline) { finish({ status: 'timeout' }); return; }
      if (removedConnectionAnchor(records, connection.anchors) || changedFrameSource(records, connection.frames)
        || !connected(connection)) {
        finish({ status: 'root-disconnected' }); return;
      }
    });
    const clearQuiet = (): void => {
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      quietTimer = undefined;
    };
    const finish = (result: DomStabilityOutcome<T>): void => {
      if (settled) return;
      settled = true;
      rootObserver.disconnect();
      connectionObserver.disconnect();
      clearQuiet();
      clearTimeout(hardTimer);
      options.signal?.removeEventListener('abort', onAbort);
      for (const boundary of connection.frames) boundary.frame.removeEventListener('load', onFrameLoad);
      for (const lifecycle of lifecycles) {
        lifecycle.navigation?.removeEventListener('navigate', onNavigationStart);
        lifecycle.view.removeEventListener('pagehide', onNavigationStart);
        lifecycle.view.removeEventListener('beforeunload', onNavigationStart);
      }
      resolve({ ...result, elapsedMs: elapsed(), relevantMutations } as DomStabilityResult<T>);
    };
    const read = (): T | false | null | undefined => {
      try {
        const value = options.predicate();
        if (thenable(value)) {
          consumeThenable(value);
          throw new TypeError('DOM stability predicates must be synchronous');
        }
        return value;
      } catch (error) {
        finish({ status: 'predicate-failed', stage: 'predicate', error });
        return undefined;
      }
    };
    const beforeRead = (): boolean => {
      if (settled) return false;
      if (performance.now() >= deadline) { finish({ status: 'timeout' }); return false; }
      if (options.signal?.aborted) { finish({ status: 'aborted' }); return false; }
      if (!connected(connection) || navigationInProgress(connection, lifecycles)) {
        finish({ status: 'root-disconnected' }); return false;
      }
      return true;
    };
    const finalizeQuietWindow = (): void => {
      quietTimer = undefined;
      if (!beforeRead()) return;
      const pending = rootObserver.takeRecords();
      if (pending.length && handleRecords(pending)) return;
      if (!beforeRead()) return;
      const value = read();
      if (settled) return;
      if (!beforeRead()) return;
      if (matched(value)) finish({ status: 'stable', value });
    };
    const scheduleQuiet = (): void => {
      clearQuiet();
      const remaining = Math.max(0, lastRelevantAt + options.quietWindowMs - performance.now());
      quietTimer = setTimeout(finalizeQuietWindow, remaining);
    };
    const evaluate = (): void => {
      if (!beforeRead()) return;
      const value = read();
      if (settled || !beforeRead()) return;
      if (matched(value)) scheduleQuiet();
      else clearQuiet();
    };
    function handleRecords(records: readonly MutationRecord[]): boolean {
      if (!beforeRead()) return false;
      let count = 0;
      try {
        for (const record of records) if (!options.isRelevantMutation || options.isRelevantMutation(record)) count++;
      } catch (error) {
        finish({ status: 'predicate-failed', stage: 'mutation-filter', error });
        return false;
      }
      if (!count) return false;
      relevantMutations += count;
      lastRelevantAt = performance.now();
      clearQuiet();
      evaluate();
      return true;
    }
    function onAbort(): void {
      if (settled) return;
      finish({ status: performance.now() >= deadline ? 'timeout' : 'aborted' });
    }
    function onFrameLoad(): void {
      if (settled) return;
      if (performance.now() >= deadline) { finish({ status: 'timeout' }); return; }
      if (!connected(connection)) finish({ status: 'root-disconnected' });
    }
    function onNavigationStart(): void {
      if (settled) return;
      if (performance.now() >= deadline) { finish({ status: 'timeout' }); return; }
      finish({ status: 'root-disconnected' });
    }

    const hardTimer = setTimeout(() => {
      if (!settled) finish({ status: 'timeout' });
    }, Math.max(0, deadline - performance.now()));
    rootObserver.observe(options.root, observation);
    for (const target of connectionPath) {
      if (performance.now() >= deadline) { finish({ status: 'timeout' }); return; }
      connectionObserver.observe(target, { childList: true });
    }
    for (const boundary of connection.frames) {
      if (performance.now() >= deadline) { finish({ status: 'timeout' }); return; }
      connectionObserver.observe(boundary.frame, { attributes: true, attributeFilter: ['src', 'srcdoc'] });
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    for (const boundary of connection.frames) boundary.frame.addEventListener('load', onFrameLoad);
    for (const lifecycle of lifecycles) {
      lifecycle.navigation?.addEventListener('navigate', onNavigationStart);
      lifecycle.view.addEventListener('pagehide', onNavigationStart);
      lifecycle.view.addEventListener('beforeunload', onNavigationStart);
    }
    if (options.signal?.aborted) { finish({ status: 'aborted' }); return; }
    if (!connected(connection)) { finish({ status: 'root-disconnected' }); return; }
    evaluate();
  });
}
