import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const dir = resolve(process.env.RA_VISUAL_TEST_DIST ?? 'artifacts/i014a-agent-visual-dist');
const report = { scope: 'Unmodified full MV3 popup/content/background; actual companion and compatible text, next-step and image providers; fictional upstream only', checks: [], errors: [], externalRequests: [], scenarios: [] };
await build({ entryPoints: ['src/companion/server.ts', 'src/companion/chatCompletionsProvider.ts', 'src/companion/agentProvider.ts'],
  outdir: 'artifacts/i014a-agent-visual-service', bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createSemanticServer } = await import('../artifacts/i014a-agent-visual-service/server.js');
const { createChatCompletionsProvider, createVisualChatCompletionsProvider } = await import('../artifacts/i014a-agent-visual-service/chatCompletionsProvider.js');
const { createAgentProvider } = await import('../artifacts/i014a-agent-visual-service/agentProvider.js');
const requests = []; let hold = false, held = false, cancelled = 0, ignoreAbort = false, lateResponse;
const fetcher = async (url, options) => {
  assert.equal(url, 'https://fictional.invalid/v1/chat/completions');
  const body = JSON.parse(options.body), content = body.messages[1].content;
  assert.ok(!JSON.stringify(body).includes('本机虚构姓名')); assert.ok(!JSON.stringify(body).includes('recruitment.profile'));
  const image = Array.isArray(content), request = JSON.parse(image ? content[0].text : content);
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
      const inputs = Array.from({ length: count }, (_, i) => `<div style="position:absolute;left:100px;top:${100 + i * 100}px;width:200px;height:90px"><label style="display:block;width:160px;height:24px;overflow:hidden;background:white;color:black" for="unknown${i}">陌生问题${['甲','乙','丙','丁'][i]}</label><input style="display:block;margin-top:12px;width:160px;height:24px" id="unknown${i}" ${mode === 'existing' ? 'value="用户已填"' : ''} required></div>`).join('');
      const decoration = mode === 'decoration-svg' ? '<div style="position:absolute;left:700px;top:20px;width:48px;height:48px;contain:paint;overflow:hidden"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15" fill="blue"/></svg></div>' : mode === 'decoration-image' ? '<div style="position:absolute;left:700px;top:20px;width:48px;height:48px;contain:paint;overflow:hidden"><img width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></div>' : '';
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
  const disabled = await scenario('disabled', false);
  assert.deepEqual(disabled.values, ['']); assert.equal(disabled.requests.filter(kind => kind === 'visual').length, 0);
  assert.ok(disabled.text.includes('仍有待办')); report.checks.push('One explicit Agent intent without visual consent leaves an unresolved text field pending and sends no image');
  const normal = await scenario('normal', true);
  assert.deepEqual(normal.values, ['本机虚构姓名']); assert.equal(normal.requests.filter(kind => kind === 'visual').length, 1);
  assert.ok(normal.requests.indexOf('text') < normal.requests.indexOf('visual')); assert.ok(normal.text.includes('本页可访问且支持的任务已核验完成'));
  report.checks.push('Agent hands off its text owner, uses one redacted image after unresolved text, fills the verified local fact and freshly confirms completion');
  for(const mode of ['decoration-svg','decoration-image']){
    const value=await scenario(mode,true);assert.deepEqual(value.values,['本机虚构姓名']);assert.equal(value.requests.filter(kind=>kind==='visual').length,1);assert.ok(value.text.includes('本页可访问且支持的任务已核验完成'));report.checks.push('Actual '+mode+' outside the label has one current redacted PNG request, local fact fill and fresh completion');
  }
  const existing = await scenario('existing', true);
  assert.deepEqual(existing.values, ['用户已填']); assert.equal(existing.requests.length, 0);
  report.checks.push('Already answered fields are preserved with zero model calls');
  const budget = await scenario('budget', true);
  assert.deepEqual(budget.values, ['本机虚构姓名', '本机虚构姓名', '本机虚构姓名', '']);
  assert.equal(budget.requests.filter(kind => kind === 'visual').length, 3); assert.ok(budget.text.includes('仍有待办')); assert.ok(budget.text.includes('1 个字段'));
  report.checks.push('Three image attempts share one Agent run; the fourth field remains pending after fresh observation without repeated screenshots');
  for (const mode of ['stop', 'late', 'replace', 'transient', 'manual', 'profile', 'consent']) {
    const result = await scenario(mode, true, async (form, click, worker) => {
      if (mode === 'stop' || mode === 'late') await click('停止 Agent');
      else if (mode === 'profile') await worker.evaluate(async () => { const data = await chrome.storage.local.get('recruitment.profile.v1'); data['recruitment.profile.v1'].basic.name = '修改后的档案'; await chrome.storage.local.set(data); });
      else if (mode === 'consent') await worker.evaluate(() => chrome.storage.local.remove('recruitment.visual.consent.v1'));
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
  await writeFile('artifacts/i014a-agent-visual-installed-report.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({passed:report.passed,version:report.version,checks:report.checks.length,errors:report.errors}));
