// Disposable MV3 verification for the separately compiled, fictional record-v2 fixture build.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'artifacts');
const url = 'http://localhost:3000/repeatable-records?case=happy';
const report = { startedAt: new Date().toISOString(), checks: [], externalRequests: [], errors: [] };
await mkdir(artifacts, { recursive: true });
const html = await readFile(resolve(root, 'tests/fixtures/record-v2.html'), 'utf8');
let context;

function build(testBuild) {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: root,
    windowsHide: true,
    encoding: 'utf8',
    env: { ...process.env, RA_RECORD_V2_TEST_BUILD: testBuild ? '1' : '0' },
  });
  if (result.status !== 0) throw new Error(`record-v2 ${testBuild ? 'test' : 'production'} build failed\n${result.stdout}\n${result.stderr}`);
}

try {
  build(true);
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`,
      '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'],
  });
  context.setDefaultTimeout(15_000);
  await context.route(/^https?:/, async route => {
    if (route.request().url() === url) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    } else {
      report.externalRequests.push(route.request().url());
      await route.abort();
    }
  });
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const initial = context.pages()[0];
  const browserSession = context.browser() ? await context.browser().newBrowserCDPSession()
    : await context.newCDPSession(initial);
  report.browser = (await browserSession.send('Browser.getVersion')).product;

  async function grant(page) {
    const targets = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    const target = targets.find(item => item.url === page.url());
    assert.ok(target, `fixture target missing: ${page.url()}`);
    await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
  }

  async function popupFor(page) {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async targetUrl => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(candidate => candidate.url === targetUrl);
      if (!tab?.id) throw new Error('fixture tab missing');
      await chrome.tabs.update(tab.id, { active: true });
    }, page.url());
    await popup.evaluate(async targetUrl => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(candidate => candidate.url === targetUrl);
      if (!tab?.id) throw new Error('fixture tab missing');
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] });
    }, page.url());
    return popup;
  }

  async function message(popup, payload) {
    return popup.evaluate(async request => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, request, { frameId: 0 });
    }, payload);
  }

  const page = await context.newPage();
  await page.goto(url);
  await page.locator('#record-list').waitFor();
  await grant(page);
  let popup = await popupFor(page);

  const initialStatus = await message(popup, { type: 'RA_RECORD_V2_STATUS' });
  assert.deepEqual(initialStatus.data.state, { enabled: true, state: 'idle', snapshotVersion: 0 });
  const injected = await message(popup, { type: 'RA_RECORD_V2_START', payload: { selector: '#fixture-submit' } });
  assert.deepEqual(injected, { ok: false, error: '无效的扩展请求' });
  assert.equal((await message(popup, { type: 'RA_RECORD_V2_START' })).data.state, 'ready');
  assert.equal((await message(popup, { type: 'RA_RECORD_V2_START' })).ok, false);
  assert.equal((await message(popup, { type: 'RA_RECORD_V2_PAUSE' })).data.state, 'paused');
  assert.equal((await message(popup, { type: 'RA_RECORD_V2_RESUME' })).data.state, 'ready');
  report.checks.push('Test build accepts only strict empty messages; duplicate start is rejected and pause/resume are explicit');

  const concurrent = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return Promise.all([
      chrome.tabs.sendMessage(tab.id, { type: 'RA_RECORD_V2_ADVANCE' }, { frameId: 0 }),
      chrome.tabs.sendMessage(tab.id, { type: 'RA_RECORD_V2_ADVANCE' }, { frameId: 0 }),
    ]);
  });
  assert.deepEqual(concurrent.map(item => item.data.status).sort(), ['advanced', 'busy']);
  await popup.close();
  popup = await popupFor(page);
  assert.equal((await message(popup, { type: 'RA_RECORD_V2_STATUS' })).data.state.state, 'ready');
  report.checks.push('Concurrent advance consumes one step; reopening the extension page preserves the content-script session');

  let complete = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await message(popup, { type: 'RA_RECORD_V2_ADVANCE' });
    assert.equal(response.ok, true);
    if (response.data.status === 'complete') { complete = true; break; }
    assert.equal(response.data.status, 'advanced');
  }
  assert.equal(complete, true);
  const completed = await page.evaluate(() => ({ ...window.fixture,
    cardIds: [...document.querySelectorAll('[data-ra-v2-card="v1"]')].map(card => Number(card.dataset.raV2Intent)).sort() }));
  assert.deepEqual(completed.cardIds, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual({ add: completed.add, save: completed.save }, { add: 4, save: 4 });
  assert.deepEqual({ delete: completed.delete, upload: completed.upload, next: completed.next, submit: completed.submit },
    { delete: 0, upload: 0, next: 0, submit: 0 });
  report.completed = completed;
  report.checks.push('Two existing fictional projects plus four missing projects complete in 12 one-step actions; unsafe actions stay at zero');

  await page.evaluate(() => history.pushState({}, '', '/repeatable-records?case=changed'));
  const changed = await message(popup, { type: 'RA_RECORD_V2_STATUS' });
  assert.deepEqual(changed.data.state, { enabled: true, state: 'request-human', snapshotVersion: 0,
    reason: 'page-changed' });
  report.checks.push('A same-document route change invalidates and stops the previous session');
  await popup.close();

  const broken = await context.newPage();
  await broken.goto(url);
  await broken.locator('[data-ra-v2-card="v1"]').first().evaluate(card => { card.dataset.raV2Intent = 'unknown'; });
  await grant(broken);
  const brokenPopup = await popupFor(broken);
  assert.equal((await message(brokenPopup, { type: 'RA_RECORD_V2_START' })).ok, true);
  const refused = await message(brokenPopup, { type: 'RA_RECORD_V2_ADVANCE' });
  assert.deepEqual(refused.data, { status: 'request-human', snapshotVersion: 1, reason: 'identity-insufficient' });
  const brokenCounts = await broken.evaluate(() => ({ add: window.fixture.add, save: window.fixture.save,
    delete: window.fixture.delete, upload: window.fixture.upload, next: window.fixture.next, submit: window.fixture.submit }));
  assert.deepEqual(brokenCounts, { add: 0, save: 0, delete: 0, upload: 0, next: 0, submit: 0 });
  report.checks.push('Corrupt identity evidence requests human review before any page action');

  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  try { build(false); }
  catch (error) {
    report.productionRestoreFailure = error instanceof Error ? error.stack : String(error);
    report.passed = false;
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifacts, 'record-v2-e2e.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
}
