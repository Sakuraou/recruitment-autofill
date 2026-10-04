// Read-only fictional cards in disposable Chromium; no account, profile storage or page action.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const entry = resolve(artifacts, 'education-identity-entry.ts'); const bundle = resolve(artifacts, 'education-identity-browser.js');
await writeFile(entry, "export {compareEducationCard} from '../src/content/educationRecordIdentity';\nexport {educationFillOrder} from '../src/profile/educationFillOrder';\nexport {compareProjectCard} from '../src/content/projectRecordIdentity';\n");
await build({ entryPoints: [entry], bundle: true, platform: 'browser', format: 'iife', globalName: 'EducationIdentityTest', target: 'chrome114', outfile: bundle });
const code = await readFile(bundle, 'utf8'); const report = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] };
const record = { id: 'fictional-bachelor', school: '虚构青岚大学', level: '本科', major: '软件工程', startDate: '2020-09', endDate: '2024-06' };
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true }); const context = await browser.newContext();
  await context.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  const cases = [
    ['paragraphs', `<h3>${record.school}</h3><p>学历：本科</p>`, 'same'],
    ['definitions', `<dl><dt>学校</dt><dd>${record.school}</dd><dt>专业</dt><dd>软件工程</dd></dl>`, 'same'],
    ['table', `<table><tr><th>学校</th><td>${record.school}</td></tr><tr><th>学历</th><td>本科</td></tr></table>`, 'same'],
    ['month-range', `<h3>${record.school}</h3><p>入学日期：2020.09</p><p>毕业日期：2024/06</p>`, 'same'],
    ['other-level', `<h3>${record.school}</h3><p>学历：硕士研究生</p>`, 'different'],
    ['mixed-precision', `<h3>${record.school}</h3><p>学历：本科</p><p>入学日期：2020-09-01</p>`, 'insufficient'],
    ['editable-ancestor', `<h3>${record.school}</h3><div contenteditable><p>学历：本科</p></div>`, 'insufficient'],
    ['textbox-ancestor', `<h3>${record.school}</h3><div role="textbox"><p>学历：本科</p></div>`, 'insufficient'],
    ['clamped-ancestor', `<h3>${record.school}</h3><div style="display:-webkit-box;-webkit-line-clamp:2;overflow:hidden"><p>学历：本科</p></div>`, 'insufficient'],
    ['ellipsis-ancestor', `<h3>${record.school}</h3><div style="text-overflow:ellipsis;overflow:hidden"><p>学历：本科</p></div>`, 'insufficient'],
    ['hidden-ancestor', `<h3>${record.school}</h3><div hidden><p>学历：本科</p></div>`, 'insufficient'],
    ['nested-card', `<h3>${record.school}</h3><article><p>学历：本科</p></article>`, 'insufficient'],
    ['conflicting-labels', `<h3>${record.school}</h3><p>学历：本科</p><p>学历：硕士</p>`, 'insufficient'],
    ['over-element-budget', `<h3>${record.school}</h3>${'<p>学历：本科</p>'.repeat(1001)}`, 'insufficient'],
    ['stage-heading', '<h3>本科</h3><p>学历：本科</p><p>专业：软件工程</p>', 'insufficient'],
    ['labelled-school-stage-heading', `<h3>本科</h3><p>学校：${record.school}</p><p>学历：本科</p>`, 'same'],
  ];
  for (const [name, html, verdict] of cases) {
    await page.setContent(`<form><article id="card">${html}<button type="submit">删除或提交</button></article></form>`);
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(value => {
      let actions = 0; document.addEventListener('click', () => actions++); document.addEventListener('submit', () => actions++);
      const identity = window.EducationIdentityTest.compareEducationCard(document.querySelector('#card'), value);
      return { identity, actions };
    }, record);
    assert.equal(result.identity.verdict, verdict, name); assert.equal(result.actions, 0, name);
    assert.doesNotMatch(JSON.stringify(result.identity), /青岚|软件工程|2020|2024|fictional/);
    report.checks.push(name + ': ' + verdict + ', zero actions and personal-value output');
  }
  const order = await page.evaluate(value => window.EducationIdentityTest.educationFillOrder([
    { ...value, id: 'fictional-master', level: '硕士研究生' }, value,
  ]), record);
  assert.deepEqual(order, { status: 'ready', indices: [1, 0] }); report.checks.push('Undergraduate precedes master through independent indices in real Chromium');
  const project = { id: 'fictional-heading-project', name: '虚构校园检索平台', role: '开发成员',
    description: '为虚构校园资料提供检索、收藏与分类管理。', technologies: [] };
  for (const [name, html, verdict] of [
    ['project-outer-application-form', `<h3>${project.name}</h3><p>项目描述：${project.description}</p>`, 'same'],
    ['project-inner-editor', `<h3>${project.name}</h3><div id="inner-editor"><p>项目描述：${project.description}</p></div>`, 'insufficient'],
    ['project-role-heading', `<h3>开发成员</h3><p>项目描述：${project.description}</p>`, 'insufficient'],
    ['project-labelled-name-role-heading', `<h3>开发成员</h3><p>项目名称：${project.name}</p><p>项目描述：${project.description}</p>`, 'same'],
    ['project-clamped-ancestor', `<h3>${project.name}</h3><div style="display:-webkit-box;-webkit-line-clamp:2;overflow:hidden"><p>项目描述：${project.description}</p></div>`, 'insufficient'],
  ]) {
    await page.setContent(`<form><article id="card">${html}<button type="submit">删除或提交</button></article></form>`);
    if (name === 'project-inner-editor') {
      // HTML parsing discards nested form tags; create the actual editor node
      // that a script-driven site can add, rather than testing a missing form.
      await page.evaluate(() => {
        const placeholder = document.querySelector('#inner-editor'); const editor = document.createElement('form');
        editor.append(...placeholder.childNodes); placeholder.replaceWith(editor);
      });
      assert.equal(await page.locator('#card form').count(), 1);
    }
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(value => {
      let actions = 0; document.addEventListener('click', () => actions++); document.addEventListener('submit', () => actions++);
      return { identity: window.EducationIdentityTest.compareProjectCard(document.querySelector('#card'), value), actions };
    }, project);
    assert.equal(result.identity.verdict, verdict, name); assert.equal(result.actions, 0, name);
    assert.doesNotMatch(JSON.stringify(result.identity), /虚构|fictional|开发/u);
    report.checks.push(name + ': ' + verdict + ', zero actions and personal-value output');
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
  console.info('Education identity browser checks passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'education-identity-e2e.json'), JSON.stringify(report, null, 2)); await browser?.close(); }
