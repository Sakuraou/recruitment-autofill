import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { inflateSync } from 'node:zlib';

const dir = resolve(process.env.RA_VISUAL_TEST_DIST ?? 'artifacts/i014c-multilabel-dist');
const reportPath = process.env.RA_VISUAL_TEST_REPORT ?? 'artifacts/i014c-multilabel-installed-report.json';
const focused = process.env.RA_VISUAL_TEST_FOCUS === 'multi';
const report = { scope: 'Unmodified full MV3 popup/content/background; actual companion and compatible text, next-step and image providers; fictional upstream only', checks: [], errors: [], externalRequests: [], scenarios: [] };
await build({ entryPoints: ['src/companion/server.ts', 'src/companion/chatCompletionsProvider.ts', 'src/companion/agentProvider.ts'],
  outdir: 'artifacts/i014c-multilabel-service', bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createSemanticServer } = await import('../artifacts/i014c-multilabel-service/server.js');
const { createChatCompletionsProvider, createVisualChatCompletionsProvider } = await import('../artifacts/i014c-multilabel-service/chatCompletionsProvider.js');
const { createAgentProvider } = await import('../artifacts/i014c-multilabel-service/agentProvider.js');
let activeMode = '';
function verifyLabelOnlyPng(data) {
  assert.ok(data.startsWith('data:image/png;base64,'));
  const png = Buffer.from(data.split(',')[1], 'base64');
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks = [];
  assert.equal(png[24], 8); assert.equal(png[25], 6);
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(chunks));
  assert.equal(rows.length, (width * 4 + 1) * height);
  assert.ok(width >= 160 && height > 24);
  const labels = activeMode === 'multi-four' ? 4 : activeMode.startsWith('multi-') ? 2 : 1;
  const retained = Array(labels).fill(0);
  for (let y = 0; y < height; y++) {
    assert.equal(rows[y * (width * 4 + 1)], 0);
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4, [r, g, b, a] = rows.subarray(offset, offset + 4);
      assert.equal(a, 255);
      // The crop includes the existing 12px context margin; retain only the
      // fixture label's inward-rounded interior at (13,13), 158x22 pixels.
      const island = Array.from({length:labels},(_,i)=>13+i*32).findIndex(top=>x>=13&&x<171&&y>=top&&y<top+22);
      if (island >= 0) { if (r > 0) retained[island]++; }
      else assert.deepEqual([r, g, b], [0, 0, 0], `Only label pixels may survive at ${x},${y} in ${width}x${height}`);
    }
  }
  assert.ok(retained.every(count=>count>100), 'Every original label island must actually be retained');
  report.pixelChecks = (report.pixelChecks ?? 0) + 1;
}
const requests = []; let hold = false, held = false, cancelled = 0, ignoreAbort = false, lateResponse;
const fetcher = async (url, options) => {
  assert.equal(url, 'https://fictional.invalid/v1/chat/completions');
  const body = JSON.parse(options.body), content = body.messages[1].content;
  assert.ok(!JSON.stringify(body).includes('本机虚构姓名')); assert.ok(!/青\s*岚\s*岭\s*城/u.test(JSON.stringify(body))); assert.ok(!JSON.stringify(body).includes('recruitment.profile'));
  const image = Array.isArray(content), request = JSON.parse(image ? content[0].text : content);
  if (image) {
    try { verifyLabelOnlyPng(content[1].image_url.url); }
    catch (error) { report.errors.push('PNG verification: ' + String(error)); throw error; }
  }
  requests.push(image ? 'visual' : request.tasks ? 'agent' : 'text');
  if (image && hold) {
    held = true;
    return new Promise((resolve, reject) => {
      const field = request.fields[0];
      lateResponse = () => resolve(new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        requestId: request.requestId, status: 'mapped', bindings: [{ ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' }],
      }) } }] })));
      const abort = () => { cancelled++; if (!ignoreAbort) reject(new DOMException('Cancelled', 'AbortError')); };
      if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
    });
  }
  let answer;
  if (request.tasks) answer = { requestId: request.requestId, status: 'act', ref: request.tasks[0].ref, reason: 'available-task' };
  else if (image) {
    assert.ok(content[1].image_url.url.startsWith('data:image/png;base64,'));
    const field = request.fields[0];
    answer = { requestId: request.requestId, status: 'mapped', bindings: [{ ref: field.ref, fingerprint: field.fingerprint,
      path: 'basic.name', certainty: 'certain', evidence: 'label' }] };
  } else answer = { requestId: request.requestId, status: 'unresolved', bindings: [] };
  return new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }] }));
};
const config = { baseUrl: 'https://fictional.invalid/v1', apiKey: 'fictional-only', model: 'fictional-vision', fetcher };
const server = createSemanticServer({ token: 'a'.repeat(64), provider: createChatCompletionsProvider(config), agentProvider: createAgentProvider(config), visualProvider: createVisualChatCompletionsProvider(config) });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(43127, '127.0.0.1', resolve); });
let context;
try {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension://') || url.startsWith('http://127.0.0.1:43127/')) return route.continue();
    if (url.startsWith('http://127.0.0.1:8123/agent-visual')) {
      const mode = new URL(url).searchParams.get('mode'), count = mode === 'budget' ? 4 : 1;
      const inputs = Array.from({ length: count }, (_, i) => {
        const multi = mode.startsWith('multi-'), labelCount = mode === 'multi-four' ? 4 : mode === 'multi-five' ? 5 : multi ? 2 : 1;
        const labels = Array.from({length:labelCount},(_,j)=>{
          let text = j===0 ? '陌生问题'+['甲','乙','丙','丁'][i] : mode==='multi-duplicate' ? '陌生问题甲' : ['附加问题甲','附加问题乙','附加问题丙','附加问题丁'][j-1];
          if(j===1&&mode==='multi-private')text='本机虚构姓名';
          if(mode==='multi-split-private')text=j===0?'青岚':'岭城';
          if(j===1&&mode==='multi-protected')text='验证码';
          if(j===1&&mode==='multi-nested')text='<span>附加问题甲</span>';
          const extra=j===1&&mode==='multi-hidden'?'display:none;':j===1&&mode==='multi-overlap'?'position:absolute;left:0;top:0;':'';
          return `<label style="display:block;width:160px;height:24px;${j>0?'margin-top:8px;':''}overflow:hidden;background:white;color:black;${extra}" for="unknown${i}">${text}</label>`;
        }).join('');
        return `<div style="position:absolute;left:100px;top:${100 + i * 100}px;width:200px;height:${multi?190:90}px">${labels}<input style="display:block;margin-top:12px;width:160px;height:24px" id="unknown${i}" ${mode==='existing'?'value="用户已填"':''} required></div>`;
      }).join('');
      const isImage = mode === 'own-image' || mode === 'decoration-image';
      const decorated = mode.startsWith('own-') || mode.startsWith('decoration-') || mode.startsWith('blocked-');
      const contained = mode.startsWith('decoration-') ? 'contain:paint;overflow:hidden;' : '';
      const mediaStyle = mode === 'blocked-visible' ? 'overflow:visible' : mode === 'blocked-margin' ? 'overflow:clip;overflow-clip-margin:600px' : mode === 'blocked-outline' ? 'outline:600px solid red' : '';
      const position = mode === 'blocked-overlap' ? 'left:100px;top:100px' : 'left:700px;top:20px';
      const decoration = decorated ? `<div class="decoration" style="position:absolute;${position};width:48px;height:48px;${contained}">${isImage ? '<img width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">' : `<svg xmlns="http://www.w3.org/2000/svg" style="${mediaStyle}" width="40" height="40"><circle cx="20" cy="20" r="15" fill="blue"/></svg>`}</div>` : '';
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><form><section><h2 style="margin:0;height:24px">个人信息</h2>' + inputs + '</section></form>' + decoration });
    }
    report.externalRequests.push(url); return route.abort();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  report.version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(report.version, JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8')).version);
  const cdp = await context.browser().newBrowserCDPSession();
  let seq = 0;
  async function scenario(mode, visual, mutate) {
    activeMode = mode;
    hold = !!mutate; held = false; ignoreAbort = mode === 'late'; lateResponse = undefined;
    const start = requests.length, cancelledBefore = cancelled;
    await worker.evaluate(async enabled => {
      const profile = { schemaVersion: 1, basic: { name: '本机虚构姓名' }, education: [], research: { papers: [], patents: [] },
        projects: [], internships: [], studentWork: [], awards: [], certificates: [], skills: {}, commonAnswers: {}, family: [] };
      if (enabled === 'split-private') profile.basic.name = '青岚岭城';
      await chrome.storage.local.set({ 'recruitment.profile.v1': profile, 'recruitment.semantic.connection.v1': { protocol: 1, token: 'a'.repeat(64), enabled: true, userConfirmed: true } });
      if (enabled) await chrome.storage.local.set({ 'recruitment.visual.consent.v1': { version: 1, enabled: true, userConfirmed: true } });
      else await chrome.storage.local.remove('recruitment.visual.consent.v1');
    }, mode==='multi-split-private'?'split-private':visual);
    const form = await context.newPage(); form.on('pageerror', error => report.errors.push(error.message));
    await form.goto('http://127.0.0.1:8123/agent-visual?mode=' + mode); await form.bringToFront();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const tab = targetInfos.find(target => target.url === form.url()); assert.ok(tab);
    await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
    let popupTarget;
    for (let i = 0; i < 50; i++) {
      popupTarget = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url === `chrome-extension://${id}/popup.html`);
      if (popupTarget) break; await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(popupTarget);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: false });
    const evaluate = expression => new Promise((resolve, reject) => {
      const requestId = ++seq;
      const handler = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message); if (message.id !== requestId) return;
        cdp.off('Target.receivedMessageFromTarget', handler);
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message))); else resolve(message.result.result.value);
      };
      cdp.on('Target.receivedMessageFromTarget', handler);
      void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }) }).catch(reject);
    });
    const wait = async expression => {
      for (let i = 0; i < 400; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw Error('UI wait failed: ' + expression + ' text=' + await evaluate('document.body.innerText'));
    };
    const click = text => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('button unavailable: '+${JSON.stringify(text)});button.click();return true})()`);
    await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='启动 Agent 连续填写'&&!b.disabled)");
    await click('启动 Agent 连续填写');
    if (mutate) {
      for (let i = 0; i < 400 && !held; i++) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(held, 'visual upstream must be waiting before mutation');
      await mutate(form, click, worker);
    }
    await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='启动 Agent 连续填写'&&!b.disabled)");
    if (mutate) { for (let i = 0; i < 100 && cancelled === cancelledBefore; i++) await new Promise(resolve => setTimeout(resolve, 25)); assert.ok(cancelled > cancelledBefore); }
    if (mode === 'late') { assert.ok(lateResponse); lateResponse(); await new Promise(resolve => setTimeout(resolve, 250)); }
    const text = await evaluate('document.body.innerText'), values = await form.locator('input').evaluateAll(inputs => inputs.map(input => input.value));
    await cdp.send('Target.detachFromTarget', { sessionId }); await cdp.send('Target.closeTarget', { targetId: popupTarget.targetId });
    for (let i = 0; i < 100; i++) {
      if (!(await cdp.send('Target.getTargets')).targetInfos.some(target => target.targetId === popupTarget.targetId)) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await form.close(); await new Promise(resolve => setTimeout(resolve, 100));
    const result = { text, values, requests: requests.slice(start) }; report.scenarios.push({ mode, ...result }); return result;
  }
  if (!focused) {
  const disabled = await scenario('disabled', false);
  assert.deepEqual(disabled.values, ['']); assert.equal(disabled.requests.filter(kind => kind === 'visual').length, 0);
  assert.ok(disabled.text.includes('仍有待办')); report.checks.push('One explicit Agent intent without visual consent leaves an unresolved text field pending and sends no image');
  const normal = await scenario('normal', true);
  assert.deepEqual(normal.values, ['本机虚构姓名']); assert.equal(normal.requests.filter(kind => kind === 'visual').length, 1);
  assert.ok(normal.requests.indexOf('text') < normal.requests.indexOf('visual')); assert.ok(normal.text.includes('本页可访问且支持的任务已核验完成'));
  report.checks.push('Agent hands off its text owner, uses one redacted image after unresolved text, fills the verified local fact and freshly confirms completion');
  }
  for(const mode of (focused ? ['multi-two','multi-four','multi-duplicate'] : ['own-svg','own-image','multi-two','multi-four','multi-duplicate'])){
    const value=await scenario(mode,true);assert.deepEqual(value.values,['本机虚构姓名']);assert.equal(value.requests.filter(kind=>kind==='visual').length,1);assert.ok(value.text.includes('本页可访问且支持的任务已核验完成'));report.checks.push('Actual '+mode+' outside the label has one current redacted PNG request, local fact fill and fresh completion');
  }
  for (const mode of ['multi-five','multi-private','multi-split-private','multi-hidden','multi-nested','multi-overlap','multi-protected']) {
    const result = await scenario(mode, true);
    assert.deepEqual(result.values, ['']); assert.equal(result.requests.filter(kind => kind === 'visual').length, 0);
    assert.ok(result.text.includes('仍有待办')); report.checks.push('Actual ' + mode + ' keeps the field pending with no image or write');
  }
  if (!focused) {
  const existing = await scenario('existing', true);
  assert.deepEqual(existing.values, ['用户已填']); assert.equal(existing.requests.length, 0);
  report.checks.push('Already answered fields are preserved with zero model calls');
  const budget = await scenario('budget', true);
  assert.deepEqual(budget.values, ['本机虚构姓名', '本机虚构姓名', '本机虚构姓名', '']);
  assert.equal(budget.requests.filter(kind => kind === 'visual').length, 3); assert.ok(budget.text.includes('仍有待办')); assert.ok(budget.text.includes('1 个字段'));
  report.checks.push('Three image attempts share one Agent run; the fourth field remains pending after fresh observation without repeated screenshots');
  }
  for (const mode of (focused ? ['multi-change','multi-replace','multi-transient','multi-association','multi-reorder'] : ['stop', 'late', 'replace', 'transient', 'manual', 'profile', 'consent','multi-change','multi-replace','multi-transient','multi-association','multi-reorder'])) {
    const result = await scenario(mode, true, async (form, click, worker) => {
      if (mode === 'stop' || mode === 'late') await click('停止 Agent');
      else if (mode === 'profile') await worker.evaluate(async () => { const data = await chrome.storage.local.get('recruitment.profile.v1'); data['recruitment.profile.v1'].basic.name = '修改后的档案'; await chrome.storage.local.set(data); });
      else if (mode === 'consent') await worker.evaluate(() => chrome.storage.local.remove('recruitment.visual.consent.v1'));
      else if (mode.startsWith('multi-')) await form.locator('label').nth(1).evaluate((label, mode) => {
        if (mode === 'multi-replace') { label.replaceWith(label.cloneNode(true)); return; }
        if (mode === 'multi-association') { label.htmlFor = 'other'; return; }
        if (mode === 'multi-reorder') { label.parentElement.prepend(label); return; }
        const original = label.textContent; label.textContent = '变更后的问题';
        if (mode === 'multi-transient') label.textContent = original;
      }, mode);
      else await form.locator('#unknown0').evaluate((input, mode) => {
        if (mode === 'replace') { input.replaceWith(input.cloneNode(true)); return; }
        input.value = '用户手改'; input.dispatchEvent(new Event('input', { bubbles: true }));
        if (mode === 'transient') { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
      }, mode);
    });
    assert.deepEqual(result.values, [mode === 'manual' ? '用户手改' : '']);
    assert.ok(!result.text.includes('本页可访问且支持的任务已核验完成'));
    report.checks.push(`Actual ${mode} during image wait cancels upstream and cannot apply a late local fact or claim completion`);
  }
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []);
  report.requests = requests; report.passed = true; report.finishedAt = new Date().toISOString();
} catch (error) { report.errors.push(String(error)); throw error; }
finally {
  await context?.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({passed:report.passed,version:report.version,checks:report.checks.length,errors:report.errors}));
