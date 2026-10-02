// Actual MV3 background/content ports, fictional profile/model, no cloud or recruitment backend.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const bundle = resolve(artifacts, 'project-semantic-server.mjs');
await build({ entryPoints: [resolve(root, 'src/companion/server.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle });
const { createSemanticServer } = await import(pathToFileURL(bundle).href);
const token = 'b'.repeat(64); const requests = []; let mode = 'normal'; let pending; let aborted = 0;
const report = { startedAt: new Date().toISOString(), checks: [], externalRequests: [], errors: [] };
const service = createSemanticServer({ token, provider: async (request, signal) => {
  requests.push(request);
  if (mode === 'hold' || mode === 'hold-tools' && request.fields.some(field => field.label.includes('工具'))) await new Promise(done => { pending = done; signal.addEventListener('abort', () => { aborted++; done(); }, { once: true }); });
  const bindings = request.fields.map(field => ({ ref: field.ref, fingerprint: field.fingerprint,
    path: field.label.includes('定位') ? 'projects.role' : field.label.includes('叫什么') ? 'projects.name' : field.label.includes('工具') ? 'projects.technologies'
      : field.label.includes('产出') ? 'projects.achievements' : 'projects.description', certainty: 'certain', evidence: 'label' }));
  if (mode === 'invalid') bindings.push({ ...bindings[0], ref: 'field-29' });
  return { state: 'ready', proposal: { requestId: request.requestId, status: 'mapped', bindings } };
} });
const origin = 'https://fictional-semantic-projects.example.test';
const raw = await readFile(resolve(root, 'tests/fixtures/record-v2.html'), 'utf8');
const html = raw.replace('data-ra-record-v2-fixture="v1"', '').replace(/<meta name="ra-record-v2-fixture"[^>]+>/u, '')
  .replace('data-schema="record-v2-six-projects-v1"', '').replace("add.textContent = '添加项目经历';", "add.textContent = '+';")
  .replace('name="fixture-project-name"', 'name="slot-a"').replace('name="fixture-project-description"', 'name="slot-b"')
  .replace("'<label>项目名称' + name + '</label><label>项目描述' + description + '</label>'",
    "'<label>' + (window.fixtureSemanticMixed ? '项目名称' : '这项工作叫什么') + name + '</label><label>这项工作做了些什么' + description + '</label>'")
  .replace('form.innerHTML = fields +', `if (window.fixtureDynamic) fields += '<label>项目角色<select name="choice"><option value="">请选择</option><option value="developer">开发成员</option></select></label>';
    if (window.fixtureStable) fields += '<button type="button" role="combobox" aria-label="这项工作中的身份定位" aria-controls="stable-role-options" aria-expanded="false">请选择</button><div id="stable-role-options" role="listbox" hidden><div role="option">开发成员</div><div role="option">负责人</div></div>';
    form.innerHTML = fields +`)
  .replace("form.querySelector('[data-save]').addEventListener", `
    if (window.fixtureStable) {
      window.fixtureStableActions ??= { opens: 0, choices: 0, savedRoles: [] };
      const combo = form.querySelector('[role="combobox"]'); const choices = form.querySelector('[role="listbox"]');
      combo.addEventListener('click', () => {
        window.fixtureStableActions.opens++; combo.setAttribute('aria-expanded', 'true'); choices.hidden = false;
        if (window.fixtureStable === 'rehydrate') choices.replaceChildren(...Array.from(choices.children).map(node => node.cloneNode(true)));
      });
      choices.addEventListener('click', event => {
        const option = event.target.closest('[role="option"]'); if (!option) return;
        window.fixtureStableActions.choices++; const answer = option.textContent;
        setTimeout(() => {
          combo.textContent = answer; combo.setAttribute('aria-valuetext', answer); combo.setAttribute('aria-expanded', 'false'); choices.hidden = true;
          if (window.fixtureStable === 'manual') setTimeout(() => { combo.textContent = '开发成员'; combo.setAttribute('aria-valuetext', '开发成员'); }, 50);
        }, window.fixtureStable === 'stop-wait' ? 1200 : 25);
        if (window.fixtureStable === 'dynamic') setTimeout(() => {
          if (form.isConnected) form.querySelector('[data-save]').insertAdjacentHTML('beforebegin', '<label>这项工作用了什么工具<input name="stack"></label>');
        }, 600);
      });
      form.querySelector('[data-save]').addEventListener('click', () => window.fixtureStableActions.savedRoles.push(combo.getAttribute('aria-valuetext')));
    }
    if (window.fixtureDynamic) {
      form.querySelector('[name="choice"]').addEventListener('change', () => {
        if (form.querySelector('[name="choice"]').value !== 'developer') return;
        setTimeout(() => {
          if (!form.isConnected) return;
          const button = form.querySelector('[data-save]');
          button.insertAdjacentHTML('beforebegin', '<label>这项工作用了什么工具<select name="stack"><option value="">请选择</option><option value="ts-code">TypeScript</option></select></label>');
          form.querySelector('[name="stack"]').addEventListener('change', () => {
            if (form.querySelector('[name="stack"]').value !== 'ts-code') return;
            setTimeout(() => {
              if (!form.isConnected) return;
              button.insertAdjacentHTML('beforebegin', window.fixtureDynamic === 'limit'
                ? '<label>这项工作有哪些产出<select name="output"><option value="">请选择</option><option value="passed">演示验证通过</option></select></label>'
                : '<label>这项工作有哪些产出<input name="output"></label>');
              if (window.fixtureDynamic === 'limit') form.querySelector('[name="output"]').addEventListener('change', () => {
                if (form.querySelector('[name="output"]').value === 'passed') setTimeout(() => {
                  if (form.isConnected) button.insertAdjacentHTML('beforebegin', '<label>所在公司<input name="extra"></label>');
                }, 200);
              });
            }, 600);
          });
        }, 600);
      });
    }
    form.querySelector('[data-save]').addEventListener`);
const profile = JSON.parse(await readFile(resolve(root, 'examples/sample-profile.json'), 'utf8'));
profile.projects = Array.from({ length: 6 }, (_, index) => ({ id: 'fictional-semantic-' + index,
  name: '虚构测试项目 ' + (index + 1), description: '仅用于本地浏览器扩展验证的虚构项目 ' + (index + 1) + '。',
  role: '开发成员', technologies: ['TypeScript'], achievements: '演示验证通过', organization: '无' }));
let context;
try {
  await new Promise((res, rej) => { service.once('error', rej); service.listen(43127, '127.0.0.1', res); });
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`,
      '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  context.setDefaultTimeout(20_000);
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  await context.route(/^https?:/, async route => {
    if (route.request().url().startsWith(origin)) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    else if (new URL(route.request().url()).hostname === '127.0.0.1') await route.continue();
    else { report.externalRequests.push(route.request().url()); await route.abort(); }
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const cdp = await context.browser().newBrowserCDPSession();
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
  await options.getByRole('button', { name: '校验并载入预览' }).click(); await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  async function pageFor(name, mixed = false, dynamic = false, stable = false) {
    const page = await context.newPage();
    await page.addInitScript(value => { window.fixtureInitialCards = value.dynamic || value.stable && value.stable !== 'normal' ? [0, 1, 2, 3, 4] : [0];
      window.fixtureAddRelation = 'aria-controls'; window.fixtureSemanticMixed = value.mixed; window.fixtureDynamic = value.dynamic; window.fixtureStable = value.stable; }, { mixed, dynamic, stable });
    await page.goto(origin + '/projects?case=' + name);
    const targets = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: targets.find(item => item.url === page.url()).targetId });
    return page;
  }
  async function popupFor(page) {
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(item => item.url === url); await chrome.tabs.update(tab.id, { active: true }); }, page.url());
    await popup.reload(); return popup;
  }
  async function start(popup) { await popup.getByRole('button', { name: '连续填写全部项目', exact: true }).click(); }
  async function waitRequest(count) { for (let index = 0; index < 200 && requests.length <= count; index++) await new Promise(res => setTimeout(res, 50));
    assert.ok(requests.length > count, 'No current-project request received'); }
  async function counts(page) { return page.evaluate(() => ({ add: window.fixture.add, save: window.fixture.save, delete: window.fixture.delete,
    upload: window.fixture.upload, next: window.fixture.next, submit: window.fixture.submit })); }
  const blocked = { add: 1, save: 0, delete: 0, upload: 0, next: 0, submit: 0 };
  const completion = /全部 6 个档案项目已处理并核验/;
  let page = await pageFor('disabled'); let popup = await popupFor(page); await start(popup);
  await popup.getByText('项目填写需要检查', { exact: false }).waitFor();
  assert.deepEqual(await counts(page), blocked); assert.equal(requests.length, 0); assert.equal(await page.locator('form input').inputValue(), '');
  report.checks.push('Disabled AI preserves the unknown project draft with zero model calls, writes or Save');
  await popup.close(); await page.close();
  await options.getByRole('button', { name: /13 AI 识别连接/ }).click();
  await options.getByLabel('导入 AI 连接文件', { exact: true }).setInputFiles({ name: 'fictional-project-connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ protocol: 1, token })) });
  await options.getByText('AI 连接已启用。回到招聘网页', { exact: false }).waitFor();
  mode = 'hold'; const before = requests.length;
  page = await pageFor('happy'); popup = await popupFor(page); await start(popup); await waitRequest(before);
  assert.equal(await page.locator('form input').inputValue(), ''); await popup.close(); mode = 'normal'; pending();
  popup = await popupFor(page); await popup.getByText(completion).waitFor();
  const completed = { ...blocked, add: 5, save: 5 };
  assert.deepEqual(await counts(page), completed); assert.equal(requests.length - before, 5);
  assert.deepEqual(await page.evaluate(() => window.fixture.savedFields), profile.projects.slice(1).map((project, index) => ({ index: index + 1, values: { 'slot-a': project.name, 'slot-b': project.description } })));
  assert.ok(requests.every(request => request.fields.every(field => field.section === 'project' && field.record === 'creating')));
  assert.doesNotMatch(JSON.stringify(requests), /虚构测试项目|仅用于本地浏览器|intentIndex|fictional-semantic-projects|token/);
  report.checks.push('One production click fills and saves five distinct unfamiliar projects after popup closure, using trusted background ports and local current-record values');
  await start(popup); await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(page), completed); assert.equal(requests.length - before, 5);
  report.checks.push('Restart verifies six existing projects without another model call, Add or Save');
  await popup.close(); await page.close();
  mode = 'hold'; const pauseBefore = requests.length;
  page = await pageFor('paused', true); popup = await popupFor(page); await start(popup); await waitRequest(pauseBefore);
  await popup.getByRole('button', { name: '暂停项目填写', exact: true }).click();
  mode = 'normal'; pending(); await popup.getByText('项目填写已暂停', { exact: false }).waitFor();
  assert.deepEqual(await counts(page), blocked); assert.equal(await page.locator('form input').inputValue(), profile.projects[1].name);
  await popup.close(); popup = await popupFor(page);
  await popup.getByRole('button', { name: '继续项目填写', exact: true }).click(); await popup.getByText(completion).waitFor();
  assert.deepEqual(await counts(page), completed); assert.equal(requests.length - pauseBefore, 5);
  report.checks.push('Cooperative pause during model wait verifies the current mixed editor without Save; reopening and resuming saves all projects exactly once');
  await popup.close(); await page.close();
  const originalConnection = await worker.evaluate(async () => (await chrome.storage.local.get('recruitment.semantic.connection.v1'))['recruitment.semantic.connection.v1']);
  for (const change of ['manual', 'replace', 'stop', 'profile', 'connection', 'invalid']) {
    mode = change === 'invalid' ? 'invalid' : 'hold'; const previous = requests.length; const previousAborted = aborted;
    page = await pageFor(change, true); popup = await popupFor(page); await start(popup); await waitRequest(previous);
    assert.equal(requests.at(-1).fields.length, 1);
    if (change === 'manual') await page.locator('form textarea').fill('保留手工草稿');
    if (change === 'replace') await page.locator('form textarea').evaluate(node => node.replaceWith(node.cloneNode(true)));
    if (change === 'profile') await worker.evaluate(async () => { const key = 'recruitment.profile.v1'; const saved = (await chrome.storage.local.get(key))[key];
      saved.projects[1].description = '虚构同修订号更新'; await chrome.storage.local.set({ [key]: saved }); });
    if (change === 'connection') await worker.evaluate(async () => { const key = 'recruitment.semantic.connection.v1'; const saved = (await chrome.storage.local.get(key))[key];
      saved.cacheRevision = crypto.randomUUID(); await chrome.storage.local.set({ [key]: saved }); });
    if (change === 'stop') await popup.getByRole('button', { name: '停止项目填写', exact: true }).click();
    if (change !== 'invalid' && change !== 'stop') { mode = 'normal'; pending(); }
    if (change === 'stop') { await popup.getByText('项目任务已停止', { exact: false }).waitFor();
      await new Promise(res => setTimeout(res, 200)); assert.ok(aborted > previousAborted, 'Port disconnect did not abort upstream'); }
    else await popup.getByText('项目填写需要检查', { exact: false }).waitFor();
    assert.deepEqual(await counts(page), blocked); assert.equal(await page.locator('form input').inputValue(), ''); assert.equal(requests.length - previous, 1);
    if (change === 'manual') assert.equal(await page.locator('form textarea').inputValue(), '保留手工草稿');
    report.checks.push('Current project ' + change + ' rejects the entire pending batch, preserves drafts and performs no Save or unsafe action');
    await popup.close(); await page.close();
    if (change === 'profile') await worker.evaluate(async restored => { const key = 'recruitment.profile.v1'; const saved = (await chrome.storage.local.get(key))[key];
      saved.projects = restored; await chrome.storage.local.set({ [key]: saved }); }, profile.projects);
    if (change === 'connection') await worker.evaluate(async restored => chrome.storage.local.set({ 'recruitment.semantic.connection.v1': restored }), originalConnection);
  }
  mode = 'normal'; const dynamicBefore = requests.length;
  page = await pageFor('dynamic', false, 'normal'); popup = await popupFor(page); await start(popup);
  await popup.getByText(completion).waitFor();
  assert.deepEqual(await counts(page), { ...blocked, save: 1 });
  assert.deepEqual(requests.slice(dynamicBefore).map(request => request.fields.length), [2, 1, 1]);
  assert.deepEqual(await page.evaluate(() => window.fixture.savedFields), [{ index: 5, values: {
    'slot-a': profile.projects[5].name, 'slot-b': profile.projects[5].description,
    choice: 'developer', stack: 'ts-code', output: profile.projects[5].achievements,
  } }]);
  report.checks.push('Two delayed native choices reveal new unfamiliar fields; fresh batches reuse current-node meanings and save the same project exactly once after all three batches');
  await popup.close(); await page.close();
  mode = 'hold'; const dynamicPause = requests.length;
  page = await pageFor('dynamic-pause', false, 'normal'); popup = await popupFor(page); await start(popup); await waitRequest(dynamicPause);
  await popup.getByRole('button', { name: '暂停项目填写', exact: true }).click(); mode = 'normal'; pending();
  await popup.getByText('项目填写已暂停', { exact: false }).waitFor();
  assert.deepEqual(await counts(page), blocked); assert.equal(await page.locator('[name="stack"]').inputValue(), '');
  await popup.close(); popup = await popupFor(page);
  await popup.getByRole('button', { name: '继续项目填写', exact: true }).click(); await popup.getByText(completion).waitFor();
  assert.deepEqual(await counts(page), { ...blocked, save: 1 }); assert.equal(requests.length - dynamicPause, 3);
  report.checks.push('Pausing after a dynamic expansion retains the original project draft; reopen and resume replan new fields without a second Add');
  await popup.close(); await page.close();
  mode = 'hold-tools'; const dynamicManual = requests.length;
  page = await pageFor('dynamic-manual', false, 'normal'); popup = await popupFor(page); await start(popup);
  await waitRequest(dynamicManual + 1); await page.locator('form textarea').fill('保留联动期间的手工草稿');
  mode = 'normal'; pending(); await popup.getByText('项目填写需要检查', { exact: false }).waitFor();
  assert.deepEqual(await counts(page), blocked); assert.equal(requests.length - dynamicManual, 2);
  assert.equal(await page.locator('form textarea').inputValue(), '保留联动期间的手工草稿'); assert.equal(await page.locator('[name="stack"]').inputValue(), '');
  report.checks.push('Manual changes while a later dynamic semantic batch waits invalidate prior meanings and preserve the manual draft with zero Save');
  await popup.close(); await page.close();
  mode = 'normal'; const dynamicLimit = requests.length;
  page = await pageFor('dynamic-limit', false, 'limit'); popup = await popupFor(page); await start(popup);
  await popup.getByText('当前项目连续展开的问题超过三轮', { exact: false }).waitFor();
  assert.deepEqual(await counts(page), blocked); assert.equal(requests.length - dynamicLimit, 3);
  assert.equal(await page.locator('[name="extra"]').inputValue(), '');
  report.checks.push('A fourth expanding batch exceeds the bounded project limit; it cannot reuse an old receipt or Save an incomplete record');
  await popup.close(); await page.close();
  const stableProjects = profile.projects.map((project, index) => ({ ...project, role: index % 2 ? '负责人' : '开发成员' }));
  await worker.evaluate(async projects => { const key = 'recruitment.profile.v1'; const saved = (await chrome.storage.local.get(key))[key];
    saved.projects = projects; await chrome.storage.local.set({ [key]: saved }); }, stableProjects);
  mode = 'normal'; const stableBefore = requests.length;
  page = await pageFor('stable-distinct', false, false, 'normal'); popup = await popupFor(page); await start(popup);
  await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(page), completed);
  assert.deepEqual(await page.evaluate(() => window.fixtureStableActions), { opens: 5, choices: 5, savedRoles: stableProjects.slice(1).map(project => project.role) });
  assert.equal(requests.length - stableBefore, 5);
  assert.ok(requests.slice(stableBefore).every(request => request.fields.some(field => field.label.includes('定位'))));
  report.checks.push('Five unfamiliar stable ARIA project roles use five distinct local records, with exactly one open, choice and Save per new project');
  await popup.close(); await page.close();
  const stableDynamic = requests.length;
  page = await pageFor('stable-dynamic', false, false, 'dynamic'); popup = await popupFor(page); await start(popup);
  await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(page), { ...blocked, save: 1 });
  assert.deepEqual(requests.slice(stableDynamic).map(request => request.fields.length), [3, 1]);
  assert.deepEqual(await page.evaluate(() => window.fixtureStableActions), { opens: 1, choices: 1, savedRoles: ['负责人'] });
  assert.deepEqual(await page.evaluate(() => window.fixture.savedFields), [{ index: 5, values: { 'slot-a': stableProjects[5].name, 'slot-b': stableProjects[5].description, stack: 'TypeScript' } }]);
  report.checks.push('A stable ARIA role reveals a delayed unfamiliar native tool field; a fresh batch finishes the original project without reopening or an early Save');
  await popup.close(); await page.close();
  for (const behavior of ['rehydrate', 'manual', 'stop-wait']) {
    page = await pageFor('stable-' + behavior, false, false, behavior); popup = await popupFor(page); await start(popup);
    if (behavior === 'stop-wait') {
      await page.waitForFunction(() => window.fixtureStableActions?.choices === 1);
      await popup.getByRole('button', { name: '停止项目填写', exact: true }).click();
      await popup.getByText('项目任务已停止', { exact: false }).waitFor();
      await page.waitForFunction(() => document.querySelector('[role="combobox"]').getAttribute('aria-valuetext') === '负责人');
    } else await popup.getByText('项目填写需要检查', { exact: false }).waitFor();
    assert.deepEqual(await counts(page), blocked);
    assert.deepEqual(await page.evaluate(() => window.fixtureStableActions), { opens: 1, choices: behavior === 'rehydrate' ? 0 : 1, savedRoles: [] });
    if (behavior === 'manual') assert.equal(await page.locator('[role="combobox"]').getAttribute('aria-valuetext'), '开发成员');
    report.checks.push('Stable project combo ' + behavior + ' stops with zero Save, retains website values and cannot fake a cleared selection');
    await popup.close(); await page.close();
  }
  mode = 'hold'; const stablePause = requests.length;
  page = await pageFor('stable-before-save', false, false, 'pause'); popup = await popupFor(page); await start(popup); await waitRequest(stablePause);
  await popup.getByRole('button', { name: '暂停项目填写', exact: true }).click(); mode = 'normal'; pending();
  await popup.getByText('项目填写已暂停', { exact: false }).waitFor(); assert.deepEqual(await counts(page), blocked);
  assert.equal(await page.locator('[role="combobox"]').getAttribute('aria-valuetext'), '负责人');
  await page.locator('[role="listbox"]').evaluate(node => node.replaceWith(node.cloneNode(true)));
  await popup.getByRole('button', { name: '继续项目填写', exact: true }).click();
  await popup.getByText('项目填写需要检查', { exact: false }).waitFor(); assert.deepEqual(await counts(page), blocked);
  assert.deepEqual(await page.evaluate(() => window.fixtureStableActions), { opens: 1, choices: 1, savedRoles: [] });
  report.checks.push('Replacing the verified combo list before Save invalidates the record receipt, with no repeat choice, Add or Save');
  await popup.close(); await page.close();
  assert.doesNotMatch(JSON.stringify(requests), /虚构测试项目|仅用于本地浏览器|intentIndex|fictional-semantic-projects|token/);
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []); report.passed = true;
  console.info('Project semantic extension E2E passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally {
  report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'project-semantic-extension-report.json'), JSON.stringify(report, null, 2));
  await context?.close(); service.closeAllConnections(); await new Promise(res => service.close(res));
}
