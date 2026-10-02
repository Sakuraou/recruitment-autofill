// Internal education session in disposable Chromium; no account or runtime entry.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const entry = resolve(artifacts, 'education-session-entry.ts'); const bundle = resolve(artifacts, 'education-session-browser.js');
await writeFile(entry, "export {createEducationRecordSession} from '../src/content/educationRecordSession';\nexport {educationSessionProfile,installEducationSessionPage} from '../tests/fixtures/education-session-page';\n");
await build({ entryPoints: [entry], bundle: true, platform: 'browser', format: 'iife', globalName: 'EducationSessionTest', target: 'chrome114', outfile: bundle });
const code = await readFile(bundle, 'utf8'); const report = { startedAt: new Date().toISOString(), checks: [], externalRequests: [], errors: [] };
const url = 'https://careers.example.test/education?step=2'; let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true }); const context = await browser.newContext();
  await context.route(/^https?:/, route => route.request().url() === url
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><main></main>' })
    : (report.externalRequests.push(route.request().url()), route.abort()));
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url); await page.addScriptTag({ content: code });
  const windowlessProfile = await page.evaluate(() => window.EducationSessionTest.educationSessionProfile);
  for (const mode of ['complete', 'partial', 'same-school', 'restart', 'manual', 'replace-save', 'wrong-card', 'stop', 'profile', 'unknown', 'dynamic']) {
    const result = await page.evaluate(async mode => {
      const api = window.EducationSessionTest; const source = structuredClone(api.educationSessionProfile);
      if (mode === 'same-school') source.education.forEach(record => record.school = '虚构同校大学');
      const original = JSON.stringify(source); const page = api.installEducationSessionPage(document, source, ['partial', 'same-school'].includes(mode) ? [0] : []);
      let latest = source; const session = api.createEducationRecordSession(document, source, async () => latest);
      page.add.addEventListener('click', () => {
        const form = page.list.querySelector('form');
        if (mode === 'stop') form.querySelector('input').addEventListener('input', () => session.stop());
        if (mode === 'unknown') form.insertAdjacentHTML('beforeend', '<label>陌生评估项<input></label>');
        if (mode === 'wrong-card') form.querySelector('button').addEventListener('click', () => page.cards[0].querySelector('h3').textContent = '虚构错误院校');
        if (mode === 'dynamic') {
          form.querySelector('[data-test-key="durationYears"]').parentElement.remove();
          form.querySelector('[data-test-key="educationType"]').addEventListener('change', () => {
            setTimeout(() => form.querySelector('button').insertAdjacentHTML('beforebegin', '<label>学制<input type="number" required data-test-key="durationYears"></label>'), 40);
          }, { once: true });
        }
      });
      let outcome;
      for (let step = 0; step < 14; step++) {
        outcome = await session.advance(); if (outcome.status !== 'advanced') break;
        if (step === 1 && mode === 'manual') page.list.querySelector('input').value = '用户手改';
        if (step === 1 && mode === 'replace-save') { const save = page.list.querySelector('form button'); save.replaceWith(save.cloneNode(true)); }
        if (step === 1 && mode === 'profile') latest = { ...source, education: source.education.map(record => ({ ...record, major: '新的专业' })) };
      }
      if (mode === 'restart') {
        const restarted = api.createEducationRecordSession(document, source); outcome = await restarted.advance();
      }
      return { outcome, counts: page.counts, saved: page.saved, unchanged: JSON.stringify(source) === original,
        manualPreserved: page.list.querySelector('input')?.value === '用户手改', knownEmpty: page.list.querySelector('input')?.value === '' };
    }, mode);
    const good = ['complete', 'partial', 'same-school', 'restart', 'dynamic'].includes(mode);
    assert.equal(result.outcome.status, good ? 'complete' : mode === 'stop' ? 'stopped' : 'request-human', mode);
    const count = good ? ['partial', 'same-school'].includes(mode) ? 1 : 2 : mode === 'wrong-card' ? 1 : 0;
    assert.equal(result.counts.save, count, mode); assert.equal(result.counts.add, good ? count : 1, mode);
    assert.equal(result.counts.submit + result.counts.remove + result.counts.cancel, 0, mode); assert.equal(result.unchanged, true, mode);
    if (mode === 'manual') assert.equal(result.manualPreserved, true); if (mode === 'unknown') assert.equal(result.knownEmpty, true);
    if (good) {
      const expected = ['partial', 'same-school'].includes(mode) ? [1] : [1, 0];
      expected.forEach((sourceIndex, index) => {
        const source = windowlessProfile.education[sourceIndex];
        assert.equal(result.saved[index].school, mode === 'same-school' ? '虚构同校大学' : source.school, mode);
        assert.equal(result.saved[index].major, source.major, mode);
        for (const key of ['level', 'degree', 'educationType', 'schoolProperty', 'durationYears', 'gpa', 'ranking', 'startDate', 'endDate']) assert.equal(result.saved[index][key], source[key], `${mode}: ${key}`);
      });
    }
    report.checks.push(mode + ': verified outcome and exact action counts, no unsafe actions');
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
  console.info('Education session browser checks passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'education-session-e2e.json'), JSON.stringify(report, null, 2)); await browser?.close(); }
