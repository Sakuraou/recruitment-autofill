import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({ entryPoints: [resolve(root, 'tests/fixtures/controlled-browser.tsx')],
  bundle: true, format: 'iife', globalName: 'ControlFixtures', platform: 'browser', target: 'chrome114', write: false });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  let externalRequests = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixtureUrl = 'https://controls.fixture.invalid/';
  await page.route('**/*', route => {
    if (route.request().url() === fixtureUrl) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    externalRequests++;
    return route.abort();
  });
  await page.goto(fixtureUrl);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.ControlFixtures.runChecks());
  assert.deepEqual(result.checks, [
    { mode: 'commit', status: 'filled', optionClicks: 1, submits: 0, retained: true },
    { mode: 'user-choice', status: 'error', optionClicks: 0, submits: 0, retained: true },
    { mode: 'replace', status: 'error', optionClicks: 0, submits: 0, retained: true },
  ]);
  assert.deepEqual(result.nativeSelect, { status: 'filled', changes: 1, retained: true });
  assert.deepEqual(result.frame, { status: 'written', realmCorrect: true });
  assert.deepEqual(result.recordCheckboxes, [
    { mode: 'false-noop', status: 'advanced', reason: '', rollbackComplete: true, written: 0, clicks: 0, submits: 0, saves: 0, retained: true },
    { mode: 'rollback', status: 'request-human', reason: 'field-write-failed', rollbackComplete: true, written: 1, clicks: 2, submits: 0, saves: 0, retained: true },
    { mode: 'rollback-refused', status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false, written: 1, clicks: 2, submits: 0, saves: 0, retained: true },
  ]);
  assert.deepEqual(result.recordRadios, [
    { controlled: false, status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false,
      retained: true, frameworkRetained: true, clicks: 1 },
    { controlled: true, status: 'request-human', reason: 'rollback-incomplete', rollbackComplete: false,
      retained: true, frameworkRetained: true, clicks: 1 },
  ]);
  assert.equal(externalRequests, 0);
  assert.deepEqual(result.cancellations, [
    { mode: 'cancel', status: 'error', optionClicks: 0, submits: 0, retained: true },
    { mode: 'navigate', status: 'error', optionClicks: 0, submits: 0, retained: true },
    { mode: 'already-cancelled', status: 'skipped', optionClicks: 0, submits: 0, retained: true },
    { mode: 'native-cancel', status: 'error', optionClicks: 0, submits: 0, retained: true },
    { mode: 'record-cancel', status: 'request-human', optionClicks: 0, submits: 0, retained: true },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.activation, ['open-submit', 'open-reset', 'open-implicit', 'option-submit', 'option-reset', 'option-implicit',
    'checkbox-submit', 'radio-submit', 'anchor', 'nested-submit', 'duplicate-id', 'legal-button'].map(mode => ({
      mode, status: mode === 'legal-button' ? 'written' : 'request-human', clicks: mode === 'legal-button' ? 2 : 0,
      submits: 0, resets: 0, bound: false,
    })));
  const report = { browser: browser.version(), checks: 27, externalRequests, pageErrors: errors.length, result };
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(resolve(root, 'artifacts/control-adapters-e2e.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
