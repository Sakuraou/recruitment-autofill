// Actual production MV3 UI; isolated fictional HTTPS pages, no recruitment backend.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'artifacts');
const origin = 'https://careers.example.test';
const raw = await readFile(resolve(root, 'tests/fixtures/record-v2.html'), 'utf8');
const html = raw.replace('data-ra-record-v2-fixture="v1"', '')
  .replace(/<meta name="ra-record-v2-fixture"[^>]+>/u, '').replace('data-schema="record-v2-six-projects-v1"', '')
  .replace("add.textContent = '添加项目经历';", "add.textContent = '+';");
const profile = JSON.parse(await readFile(resolve(root, 'examples/sample-profile.json'), 'utf8'));
profile.projects = Array.from({ length: 6 }, (_, index) => ({ id: `pilot-fictional-${index}`,
  name: `虚构测试项目 ${index + 1}`, description: `仅用于本地浏览器扩展验证的虚构项目 ${index + 1}。`,
  role: '开发成员', organization: '无', startDate: '2026-01-01', endDate: '2026-06-30',
  responsibilities: `完成虚构项目 ${index + 1} 的测试职责。`, achievements: `完成虚构项目 ${index + 1} 的验收。`, technologies: ['TypeScript'] }));
const report = { checks: [], errors: [], externalRequests: [], startedAt: new Date().toISOString() };
let context;
await mkdir(artifacts, { recursive: true });
try {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${resolve(root, 'dist')}`,
      `--load-extension=${resolve(root, 'dist')}`, '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  context.setDefaultTimeout(15_000);
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  await context.route(/^https?:/, async route => {
    if (route.request().url().startsWith(`${origin}/projects?`)) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    else { report.externalRequests.push(route.request().url()); await route.abort(); }
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const first = context.pages()[0];
  const browser = context.browser() ? await context.browser().newBrowserCDPSession() : await context.newCDPSession(first);
  report.browser = (await browser.send('Browser.getVersion')).product;
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
  await options.getByRole('button', { name: '校验并载入预览' }).click();
  await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor(); await options.close();

  async function pageFor(mode, editor = 'rich') {
    const page = await context.newPage();
    await page.addInitScript(value => { window.fixtureEditorLayout = value.editor;
      window.fixtureActionDelayMs = value.mode === 'paused' || value.mode === 'stopping' ? 600 : 0;
    }, { mode, editor });
    await page.goto(`${origin}/projects?case=${mode}`);
    const targets = (await browser.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    const target = targets.find(item => item.url === page.url()); assert.ok(target);
    await browser.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
    return page;
  }
  async function popupFor(page) {
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async url => {
      const tabs = await chrome.tabs.query({}); const tab = tabs.find(candidate => candidate.url === url);
      if (!tab?.id) throw new Error('fictional pilot tab missing'); await chrome.tabs.update(tab.id, { active: true });
    }, page.url());
    await popup.reload();
    return popup;
  }
  async function message(popup, type, payload) {
    return popup.evaluate(async request => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, request, { frameId: 0 });
    }, payload === undefined ? { type } : { type, payload });
  }
  const counts = page => page.evaluate(() => ({ add: window.fixture.add, save: window.fixture.save,
    delete: window.fixture.delete, upload: window.fixture.upload, next: window.fixture.next, submit: window.fixture.submit }));
  const expected = { add: 4, save: 4, delete: 0, upload: 0, next: 0, submit: 0 };
  const completion = /全部 6 个档案项目已处理并核验/;

  const happy = await pageFor('happy'); let popup = await popupFor(happy);
  await popup.getByRole('button', { name: '连续填写全部项目', exact: true }).waitFor();
  assert.deepEqual((await message(popup, 'RA_RECORD_V2_STATUS')).data.state, { enabled: false, state: 'disabled', snapshotVersion: 0 });
  assert.deepEqual(await message(popup, 'RA_PROJECT_RECORD_START', { selector: '#fixture-submit', projects: profile.projects }),
    { ok: false, error: '无效的扩展请求' });
  assert.deepEqual(await counts(happy), { ...expected, add: 0, save: 0 });
  report.checks.push('Production project-only UI is available by semantic eligibility; test gateway stays disabled and injected payload is rejected before any action');
  await popup.getByRole('button', { name: '连续填写全部项目', exact: true }).click();
  await popup.getByText('正在逐条填写 6 个档案项目。可以关闭弹窗，任务会继续。', { exact: true }).waitFor();
  await popup.close();
  await happy.waitForFunction(() => window.fixture.save === 4);
  popup = await popupFor(happy); await popup.getByText(completion).waitFor();
  await popup.getByRole('region', { name: '通用项目连续填写' }).screenshot({ path: resolve(artifacts, 'project-pilot-popup.png') });
  assert.deepEqual(await counts(happy), expected);
  assert.deepEqual(await happy.evaluate(() => window.fixture.savedFields.map(item => item.index)), [2, 3, 4, 5]);
  const filled = await happy.evaluate(() => window.fixture.savedFields);
  for (const item of filled) assert.deepEqual(item.values, { 'fixture-project-name': profile.projects[item.index].name,
    'fixture-project-description': profile.projects[item.index].description, organization: '无', role: 'opaque-17',
    startDate: '2026-01-01', endDate: '2026-06-30', responsibilities: profile.projects[item.index].responsibilities,
    achievements: profile.projects[item.index].achievements, technologies: 'TypeScript' });
  report.checks.push('One real popup click autonomously fills all missing projects after popup closure; reopen recovers project-only completion and nine exact values per record');
  await popup.getByRole('button', { name: '连续填写全部项目', exact: true }).click();
  await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(happy), expected);
  report.checks.push('Restart verifies six existing projects with zero additional add/save');
  await popup.close(); await happy.close();

  const paused = await pageFor('paused'); popup = await popupFor(paused);
  await popup.getByRole('button', { name: '连续填写全部项目', exact: true }).click();
  await popup.getByRole('button', { name: '暂停项目填写', exact: true }).click();
  await popup.getByText('项目填写已暂停，请检查网页后继续。', { exact: true }).waitFor();
  const pausedCounts = await counts(paused);
  assert.deepEqual((await message(popup, 'RA_FILL', { scanId: 'stale', items: [] })).ok, false);
  await popup.close(); popup = await popupFor(paused);
  await popup.getByText('项目填写已暂停，请检查网页后继续。', { exact: true }).waitFor();
  assert.deepEqual(await counts(paused), pausedCounts);
  await popup.getByRole('button', { name: '继续项目填写', exact: true }).click();
  await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(paused), expected);
  report.checks.push('Pause waits for the current step, persists across popup closure, rejects another fill writer, and resumes to completion without duplicate actions');
  await popup.close(); await paused.close();

  const stopping = await pageFor('stopping'); popup = await popupFor(stopping);
  await popup.getByRole('button', { name: '连续填写全部项目', exact: true }).click();
  await popup.getByRole('button', { name: '停止项目填写', exact: true }).click();
  await popup.getByText('项目任务已停止。已保存记录与网页草稿保留。', { exact: true }).waitFor();
  const stoppedCounts = await counts(stopping);
  await popup.close(); popup = await popupFor(stopping);
  await popup.getByText('项目任务已停止。已保存记录与网页草稿保留。', { exact: true }).waitFor();
  assert.deepEqual(await counts(stopping), stoppedCounts);
  assert.equal(stoppedCounts.submit + stoppedCounts.delete + stoppedCounts.upload + stoppedCounts.next, 0);
  report.checks.push('Stop during an active production run prevents another add/save and persists when the popup is reopened');
  await popup.close(); await stopping.close();

  const unknown = await pageFor('unknown', 'unknown'); popup = await popupFor(unknown);
  await popup.getByRole('button', { name: '连续填写全部项目', exact: true }).click();
  await popup.getByText('有字段的含义尚未识别，请检查当前项目编辑器。', { exact: true }).waitFor();
  assert.deepEqual(await unknown.evaluate(() => [...document.querySelectorAll('input, textarea')].map(field => field.value)), ['', '', '']);
  assert.deepEqual(await counts(unknown), { ...expected, add: 1, save: 0 });
  const status = (await message(popup, 'RA_PROJECT_RECORD_STATUS')).data.state;
  assert.deepEqual(Object.keys(status).sort(), ['canStart', 'phase', 'reason', 'total']);
  await popup.getByRole('button', { name: '停止项目填写', exact: true }).click();
  await popup.getByText('项目任务已停止。已保存记录与网页草稿保留。', { exact: true }).waitFor();
  assert.equal(await unknown.locator('form').count(), 1);
  report.checks.push('Unknown field produces a Chinese semantic reason, zero field writes/save, value-free public status and preserved draft after Stop');
  await popup.close(); await unknown.close();

  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack ?? String(error); process.exitCode = 1;
  if (context) {
    report.pageStates = [];
    for (const page of context.pages().filter(candidate => candidate.url().startsWith(origin))) {
      report.pageStates.push(await page.evaluate(() => ({ counts: window.fixture,
        editor: document.querySelector('form')?.outerHTML ?? null })));
      await page.screenshot({ path: resolve(artifacts, 'project-pilot-failure.png') });
    }
    const worker = context.serviceWorkers()[0];
    report.popupStates = await Promise.all(context.pages().filter(page => page.url().includes('/popup.html'))
      .map(page => page.locator('body').innerText()));
    if (worker) {
      const inspect = await context.newPage();
      await inspect.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
      report.statuses = await inspect.evaluate(async () => {
        const tabs = await chrome.tabs.query({}); const results = [];
        for (const tab of tabs.filter(candidate => candidate.url?.startsWith('https://careers.example.test/'))) {
          results.push(await chrome.tabs.sendMessage(tab.id, { type: 'RA_PROJECT_RECORD_STATUS' }, { frameId: 0 }));
        }
        return results;
      });
    }
  }
}
finally { if (context) await context.close(); report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifacts, 'project-pilot-e2e.json'), JSON.stringify(report, null, 2)); console.info(JSON.stringify(report, null, 2)); }
