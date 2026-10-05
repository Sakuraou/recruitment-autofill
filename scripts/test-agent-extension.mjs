// Disposable actual MV3 browser and fictional compatible HTTP provider; no real credentials or website.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
async function moduleAt(source, name) {
  const outfile = resolve(artifacts, name + '.mjs');
  await build({ entryPoints: [resolve(root, source)], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node22' });
  return import(pathToFileURL(outfile).href);
}
const { createSemanticServer } = await moduleAt('src/companion/server.ts', 'agent-server');
const { createChatCompletionsProvider } = await moduleAt('src/companion/chatCompletionsProvider.ts', 'agent-field-provider');
const { createAgentProvider } = await moduleAt('src/companion/agentProvider.ts', 'agent-next-provider');
const browserFixture = await build({ stdin: { contents: "import {installAgentPage} from './tests/fixtures/agent-page.ts';window.agentFixture=installAgentPage(document,new URL(location.href).searchParams.get('mode')||'normal');",
  resolveDir: root, sourcefile: 'agent-fixture-entry.ts', loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const fixtureJs = browserFixture.outputFiles[0].text;
const resume = process.argv[2] === '--resume-publication-lifecycle';
assert.ok(!process.argv[2] || resume, 'unknown resume stage');
const prior = resume ? JSON.parse(await readFile(resolve(artifacts,'i011e-agent-mv3-first49.json'),'utf8')) : undefined;
if(prior){assert.equal(prior.version,'0.6.36');assert.equal(prior.checks.length,49);assert.deepEqual(prior.errors,[]);assert.deepEqual(prior.externalRequests,[]);}
const token = 'a'.repeat(64); const requests = []; let hold = false; let holdKind; let pending;
const report = { startedAt: new Date().toISOString(), version: JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8')).version,
  checks: [], externalRequests: [], errors: [] };
if(prior){report.checks.push(...prior.checks);requests.push(...prior.requests);report.reusedChecks=49;}
const upstream = createServer((req, res) => {
  const chunks = []; const controller = new AbortController(); res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { void (async () => {
    assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer fictional-agent-key');
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert.equal(input.model, 'fictional-agent-model');
    assert.equal(input.response_format.type, 'json_object'); assert.equal(input.tools, undefined);
    const request = JSON.parse(input.messages[1].content); requests.push(request);
    if (hold || holdKind && request.tasks?.[0]?.kind === holdKind) await new Promise(done => { pending = done; controller.signal.addEventListener('abort', done, { once: true }); });
    if (res.destroyed) return;
    const bindings = request.fields?.flatMap(field => /称呼/u.test(field.label + field.ariaLabel)
      ? [{ ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' }] : /出生日期/u.test(field.label + field.ariaLabel) ? [{ ref: field.ref, fingerprint: field.fingerprint, path: 'basic.birthday', certainty: 'certain', evidence: 'label' }] : []) ?? [];
    const proposal = request.tasks ? { requestId: request.requestId, status: 'act', ref: request.tasks[0].ref, reason: 'available-task' }
      : { requestId: request.requestId, status: bindings.length ? 'mapped' : 'unresolved', bindings };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(proposal) } }] }));
  })().catch(error => { report.errors.push(error.message); if (!res.destroyed) { res.writeHead(500); res.end(); } }); });
});
const fixture = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': req.url.startsWith('/fixture.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
  res.end(req.url.startsWith('/fixture.js') ? fixtureJs : '<!doctype html><html lang="zh"><meta charset="utf-8"><title>虚构跨栏目网申</title><body><script src="/fixture.js"></script></body></html>');
});
async function listen(server, port = 0) { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); }); return server.address().port; }
let service; let context; let latestPopup;
try {
  const upstreamPort = await listen(upstream);
  const config = { apiKey: 'fictional-agent-key', model: 'fictional-agent-model', baseUrl: `http://127.0.0.1:${upstreamPort}/v1` };
  service = createSemanticServer({ token, provider: createChatCompletionsProvider(config), agentProvider: createAgentProvider(config) });
  await listen(service, 43127); const fixturePort = await listen(fixture); const url = `http://127.0.0.1:${fixturePort}/`;
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`,
      '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  context.setDefaultTimeout(20000);
  await context.route(/^https?:/, async route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') {
    report.externalRequests.push(route.request().url()); await route.abort(); } else await route.continue(); });
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const extensionId = new URL(worker.url()).host;
  const cdp = context.browser() ? await context.browser().newBrowserCDPSession() : await context.newCDPSession(context.pages()[0]);
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  const form = await context.newPage(); await form.goto(url); const profile = await form.evaluate(() => window.agentFixture.profile);
  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile)); await options.getByRole('button', { name: '校验并载入预览' }).click();
  await options.getByText('已载入导入预览。', { exact: false }).waitFor(); await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  await options.getByRole('button', { name: /13 AI 识别连接/ }).click();
  await options.getByLabel('导入 AI 连接文件', { exact: true }).setInputFiles({ name: 'fictional-agent-connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ protocol: 1, token })) });
  await options.getByText('AI 连接已启用。回到招聘网页', { exact: false }).waitFor(); if(!resume)report.checks.push('Actual options import and compatible HTTP pairing succeed');
  async function openPopup() {
    const pageUrl = form.url(); const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const target = targetInfos.find(info => info.url === pageUrl && info.type === 'tab'); assert.ok(target);
    await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
    const popup = await context.newPage(); latestPopup = popup;
    // Creating this test tab makes it active; bind the fixture before React effects query activeTab.
    await worker.evaluate(async fixtureUrl => { const tab = (await chrome.tabs.query({})).find(tab => tab.url === fixtureUrl); await chrome.tabs.update(tab.id, { active: true }); }, pageUrl);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async fixtureUrl => { const tab = (await chrome.tabs.query({})).find(tab => tab.url === fixtureUrl); await chrome.tabs.update(tab.id, { active: true }); }, pageUrl);
    return popup;
  }
  const click = popup => popup.getByRole('button', { name: '启动 Agent 连续填写', exact: true }).click();
  async function waitRequest(previous) { for (let i = 0; i < 200 && requests.length <= previous; i++) await new Promise(done => setTimeout(done, 25)); assert.ok(requests.length > previous); }
  async function saveFixtureProfile(){const value=await form.evaluate(()=>window.agentFixture.profile);
    await options.getByRole('button',{name:/11 导入与备份/}).click();await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(value));
    await options.getByRole('button',{name:'校验并载入预览'}).click();await options.getByRole('button',{name:'保存档案'}).click();
    await options.getByText('档案已保存在此浏览器。',{exact:false}).waitFor();return value;
  }
  let popup; let state; const awardFacts=[]; const paperFacts=[];
  if(!resume){
  popup = await openPopup(); await click(popup);
  await popup.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === '启动 Agent 连续填写')?.disabled, null, { timeout: 60000 });
  assert.ok((await popup.locator('[role="status"]').allTextContents()).some(text => text.includes('本页可访问且支持的任务已核验完成')));
  const statusPosition = await popup.locator('.notice[role="status"]').boundingBox();
  const firstLegacyPosition = await popup.locator('.workflow-panel').nth(1).boundingBox();
  assert.ok(statusPosition && firstLegacyPosition && statusPosition.y < firstLegacyPosition.y, 'Agent result remains beside the primary entry, above legacy panels');
  state = await form.evaluate(() => window.agentFixture.state());
  assert.equal(await form.locator('#u').inputValue(), profile.basic.name);
  assert.deepEqual(state.education.map(record => record.degree), ['学士学位','硕士学位']);
  assert.deepEqual(state.projects.map(record => record.name), profile.projects.map(record => record.name));
  assert.deepEqual(state.internships.map(record => record.organization), profile.internships.map(record => record.organization));
  assert.ok(state.counts.every(count => count.add === 2 && count.save === 2 && count.submit === 0 && count.remove === 0)); assert.equal(state.submits, 0);
  report.checks.push('One actual Agent click maps unknown ordinary name, then adds and saves both education records, both projects and both internships');
  report.checks.push('Education uses bachelor then master degrees; all projects/internships keep their own facts');
  report.checks.push('Actual record executors have six Add/six Save and zero Delete/Submit');
  await popup.screenshot({ path: resolve(artifacts, 'agent-extension.png'), fullPage: true });
  const previous = requests.length; await click(popup); await popup.getByText('Agent 已执行 0 步', { exact: false }).waitFor();
  assert.equal(requests.length, previous); assert.deepEqual(await form.evaluate(() => window.agentFixture.state()), state); await popup.close();
  report.checks.push('Restart freshly proves identities and performs zero model calls or duplicate adds');
  await form.goto(url + '?mode=weak-applicant'); popup = await openPopup(); await click(popup);
  await popup.getByText('本页可访问且支持的任务已核验完成', { exact: false }).waitFor({timeout:60000});
  assert.equal(await form.locator('#u').inputValue(), profile.basic.birthday);
  state = await form.evaluate(() => window.agentFixture.state()); assert.ok(state.counts.every(count => count.add === 2 && count.save === 2)); assert.equal(state.submits, 0); await popup.close();
  report.checks.push('Agent confirms a weak applicant birthday via actual compatible API then completes all three record collections without per-field approval');
  for (const mode of ['unknown','award','weak']) {
    await form.goto(`${url}?mode=${mode}`); popup = await openPopup(); await click(popup);
    await popup.getByText('仍有待办或需要补充的资料', { exact: false }).waitFor({ timeout: 60000 });
    state = await form.evaluate(() => window.agentFixture.state()); assert.equal(state.projects.length, 2); assert.equal(state.education.length, 2); assert.equal(state.internships.length, 2);
    if (mode === 'unknown') assert.equal(await form.locator('#unknown-answer').inputValue(), '');
    if (mode === 'weak') assert.equal(await form.locator('#agent-name').inputValue(), '');
    assert.equal(state.submits, 0); await popup.close(); report.checks.push(`Unsupported ${mode} remains pending while known collections are all processed`);
  }
  await form.goto(url + '?mode=known-empty');
  const incomplete = await form.evaluate(() => window.agentFixture.profile);
  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(incomplete)); await options.getByRole('button', { name: '校验并载入预览' }).click();
  await options.getByRole('button', { name: '保存档案' }).click(); await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  popup = await openPopup(); await click(popup);
  await popup.getByText('仍有待办或需要补充的资料', { exact: false }).waitFor({ timeout: 60000 });
  state = await form.evaluate(() => window.agentFixture.state()); assert.equal(state.projects.length, 0); assert.equal(state.education.length, 2); assert.equal(state.internships.length, 2);
  assert.equal(state.counts[1].add, 0); assert.equal(state.counts[1].save, 0); assert.equal(state.submits, 0); await popup.close();
  report.checks.push('A profile marked as having projects but missing record details remains pending without inventing a first project');
  await options.getByRole('button', { name: /11 导入与备份/ }).click(); await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
  await options.getByRole('button', { name: '校验并载入预览' }).click(); await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  for (const scenario of ['stop','close','replace','profile']) {
    await form.goto(url + '?mode=' + scenario); hold = true; pending = undefined; popup = await openPopup(); const before = requests.length; await click(popup); await waitRequest(before);
    if (scenario === 'stop') {
      const guarded = await popup.evaluate(async fixtureUrl => { const tab = (await chrome.tabs.query({})).find(tab => tab.url === fixtureUrl);
        return chrome.tabs.sendMessage(tab.id, { type: 'RA_PROJECT_RECORD_START' }, { frameId: 0 }); }, form.url());
      assert.equal(guarded.ok, false); report.checks.push('A competing manual record start cannot enter an Agent-owned page');
      await popup.getByRole('region', { name: 'Agent 连续填写', exact: true }).getByRole('button', { name: '停止 Agent', exact: true }).click();
    } else if (scenario === 'close') await popup.close();
    else if (scenario === 'replace') await form.evaluate(() => { const add = window.agentFixture.project.add; add.replaceWith(add.cloneNode(true)); });
    else await options.evaluate(async () => { const key = 'recruitment.profile.v1'; const value = (await chrome.storage.local.get(key))[key]; value.basic.name = '另一虚构姓名'; await chrome.storage.local.set({ [key]: value }); });
    hold = false; pending?.();
    if (scenario !== 'close') { await popup.getByRole('button', { name: '启动 Agent 连续填写', exact: true }).waitFor({ state: 'visible' });
      await popup.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === '启动 Agent 连续填写')?.disabled); }
    await new Promise(done => setTimeout(done, 350)); state = await form.evaluate(() => window.agentFixture.state());
    assert.ok(state.counts.every(count => count.add === 0 && count.save === 0)); assert.equal(state.submits, 0); assert.equal(await form.locator('#u').inputValue(), '');
    if (!popup.isClosed()) await popup.close(); report.checks.push(`Actual ${scenario} during model thinking rejects late response: zero writes, Add, Save and Submit`);
  }

  for(const mode of ['awards-normal','awards-radio','awards-dynamic','awards-presence-select','awards-presence-radio']){
    await form.goto(url+'?mode='+mode);const source=await saveFixtureProfile();awardFacts.push(...source.awards.flatMap(award=>[award.name,award.school,award.description]));
    popup=await openPopup();await click(popup);await popup.getByText('本页可访问且支持的任务已核验完成',{exact:false}).waitFor({timeout:90000});
    state=await form.evaluate(()=>window.agentFixture.state());assert.deepEqual(state.awards.map(award=>award.date),source.awards.map(award=>award.date));
    assert.ok(state.counts.slice(0,3).every(count=>count.add===2&&count.save===2));assert.equal(state.counts[3].add,3);assert.equal(state.counts[3].save,3);assert.equal(state.submits,0);
    assert.ok(state.awards.every(award=>award.cadre===(mode==='awards-dynamic'?'yes':'no')));
    if(mode==='awards-dynamic')assert.ok(state.awards.every(award=>award.cadreDescription===source.basic.studentCadreDescription));
    report.checks.push(`Actual ${mode} Agent completes all four record categories with independent award dates and explicit cadre facts`);
    if(mode==='awards-normal'){
      const before=requests.length;await click(popup);await popup.getByText('Agent 已执行 0 步',{exact:false}).waitFor();assert.equal(requests.length,before);
      assert.deepEqual(await form.evaluate(()=>window.agentFixture.state()),state);report.checks.push('Award restart freshly proves all three identities with zero duplicate Add/Save or model calls');
    }await popup.close();
  }
  for(const mode of ['awards-missing-cadre','awards-conflict','awards-save-uncertain','awards-known-empty']){
    await form.goto(url+'?mode='+mode);await saveFixtureProfile();popup=await openPopup();await click(popup);
    await popup.getByText('仍有待办或需要补充的资料',{exact:false}).waitFor({timeout:90000});state=await form.evaluate(()=>window.agentFixture.state());
    assert.equal(state.awards.length,0);assert.equal(state.counts[3].add,mode==='awards-known-empty'?0:1);assert.equal(state.counts[3].save,mode==='awards-save-uncertain'?1:0);assert.equal(state.submits,0);
    if(mode==='awards-conflict')assert.equal(await form.locator('#award-items fieldset select').inputValue(),'yes');
    if(mode==='awards-missing-cadre')assert.equal(await form.locator('#award-items fieldset select').inputValue(),'');
    assert.equal(state.education.length,2);assert.equal(state.projects.length,2);assert.equal(state.internships.length,2);
    await popup.close();report.checks.push(`Actual ${mode} preserves award work without fabricating facts or repeating uncertain saves`);
  }
  for(const scenario of ['stop','close','replace','profile']){
    await form.goto(url+'?mode=awards-normal');await saveFixtureProfile();holdKind='award-records';pending=undefined;popup=await openPopup();await click(popup);
    await form.waitForFunction(()=>window.agentFixture.state().internships.length===2,null,{timeout:90000});
    for(let i=0;i<400&&!pending;i++)await new Promise(done=>setTimeout(done,25));assert.ok(pending,'award decision is actually held after the other categories finish');
    if(scenario==='stop'){
      const guarded=await popup.evaluate(async fixtureUrl=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===fixtureUrl);return chrome.tabs.sendMessage(tab.id,{type:'RA_AWARD_RECORD_START'},{frameId:0});},form.url());
      assert.equal(guarded.ok,false);await popup.getByRole('region',{name:'Agent 连续填写',exact:true}).getByRole('button',{name:'停止 Agent',exact:true}).click();
    }else if(scenario==='close')await popup.close();
    else if(scenario==='replace')await form.evaluate(()=>{const add=window.agentFixture.award.add;add.replaceWith(add.cloneNode(true));});
    else await options.evaluate(async()=>{const key='recruitment.profile.v1';const value=(await chrome.storage.local.get(key))[key];value.awards[0].description='修改后的虚构奖项说明';await chrome.storage.local.set({[key]:value});});
    holdKind=undefined;pending();
    if(scenario!=='close')await popup.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='启动 Agent 连续填写')?.disabled,null,{timeout:20000});
    await new Promise(done=>setTimeout(done,400));state=await form.evaluate(()=>window.agentFixture.state());assert.equal(state.counts[3].add,0);assert.equal(state.counts[3].save,0);assert.equal(state.submits,0);
    if(!popup.isClosed())await popup.close();report.checks.push(`Actual award ${scenario} rejects the late award decision with zero award Add/Save`);
  }
  await form.goto(url+'?mode=awards-normal');await saveFixtureProfile();popup=await openPopup();await click(popup);
  await form.locator('#award-items fieldset select').waitFor({timeout:90000});await form.waitForFunction(()=>document.querySelector('#award-items fieldset select')?.value==='no',null,{timeout:90000});
  await popup.close();await new Promise(done=>setTimeout(done,1000));state=await form.evaluate(()=>window.agentFixture.state());assert.equal(state.counts[3].save,0);assert.equal(state.counts[3].add,1);assert.equal(state.submits,0);
  report.checks.push('Closing Agent during actual award fill cancels its owned workflow before Save and preserves the draft');
  for(const mode of ['papers-normal','papers-dynamic','papers-presence-select','papers-presence-radio']){
    await form.goto(url+'?mode='+mode);const source=await saveFixtureProfile();paperFacts.push(...source.research.papers.flatMap(paper=>[paper.title,paper.doi,paper.abstract,paper.venue,paper.publicationSituation]));
    popup=await openPopup();await click(popup);await popup.getByText('本页可访问且支持的任务已核验完成',{exact:false}).waitFor({timeout:120000});
    state=await form.evaluate(()=>window.agentFixture.state());assert.deepEqual(state.publications.map(paper=>paper.doi),source.research.papers.map(paper=>paper.doi));
    assert.deepEqual(state.publications.map(paper=>paper.date),source.research.papers.map(paper=>paper.date));
    assert.deepEqual(state.publications.map(paper=>paper.status),['published','submitted','published']);
    assert.deepEqual(state.publications.map(paper=>paper.authorOrder),['two','three','one']);
    assert.deepEqual(state.publications.map(paper=>paper.venue),source.research.papers.map(paper=>paper.venue));
    assert.ok(state.counts.slice(0,3).every(count=>count.add===2&&count.save===2));
    assert.ok(state.counts.slice(3).every(count=>count.add===3&&count.save===3&&count.submit===0&&count.remove===0&&count.cancel===0));assert.equal(state.submits,0);
    report.checks.push(`Actual ${mode} Agent completes five collections, preserves same-title distinct DOI papers and each status, order, date and venue`);
    if(mode==='papers-normal'){
      assert.ok(requests.some(request=>request.tasks?.length===6),'all six task types are offered together');
      const before=requests.length;await click(popup);await popup.getByText('Agent 已执行 0 步',{exact:false}).waitFor();assert.equal(requests.length,before);
      assert.deepEqual(await form.evaluate(()=>window.agentFixture.state()),state);report.checks.push('All-paper restart freshly proves private identities: zero Add/Save/model calls');
    }await popup.close();
  }
  for(const mode of ['papers-missing-identity','papers-unknown','papers-conflict','papers-save-uncertain','papers-corrupt-summary','papers-known-empty','papers-none-existing','papers-none-draft']){
    await form.goto(url+'?mode='+mode);await saveFixtureProfile();popup=await openPopup();await click(popup);
    await popup.getByText('仍有待办或需要补充的资料',{exact:false}).waitFor({timeout:120000});state=await form.evaluate(()=>window.agentFixture.state());
    assert.equal(state.counts[4].add,['papers-missing-identity','papers-known-empty','papers-none-existing'].includes(mode)?0:1);
    assert.equal(state.counts[4].save,['papers-save-uncertain','papers-corrupt-summary'].includes(mode)?1:0);
    assert.equal(state.publications.length,mode==='papers-corrupt-summary'?1:0);assert.equal(state.counts[4].remove,0);assert.equal(state.counts[4].cancel,0);assert.equal(state.submits,0);
    assert.equal(state.education.length,2);assert.equal(state.projects.length,2);assert.equal(state.internships.length,2);assert.equal(state.awards.length,3);
    if(mode==='papers-conflict')assert.equal(await form.locator('#paper-items [data-key="title"]').inputValue(),'网页其他论文');
    await popup.close();report.checks.push(`Actual ${mode} preserves paper pending work without inventing identities, repeating uncertain saves or discarding foreign drafts`);
  }
  await form.goto(url+'?mode=papers-none');await saveFixtureProfile();popup=await openPopup();await click(popup);
  await popup.getByText('本页可访问且支持的任务已核验完成',{exact:false}).waitFor({timeout:120000});state=await form.evaluate(()=>window.agentFixture.state());
  assert.equal(state.counts[4].add,0);assert.equal(state.counts[4].save,0);assert.equal(state.submits,0);await popup.close();
  report.checks.push('Explicit no papers removes only an empty closed paper list; other four collections still complete');
  for(const scenario of ['stop','close','replace','profile']){
    await form.goto(url+'?mode=papers-normal');await saveFixtureProfile();holdKind='publication-records';pending=undefined;popup=await openPopup();await click(popup);
    await form.waitForFunction(()=>window.agentFixture.state().awards.length===3,null,{timeout:120000});
    for(let i=0;i<400&&!pending;i++)await new Promise(done=>setTimeout(done,25));assert.ok(pending,'paper decision is actually held after other four collections');
    if(scenario==='stop'){
      const guarded=await popup.evaluate(async fixtureUrl=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===fixtureUrl);return chrome.tabs.sendMessage(tab.id,{type:'RA_PUBLICATION_RECORD_START'},{frameId:0});},form.url());
      assert.equal(guarded.ok,false);await popup.getByRole('region',{name:'Agent 连续填写',exact:true}).getByRole('button',{name:'停止 Agent',exact:true}).click();
    }else if(scenario==='close')await popup.close();
    else if(scenario==='replace')await form.evaluate(()=>{const add=window.agentFixture.publication.add;add.replaceWith(add.cloneNode(true));});
    else await options.evaluate(async()=>{const key='recruitment.profile.v1';const value=(await chrome.storage.local.get(key))[key];value.research.papers[0].abstract='另一份虚构摘要';await chrome.storage.local.set({[key]:value});});
    holdKind=undefined;pending();
    if(scenario!=='close')await popup.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='启动 Agent 连续填写')?.disabled,null,{timeout:20000});
    await new Promise(done=>setTimeout(done,400));state=await form.evaluate(()=>window.agentFixture.state());assert.equal(state.counts[4].add,0);assert.equal(state.counts[4].save,0);assert.equal(state.submits,0);
    if(!popup.isClosed())await popup.close();report.checks.push(`Actual paper ${scenario} rejects late model decision: zero paper Add/Save`);
  }
  await form.goto(url+'?mode=papers-dynamic');await saveFixtureProfile();popup=await openPopup();await click(popup);
  await form.waitForFunction(()=>document.querySelector('#paper-items [data-key="status"]')?.value==='published',null,{timeout:120000});
  await popup.close();await new Promise(done=>setTimeout(done,1000));state=await form.evaluate(()=>window.agentFixture.state());assert.equal(state.counts[4].add,1);assert.equal(state.counts[4].save,0);assert.equal(state.submits,0);
  report.checks.push('Closing Agent during actual paper fill cancels its owned workflow before Save and preserves draft');
  }
  // Independent fixed entry exercises the same lifecycle without a model task.
  await form.goto(url+'?mode=papers-dynamic');const manualSource=await saveFixtureProfile();
  awardFacts.push(...manualSource.awards.flatMap(award=>[award.name,award.school,award.description]));
  paperFacts.push(...manualSource.research.papers.flatMap(paper=>[paper.title,paper.doi,paper.abstract,paper.venue,paper.publicationSituation]));
  popup=await openPopup();
  const paperPanel=popup.getByRole('region',{name:'通用专业论著连续填写',exact:true});
  await paperPanel.getByRole('button',{name:'连续填写全部专业论著',exact:true}).click();
  await form.locator('#paper-items form').waitFor();
  async function direct(type,extra={}){return popup.evaluate(async({fixtureUrl,type,extra})=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===fixtureUrl);return chrome.tabs.sendMessage(tab.id,{type,...extra},{frameId:0});},{fixtureUrl:form.url(),type,extra});}
  assert.equal((await direct('RA_EDUCATION_RECORD_START')).ok,false);
  assert.equal((await direct('RA_PUBLICATION_RECORD_STATUS',{payload:{index:1}})).ok,false);
  assert.equal((await direct('RA_PUBLICATION_RECORD_PAUSE')).ok,true);
  for(let i=0;i<100;i++){const status=await direct('RA_PUBLICATION_RECORD_STATUS');if(status.data?.state.phase==='paused')break;await form.waitForTimeout(50);}
  const paused=await direct('RA_PUBLICATION_RECORD_STATUS');assert.equal(paused.ok,true);assert.equal(paused.data.state.phase,'paused');
  assert.equal((await direct('RA_PROJECT_RECORD_START')).ok,false);assert.equal((await direct('RA_PUBLICATION_RECORD_RESUME')).ok,true);
  for(let i=0;i<400;i++){const result=await direct('RA_PUBLICATION_RECORD_STATUS');if(result.data?.state.phase==='complete')break;await form.waitForTimeout(50);}
  const complete=await direct('RA_PUBLICATION_RECORD_STATUS');assert.equal(complete.data.state.phase,'complete');
  state=await form.evaluate(()=>window.agentFixture.state());assert.equal(state.counts[4].add,3);assert.equal(state.counts[4].save,3);assert.equal(state.submits,0);
  assert.equal((await direct('RA_PUBLICATION_RECORD_STOP')).ok,true);await popup.close();
  report.checks.push('Independent actual paper lifecycle supports status, pause, resume and stop with page mutual exclusion and strict messages');
  const serialized = JSON.stringify(requests);
  for (const fact of [profile.basic.name, profile.basic.birthday, profile.education[0].school, profile.projects[0].name, profile.internships[0].organization, token, url]) assert.ok(!serialized.includes(fact));
  for(const fact of awardFacts)if(fact)assert.ok(!serialized.includes(fact));
  for(const fact of paperFacts)if(fact)assert.ok(!serialized.includes(fact));
  assert.ok(requests.filter(request => request.tasks).every(request => Object.keys(request).sort().join(',') === 'canComplete,pending,protocol,requestId,tasks'));
  report.checks.push('Model requests contain offered references/counts or sanitized field metadata, never personal answers, URL or owner token');
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []); report.checks.push('Zero external browser requests and page errors');
  report.passed = true; report.finishedAt = new Date().toISOString(); console.log(`Agent extension E2E passed (${report.checks.length} checks)`);
} catch (error) {
  report.failure = error.message; report.requests = requests;
  if (latestPopup && !latestPopup.isClosed()) { report.lastState = await latestPopup.locator('[role="status"]').allTextContents(); report.debug = await latestPopup.locator('details.debug-panel pre').textContent().catch(() => 'no scan'); }
  throw error;
} finally {
  await writeFile(resolve(artifacts, 'agent-extension-report.json'), JSON.stringify(report, null, 2)); await context?.close();
  service?.closeAllConnections(); fixture.closeAllConnections(); upstream.closeAllConnections();
  await Promise.all([new Promise(done => service ? service.close(done) : done()), new Promise(done => fixture.close(done)), new Promise(done => upstream.close(done))]);
}
