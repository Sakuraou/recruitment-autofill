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
  assert.equal(externalRequests, 0);
  assert.deepEqual(errors, []);
  const report = { browser: browser.version(), checks: 5, externalRequests, pageErrors: errors.length, result };
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(resolve(root, 'artifacts/control-adapters-e2e.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
