import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { inflateSync } from 'node:zlib';

const dir = resolve(process.env.RA_VISUAL_TEST_DIST ?? 'artifacts/i014d-inline-label-dist');
const reportPath = process.env.RA_VISUAL_TEST_REPORT ?? 'artifacts/i014d-inline-label-installed-report.json';
const focused = process.env.RA_VISUAL_TEST_FOCUS === 'inline';
const report = { scope: 'Unmodified full MV3 popup/content/background; actual companion and compatible text, next-step and image providers; fictional upstream only', checks: [], errors: [], externalRequests: [], scenarios: [] };
await build({ entryPoints: ['src/companion/server.ts', 'src/companion/chatCompletionsProvider.ts', 'src/companion/agentProvider.ts'],
  outdir: 'artifacts/i014d-inline-label-service', bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createSemanticServer } = await import('../artifacts/i014d-inline-label-service/server.js');
const { createChatCompletionsProvider, createVisualChatCompletionsProvider } = await import('../artifacts/i014d-inline-label-service/chatCompletionsProvider.js');
const { createAgentProvider } = await import('../artifacts/i014d-inline-label-service/agentProvider.js');
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
  const labelCount=activeMode==='inline-multi'?2:1, labelHeight=activeMode==='inline-lines'?48:24;
  const retained = Array(labelCount).fill(0);
  for (let y = 0; y < height; y++) {
    assert.equal(rows[y * (width * 4 + 1)], 0);
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4, [r, g, b, a] = rows.subarray(offset, offset + 4);
      assert.equal(a, 255);
      // The crop includes the existing 12px context margin; retain only the
      // fixture label's inward-rounded interior at (13,13), 158x22 pixels.
      const island=Array.from({length:labelCount},(_,i)=>13+i*32).findIndex(top=>x>=13&&x<171&&y>=top&&y<top+labelHeight-2);
      if (island>=0) { if (r > 0) retained[island]++; }
      else assert.deepEqual([r, g, b], [0, 0, 0], `Only label pixels may survive at ${x},${y} in ${width}x${height}`);
    }
  }
  assert.ok(retained.every(count=>count>100), 'Every original label interior must actually be retained');
  report.pixelChecks = (report.pixelChecks ?? 0) + 1;
}
const requests = []; let hold = false, held = false, cancelled = 0, ignoreAbort = false, lateResponse;
const fetcher = async (url, options) => {
  assert.equal(url, 'https://fictional.invalid/v1/chat/completions');
  const body = JSON.parse(options.body), content = body.messages[1].content;
  assert.ok(!JSON.stringify(body).includes('本机虚构姓名')); assert.ok(!JSON.stringify(body).includes('recruitment.profile'));
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
        let text='陌生问题'+['甲','乙','丙','丁'][i];
        if(mode.startsWith('inline-'))text='<span>'+text+'</span>';
        if(mode==='inline-nested')text='<span><strong>陌生问题甲</strong></span>';
        if(mode==='inline-star')text='陌生问题甲<span aria-hidden="true" style="color:red">*</span>';
        if(mode==='inline-bold')text='<b>陌生问题甲</b><i>附加说明</i>';
        if(mode==='inline-lines')text='<span>陌生问题甲<br>附加说明</span>';
        if(mode==='blocked-link')text='<a href="#help">陌生问题甲</a>';
        if(mode==='blocked-button')text='<button>陌生问题甲</button>';
        if(mode==='blocked-closed-shadow')text='<span>陌生问题甲</span>';
        if(mode==='blocked-fixed')text='<b style="position:fixed;left:100px;top:100px">陌生问题甲</b>';
        if(mode==='blocked-overflow')text='<b style="margin-left:300px">陌生问题甲</b>';
        if(mode==='blocked-background')text='<b style="background-image:linear-gradient(red,blue)">陌生问题甲</b>';
        if(mode==='blocked-pseudo')text='<b class="generated">陌生问题甲</b>';
        const height=mode==='inline-lines'?48:24;
        const second=mode==='inline-multi'?`<label for="unknown${i}" style="display:block;margin-top:8px;width:160px;height:24px;overflow:hidden;background:white;color:black"><span>附加问题甲</span></label>`:'';
        return `<div style="position:absolute;left:100px;top:${100+i*100}px;width:200px;height:${mode==='inline-multi'||mode==='inline-lines'?160:90}px"><label style="display:block;width:160px;height:${height}px;overflow:hidden;background:white;color:black" for="unknown${i}">${text}</label>${second}<input style="display:block;margin-top:12px;width:160px;height:24px" id="unknown${i}" ${mode==='existing'?'value="用户已填"':''} required></div>`;
      }).join('');
      const isImage = mode === 'own-image' || mode === 'decoration-image';
      const decorated = mode.startsWith('own-') || mode.startsWith('decoration-') || mode.startsWith('blocked-');
      const contained = mode.startsWith('decoration-') ? 'contain:paint;overflow:hidden;' : '';
      const mediaStyle = mode === 'blocked-visible' ? 'overflow:visible' : mode === 'blocked-margin' ? 'overflow:clip;overflow-clip-margin:600px' : mode === 'blocked-outline' ? 'outline:600px solid red' : '';
      const position = mode === 'blocked-overlap' ? 'left:100px;top:100px' : 'left:700px;top:20px';
      const decoration = decorated ? `<div class="decoration" style="position:absolute;${position};width:48px;height:48px;${contained}">${isImage ? '<img width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">' : `<svg xmlns="http://www.w3.org/2000/svg" style="${mediaStyle}" width="40" height="40"><circle cx="20" cy="20" r="15" fill="blue"/></svg>`}</div>` : '';
      const overlay=mode==='blocked-aria-overlay'||mode==='blocked-inert-overlay'?`<input ${mode==='blocked-aria-overlay'?'aria-hidden="true"':'inert'} style="position:absolute;left:100px;top:100px;width:150px;height:24px" value="已有私密信息">`:'';
      const pseudo=mode==='blocked-pseudo'?'<style>.generated::before{content:"其他文字"}</style>':'';
      const shadow=mode==='blocked-closed-shadow'?'<script>document.querySelector("label span").attachShadow({mode:"closed"}).innerHTML="<b>本机虚构姓名</b>"</script>':mode==='blocked-ancestor-shadow'?'<script>document.querySelector("section").attachShadow({mode:"closed"}).innerHTML="<slot></slot><b style=position:absolute;left:100px;top:100px>本机虚构姓名</b>"</script>':'';
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html>'+pseudo+'<form><section><h2 style="margin:0;height:24px">个人信息</h2>' + inputs + '</section></form>' + decoration +overlay+shadow });
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
      await chrome.storage.local.set({ 'recruitment.profile.v1': profile, 'recruitment.semantic.connection.v1': { protocol: 1, token: 'a'.repeat(64), enabled: true, userConfirmed: true } });
      if (enabled) await chrome.storage.local.set({ 'recruitment.visual.consent.v1': { version: 1, enabled: true, userConfirmed: true } });
      else await chrome.storage.local.remove('recruitment.visual.consent.v1');
    }, visual);
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
    if (mode === 'blocked-api') {
      // Simulate an unavailable browser capability in this disposable content
      // world only; production code and all other native API checks are unchanged.
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
        const [result] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
          chrome.dom.openOrClosedShadowRoot = undefined; return typeof chrome.dom.openOrClosedShadowRoot;
        }});
        if (result.result !== 'undefined') throw Error('test capability unavailable simulation failed');
      });
    }
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
  for(const mode of (focused ? ['inline-span','inline-nested','inline-star','inline-bold','inline-lines','inline-multi'] : ['own-svg','own-image','inline-span','inline-nested','inline-star','inline-bold','inline-lines','inline-multi'])){
    const value=await scenario(mode,true);assert.deepEqual(value.values,['本机虚构姓名']);assert.equal(value.requests.filter(kind=>kind==='visual').length,1);assert.ok(value.text.includes('本页可访问且支持的任务已核验完成'));report.checks.push('Actual '+mode+' outside the label has one current redacted PNG request, local fact fill and fresh completion');
  }
  for (const mode of ['blocked-link','blocked-button','blocked-fixed','blocked-overflow','blocked-background','blocked-pseudo','blocked-aria-overlay','blocked-inert-overlay','blocked-closed-shadow','blocked-ancestor-shadow','blocked-api']) {
    const result = await scenario(mode, true);
    assert.equal(result.values[0], '');
    if(mode.endsWith('-overlay'))assert.deepEqual(result.values.slice(1),['已有私密信息']);else assert.deepEqual(result.values,['']);
    assert.equal(result.requests.filter(kind => kind === 'visual').length, 0);
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
  for (const mode of (focused ? ['inline-child-replace','inline-child-transient','inline-child-move','inline-attach-shadow'] : ['stop', 'late', 'replace', 'transient', 'manual', 'profile', 'consent','inline-child-replace','inline-child-transient','inline-child-move','inline-attach-shadow'])) {
    const result = await scenario(mode, true, async (form, click, worker) => {
      if (mode === 'stop' || mode === 'late') await click('停止 Agent');
      else if (mode === 'profile') await worker.evaluate(async () => { const data = await chrome.storage.local.get('recruitment.profile.v1'); data['recruitment.profile.v1'].basic.name = '修改后的档案'; await chrome.storage.local.set(data); });
      else if (mode === 'consent') await worker.evaluate(() => chrome.storage.local.remove('recruitment.visual.consent.v1'));
      else if (mode.startsWith('inline-')) await form.locator('label span').evaluate((span, mode) => {
        if(mode==='inline-attach-shadow'){span.attachShadow({mode:'closed'}).innerHTML='<b>本机虚构姓名</b>';return;}
        if(mode==='inline-child-replace'){span.replaceWith(span.cloneNode(true));return;}
        if(mode==='inline-child-move'){span.style.marginLeft='400px';return;}
        const text=span.textContent;span.textContent='已改动的问题';span.textContent=text;
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
