import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForDomStability } from '../src/content/domStability';

const flushMutations = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('DOM stability waiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('requires a full quiet window even when the predicate already matches', async () => {
    const root = document.createElement('section');
    root.append(document.createElement('article'));
    document.body.append(root);

    const waiting = waitForDomStability({
      root,
      predicate: () => root.querySelector('article') ?? undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });
    let settled = false;
    void waiting.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(waiting).resolves.toMatchObject({ status: 'stable', elapsedMs: 100, relevantMutations: 0 });
  });

  it('waits for delayed content and then for a quiet window', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root.querySelector<HTMLElement>('[data-ready]') ?? undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    setTimeout(() => {
      const ready = document.createElement('div');
      ready.dataset.ready = 'true';
      root.append(ready);
    }, 200);

    await vi.advanceTimersByTimeAsync(299);
    let settled = false;
    void waiting.then(() => { settled = true; });
    await flushMutations();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const result = await waiting;
    expect(result.status).toBe('stable');
    if (result.status === 'stable') expect(result.value.dataset.ready).toBe('true');
  });

  it('restarts the quiet window after every relevant mutation', async () => {
    const root = document.createElement('section');
    root.dataset.state = 'ready';
    document.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root.dataset.state === 'ready' ? root : undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    for (const delay of [50, 120, 190]) setTimeout(() => root.append(document.createElement('i')), delay);
    await vi.advanceTimersByTimeAsync(289);
    let settled = false;
    void waiting.then(() => { settled = true; });
    await flushMutations();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(waiting).resolves.toMatchObject({ status: 'stable', elapsedMs: 290, relevantMutations: 3 });
  });

  it('does not restart for mutations rejected by the relevance filter', async () => {
    const root = document.createElement('section');
    const result = document.createElement('output');
    const noise = document.createElement('aside');
    root.append(result, noise);
    document.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => result,
      quietWindowMs: 100,
      timeoutMs: 1_000,
      isRelevantMutation: mutation => mutation.target === result,
    });

    setTimeout(() => noise.append(document.createElement('span')), 90);
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toMatchObject({ status: 'stable', elapsedMs: 100, relevantMutations: 0 });
  });

  it('observes delayed structural attributes used by semantic classification', async () => {
    const root = document.createElement('section');
    const editor = document.createElement('div');
    root.append(editor);
    document.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => editor.getAttribute('contenteditable') === 'true' ? editor : undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    setTimeout(() => editor.setAttribute('contenteditable', 'true'), 50);
    await vi.advanceTimersByTimeAsync(150);

    await expect(waiting).resolves.toMatchObject({ status: 'stable', elapsedMs: 150, relevantMutations: 1 });
  });

  it('can opt into character-data changes without broadening the default observer', async () => {
    const root = document.createElement('section');
    const textNode = document.createTextNode('loading');
    root.append(textNode);
    document.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root.textContent === 'ready' ? root : undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
      observe: { childList: false, characterData: true, attributes: [] },
    });

    setTimeout(() => { textNode.data = 'ready'; }, 50);
    await vi.advanceTimersByTimeAsync(150);

    await expect(waiting).resolves.toMatchObject({ status: 'stable', elapsedMs: 150, relevantMutations: 1 });
  });

  it('requires the predicate to remain satisfied through the quiet window', async () => {
    const root = document.createElement('section');
    root.className = 'ready';
    document.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root.classList.contains('ready') ? root : undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    setTimeout(() => root.classList.remove('ready'), 50);
    setTimeout(() => root.classList.add('ready'), 120);
    await vi.advanceTimersByTimeAsync(219);
    let settled = false;
    void waiting.then(() => { settled = true; });
    await flushMutations();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(waiting).resolves.toMatchObject({ status: 'stable', elapsedMs: 220, relevantMutations: 2 });
  });

  it('reports predicate failures instead of treating them as a timeout', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    let shouldThrow = false;
    const failure = new Error('fixture predicate failed');
    const waiting = waitForDomStability({
      root,
      predicate: () => {
        if (shouldThrow) throw failure;
        return undefined;
      },
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    setTimeout(() => {
      shouldThrow = true;
      root.append(document.createElement('span'));
    }, 50);
    await vi.advanceTimersByTimeAsync(50);

    const result = await waiting;
    expect(result).toMatchObject({ status: 'predicate-failed', elapsedMs: 50 });
    if (result.status === 'predicate-failed') expect(result.error).toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects and consumes asynchronous predicate failures without leaking the rejection', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    // @ts-expect-error This deliberate misuse verifies the runtime guard as well as the public type.
    const waiting = waitForDomStability({
      root,
      predicate: async () => { throw new Error('async fixture failure'); },
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await expect(waiting).resolves.toMatchObject({ status: 'predicate-failed', stage: 'predicate' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a hard timeout even while relevant mutations continue', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 250,
    });
    for (const delay of [40, 80, 120, 160, 200, 240]) setTimeout(() => root.append(document.createElement('i')), delay);

    await vi.advanceTimersByTimeAsync(250);

    await expect(waiting).resolves.toMatchObject({ status: 'timeout', elapsedMs: 250, relevantMutations: 6 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a monotonic clock when the system clock jumps', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(50);
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'));
    root.append(document.createElement('span'));
    await flushMutations();
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toMatchObject({ status: 'stable', elapsedMs: 150, relevantMutations: 1 });
  });

  it('reports an explicit abort immediately and cleans up pending work', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const controller = new AbortController();
    const predicate = vi.fn(() => undefined);
    const waiting = waitForDomStability({
      root,
      predicate,
      signal: controller.signal,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(60);
    controller.abort();
    const calls = predicate.mock.calls.length;
    const result = await waiting;
    root.append(document.createElement('span'));
    await flushMutations();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(result).toMatchObject({ status: 'aborted', elapsedMs: 60 });
    expect(predicate).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives the hard deadline priority when abort fires at the same instant', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const waiting = waitForDomStability({
      root,
      predicate: () => undefined,
      signal: controller.signal,
      quietWindowMs: 50,
      timeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toMatchObject({ status: 'timeout', elapsedMs: 100 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles pre-aborted signals and initially detached roots without installing timers', async () => {
    const attached = document.createElement('section');
    document.body.append(attached);
    const controller = new AbortController();
    controller.abort();
    await expect(waitForDomStability({
      root: attached,
      predicate: () => attached,
      signal: controller.signal,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ status: 'aborted', elapsedMs: 0 });

    const detached = document.createElement('section');
    await expect(waitForDomStability({
      root: detached,
      predicate: () => detached,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ status: 'root-disconnected', elapsedMs: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a relevance-filter failure and tears down the observer', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const failure = new Error('fixture filter failed');
    const waiting = waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 1_000,
      isRelevantMutation: () => { throw failure; },
    });

    root.append(document.createElement('span'));
    await flushMutations();
    const result = await waiting;

    expect(result).toMatchObject({ status: 'predicate-failed', stage: 'mutation-filter' });
    if (result.status === 'predicate-failed') expect(result.error).toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('distinguishes replacement of the observed root from a timeout', async () => {
    const parent = document.createElement('main');
    const root = document.createElement('section');
    parent.append(root);
    document.body.append(parent);
    const waiting = waitForDomStability({
      root,
      predicate: () => undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    setTimeout(() => root.replaceWith(document.createElement('section')), 75);
    await vi.advanceTimersByTimeAsync(75);
    await flushMutations();

    await expect(waiting).resolves.toMatchObject({ status: 'root-disconnected', elapsedMs: 75 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed when the root is moved to another parent', async () => {
    const firstParent = document.createElement('main');
    const secondParent = document.createElement('aside');
    const root = document.createElement('section');
    firstParent.append(root);
    document.body.append(firstParent, secondParent);
    const waiting = waitForDomStability({
      root,
      predicate: () => undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    secondParent.append(root);
    await flushMutations();
    expect(root.isConnected).toBe(true);

    await expect(waiting).resolves.toMatchObject({ status: 'root-disconnected' });
  });

  it('does not report stable after a root is removed and reattached in one task', async () => {
    const parent = document.createElement('main');
    const root = document.createElement('section');
    parent.append(root);
    document.body.append(parent);
    const waiting = waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(50);
    root.remove();
    parent.append(root);
    await flushMutations();

    await expect(waiting).resolves.toMatchObject({ status: 'root-disconnected', elapsedMs: 50 });
  });

  it('tracks the containing same-origin iframe as part of root connectivity', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const root = frameDocument.createElement('section');
    frameDocument.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(50);
    frame.remove();
    await flushMutations();

    await expect(waiting).resolves.toMatchObject({ status: 'root-disconnected', elapsedMs: 50 });
  });

  it('rejects a root from an iframe document that was already detached', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const root = frameDocument.createElement('section');
    frameDocument.body.append(root);
    frame.remove();

    await expect(waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ status: 'root-disconnected', elapsedMs: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('invalidates an iframe root as soon as its source starts changing', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const root = frameDocument.createElement('section');
    frameDocument.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(50);
    frame.srcdoc = '<p>replacement</p>';
    await flushMutations();

    await expect(waiting).resolves.toMatchObject({ status: 'root-disconnected', elapsedMs: 50 });
  });

  it('tracks a cross-realm open ShadowRoot inside a same-origin iframe', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const host = frameDocument.createElement('div');
    frameDocument.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const waiting = waitForDomStability({
      root: shadow,
      predicate: () => shadow,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(50);
    frame.remove();
    await flushMutations();

    await expect(waiting).resolves.toMatchObject({ status: 'root-disconnected', elapsedMs: 50 });
  });

  it('tracks every boundary of a nested same-origin iframe root', async () => {
    const outerFrame = document.createElement('iframe');
    document.body.append(outerFrame);
    const innerFrame = outerFrame.contentDocument!.createElement('iframe');
    outerFrame.contentDocument!.body.append(innerFrame);
    const root = innerFrame.contentDocument!.createElement('section');
    innerFrame.contentDocument!.body.append(root);
    const waiting = waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(50);
    outerFrame.remove();
    await flushMutations();

    await expect(waiting).resolves.toMatchObject({ status: 'root-disconnected', elapsedMs: 50 });
  });

  it('observes an open ShadowRoot and detects removal of its host', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const waiting = waitForDomStability({
      root: shadow,
      predicate: () => shadow.querySelector<HTMLElement>('[data-ready]') ?? undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });
    setTimeout(() => {
      const ready = document.createElement('span');
      ready.dataset.ready = 'true';
      shadow.append(ready);
    }, 50);
    await vi.advanceTimersByTimeAsync(150);
    const stable = await waiting;
    expect(stable.status).toBe('stable');

    const disconnected = waitForDomStability({
      root: shadow,
      predicate: () => undefined,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });
    host.remove();
    await flushMutations();
    await expect(disconnected).resolves.toMatchObject({ status: 'root-disconnected' });
  });

  it('disconnects observers and timers after a stable result', async () => {
    const root = document.createElement('section');
    document.body.append(root);
    const predicate = vi.fn(() => root);
    const waiting = waitForDomStability({
      root,
      predicate,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toMatchObject({ status: 'stable' });
    const calls = predicate.mock.calls.length;
    root.append(document.createElement('span'));
    await flushMutations();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(predicate).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed before installing observers for an excessively deep ancestor chain', async () => {
    const root = document.createElement('section');
    let current = root;
    for (let index = 0; index < 256; index++) {
      const parent = document.createElement('div');
      parent.append(current);
      current = parent;
    }
    document.body.append(current);

    await expect(waitForDomStability({
      root,
      predicate: () => root,
      quietWindowMs: 100,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ status: 'predicate-failed', stage: 'connection' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects unbounded or internally inconsistent timing options', () => {
    const root = document.createElement('section');
    document.body.append(root);
    expect(() => waitForDomStability({ root, predicate: () => root, quietWindowMs: 0, timeoutMs: 100 })).toThrow();
    expect(() => waitForDomStability({ root, predicate: () => root, quietWindowMs: 101, timeoutMs: 100 })).toThrow();
    expect(() => waitForDomStability({ root, predicate: () => root, quietWindowMs: 50, timeoutMs: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => waitForDomStability({ root, predicate: () => root, quietWindowMs: 50, timeoutMs: 60_001 })).toThrow();
  });
});
