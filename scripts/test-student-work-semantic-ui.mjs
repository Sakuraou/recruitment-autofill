// Full MV3 and real loopback service. Every fact and upstream response is fictional.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const focused=process.env.RA_RECORD_TEST_FOCUS==='financial';
const dir = resolve(process.env.RA_STUDENT_WORK_TEST_DIST ?? 'artifacts/i013c-student-work-semantic-dist');
const report = { scope: 'Unmodified popup, content, background, real companion and compatible provider; fictional studentWork only', checks: [], errors: [], externalRequests: [], scenarios: [] };
await build({ entryPoints: ['src/companion/server.ts', 'src/companion/chatCompletionsProvider.ts', 'src/companion/agentProvider.ts'],
  outdir: 'artifacts/i013c-student-work-semantic-service', bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createSemanticServer } = await import('../artifacts/i013c-student-work-semantic-service/server.js');
const { createChatCompletionsProvider } = await import('../artifacts/i013c-student-work-semantic-service/chatCompletionsProvider.js');
const { createAgentProvider } = await import('../artifacts/i013c-student-work-semantic-service/agentProvider.js');
const fixtureBuild = await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'studentWork-installed-fixture.ts', loader: 'ts', contents: `
  import {installStudentWorkSessionPage,studentWorkSessionProfile} from './tests/fixtures/student-work-session-page';
  import {createEmptyProfile} from './src/profile/schema';
  const mode=new URL(location.href).searchParams.get('mode');
  const fixture=installStudentWorkSessionPage(document,[],{existingConflict:mode==='existing',dynamicDuties:mode==='dynamic'});
  const profile=createEmptyProfile();profile.studentWork=studentWorkSessionProfile.studentWork.map(record=>({...record}));
  profile.basic.name='本机虚构姓名';profile.updatedAt='fictional-installed-studentWork';
  if(mode==='missing')delete profile.studentWork[0].shortDuties;
  if(mode!=='known')fixture.add.addEventListener('click',()=>{fixture.list.querySelector('[data-key="role"]').closest('label').firstChild.textContent=mode==='financial'?'税前月薪':'这段校园经历中的头衔是啥';});
  window.studentWorkFixture={...fixture,profile};
` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const fixtureJs = fixtureBuild.outputFiles[0].text;
const requests = []; let hold = false, held = false, ignoreAbort = false, cancelled = 0, lateResponse;
const fetcher = async (url, options) => {
  assert.equal(url, 'https://fictional.invalid/v1/chat/completions');
  const body = JSON.parse(options.body), request = JSON.parse(body.messages[1].content);
  assert.equal(body.tools, undefined);
  assert.ok(!JSON.stringify(body).includes('本机虚构姓名'));
  assert.ok(!JSON.stringify(body).includes('虚构学院'));
  assert.ok(!JSON.stringify(body).includes('2021-09-01'));
  requests.push(request.tasks ? 'agent' : `meaning-${request.protocol}`);
  let proposal;
  if (request.tasks) proposal = request.tasks.length
    ? { requestId: request.requestId, status: 'act', ref: request.tasks[0].ref, reason: 'available-task' }
    : { requestId: request.requestId, status: request.canComplete ? 'complete' : 'needs-user', ref: null, reason: request.canComplete ? 'no-pending-work' : 'needs-information' };
  else {
    assert.equal(request.protocol, 6); assert.equal(request.fields.length, 1);
    assert.equal(request.fields[0].section, 'student-work'); assert.equal(request.fields[0].record, 'creating');
    assert.equal(request.intentIndex, undefined);
    proposal = { requestId: request.requestId, status: 'mapped', bindings: request.fields.map(field => ({ ref: field.ref,
      fingerprint: field.fingerprint, path: 'studentWork.role', certainty: 'certain', evidence: 'label' })) };
  }
  const response = () => new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(proposal) } }] }));
  if (!request.tasks && hold) {
    held = true;
    return new Promise((resolve, reject) => {
      lateResponse = () => resolve(response());
      const abort = () => { cancelled++; if (!ignoreAbort) reject(new DOMException('Cancelled', 'AbortError')); };
      if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
    });
  }
  return response();
};
const config = { baseUrl: 'https://fictional.invalid/v1', apiKey: 'fictional-only', model: 'fictional-studentWork', fetcher };
const server = createSemanticServer({ token: 'a'.repeat(64), provider: createChatCompletionsProvider(config), agentProvider: createAgentProvider(config) });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(43127, '127.0.0.1', resolve); });
let context;
try {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension://') || url.startsWith('http://127.0.0.1:43127/')) return route.continue();
    if (url.startsWith('http://127.0.0.1:8123/studentWork-fixture.js')) return route.fulfill({ contentType: 'text/javascript', body: fixtureJs });
    if (url.startsWith('http://127.0.0.1:8123/studentWork-semantic')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh"><head><meta charset="utf-8"></head><body><script src="/studentWork-fixture.js"></script></body></html>' });
    report.externalRequests.push(url); return route.abort();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  report.version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(report.version, JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8')).version);
  const cdp = await context.browser().newBrowserCDPSession();
  async function popupFor(form) {
    await form.bringToFront(); const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const tab = targetInfos.find(target => target.url === form.url()); assert.ok(tab);
    // Grant activeTab with the actual action, then keep the unmodified UI in a
    // tab so native select focus cannot close the test control surface.
    await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
    for(const target of (await cdp.send('Target.getTargets')).targetInfos.filter(target=>target.url===`chrome-extension://${id}/popup.html`))await cdp.send('Target.closeTarget',{targetId:target.targetId});
    const page=await context.newPage();
    const activate=()=>worker.evaluate(async url=>{const target=(await chrome.tabs.query({})).find(tab=>tab.url===url);await chrome.tabs.update(target.id,{active:true});},form.url());
    await activate();await page.goto(`chrome-extension://${id}/popup.html`);await activate();
    const evaluate=expression=>page.evaluate(expression);
    const wait = async expression => {
      for (let i = 0; i < 400; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw Error('UI wait failed: ' + expression + ' text=' + await evaluate('document.body.innerText'));
    };
    const click = text => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('button unavailable: '+${JSON.stringify(text)});button.click();return true})()`);
    return { evaluate, wait, click, close: () => page.close() };
  }
  async function scenario(mode, entry = 'Agent', mutate) {
    hold = !!mutate; held = false; ignoreAbort = mode === 'late'; lateResponse = undefined;
    const start = requests.length, cancelledBefore = cancelled;
    const form = await context.newPage(); form.on('pageerror', error => report.errors.push(error.message));
    await form.goto('http://127.0.0.1:8123/studentWork-semantic?mode=' + mode);
    const profile = await form.evaluate(() => window.studentWorkFixture.profile);
    await worker.evaluate(async ({profile,enabled}) => {
      await chrome.storage.local.set({ 'recruitment.profile.v1': profile });
      await chrome.storage.local.remove('recruitment.visual.consent.v1');
      if(enabled)await chrome.storage.local.set({ 'recruitment.semantic.connection.v1': { protocol: 1, token: 'a'.repeat(64), enabled: true, userConfirmed: true } });
      else await chrome.storage.local.remove('recruitment.semantic.connection.v1');
    }, { profile, enabled: mode !== 'disabled' });
    const popup = await popupFor(form), label = entry === 'Agent' ? '启动 Agent 连续填写' : '连续填写全部校内职务';
    await popup.wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);
    await popup.click(label);
    if(mutate){
      for(let i=0;i<400&&!held;i++)await new Promise(resolve=>setTimeout(resolve,25));
      assert.ok(held,'The studentWork meaning request must be in flight before mutation'); await mutate(form,popup,worker);
    }
    if(entry==='Agent')await popup.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='启动 Agent 连续填写'&&!b.disabled)");
    else await popup.wait("[...document.querySelectorAll('section[aria-label=\"通用校内职务连续填写\"] [role=status]')].some(node=>/已处理并核验|需要检查|已停止/.test(node.textContent))");
    if(mutate){for(let i=0;i<100&&cancelled===cancelledBefore;i++)await new Promise(resolve=>setTimeout(resolve,25));assert.ok(cancelled>cancelledBefore,'Upstream is cancelled');}
    if(mode==='late'){assert.ok(lateResponse);lateResponse();await new Promise(resolve=>setTimeout(resolve,250));}
    const state = await form.evaluate(() => ({ counts:window.studentWorkFixture.counts,saved:window.studentWorkFixture.saved,draft:document.querySelector('[data-key="role"]')?.value }));
    const text = await popup.evaluate('document.body.innerText');
    if(mode==='normal'&&entry==='Agent'){
      const before=requests.length;await popup.click(label);await popup.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='启动 Agent 连续填写'&&!b.disabled)");
      const restarted=await form.evaluate(()=>window.studentWorkFixture.counts);assert.equal(restarted.add,3);assert.equal(restarted.save,3);
      assert.ok(!requests.slice(before).includes('meaning-6'));report.checks.push('Actual Agent restart proves all saved studentWork without adding duplicates or requesting meanings again');
    }
    report.scenarios.push({mode,entry,requests:requests.slice(start),cancelled:cancelled-cancelledBefore,counts:state.counts});
    await popup.close();await form.close();return{state,text,requests:requests.slice(start),profile};
  }
  if(!focused)for(const entry of ['Agent','StudentWorks']){
    const result=await scenario('normal',entry);assert.equal(result.state.counts.add,3);assert.equal(result.state.counts.save,3);
    assert.equal(result.state.counts.submit,0);assert.equal(result.state.counts.remove,0);
    assert.deepEqual(result.state.saved.map(record=>[record.role,record.startDate,record.endDate]),result.profile.studentWork.map(record=>[record.role,record.startDate,record.endDate]));
    assert.equal(result.requests.filter(item=>item==='meaning-6').length,3);
    assert.deepEqual(result.state.saved.map(record=>record.shortDuties),result.profile.studentWork.map(record=>record.shortDuties));
    report.checks.push(`Actual ${entry} entry maps unknown studentWork labels, fills three current records, saves each and preserves same organizations with distinct roles or tenures`);
  }
  for(const mode of focused?['financial']:['known','disabled','missing','existing','financial']){
    const result=await scenario(mode,'StudentWorks');assert.equal(result.requests.length,0);assert.equal(result.state.counts.save,mode==='known'?3:0);if(mode==='financial'){assert.equal(result.state.draft,'');assert.equal(result.state.counts.submit,0);assert.equal(result.state.counts.remove,0);}
    report.checks.push(`Actual ${mode} scenario uses no model; only complete known facts may save`);
  }
  if(!focused){
  const dynamic=await scenario('dynamic','StudentWorks');assert.equal(dynamic.state.counts.save,3);assert.equal(dynamic.requests.filter(item=>item==='meaning-6').length,3);
  assert.deepEqual(dynamic.state.saved.map(record=>record.shortDuties),dynamic.profile.studentWork.map(record=>record.shortDuties));
  report.checks.push('Actual dynamic duties expansion preserves the original meaning without a second model request on the same node');
  for(const mode of ['stop','late','replace','transient','manual','label','profile','consent']){
    const result=await scenario(mode,'Agent',async(form,popup,worker)=>{
      if(mode==='stop'||mode==='late')await popup.click('停止 Agent');
      else if(mode==='profile')await worker.evaluate(async()=>{const data=await chrome.storage.local.get('recruitment.profile.v1');data['recruitment.profile.v1'].studentWork[0].role='修改后的校内职务';await chrome.storage.local.set(data);});
      else if(mode==='consent')await worker.evaluate(()=>chrome.storage.local.remove('recruitment.semantic.connection.v1'));
      else await form.locator('[data-key="role"]').evaluate((input,mode)=>{
        if(mode==='replace'){input.replaceWith(input.cloneNode(true));return;}
        if(mode==='label'){input.closest('label').firstChild.textContent='另一个问题';return;}
        input.value='用户手改';input.dispatchEvent(new Event('input',{bubbles:true}));if(mode==='transient'){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}
      },mode);
    });
    assert.equal(result.state.counts.save,0);assert.equal(result.state.draft,mode==='manual'?'用户手改':'');
    assert.ok(!result.text.includes('本页可访问且支持的任务已核验完成'));
    report.checks.push(`Actual ${mode} while meaning inference waits cancels upstream, preserves draft and refuses late completion`);
  }
  }
  assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.errors.push(String(error));throw error;}
finally{await context?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});report.finishedAt=new Date().toISOString();await writeFile(process.env.RA_RECORD_TEST_REPORT ?? 'artifacts/i013c-student-work-semantic-installed-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,version:report.version,checks:report.checks.length,errors:report.errors}));
