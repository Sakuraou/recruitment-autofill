// Internal internship session in disposable Chromium; no account or runtime entry.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const entry = resolve(artifacts, 'internship-session-entry.ts'); const bundle = resolve(artifacts, 'internship-session-browser.js');
await writeFile(entry, "export {createInternshipRecordSession} from '../src/content/internshipRecordSession';\nexport {internshipSessionProfile,installInternshipSessionPage} from '../tests/fixtures/internship-session-page';\n");
await build({ entryPoints: [entry], bundle: true, platform: 'browser', format: 'iife', globalName: 'InternshipSessionTest', target: 'chrome114', outfile: bundle });
const code = await readFile(bundle, 'utf8'); const report = { startedAt: new Date().toISOString(), checks: [], externalRequests: [], errors: [] };
const url = 'https://careers.example.test/internship?step=2'; let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true }); const context = await browser.newContext();
  await context.route(/^https?:/, route => route.request().url() === url
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><main></main>' })
    : (report.externalRequests.push(route.request().url()), route.abort()));
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url); await page.addScriptTag({ content: code });
  const windowlessProfile = await page.evaluate(() => window.InternshipSessionTest.internshipSessionProfile);
  for (const mode of ['complete', 'partial', 'same-company', 'same-company-dates', 'restart', 'manual', 'replace-save', 'wrong-card', 'stop', 'profile', 'unknown', 'contact', 'missing-description', 'missing-proof', 'orphan', 'dynamic', 'identity-role', 'identity-generic', 'identity-labelled-role']) {
    const result = await page.evaluate(async mode => {
      const api = window.InternshipSessionTest; const source = structuredClone(api.internshipSessionProfile);
      if (mode.startsWith('same-company')) source.internships.forEach(record => {
        record.organization = '虚构共同公司'; if (mode === 'same-company-dates') record.role = '软件实习生';
      });
      if (mode === 'missing-description') source.internships.forEach(record => { delete record.description; });
      if (mode === 'missing-proof') source.internships.forEach(record => { delete record.hasProof; });
      const original = JSON.stringify(source); const page = api.installInternshipSessionPage(document, source, ['partial', 'same-company', 'same-company-dates'].includes(mode) || mode.startsWith('identity-') ? [0] : []);
      if (mode.startsWith('identity-')) {
        page.cards[0].querySelector('h3').textContent = mode.includes('role') ? source.internships[0].role : '实习经历';
        if (mode.includes('labelled')) { const employer = document.createElement('p'); employer.textContent = '工作单位：' + source.internships[0].organization; page.cards[0].append(employer); }
      }
      let latest = source; const session = api.createInternshipRecordSession(document, source, async () => latest);
      page.add.addEventListener('click', () => {
        const form = page.list.querySelector('form');
        if (mode === 'stop') form.querySelector('input').addEventListener('input', () => session.stop());
        if (mode === 'unknown') form.insertAdjacentHTML('beforeend', '<label>陌生评估项<input></label>');
        if (mode === 'contact') form.insertAdjacentHTML('beforeend', '<label>证明人电话<input></label>');
        if (mode === 'orphan') form.insertAdjacentHTML('beforeend', '<fieldset><legend>其他问题</legend><label>所在部门<input></label></fieldset>');
        if (mode === 'wrong-card') form.querySelector('button').addEventListener('click', () => page.cards[0].querySelector('h3').textContent = '虚构错误公司');
        if (mode === 'dynamic') {
          form.querySelector('[data-test-key="department"]').parentElement.remove();
          form.querySelector('[data-test-key="workType"]').addEventListener('change', () => {
            setTimeout(() => form.querySelector('button').insertAdjacentHTML('beforebegin', '<label>所在部门<input type="text" required data-test-key="department"></label>'), 40);
          }, { once: true });
        }
      });
      let outcome;
      for (let step = 0; step < 14; step++) {
        outcome = await session.advance(); if (outcome.status !== 'advanced') break;
        if (step === 1 && mode === 'manual') page.list.querySelector('input').value = '用户手改';
        if (step === 1 && mode === 'replace-save') { const save = page.list.querySelector('form button'); save.replaceWith(save.cloneNode(true)); }
        if (step === 1 && mode === 'profile') latest = { ...source, internships: source.internships.map(record => ({ ...record, description: '新的工作描述' })) };
      }
      if (mode === 'restart') {
        const restarted = api.createInternshipRecordSession(document, source); outcome = await restarted.advance();
      }
      return { outcome, counts: page.counts, saved: page.saved, unchanged: JSON.stringify(source) === original,
        manualPreserved: page.list.querySelector('input')?.value === '用户手改', knownEmpty: page.list.querySelector('input')?.value === '' };
    }, mode);
    const good = ['complete', 'partial', 'same-company', 'same-company-dates', 'restart', 'dynamic', 'identity-labelled-role'].includes(mode);
    assert.equal(result.outcome.status, good ? 'complete' : mode === 'stop' ? 'stopped' : 'request-human', mode);
    const count = good ? ['partial', 'same-company', 'same-company-dates', 'identity-labelled-role'].includes(mode) ? 1 : 2 : mode === 'wrong-card' ? 1 : 0;
    assert.equal(result.counts.save, count, mode); assert.equal(result.counts.add, good ? count : mode.startsWith('identity-') ? 0 : 1, mode);
    assert.equal(result.counts.submit + result.counts.remove + result.counts.cancel, 0, mode); assert.equal(result.unchanged, true, mode);
    if (mode === 'manual') assert.equal(result.manualPreserved, true);
    if (['unknown', 'contact', 'missing-description', 'missing-proof', 'orphan'].includes(mode)) assert.equal(result.knownEmpty, true);
    if (good) {
      const expected = ['partial', 'same-company', 'same-company-dates', 'identity-labelled-role'].includes(mode) ? [1] : [0, 1];
      expected.forEach((sourceIndex, index) => {
        const source = windowlessProfile.internships[sourceIndex];
        assert.equal(result.saved[index].organization, mode.startsWith('same-company') ? '虚构共同公司' : source.organization, mode);
        assert.equal(result.saved[index].role, mode === 'same-company-dates' ? '软件实习生' : source.role, mode);
        for (const key of ['department', 'description', 'achievements', 'experienceType', 'workType', 'companyProperty', 'monthlySalary', 'hasProof', 'startDate', 'endDate']) assert.equal(result.saved[index][key], source[key], `${mode}: ${key}`);
      });
    }
    report.checks.push(mode + ': verified outcome and exact action counts, no unsafe actions');
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
  console.info('Internship session browser checks passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'internship-session-e2e.json'), JSON.stringify(report, null, 2)); await browser?.close(); }
