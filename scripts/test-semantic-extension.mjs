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
      : clues.includes('诞生') ? 'basic.birthday' : clues.includes('体况') ? 'basic.healthStatus'
      : clues.includes('回信请寄往') ? 'basic.email' : undefined;
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
const dynamicHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>虚构联动表单</title></head><body>
<section id="fields"><h2>个人信息</h2><label>您的身份称谓<select id="g"><option value="">请选择</option><option value="opaque-m">男性</option></select></label></section>
<button type="submit" onclick="window.submits++">最终提交</button><script>
window.submits=0;let second=false;let third=false;
document.querySelector('#g').addEventListener('change',()=>{if(second)return;second=true;setTimeout(()=>{
document.querySelector('#fields').insertAdjacentHTML('beforeend','<label>回信请寄往<input type="email" id="e"></label>');
document.querySelector('#e').addEventListener('change',()=>{if(third)return;third=true;setTimeout(()=>{
document.querySelector('#fields').insertAdjacentHTML('beforeend','<label>如何称呼您<input id="u"></label>');
document.querySelector('#u').addEventListener('change',()=>setTimeout(()=>{
document.querySelector('#fields').insertAdjacentHTML('beforeend','<label>展示您制作的作品<input type="url" id="p"></label>');},600));},600);});},600);});
</script></body></html>`;
const cancellationHtml = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>虚构异步选择表单</title><body>
<section><h2>个人信息</h2><button type="button" id="c1" role="combobox" aria-label="您的身份称谓" aria-controls="list-one" aria-expanded="false">请选择</button>
<div id="list-one" role="listbox" hidden><div role="option">男性</div></div>
<button type="button" id="c2" role="combobox" aria-label="如何称呼您" aria-controls="list-two" aria-expanded="false">请选择</button>
<div id="list-two" role="listbox" hidden><div role="option">虚构用户乙</div></div></section>
<button type="submit" onclick="window.submits++">最终提交</button><script>
window.submits=0;window.opens=0;window.optionClicks=0;window.laterOpens=0;
const gender=document.querySelector('#c1'), choices=document.querySelector('#list-one');
gender.addEventListener('click',()=>{window.opens++;gender.setAttribute('aria-expanded','true');choices.hidden=false;choices.firstElementChild.style.display='none';
setTimeout(()=>{choices.firstElementChild.style.display='';},400);});
choices.addEventListener('click',()=>{window.optionClicks++;gender.textContent='男性';gender.setAttribute('aria-valuetext','男性');gender.setAttribute('aria-expanded','false');choices.hidden=true;});
const name=document.querySelector('#c2'), names=document.querySelector('#list-two');
name.addEventListener('click',()=>{window.laterOpens++;name.setAttribute('aria-expanded','true');names.hidden=false;});
names.addEventListener('click',()=>{window.optionClicks++;name.textContent='虚构用户乙';name.setAttribute('aria-valuetext','虚构用户乙');name.setAttribute('aria-expanded','false');names.hidden=true;});
</script></body></html>`;
const stableComboHtml = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>虚构稳定选择表单</title><body>
<section><h2>个人信息</h2><button type="button" id="s1" role="combobox" aria-label="您的身份称谓" aria-controls="stable-list" aria-expanded="false">请选择</button>
<div id="stable-list" role="listbox" hidden><div role="option">男性</div><div role="option">女性</div></div></section>
<button type="submit" onclick="window.submits++">最终提交</button><script>
window.submits=0;window.opens=0;window.optionClicks=0;const behavior=new URL(location.href).searchParams.get('behavior');
const combo=document.querySelector('#s1');
combo.addEventListener('click',()=>{window.opens++;combo.setAttribute('aria-expanded','true');const list=document.querySelector('#stable-list');list.hidden=false;
if(behavior==='rehydrate'){const markup=list.innerHTML;list.innerHTML=markup;}});
document.addEventListener('click',event=>{if(!event.target.matches('[role="option"]'))return;window.optionClicks++;
const commit=()=>{combo.textContent='男性';combo.setAttribute('aria-valuetext','男性');combo.setAttribute('aria-expanded','false');document.querySelector('#stable-list').hidden=true;};
if(behavior==='post-read-replace'){commit();queueMicrotask(()=>{const list=document.querySelector('#stable-list');list.firstElementChild.replaceWith(list.firstElementChild.cloneNode(true));});}
else setTimeout(commit,25);});
</script></body></html>`;
const fixture = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(request.url.startsWith('/stable-controls') ? stableComboHtml : request.url.startsWith('/cancel-controls') ? cancellationHtml : request.url.startsWith('/dynamic') ? dynamicHtml : html); });
let context; let latestPopup;
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
    const pageUrl = form.url();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const target = targetInfos.find(info => info.type === 'tab' && info.url === pageUrl); assert.ok(target);
    await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
    const popup = await context.newPage(); latestPopup = popup; await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async fixtureUrl => { const tabs = await chrome.tabs.query({});
      const tab = tabs.find(item => item.url === fixtureUrl); await chrome.tabs.update(tab.id, { active: true }); }, pageUrl);
    return popup;
  }
  async function clickAi(popup) { await popup.getByRole('button', { name: 'AI 识别并填写本页', exact: true }).click(); }
  async function clearRecipes() { await options.evaluate(async () => chrome.storage.session.remove([
    'recruitment.semantic.recipes.session.v1', 'recruitment.semantic.recipes.secret.v1',
  ])); }
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
  await options.getByLabel('我确认允许将脱敏字段语义发送给已配置的模型服务').check();
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

  let cachedCount = requests.length;
  await form.reload(); popup = await openPopup(); await clickAi(popup);
  await popup.getByText('AI 识别已处理', { exact: false }).waitFor();
  assert.equal(requests.length, cachedCount, 'Reopening the popup should reuse verified meanings without another model call');
  assert.equal(await form.locator('#u').inputValue(), profile.basic.name); assert.equal(await form.locator('#g').inputValue(), 'opaque-m');
  assert.equal(await form.locator('#b').inputValue(), profile.basic.birthday); await protectedFields(); await popup.close();
  const cacheData = await options.evaluate(async () => chrome.storage.session.get()); const encodedCache = JSON.stringify(cacheData);
  assert.ok(cacheData['recruitment.semantic.recipes.session.v1'].entries.length > 0); assert.ok(encodedCache.length < 35000);
  for (const value of [profile.basic.name, profile.basic.phone, profile.basic.email, profile.basic.idNumber, token, url, '如何称呼您', 'opaque-m']) assert.ok(!encodedCache.includes(value));
  const visibleSession = await form.evaluate(async () => {
    // The ordinary page has no extension API. Its injected content script is checked below through its isolated realm.
    return typeof chrome !== 'undefined' && Boolean(chrome.storage);
  }); assert.equal(visibleSession, false);
  const protectedSession = await worker.evaluate(async fixtureUrl => { const tab = (await chrome.tabs.query({})).find(item => item.url === fixtureUrl);
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      try { return Boolean((await chrome.storage.session.get())['recruitment.semantic.recipes.session.v1']); } catch { return false; }
    } }); return result.result;
  }, url); assert.equal(protectedSession, false);
  report.checks.push('Closed/reopened production popup reuses signed session meanings with zero additional provider calls; raw answers, clues, URL and option values absent and content-script access denied');

  const oldConnectionRevision = saved['recruitment.semantic.connection.v1'].cacheRevision; assert.match(oldConnectionRevision, /^[a-f\d-]{36}$/);
  await options.getByLabel('我确认允许将脱敏字段语义发送给已配置的模型服务').check();
  await options.getByLabel('导入 AI 连接文件', { exact: true }).setInputFiles({ name: 'fictional-reconnect.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ protocol: 1, token })) });
  await options.waitForFunction(async prior => (await chrome.storage.local.get('recruitment.semantic.connection.v1'))['recruitment.semantic.connection.v1'].cacheRevision !== prior, oldConnectionRevision);
  await options.waitForFunction(async () => !(await chrome.storage.session.get())['recruitment.semantic.recipes.session.v1']);
  // Restore a correctly signed old packet to simulate a delayed clear or an old storage write after reconnect.
  await options.evaluate(async old => chrome.storage.session.set(old), cacheData);
  await form.reload(); popup = await openPopup(); await clickAi(popup);
  await popup.getByText('AI 识别已处理', { exact: false }).waitFor();
  assert.equal(requests.length, cachedCount + 1); assert.equal(await form.locator('#u').inputValue(), profile.basic.name);
  await protectedFields(); await popup.close(); cachedCount = requests.length;
  report.checks.push('Reconnecting even with the same pairing token rotates an extension-issued revision; restoring a valid old signed packet forces a fresh provider batch independently of background clear timing');

  await options.evaluate(async () => { const key = 'recruitment.semantic.recipes.session.v1'; const data = (await chrome.storage.session.get(key))[key];
    data.entries[0].path = 'basic.phone'; await chrome.storage.session.set({ [key]: data }); });
  await form.reload(); popup = await openPopup(); await clickAi(popup);
  await popup.getByText('AI 识别已处理', { exact: false }).waitFor();
  assert.equal(requests.length, cachedCount + 1); assert.equal(await form.locator('#u').inputValue(), profile.basic.name);
  await protectedFields(); await popup.close();
  report.checks.push('Tampered cached path fails signature verification, falls back to one complete provider batch and does not fill a wrong answer');

  const legacyCache = await options.evaluate(async () => chrome.storage.session.get()); cachedCount = requests.length;
  await options.evaluate(async () => { const key = 'recruitment.semantic.connection.v1'; const data = (await chrome.storage.local.get(key))[key];
    delete data.cacheRevision; await chrome.storage.local.set({ [key]: data }); });
  await options.waitForFunction(async () => !(await chrome.storage.session.get())['recruitment.semantic.recipes.session.v1']);
  await options.evaluate(async old => chrome.storage.session.set(old), legacyCache);
  await form.reload(); popup = await openPopup(); await clickAi(popup);
  await popup.getByText('AI 识别已处理', { exact: false }).waitFor();
  assert.equal(requests.length, cachedCount + 1); assert.equal(await form.locator('#u').inputValue(), profile.basic.name); await protectedFields(); await popup.close();
  report.checks.push('Legacy enabled settings without a cache revision still fill through the ordinary AI provider, ignoring any restored session recipes');
  await options.getByLabel('我确认允许将脱敏字段语义发送给已配置的模型服务').check();
  await options.getByLabel('导入 AI 连接文件', { exact: true }).setInputFiles({ name: 'fictional-modern-connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ protocol: 1, token })) });
  await options.waitForFunction(async () => Boolean((await chrome.storage.local.get('recruitment.semantic.connection.v1'))['recruitment.semantic.connection.v1'].cacheRevision));

  // Latency cases below explicitly start with an empty cache to exercise a real pending provider attempt.
  await clearRecipes();

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
  await options.waitForFunction(async () => !(await chrome.storage.session.get())['recruitment.semantic.recipes.session.v1']);
  assert.equal((await options.evaluate(async () => chrome.storage.session.get()))['recruitment.semantic.recipes.secret.v1'], undefined);
  report.checks.push('Background profile-change listener clears both session meanings and their signing secret');

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

  mode = 'normal'; await form.reload(); popup = await openPopup(); previous = requests.length; await clickAi(popup);
  await popup.getByText('AI 识别已处理', { exact: false }).waitFor();
  assert.equal(requests.length - previous, 1); assert.equal(await form.locator('#u').inputValue(), '虚构用户乙'); await protectedFields(); await popup.close();
  report.checks.push('After a profile edit the next intent requests new meanings and resolves the new saved name, never the old cached personal answer');

  mode = 'normal'; await form.goto(`${url}dynamic`); popup = await openPopup(); previous = requests.length;
  await clickAi(popup); await popup.getByText('AI 识别已处理', { exact: false }).waitFor();
  await form.locator('#u').waitFor();
  assert.equal(await form.locator('#g').inputValue(), 'opaque-m'); assert.equal(await form.locator('#e').inputValue(), profile.basic.email);
  assert.equal(await form.locator('#u').inputValue(), '虚构用户乙'); assert.equal(requests.length - previous, 3);
  assert.equal(await form.locator('#p').inputValue(), ''); await popup.getByText('已达到本次三轮上限', { exact: false }).waitFor();
  assert.equal(await form.evaluate(() => window.submits), 0); await popup.close();
  report.checks.push('One AI intent completes three unknown layers revealed after 600ms each, with fresh scan/session per layer; fourth layer stays pending at the explicit bound and no submit');

  await clearRecipes(); await form.reload(); popup = await openPopup(); previous = requests.length; await clickAi(popup);
  await form.waitForFunction(() => document.querySelector('#g').value === 'opaque-m');
  await popup.getByRole('button', { name: '停止 AI 填写', exact: true }).click();
  await popup.getByText('已停止后续 AI 填写', { exact: false }).waitFor();
  assert.equal(requests.length - previous, 1); assert.equal(await form.locator('#e').inputValue(), ''); await popup.close();
  report.checks.push('Stop during delayed reveal prevents another model round or write while preserving the first selected answer');

  for (const cancellation of ['stop', 'close', 'profile-change']) {
    mode = 'normal'; await clearRecipes(); await form.goto(`${url}cancel-controls`); popup = await openPopup(); previous = requests.length;
    await clickAi(popup);
    try { await form.waitForFunction(() => window.opens === 1); }
    catch (error) { report.cancelFixture = { popup: await popup.locator('[role="status"]').allTextContents(),
      requests: requests.slice(previous).map(value => ({ fields: value.fields.map(field => ({ label: field.label, kind: field.kind, section: field.section })) })) };
      await popup.screenshot({ path: resolve(artifacts, 'cancel-fixture-failure.png'), fullPage: true }); throw error; }
    if (cancellation === 'stop') await popup.getByRole('button', { name: '停止 AI 填写', exact: true }).click();
    else if (cancellation === 'close') await popup.close();
    else await options.evaluate(async () => { const key='recruitment.profile.v1'; const data=await chrome.storage.local.get(key);
      await chrome.storage.local.set({[key]:{...data[key],revision:crypto.randomUUID()}}); });
    if (cancellation !== 'close') await popup.getByText('已停止后续 AI 填写', { exact: false }).waitFor();
    await form.waitForFunction(() => { const option = document.querySelector('#list-one [role="option"]'); return option && getComputedStyle(option).display !== 'none'; });
    await form.waitForTimeout(120);
    assert.deepEqual(await form.evaluate(() => ({opens:window.opens, clicks:window.optionClicks, later:window.laterOpens, submits:window.submits})),
      {opens:1,clicks:0,later:0,submits:0});
    assert.equal(await form.locator('#c1').textContent(), '请选择'); assert.equal(requests.length-previous,1);
    if (cancellation !== 'close') await popup.close();
    report.checks.push(`Production popup ${cancellation} disconnects the in-flight content batch: late options have zero clicks and subsequent combo has zero opens`);
  }

  for (const behavior of ['commit', 'rehydrate', 'post-read-replace', 'model-replace']) {
    mode = behavior === 'model-replace' ? 'hold' : 'normal'; await clearRecipes();
    await form.goto(`${url}stable-controls?behavior=${behavior}`); popup = await openPopup(); previous = requests.length; await clickAi(popup);
    if (behavior === 'model-replace') {
      await waitForRequest(previous); await form.evaluate(() => { const list=document.querySelector('#stable-list');list.replaceWith(list.cloneNode(true)); });
      pending(); await popup.getByText('AI 服务不可用或页面已变化', { exact: false }).waitFor();
    } else await popup.getByText('AI 识别已处理', { exact: false }).waitFor();
    assert.deepEqual(await form.evaluate(() => ({opens:window.opens, clicks:window.optionClicks, submits:window.submits})),
      {opens:behavior === 'model-replace' ? 0 : 1, clicks:['commit','post-read-replace'].includes(behavior) ? 1 : 0, submits:0});
    assert.equal(await form.locator('#s1').textContent(), ['commit','post-read-replace'].includes(behavior) ? '男性' : '请选择');
    await popup.getByText(`本次已填写 ${behavior === 'commit' ? 1 : 0} 项`, { exact: false }).waitFor();
    assert.equal(requests.length-previous,1); await popup.close();
    report.checks.push(`Production stable ARIA combo ${behavior} validates original list/options before action and after asynchronous readback, without submit`);
  }

  await options.getByRole('button', { name: '关闭 AI 连接', exact: true }).click();
  await options.getByText('已关闭 AI 连接并移除配对令牌。', { exact: false }).waitFor();
  assert.equal((await options.evaluate(async () => await chrome.storage.local.get()))['recruitment.semantic.connection.v1'], undefined);
  await options.waitForFunction(async () => !(await chrome.storage.session.get())['recruitment.semantic.recipes.session.v1']);
  assert.equal((await options.evaluate(async () => chrome.storage.session.get()))['recruitment.semantic.recipes.secret.v1'], undefined);
  report.checks.push('Disabling AI removes the saved pairing token');
  report.checks.push('Disabling AI clears signed session recipes and their secret');
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []);
  console.log(`Semantic extension E2E passed (${report.checks.length} checks)`);
} catch (error) { report.failure = error.message;
  if (latestPopup && !latestPopup.isClosed()) report.lastState = await latestPopup.locator('[role="status"]').allTextContents();
  throw error; }
finally {
  await writeFile(resolve(artifacts, 'semantic-extension-report.json'), JSON.stringify(report, null, 2));
  await context?.close(); service.closeAllConnections(); fixture.closeAllConnections();
  await Promise.all([new Promise(res => service.close(res)), new Promise(res => fixture.close(res))]);
}


