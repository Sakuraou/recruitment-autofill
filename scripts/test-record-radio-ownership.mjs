// Disposable native Chromium interactions; fictional records and no account.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
const bundle = await build({ stdin: { contents: "export {bindRecordEditor} from './src/planner/recordEditorBinder'; export {lifecycle} from './tests/fixtures/record-editor-context'; export {scanDocument} from './src/content/scanner'; export {fillScan} from './src/content/autofill';", resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'browser', format: 'iife', globalName: 'RecordRadioTest', write: false, target: 'chrome114' });
const report = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] }; let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true }); const context = await browser.newContext();
  const url = 'https://careers.example.test/radio';
  await context.route(/^https?:/, route => route.request().url() === url
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' })
    : (report.externalRequests.push(route.request().url()), route.abort()));
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  report.browser = browser.version(); await page.goto(url); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const mode of ['normal', 'outside-target', 'outside-other', 'move-before-radio', 'move-on-click', 'move-during-wait', 'move-on-rescan', 'added-member', 'editor-moved']) {
    const result = await page.evaluate(async mode => {
      const api = window.RecordRadioTest; const text = document.createElement('input');
      const first = document.createElement('input'); first.type = 'radio'; first.name = 'fictional-choice'; first.value = 'first';
      const second = document.createElement('input'); second.type = 'radio'; second.name = first.name; second.value = 'second';
      const state = api.lifecycle([text, first], new Map([[first, [first, second]]]));
      let clicks = 0, saves = 0; first.addEventListener('click', () => clicks++); second.addEventListener('click', () => clicks++);
      state.fixture.editor.querySelector('button').addEventListener('click', () => saves++);
      if (mode.startsWith('outside-')) document.body.append(second);
      if (mode === 'editor-moved') document.body.append(state.fixture.editor);
      if (mode === 'move-before-radio') text.addEventListener('input', () => document.body.append(second));
      if (mode === 'move-on-click') second.addEventListener('click', () => document.body.append(second));
      if (mode === 'move-during-wait') second.addEventListener('click', () => setTimeout(() => document.body.append(second), 20));
      let extra;
      if (mode === 'added-member') { extra = document.createElement('input'); extra.type = 'radio'; extra.name = first.name; extra.hidden = true; document.body.append(extra); extra.checked = true; }
      const outcome = await api.bindRecordEditor({ plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
        runContext: state.context, scanState: state.fixture.scanState, allowExpansion: mode === 'move-during-wait',
        provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? '虚构测试文本' : mode === 'outside-other' ? '__radio_option_0' : '__radio_option_1',
        rescan: () => { if (mode === 'move-on-rescan') document.body.append(second); return state.context.capture(state.fixture.source); } });
      return { status: outcome.status, rollbackComplete: outcome.rollbackComplete, clicks, saves,
        first: first.checked, second: second.checked, text: text.value, extra: extra?.checked };
    }, mode);
    const accepted = ['normal', 'move-on-click', 'move-during-wait', 'move-on-rescan'].includes(mode);
    assert.equal(result.status, mode === 'normal' ? 'advanced' : 'request-human', mode);
    assert.equal(result.clicks, accepted ? 1 : 0, mode); assert.equal(result.saves, 0, mode);
    if (accepted) assert.equal(result.second, true, mode);
    if (mode.startsWith('outside-') || mode === 'added-member' || mode === 'editor-moved') assert.equal(result.text, '', mode);
    if (mode === 'added-member') assert.equal(result.extra, true);
    if (accepted && mode !== 'normal') assert.equal(result.rollbackComplete, false, mode);
    report.checks.push(mode + ': complete editor ownership, no external activation or Save');
  }
  for (const mode of ['inside', 'hidden', 'form-associated', 'during-input']) {
    const result = await page.evaluate(async mode => {
      const api = window.RecordRadioTest;
      document.body.innerHTML = '<label>姓名<input id="fictional-name"></label><form id="fictional-form"><p>性别</p><label><input type="radio" name="gender">男</label><label><input type="radio" name="gender">女</label></form>';
      const state = api.scanDocument(document); const extra = document.createElement('input'); extra.type = 'radio'; extra.name = 'gender';
      if (mode === 'hidden') extra.hidden = true;
      const insert = () => { if (mode === 'form-associated') { extra.setAttribute('form', 'fictional-form'); document.body.append(extra); }
        else document.querySelector('form').append(extra); extra.checked = true; };
      if (mode === 'during-input') document.querySelector('#fictional-name').addEventListener('input', insert); else insert();
      let clicks = 0; document.body.addEventListener('click', () => clicks++);
      const values = mode === 'during-input' ? ['虚构姓名', '__radio_option_0'] : ['__radio_option_0'];
      const fields = mode === 'during-input' ? state.result.fields : state.result.fields.filter(field => field.kind === 'radio');
      const result = await api.fillScan(state, { scanId: state.result.scanId, items: fields.map((field, index) => ({ fieldId: field.id, value: values[index], confirmed: true })) });
      return { statuses: result.map(item => item.status), clicks, extra: extra.checked };
    }, mode);
    assert.deepEqual(result.statuses, mode === 'during-input' ? ['filled', 'skipped'] : ['skipped'], mode);
    assert.equal(result.clicks, 0, mode); assert.equal(result.extra, true, mode);
    report.checks.push(mode + ': ordinary fill preserves newly added radio state before click');
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
  console.info('Record radio ownership Chromium checks passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'record-radio-ownership-e2e.json'), JSON.stringify(report, null, 2)); await browser?.close(); }
