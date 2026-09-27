// Browser-only regression for the bounded DOM waiter. Uses a disposable page with no network or user data.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const bundle = await build({
  entryPoints: [resolve(root, 'src/content/domStability.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'DomStabilityTest',
  platform: 'browser',
  target: 'chrome114',
  write: false,
});
const source = bundle.outputFiles[0]?.text;
assert.ok(source, 'DOM stability bundle was not generated');

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const report = { startedAt: new Date().toISOString(), checks: [], results: {} };
try {
  const page = await browser.newPage();
  await page.route('https://fixture.invalid/slow-frame', async route => {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>replacement frame</p>' });
  });
  await page.route(/^https:\/\/fixture\.invalid\/slow-location/, async route => {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>replacement location</p>' });
  });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('about:blank');
  await page.addScriptTag({ content: source });
  const results = await page.evaluate(async () => {
    const wait = window.DomStabilityTest.waitForDomStability;
    const summary = result => ({ status: result.status, elapsedMs: result.elapsedMs, relevantMutations: result.relevantMutations });
    const clear = () => document.body.replaceChildren();
    let unhandledRejections = 0;
    const onUnhandledRejection = event => {
      unhandledRejections++;
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    clear();
    const asyncRoot = document.createElement('section');
    document.body.append(asyncRoot);
    const asyncPredicate = summary(await wait({
      root: asyncRoot,
      predicate: async () => { throw new Error('async browser fixture failure'); },
      quietWindowMs: 30,
      timeoutMs: 300,
    }));
    await new Promise(resolveDelay => setTimeout(resolveDelay, 20));

    clear();
    const delayedRoot = document.createElement('section');
    document.body.append(delayedRoot);
    const delayedWaiting = wait({
      root: delayedRoot,
      predicate: () => delayedRoot.querySelector('[data-ready]') ?? undefined,
      quietWindowMs: 30,
      timeoutMs: 300,
    });
    setTimeout(() => {
      const ready = document.createElement('div');
      ready.dataset.ready = 'true';
      delayedRoot.append(ready);
    }, 10);
    const delayed = summary(await delayedWaiting);

    clear();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameRoot = frame.contentDocument.createElement('section');
    frame.contentDocument.body.append(frameRoot);
    const frameWaiting = wait({ root: frameRoot, predicate: () => frameRoot, quietWindowMs: 50, timeoutMs: 300 });
    setTimeout(() => frame.remove(), 10);
    const removedFrame = summary(await frameWaiting);

    clear();
    const detachedFrame = document.createElement('iframe');
    document.body.append(detachedFrame);
    const detachedRoot = detachedFrame.contentDocument.createElement('section');
    detachedFrame.contentDocument.body.append(detachedRoot);
    detachedFrame.remove();
    const alreadyDetachedFrame = summary(await wait({
      root: detachedRoot,
      predicate: () => detachedRoot,
      quietWindowMs: 30,
      timeoutMs: 300,
    }));

    clear();
    const navigatingFrame = document.createElement('iframe');
    document.body.append(navigatingFrame);
    const navigatingRoot = navigatingFrame.contentDocument.createElement('section');
    navigatingFrame.contentDocument.body.append(navigatingRoot);
    const navigatingWaiting = wait({ root: navigatingRoot, predicate: () => navigatingRoot, quietWindowMs: 80, timeoutMs: 500 });
    setTimeout(() => { navigatingFrame.src = 'https://fixture.invalid/slow-frame'; }, 10);
    const navigationStarted = summary(await navigatingWaiting);

    clear();
    const locationFrame = document.createElement('iframe');
    document.body.append(locationFrame);
    const locationRoot = locationFrame.contentDocument.createElement('section');
    locationFrame.contentDocument.body.append(locationRoot);
    const locationWaiting = wait({ root: locationRoot, predicate: () => locationRoot, quietWindowMs: 80, timeoutMs: 500 });
    setTimeout(() => { locationFrame.contentWindow.location.href = 'https://fixture.invalid/slow-location'; }, 10);
    const locationNavigationStarted = summary(await locationWaiting);

    clear();
    const parent = document.createElement('main');
    const movedRoot = document.createElement('section');
    parent.append(movedRoot);
    document.body.append(parent);
    const movedWaiting = wait({ root: movedRoot, predicate: () => movedRoot, quietWindowMs: 50, timeoutMs: 300 });
    setTimeout(() => {
      movedRoot.remove();
      parent.append(movedRoot);
    }, 10);
    const removedAndReattached = summary(await movedWaiting);

    clear();
    const shadowFrame = document.createElement('iframe');
    document.body.append(shadowFrame);
    const host = shadowFrame.contentDocument.createElement('div');
    shadowFrame.contentDocument.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowWaiting = wait({ root: shadow, predicate: () => shadow, quietWindowMs: 50, timeoutMs: 300 });
    setTimeout(() => shadowFrame.remove(), 10);
    const shadowFrameRemoved = summary(await shadowWaiting);

    clear();
    const outerFrame = document.createElement('iframe');
    document.body.append(outerFrame);
    const innerFrame = outerFrame.contentDocument.createElement('iframe');
    outerFrame.contentDocument.body.append(innerFrame);
    const nestedRoot = innerFrame.contentDocument.createElement('section');
    innerFrame.contentDocument.body.append(nestedRoot);
    const nestedWaiting = wait({ root: nestedRoot, predicate: () => nestedRoot, quietWindowMs: 50, timeoutMs: 300 });
    setTimeout(() => outerFrame.remove(), 10);
    const nestedFrameRemoved = summary(await nestedWaiting);

    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    return { asyncPredicate, unhandledRejections, delayed, removedFrame, alreadyDetachedFrame, navigationStarted,
      locationNavigationStarted, removedAndReattached, shadowFrameRemoved, nestedFrameRemoved };
  });

  assert.equal(results.asyncPredicate.status, 'predicate-failed');
  assert.equal(results.unhandledRejections, 0);
  assert.deepEqual(pageErrors, []);
  assert.equal(results.delayed.status, 'stable');
  assert.ok(results.delayed.elapsedMs >= 30 && results.delayed.elapsedMs < 300);
  for (const name of ['removedFrame', 'alreadyDetachedFrame', 'navigationStarted', 'locationNavigationStarted',
    'removedAndReattached', 'shadowFrameRemoved', 'nestedFrameRemoved']) {
    assert.equal(results[name].status, 'root-disconnected', `${name}: ${JSON.stringify(results[name])}`);
  }
  report.results = results;
  report.checks.push('Rejected async predicates fail without an unhandled rejection');
  report.checks.push('Delayed root waits for a quiet window in Chromium');
  report.checks.push('Same-origin iframe removal invalidates its old document root');
  report.checks.push('Already-detached iframe documents fail closed');
  report.checks.push('Slow iframe navigation invalidates the old root before load');
  report.checks.push('Navigation API invalidates location-initiated slow navigation before load');
  report.checks.push('Transient root removal and reattachment fails closed');
  report.checks.push('Cross-realm ShadowRoot follows its containing iframe lifecycle');
  report.checks.push('Nested same-origin iframe roots track every containing frame');
  await page.close();
} finally {
  await browser.close();
}

await writeFile(resolve(artifacts, 'dom-stability-browser-report.json'), JSON.stringify(report, null, 2));
console.info(JSON.stringify(report, null, 2));
