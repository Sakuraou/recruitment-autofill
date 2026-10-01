// Isolated production MV3 browser, loopback server, and fictional model/profile. No real account or cloud requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const bundle = resolve(artifacts, 'semantic-extension-server.mjs');
await build({ entryPoints: [resolve(root, 'src/companion/server.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle });
const { createSemanticServer } = await import(pathToFileURL(bundle).href);
const token = 'a'.repeat(64); const requests = []; let mode = 'normal'; let pending; let aborted = 0;
const report = { startedAt: new Date().toISOString(), checks: [], externalRequests: [], errors: [] };
const service = createSemanticServer({ token, provider: async (request, signal) => {
  requests.push(request);
  if (mode === 'hold') await new Promise(resolveDone => { pending = resolveDone;
    signal.addEventListener('abort', () => { aborted++; resolveDone(); }, { once: true }); });
  const bindings = request.fields.flatMap(field => {
    const clues = `${field.label} ${field.ariaLabel}`;
    const path = clues.includes('称呼') ? 'basic.name' : clues.includes('身份称谓') ? 'basic.gender'
      : clues.includes('诞生') ? 'basic.birthday' : clues.includes('体况') ? 'basic.healthStatus' : undefined;
    return path ? [{ ref: field.ref, fingerprint: field.fingerprint, path, certainty: 'certain', evidence: 'label' }] : [];
  });
  if (mode === 'invalid' && bindings.length) bindings.push({ ...bindings[0], ref: 'field-29' });
  return { state: 'ready', proposal: { requestId: request.requestId, status: bindings.length ? 'mapped' : 'unresolved', bindings } };
} });
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>虚构 AI 网申测试</title></head><body>
<form onsubmit="event.preventDefault();window.submits++"><section><h2>个人信息</h2>
<label>手机号<input id="phone"></label><label>如何称呼您<input id="u"></label>
<label>您的身份称谓<select id="g"><option value="">请选择</option><option value="opaque-m">男性</option><option value="opaque-f">女性</option></select></label>
<label>您的诞生时刻<input type="date" id="b"></label><label>您的体况<input id="h"></label>
<label>短信验证码<input id="captcha"></label><label>同意协议<input type="checkbox" id="consent"></label>
<button type="submit">最终提交</button></section></form><script>window.submits=0;</script></body></html>`;
const fixture = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
let context;
try {
  await new Promise((res, rej) => { service.once('error', rej); service.listen(43127, '127.0.0.1', res); });
  await new Promise((res, rej) => { fixture.once('error', rej); fixture.listen(0, '127.0.0.1', res); });
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`,
      '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  context.setDefaultTimeout(10000);
  await context.route(/^https?:/, async route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') {
    report.externalRequests.push(route.request().url()); await route.abort();
  } else await route.continue(); });
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const cdp = context.browser() ? await context.browser().newBrowserCDPSession() : await context.newCDPSession(context.pages()[0]);
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  const profile = JSON.parse(await readFile(resolve(root, 'examples/sample-profile.json'), 'utf8'));
  profile.basic.name = '虚构用户甲'; delete profile.basic.healthStatus;
  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
  await options.getByRole('button', { name: '校验并载入预览' }).click();
  await options.getByText('已载入导入预览。', { exact: false }).waitFor();
  await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  const form = await context.newPage(); await form.goto(url);
  async function openPopup() {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const target = targetInfos.find(info => info.type === 'tab' && info.url === url); assert.ok(target);
    await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async fixtureUrl => { const tabs = await chrome.tabs.query({});
      const tab = tabs.find(item => item.url === fixtureUrl); await chrome.tabs.update(tab.id, { active: true }); }, url);
    return popup;
  }
  async function clickAi(popup) { await popup.getByRole('button', { name: 'AI 识别并填写本页', exact: true }).click(); }
  async function waitForRequest(previous) { for (let i = 0; i < 100 && requests.length <= previous; i++) await new Promise(res => setTimeout(res, 50));
    assert.ok(requests.length > previous, 'No model request received'); }
  async function protectedFields() {
    assert.equal(await form.locator('#captcha').inputValue(), ''); assert.equal(await form.locator('#h').inputValue(), '');
    assert.equal(await form.locator('#consent').isChecked(), false); assert.equal(await form.evaluate(() => window.submits), 0);
  }

  let popup = await openPopup(); await clickAi(popup);
  await popup.getByText('AI 未启用', { exact: false }).waitFor();
  assert.equal(requests.length, 0); assert.equal(await form.locator('#phone').inputValue(), profile.basic.phone);
  assert.equal(await form.locator('#u').inputValue(), ''); await protectedFields(); await popup.close();
  report.checks.push('Default-disabled AI makes zero model calls; ordinary rules still fill known fields');

  await options.getByRole('button', { name: /13 AI 识别连接/ }).click();
  await options.getByLabel('导入 AI 连接文件', { exact: true }).setInputFiles({ name: 'fictional-connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ protocol: 1, token })) });
  await options.getByText('AI 连接已启用。回到招聘网页', { exact: false }).waitFor();
  const saved = await options.evaluate(async () => await chrome.storage.local.get());
  assert.equal(saved['recruitment.semantic.connection.v1'].enabled, true);
  assert.ok(!JSON.stringify(saved['recruitment.profile.v1']).includes(token));
  report.checks.push('Real extension CORS pairing succeeds without broad host permissions; connection excluded from profile');

  await form.reload(); popup = await openPopup(); await clickAi(popup);
  await popup.getByText('AI 识别已处理', { exact: false }).waitFor();
  assert.equal(await form.locator('#u').inputValue(), profile.basic.name);
  assert.equal(await form.locator('#g').inputValue(), 'opaque-m'); assert.equal(await form.locator('#b').inputValue(), profile.basic.birthday);
  await protectedFields();
  const serialized = JSON.stringify(requests);
  for (const privateValue of [profile.basic.name, profile.basic.phone, profile.basic.email, profile.basic.idNumber, token, url]) assert.ok(!serialized.includes(privateValue));
  assert.ok(requests.every(request => request.fields.every(field => !JSON.stringify(field).includes('验证码'))));
  report.checks.push('One explicit AI click fills unknown name, exact gender option and saved date; no per-field confirmation, fabricated facts, captcha, agreement or submit');
  report.checks.push('Decoded service requests contain neither profile values, URL, pairing token nor protected fields');
  await popup.screenshot({ path: resolve(artifacts, 'semantic-extension.png'), fullPage: true }); await popup.close();

  mode = 'hold'; await form.reload(); popup = await openPopup(); let previous = requests.length;
  await clickAi(popup); await waitForRequest(previous); await form.locator('#u').fill('人工修改'); pending();
  await popup.getByText('未知字段未填', { exact: false }).waitFor();
  assert.equal(await form.locator('#u').inputValue(), '人工修改'); assert.equal(await form.locator('#g').inputValue(), '');
  await protectedFields(); await popup.close();
  report.checks.push('Manual value entered during model latency invalidates the entire old response, preserving manual content');

  await form.reload(); popup = await openPopup(); previous = requests.length; await clickAi(popup); await waitForRequest(previous);
  await form.locator('#u').evaluate(node => node.replaceWith(node.cloneNode(true))); pending();
  await popup.getByText('未知字段未填', { exact: false }).waitFor();
  assert.equal(await form.locator('#u').inputValue(), ''); assert.equal(await form.locator('#g').inputValue(), ''); await popup.close();
  report.checks.push('Lookalike replacement input is detected by private actual-node identity, refusing stale bindings');

  await form.reload(); popup = await openPopup(); previous = requests.length; await clickAi(popup); await waitForRequest(previous);
  await popup.getByRole('button', { name: '停止 AI 填写', exact: true }).click();
  await popup.getByText('已停止后续 AI 填写', { exact: false }).waitFor();
  assert.equal(await form.locator('#u').inputValue(), ''); await popup.close();
  for (let i = 0; i < 50 && aborted < 1; i++) await new Promise(res => setTimeout(res, 50)); assert.ok(aborted >= 1);
  report.checks.push('Stop aborts the actual HTTP provider request and prevents subsequent writes');

  await form.reload(); popup = await openPopup(); previous = requests.length; await clickAi(popup); await waitForRequest(previous);
  await options.evaluate(async () => { const key = 'recruitment.profile.v1'; const data = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({ [key]: { ...data, revision: crypto.randomUUID(), basic: { ...data.basic, name: '虚构用户乙' } } }); });
  await popup.getByText('已停止后续 AI 填写', { exact: false }).waitFor();
  assert.equal(await form.locator('#u').inputValue(), ''); await popup.close();
  for (let i = 0; i < 50 && aborted < 2; i++) await new Promise(res => setTimeout(res, 50)); assert.ok(aborted >= 2);
  report.checks.push('Profile revision change aborts pending inference before any model candidate is written');

  await form.reload(); popup = await openPopup(); previous = requests.length; await clickAi(popup); await waitForRequest(previous);
  await form.goto(`${url}another-page`); pending();
  await popup.getByText('未知字段未填', { exact: false }).waitFor();
  assert.equal(await form.locator('#u').inputValue(), ''); assert.equal(await form.locator('#phone').inputValue(), ''); await popup.close();
  report.checks.push('Navigation during inference discards the old response and does not fill the replacement page');

  await form.goto(url); popup = await openPopup(); previous = requests.length; await clickAi(popup); await waitForRequest(previous);
  await popup.close();
  for (let i = 0; i < 50 && aborted < 3; i++) await new Promise(res => setTimeout(res, 50)); assert.ok(aborted >= 3);
  assert.equal(await form.locator('#u').inputValue(), ''); assert.equal(await form.locator('#g').inputValue(), '');
  report.checks.push('Closing the popup cancels the pending HTTP attempt, leaving unknown fields untouched');

  mode = 'invalid'; await form.reload(); popup = await openPopup(); await clickAi(popup);
  await popup.getByText('未知字段未填', { exact: false }).waitFor();
  assert.equal(await form.locator('#u').inputValue(), ''); assert.equal(await form.locator('#g').inputValue(), ''); await popup.close();
  report.checks.push('Partially valid response with a forbidden field reference is rejected as a whole');

  await options.getByRole('button', { name: '关闭 AI 连接', exact: true }).click();
  await options.getByText('已关闭 AI 连接并移除配对令牌。', { exact: false }).waitFor();
  assert.equal((await options.evaluate(async () => await chrome.storage.local.get()))['recruitment.semantic.connection.v1'], undefined);
  report.checks.push('Disabling AI removes the saved pairing token');
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []);
  console.log(`Semantic extension E2E passed (${report.checks.length} checks)`);
} catch (error) { report.failure = error.message; throw error; }
finally {
  await writeFile(resolve(artifacts, 'semantic-extension-report.json'), JSON.stringify(report, null, 2));
  await context?.close(); service.closeAllConnections(); fixture.closeAllConnections();
  await Promise.all([new Promise(res => service.close(res)), new Promise(res => fixture.close(res))]);
}
