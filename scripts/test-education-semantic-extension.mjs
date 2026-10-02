// Actual MV3 ports and loopback transport, fictional education records and model replies.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const serverBundle = resolve(artifacts, 'education-semantic-server.mjs');
await build({ entryPoints: [resolve(root, 'src/companion/server.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: serverBundle });
const { createSemanticServer } = await import(pathToFileURL(serverBundle).href);
const token = 'c'.repeat(64); const requests = []; let mode = 'normal'; let pending; let aborted = 0;
const paths = { '这一阶段在哪里学习': 'education.school', '这段学习授予什么': 'education.degree',
  '这一阶段的学业表现': 'education.gpa', '这一阶段所在的教学单位': 'education.college' };
let service = createSemanticServer({ token, provider: async (request, signal) => {
  requests.push(request);
  if (mode === 'hold') await new Promise(done => { pending = done; signal.addEventListener('abort', () => { aborted++; done(); }, { once: true }); });
  const bindings = request.fields.map(field => ({ ref: field.ref, fingerprint: field.fingerprint, path: paths[field.label], certainty: 'certain', evidence: 'label' }));
  if (mode === 'partial') bindings.pop();
  if (mode === 'invalid') bindings[0].path = 'projects.name';
  return { state: 'ready', proposal: { requestId: request.requestId, status: 'mapped', bindings } };
} });
const fixtureBundle = resolve(artifacts, 'education-semantic-site.js');
await build({ entryPoints: [resolve(root, 'tests/fixtures/education-session-page.ts')], bundle: true, format: 'iife',
  globalName: 'EducationFixture', platform: 'browser', target: 'chrome114', outfile: fixtureBundle });
const code = await readFile(fixtureBundle, 'utf8');
const html = `<!doctype html><body><script>${code}</script><script>
window.fixture = EducationFixture.installEducationSessionPage(document, EducationFixture.educationSessionProfile);
window.schoolWrites = 0; const scenario = new URL(location.href).searchParams.get('case');
fixture.add.addEventListener('click', () => {
  const form = fixture.list.querySelector('form');
  const captions = { school: '这一阶段在哪里学习', degree: '这段学习授予什么', gpa: '这一阶段的学业表现' };
  for (const [key, caption] of Object.entries(captions)) form.querySelector('[data-test-key="' + key + '"]').parentElement.firstChild.textContent = caption;
  form.querySelector('[data-test-key="school"]').addEventListener('input', () => window.schoolWrites++);
  if (scenario === 'dynamic') form.querySelector('[data-test-key="degree"]').addEventListener('change', () => {
    setTimeout(() => { if (form.isConnected) form.querySelector('button').insertAdjacentHTML('beforebegin', '<label>这一阶段所在的教学单位<input required name="opaque-extra" data-test-key="college"></label>'); }, 600);
  }, { once: true });
});
</script></body>`;
const origin = 'https://fictional-education.example.test'; const report = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] };
let context;
try {
  await new Promise((res, rej) => { service.once('error', rej); service.listen(43127, '127.0.0.1', res); });
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`,
      '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  context.setDefaultTimeout(20_000); context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  await context.route(/^https?:/, async route => {
    if (route.request().url().startsWith(origin)) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    else if (new URL(route.request().url()).hostname === '127.0.0.1') await route.continue();
    else { report.externalRequests.push(route.request().url()); await route.abort(); }
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const extensionId = new URL(worker.url()).host;
  const browser = await context.browser().newBrowserCDPSession(); report.browser = (await browser.send('Browser.getVersion')).product;
  const seed = await context.newPage(); await seed.goto(origin + '/education?case=seed');
  const profile = JSON.parse(await readFile(resolve(root, 'examples/sample-profile.json'), 'utf8'));
  profile.education = await seed.evaluate(() => window.EducationFixture.educationSessionProfile.education);
  profile.education.forEach((record, index) => { record.college = index ? '虚构软件学院' : '虚构智能学院'; });
  await seed.close(); const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: /11 导入与备份/ }).click(); await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
  await options.getByRole('button', { name: '校验并载入预览' }).click(); await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  async function popupFor(page) {
    const targets = (await browser.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    await browser.send('Extensions.triggerAction', { id: extensionId, targetId: targets.find(item => item.url === page.url()).targetId });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(item => item.url === url); await chrome.tabs.update(tab.id, { active: true }); }, page.url());
    await popup.reload(); return popup;
  }
  async function pageFor(scenario) { const page = await context.newPage(); await page.goto(origin + '/education?case=' + scenario); return page; }
  const start = popup => popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).click();
  const counts = page => page.evaluate(() => ({ ...window.fixture.counts }));
  const blocked = { add: 1, save: 0, submit: 0, remove: 0, cancel: 0 }; const completed = { ...blocked, add: 2, save: 2 };
  const completion = /全部 2 段教育经历已处理并核验/;
  async function waitRequest(before) { for (let index = 0; index < 200 && requests.length <= before; index++) await new Promise(res => setTimeout(res, 50));
    assert.ok(requests.length > before, 'No current-education request received'); }
  async function zeroWrites(page) { assert.deepEqual(await counts(page), blocked);
    assert.ok(await page.locator('form input,form select').evaluateAll(nodes => nodes.every(node => !node.value))); }
  let page = await pageFor('disabled'); let popup = await popupFor(page); await start(popup);
  await popup.getByText('教育填写需要检查', { exact: false }).waitFor(); await zeroWrites(page); assert.equal(requests.length, 0);
  report.checks.push('Disabled model preserves an unfamiliar education draft with no writes or Save'); await popup.close(); await page.close();
  await options.getByRole('button', { name: /13 AI 识别连接/ }).click();
  await options.getByLabel('导入 AI 连接文件', { exact: true }).setInputFiles({ name: 'fictional-education-connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ protocol: 1, token })) });
  await options.getByText('AI 连接已启用。回到招聘网页', { exact: false }).waitFor();
  mode = 'hold'; let before = requests.length; page = await pageFor('happy'); popup = await popupFor(page); await start(popup); await waitRequest(before);
  await zeroWrites(page); await popup.close(); mode = 'normal'; pending();
  popup = await popupFor(page); await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(page), completed);
  const saved = await page.evaluate(() => window.fixture.saved);
  for (const [index, sourceIndex] of [1, 0].entries()) {
    for (const key of ['school', 'major', 'level', 'degree', 'educationType', 'schoolProperty', 'durationYears', 'gpa', 'ranking', 'startDate', 'endDate']) assert.equal(saved[index][key], profile.education[sourceIndex][key], key);
  }
  assert.equal(requests.length - before, 2); assert.ok(requests.every(request => request.protocol === 2 && request.fields.length === 3 && request.fields.every(field => field.section === 'education' && field.record === 'creating')));
  assert.doesNotMatch(JSON.stringify(requests), /虚构青岚|虚构云川|虚构软件|虚构智能|intentIndex|token|profileRevision/);
  report.checks.push('Production popup, content port, background and loopback fill 11 separate facts per bachelor and master after popup closure');
  await start(popup); await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(page), completed); assert.equal(requests.length - before, 2);
  report.checks.push('Restart skips verified records without another request, Add or Save'); await popup.close(); await page.close();
  for (const scenario of ['partial', 'invalid', 'stop', 'manual', 'field', 'list', 'profile']) {
    mode = ['partial', 'invalid'].includes(scenario) ? scenario : 'hold'; before = requests.length;
    page = await pageFor(scenario); popup = await popupFor(page); await start(popup); await waitRequest(before);
    if (mode === 'hold') {
      if (scenario === 'stop') { const previousAborts = aborted; await popup.getByRole('button', { name: '停止教育填写', exact: true }).click();
        await popup.getByText('教育任务已停止', { exact: false }).waitFor();
        for (let index = 0; index < 40 && aborted === previousAborts; index++) await new Promise(res => setTimeout(res, 50));
        assert.ok(aborted > previousAborts); }
      if (scenario === 'manual') await page.locator('[data-test-key="school"]').fill('用户自己输入的学校');
      if (scenario === 'field') await page.locator('[data-test-key="school"]').evaluate(node => node.replaceWith(node.cloneNode(true)));
      if (scenario === 'list') await page.locator('#education-items').evaluate(node => node.replaceWith(node.cloneNode(true)));
      if (scenario === 'profile') await options.evaluate(async () => {
        const key = 'recruitment.profile.v1'; const data = await chrome.storage.local.get(key);
        if (!data[key]) throw new Error('fictional stored profile missing');
        data[key].education[0].major = '已更新的虚构专业'; await chrome.storage.local.set({ [key]: data[key] });
      });
      mode = 'normal'; pending();
    }
    if (scenario !== 'stop') await popup.getByText('教育填写需要检查', { exact: false }).waitFor();
    await new Promise(res => setTimeout(res, 250)); assert.deepEqual(await counts(page), blocked);
    if (scenario === 'manual') { assert.equal(await page.locator('[data-test-key="school"]').inputValue(), '用户自己输入的学校'); assert.equal(await page.locator('[data-test-key="major"]').inputValue(), ''); }
    else await zeroWrites(page);
    report.checks.push('Pending or rejected education response ' + scenario + ' causes no partial writes or Save');
    await popup.close(); await page.close();
    if (scenario === 'profile') {
      await options.getByRole('button', { name: /11 导入与备份/ }).click(); await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
      await options.getByRole('button', { name: '校验并载入预览' }).click(); await options.getByRole('button', { name: '保存档案' }).click();
      await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
    }
  }
  mode = 'normal'; before = requests.length; page = await pageFor('dynamic'); popup = await popupFor(page); await start(popup); await popup.getByText(completion).waitFor();
  assert.deepEqual(await counts(page), completed); assert.deepEqual(await page.evaluate(() => window.fixture.saved.map(record => record.college)), ['虚构软件学院', '虚构智能学院']);
  assert.equal(await page.evaluate(() => window.schoolWrites), 2); assert.deepEqual(requests.slice(before).map(request => request.fields.length), [3, 1, 3, 1]);
  report.checks.push('Delayed new education field is inferred under a fresh capture, without re-answering the school or mixing degree facts');
  await popup.close(); await page.close(); service.closeAllConnections(); await new Promise(res => service.close(res));
  // A protocol-1-only companion rejects education protocol 2 instead of interpreting it as a legacy request.
  service = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '');
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Headers': 'content-type,x-resume-semantic-token', 'Access-Control-Allow-Methods': 'POST,GET' }); response.end(); return; }
    if (request.url === '/v1/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ protocol: 1, ready: true })); return; }
    request.resume(); response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ state: 'unavailable', proposal: null }));
  });
  await new Promise((res, rej) => { service.once('error', rej); service.listen(43127, '127.0.0.1', res); });
  before = requests.length; page = await pageFor('legacy-companion'); popup = await popupFor(page); await start(popup);
  await popup.getByText('教育填写需要检查', { exact: false }).waitFor(); await zeroWrites(page); assert.equal(requests.length, before);
  report.checks.push('Protocol-1-only companion rejection preserves the entire education draft without fallback facts or Save');
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []); report.passed = true;
  console.info('Education semantic extension E2E passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'education-semantic-extension-report.json'), JSON.stringify(report, null, 2));
  await context?.close(); service.closeAllConnections(); await new Promise(res => service.close(res)); }
