// Actual MV3 ports and loopback transport, fictional internship records and model replies.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const serverBundle = resolve(artifacts, 'internship-semantic-server.mjs');
await build({ entryPoints: [resolve(root, 'src/companion/server.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: serverBundle });
const { createSemanticServer } = await import(pathToFileURL(serverBundle).href);
const token = 'c'.repeat(64); const requests = []; let mode = 'normal'; let pending; let aborted = 0;
const paths = { '工作单位名称':'internships.organization', '实习期间所在部门':'internships.department', '[redacted]期间所在部门':'internships.department', '承担的工作内容':'internships.description', '当时服务的实体': 'internships.organization', '归属的业务团队': 'internships.department', '这段经历的主要事项': 'internships.description' };
let service = createSemanticServer({ token, provider: async (request, signal) => {
  requests.push(request);
  if (mode === 'hold') await new Promise(done => { pending = done; signal.addEventListener('abort', () => { aborted++; done(); }, { once: true }); });
  const bindings = request.fields.map(field => ({ ref: field.ref, fingerprint: field.fingerprint, path: paths[field.label], certainty: 'certain', evidence: 'label' }));
  if (mode === 'partial') bindings.pop();
  if (mode === 'invalid') bindings[0].path = 'projects.name';
  if (mode === 'disagree') bindings[0].path = 'internships.department';
  if (mode === 'refused') return { state: 'refused', proposal: null };
  const proposal = { requestId: request.requestId, status: 'mapped', bindings };
  if (mode === 'answer') proposal.answer = '模型不得生成个人答案';
  if (mode === 'selector') proposal.selector = 'body button';
  return { state: 'ready', proposal };
} });
const fixtureBundle = resolve(artifacts, 'internship-semantic-site.js');
await build({ entryPoints: [resolve(root, 'tests/fixtures/internship-session-page.ts')], bundle: true, format: 'iife',
  globalName: 'InternshipFixture', platform: 'browser', target: 'chrome114', outfile: fixtureBundle });
const code = await readFile(fixtureBundle, 'utf8');
const html = `<!doctype html><body><script>${code}</script><script>
window.fixture = InternshipFixture.installInternshipSessionPage(document, InternshipFixture.internshipSessionProfile);
window.otherColumnActions = { education: 0, project: 0, award: 0 };
for (const [kind,caption] of [['education','教育经历'],['project','项目经历'],['award','在校奖励']]) {
  const section=document.createElement('section');const heading=document.createElement('h2');heading.textContent=caption;
  const list=document.createElement('div');list.setAttribute('role','list');list.id='other-'+kind;
  const add=document.createElement('button');add.type='button';add.textContent='+';add.setAttribute('aria-controls',list.id);
  add.addEventListener('click',()=>window.otherColumnActions[kind]++);list.append(add);section.append(heading,list);document.querySelector('main').append(section);
}
window.organizationWrites = 0; const scenario = new URL(location.href).searchParams.get('case');
fixture.add.addEventListener('click', () => {
  const form = fixture.list.querySelector('form');
  const weak = scenario.startsWith('weak-');
  const captions = weak ? { organization: scenario === 'weak-mixed' ? '工作单位 / 项目名称' : '工作单位名称', department: '实习期间所在部门', description: '承担的工作内容' } : { organization: '当时服务的实体', department: '归属的业务团队', description: '这段经历的主要事项' };
  for (const [key, caption] of Object.entries(captions)) form.querySelector('[data-test-key="' + key + '"]').parentElement.firstChild.textContent = caption;
  form.querySelector('[data-test-key="organization"]').addEventListener('input', () => window.organizationWrites++);
  if (scenario === 'dynamic' || scenario === 'weak-dynamic') { form.querySelector('[data-test-key="department"]').parentElement.remove();form.querySelector('[data-test-key="workType"]').addEventListener('change', () => {
    setTimeout(() => { if (form.isConnected) form.querySelector('button').insertAdjacentHTML('beforebegin', '<label>' + (weak ? '实习期间所在部门' : '归属的业务团队') + '<input required name="opaque-extra" data-test-key="department"></label>'); }, 600);
  }, { once: true }); }
});
</script></body>`;
const origin = 'https://fictional-internship.example.test'; const report = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] };
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
  const seed = await context.newPage(); await seed.goto(origin + '/internship?case=seed');
  const profile = JSON.parse(await readFile(resolve(root, 'examples/sample-profile.json'), 'utf8'));
  profile.internships = await seed.evaluate(() => window.InternshipFixture.internshipSessionProfile.internships);
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
  async function pageFor(scenario) { const page = await context.newPage(); await page.goto(origin + '/internship?case=' + scenario); return page; }
  const start = popup => popup.getByRole('button', { name: '连续填写全部实习经历', exact: true }).click();
  const counts = page => page.evaluate(() => {
    if (Object.values(window.otherColumnActions).some(count => count !== 0)) throw new Error('Other record column was operated');
    return { ...window.fixture.counts };
  });
  const blocked = { add: 1, save: 0, submit: 0, remove: 0, cancel: 0 }; const completed = { ...blocked, add: 2, save: 2 };
  const completion = /全部 2 条实习经历已处理并核验/;
  async function waitRequest(before) { for (let index = 0; index < 200 && requests.length <= before; index++) await new Promise(res => setTimeout(res, 50));
    assert.ok(requests.length > before, 'No current-internship request received'); }
  async function zeroWrites(page) { assert.deepEqual(await counts(page), blocked);
    assert.ok(await page.locator('form input,form select,form textarea').evaluateAll(nodes => nodes.every(node => !node.value))); }
  let page = await pageFor('disabled'); let popup = await popupFor(page); await start(popup);
  await popup.getByText('实习填写需要检查', { exact: false }).waitFor(); await zeroWrites(page); assert.equal(requests.length, 0);
  report.checks.push('Disabled model preserves an unfamiliar internship draft with no writes or Save'); await popup.close(); await page.close();
  await options.getByRole('button', { name: /13 AI 识别连接/ }).click();
  await options.getByLabel('导入 AI 连接文件', { exact: true }).setInputFiles({ name: 'fictional-internship-connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ protocol: 1, token })) });
  await options.getByText('AI 连接已启用。回到招聘网页', { exact: false }).waitFor();
  mode = 'hold'; let before = requests.length; page = await pageFor('happy'); popup = await popupFor(page); await start(popup); await waitRequest(before);
  await zeroWrites(page); await popup.close(); mode = 'normal'; pending();
  popup = await popupFor(page); await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(page), completed);
  const saved = await page.evaluate(() => window.fixture.saved);
  for (const [index, sourceIndex] of [0, 1].entries()) {
    for (const key of ['organization','department','role','description','achievements','startDate','endDate','experienceType','workType','companyProperty','monthlySalary','hasProof']) assert.equal(saved[index][key], profile.internships[sourceIndex][key], key);
  }
  assert.equal(requests.length - before, 2); assert.ok(requests.every(request => request.protocol === 3 && request.fields.length === 3 && request.fields.every(field => field.section === 'internship' && field.record === 'creating')));
  assert.doesNotMatch(JSON.stringify(requests), /虚构云桥|虚构星河|平台研发部|信息服务部|intentIndex|token|profileRevision/);
  report.checks.push('Production popup, content port, background and loopback fill 12 separate facts per internship after popup closure');
  await start(popup); await popup.getByText(completion).waitFor(); assert.deepEqual(await counts(page), completed); assert.equal(requests.length - before, 2);
  report.checks.push('Restart skips verified records without another request, Add or Save'); await popup.close(); await page.close();
  for (const scenario of ['partial', 'invalid', 'refused', 'answer', 'selector', 'stop', 'manual', 'field', 'list', 'profile', 'navigation']) {
    mode = ['partial', 'invalid', 'refused', 'answer', 'selector'].includes(scenario) ? scenario : 'hold'; before = requests.length;
    page = await pageFor(scenario); popup = await popupFor(page); await start(popup); await waitRequest(before);
    if (mode === 'hold') {
      if (scenario === 'stop') { const previousAborts = aborted; await popup.getByRole('button', { name: '停止实习填写', exact: true }).click();
        await popup.getByText('实习任务已停止', { exact: false }).waitFor();
        for (let index = 0; index < 40 && aborted === previousAborts; index++) await new Promise(res => setTimeout(res, 50));
        assert.ok(aborted > previousAborts); }
      if (scenario === 'manual') await page.locator('[data-test-key="organization"]').fill('用户自己输入的单位');
      if (scenario === 'field') await page.locator('[data-test-key="organization"]').evaluate(node => node.replaceWith(node.cloneNode(true)));
      if (scenario === 'list') await page.locator('#internship-items').evaluate(node => node.replaceWith(node.cloneNode(true)));
      if (scenario === 'navigation') await page.evaluate(() => history.pushState(null, '', location.pathname + '?case=navigated'));
      if (scenario === 'profile') await options.evaluate(async () => {
        const key = 'recruitment.profile.v1'; const data = await chrome.storage.local.get(key);
        if (!data[key]) throw new Error('fictional stored profile missing');
        data[key].internships[0].department = '已更新的虚构部门'; await chrome.storage.local.set({ [key]: data[key] });
      });
      mode = 'normal'; pending();
    }
    if (scenario !== 'stop') await popup.getByText('实习填写需要检查', { exact: false }).waitFor();
    await new Promise(res => setTimeout(res, 250)); assert.deepEqual(await counts(page), blocked);
    if (scenario === 'manual') { assert.equal(await page.locator('[data-test-key="organization"]').inputValue(), '用户自己输入的单位'); assert.equal(await page.locator('[data-test-key="role"]').inputValue(), ''); }
    else await zeroWrites(page);
    report.checks.push('Pending or rejected internship response ' + scenario + ' causes no partial writes or Save');
    await popup.close(); await page.close();
    if (scenario === 'profile') {
      await options.getByRole('button', { name: /11 导入与备份/ }).click(); await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
      await options.getByRole('button', { name: '校验并载入预览' }).click(); await options.getByRole('button', { name: '保存档案' }).click();
      await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
    }
  }
  await options.evaluate(async () => { const key='recruitment.profile.v1';const data=await chrome.storage.local.get(key);delete data[key].internships[0].department;await chrome.storage.local.set({[key]:data[key]}); });
  mode='normal';before=requests.length;page=await pageFor('missing-current-department');popup=await popupFor(page);await start(popup);
  await popup.getByText('实习填写需要检查',{exact:false}).waitFor();await zeroWrites(page);assert.equal(requests.length-before,1);
  report.checks.push('Unknown department meaning cannot borrow the second record fact when the current record has no department; entire draft preserved');await popup.close();await page.close();
  await options.getByRole('button',{name:/11 导入与备份/}).click();await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
  await options.getByRole('button',{name:'校验并载入预览'}).click();await options.getByRole('button',{name:'保存档案'}).click();await options.getByText('档案已保存在此浏览器。',{exact:false}).waitFor();
  mode = 'normal'; before = requests.length; page = await pageFor('dynamic'); popup = await popupFor(page); await start(popup); await popup.getByText(completion).waitFor();
  assert.deepEqual(await counts(page), completed); assert.deepEqual(await page.evaluate(() => window.fixture.saved.map(record => record.department)), ['平台研发部', '信息服务部']);
  assert.equal(await page.evaluate(() => window.organizationWrites), 2); assert.deepEqual(requests.slice(before).map(request => request.fields.length), [2, 1, 2, 1]);
  report.checks.push('Delayed new internship field is inferred under a fresh capture, without re-answering the organization or mixing internship facts');
  await popup.close(); await page.close();
  for (const scenario of ['weak-happy','weak-dynamic','weak-disagree','weak-mixed','weak-missing','weak-stop']) {
    if (scenario==='weak-missing') await options.evaluate(async()=>{const key='recruitment.profile.v1';const data=await chrome.storage.local.get(key);delete data[key].internships[0].department;await chrome.storage.local.set({[key]:data[key]});});
    mode=scenario==='weak-disagree'?'disagree':scenario==='weak-stop'?'hold':'normal';before=requests.length;
    page=await pageFor(scenario);popup=await popupFor(page);await start(popup);
    if (scenario==='weak-happy'||scenario==='weak-dynamic') {
      await popup.getByText(completion).waitFor();assert.deepEqual(await counts(page),completed);
      const entries=await page.evaluate(()=>window.fixture.saved);
      for(const [index,entry] of entries.entries())for(const key of ['organization','department','role','description','achievements','startDate','endDate','experienceType','workType','companyProperty','monthlySalary','hasProof'])assert.equal(entry[key],profile.internships[index][key],key);
      if(scenario==='weak-dynamic'){assert.deepEqual(requests.slice(before).map(request=>request.fields.length),[2,1,2,1]);assert.equal(await page.evaluate(()=>window.organizationWrites),2);}
      else {assert.equal(requests.length-before,2);await start(popup);await popup.getByText(completion).waitFor();assert.deepEqual(await counts(page),completed);assert.equal(requests.length-before,2);}
    } else if(scenario==='weak-stop') {
      await waitRequest(before);const previousAborts=aborted;await popup.getByRole('button',{name:'停止实习填写',exact:true}).click();await popup.getByText('实习任务已停止',{exact:false}).waitFor();
      for(let index=0;index<40&&aborted===previousAborts;index++)await new Promise(res=>setTimeout(res,50));assert.ok(aborted>previousAborts);mode='normal';pending();await zeroWrites(page);
    } else {await popup.getByText('实习填写需要检查',{exact:false}).waitFor();await zeroWrites(page);assert.equal(requests.length-before,scenario==='weak-disagree'?1:0);}
    report.checks.push('Weak current-internship meaning '+scenario+': local agreement, independent facts and other-column zero actions verified');await popup.close();await page.close();
    if(scenario==='weak-missing'){await options.getByRole('button',{name:/11 导入与备份/}).click();await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));await options.getByRole('button',{name:'校验并载入预览'}).click();await options.getByRole('button',{name:'保存档案'}).click();await options.getByText('档案已保存在此浏览器。',{exact:false}).waitFor();}
  }
  assert.doesNotMatch(JSON.stringify(requests),/虚构云桥|虚构星河|平台研发部|信息服务部|intentIndex|token|profileRevision/);
  service.closeAllConnections(); await new Promise(res => service.close(res));
  // A protocol-1-only companion rejects internship protocol 3 instead of interpreting it as a legacy request.
  service = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '');
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Headers': 'content-type,x-resume-semantic-token', 'Access-Control-Allow-Methods': 'POST,GET' }); response.end(); return; }
    if (request.url === '/v1/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ protocol: 1, ready: true })); return; }
    request.resume(); response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ state: 'unavailable', proposal: null }));
  });
  await new Promise((res, rej) => { service.once('error', rej); service.listen(43127, '127.0.0.1', res); });
  before = requests.length; page = await pageFor('legacy-companion'); popup = await popupFor(page); await start(popup);
  await popup.getByText('实习填写需要检查', { exact: false }).waitFor(); await zeroWrites(page); assert.equal(requests.length, before);
  report.checks.push('Protocol-1/2-only companion rejection preserves the entire internship draft without fallback facts or Save');
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []); report.passed = true;
  console.info('Internship semantic extension E2E passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'internship-semantic-extension-report.json'), JSON.stringify(report, null, 2));
  await context?.close(); service.closeAllConnections(); await new Promise(res => service.close(res)); }
