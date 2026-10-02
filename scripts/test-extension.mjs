// Software verification only: a disposable browser, fictional data, and localhost fixtures.
// This script never attaches to the user's browser or visits recruitment websites.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const sample = await readFile(resolve(root, 'examples/sample-profile.json'), 'utf8');
const profile = JSON.parse(sample);
const educationFields = await readFile(resolve(root, 'tests/fixtures/education-fields.html'), 'utf8');
const report = { startedAt: new Date().toISOString(), checks: [], externalRequests: [], errors: [] };
let context;
const server = spawn(process.execPath, ['scripts/serve-example.mjs'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Example server did not start')), 10000);
    server.stdout.on('data', data => { if (data.toString().includes('127.0.0.1:4173')) { clearTimeout(timer); resolveReady(); } });
    server.stderr.on('data', data => { clearTimeout(timer); reject(new Error(data.toString())); });
    server.on('error', reject);
  });
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`,
      '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'],
  });
  context.setDefaultTimeout(10000);
  await context.route(/^https?:/, async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.pathname === '/education-facts') await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: educationFields });
    else if (url.hostname === '127.0.0.1' && url.pathname === '/highest-summary') await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><body><section aria-label="个人信息"><h2>个人信息</h2>
        <label>最高学历<select id="summary-level"><option value="">请选择</option><option value="doctoral">博士研究生</option><option value="master">硕士研究生</option></select></label>
        <label>最高学位<select id="summary-degree"><option value="">请选择</option><option value="d">博士学位</option><option value="m">硕士学位</option><option value="b">学士学位</option></select></label>
        <label>全日制最高学历<select id="summary-fulltime"><option value="">请选择</option><option value="bf">本科</option><option value="mf">硕士研究生</option></select></label>
        <label>全日制最高学历院校<input id="summary-fulltime-school"></label><label>最高学历院校<input id="summary-school"></label>
        <label>已取得最高学位<input id="summary-earned"></label><label>是否最高学位<select id="summary-marker"><option value="">请选择</option><option value="y">是</option><option value="n">否</option></select></label>
        <label>最高学历<input id="summary-manual" value="人工原值"></label></section><button type="submit" id="summary-submit">提交</button>
        <script>window.summarySubmits=0;document.querySelector('#summary-submit').addEventListener('click',()=>window.summarySubmits++);</script></body>` });
    else if (url.hostname === '127.0.0.1' && url.pathname === '/internship-facts') await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><body><section aria-label="实习经历"><h2>实习经历</h2>
        <label>工作单位<input id="intern-company"></label><label>所在部门<input id="intern-department"></label><label>职务<input id="intern-role"></label>
        <label>工作描述<textarea id="intern-description"></textarea></label><label>工作业绩<input id="intern-achievements"></label>
        <label>入职日期<input type="date" id="intern-start"></label><label>离职日期<input type="date" id="intern-end"></label>
        <label>活动经历类型<select id="intern-experience"><option value="">请选择</option><option value="intern">实习经历</option><option value="practice">社会实践</option></select></label>
        <label>工作类型<select id="intern-work"><option value="">请选择</option><option value="i">实习</option><option value="p">兼职</option></select></label>
        <label>企业性质<select id="intern-property"><option value="">请选择</option><option value="private">民营企业</option><option value="public">事业单位</option></select></label>
        <label>税前月薪<select id="intern-salary"><option value="">请选择</option><option value="r1">1000-2000/月</option><option value="r2">2000-3000/月</option></select></label>
        <label>是否有证明<select id="intern-proof"><option value="">请选择</option><option value="yes">是</option><option value="no">否</option></select></label>
        <label>税前月薪范围（USD）<input id="intern-currency"></label><label>税前月薪范围<input type="number" id="intern-amount"></label>
        <label>证明人联系电话<input id="intern-contact"></label><label>工作描述<input value="人工原值" id="intern-manual"></label>
        <button type="button" id="intern-add">添加</button><button type="button" id="intern-save">保存</button><button type="submit" id="intern-submit">提交</button>
        </section><script>window.internActions=0;document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>window.internActions++));</script></body>` });
    else if (url.hostname !== '127.0.0.1') {
      report.externalRequests.push(route.request().url()); await route.abort();
    } else await route.continue();
  });
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  assert.ok(extensionId);
  const initial = context.pages()[0];
  const browserSession = context.browser() ? await context.browser().newBrowserCDPSession() : await context.newCDPSession(initial);
  report.browser = (await browserSession.send('Browser.getVersion')).product;
  report.checks.push('Actual production Manifest V3 installed and service worker started');

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel('姓名', { exact: true }).waitFor();
  assert.equal(await options.getByLabel('姓名', { exact: true }).inputValue(), '');
  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  await options.getByLabel('或粘贴 JSON').fill(sample);
  await options.getByRole('button', { name: '校验并载入预览' }).click();
  await options.getByText('已载入导入预览。', { exact: false }).waitFor();
  await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  await options.reload();
  await options.getByLabel('姓名', { exact: true }).waitFor();
  assert.equal(await options.getByLabel('姓名', { exact: true }).inputValue(), profile.basic.name);
  await options.screenshot({ path: resolve(artifacts, 'options.png'), fullPage: true });
  report.checks.push('Options JSON import, save to chrome.storage.local, reload and persistence');

  await options.getByRole('button', { name: /03 项目经历/ }).click();
  await options.getByLabel('是否有项目经历', { exact: true }).selectOption('none');
  const beforeFactConflict = await options.evaluate(async () => (await chrome.storage.local.get('recruitment.profile.v1'))['recruitment.profile.v1']);
  await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('没有或不适用与已录入的资料冲突。', { exact: false }).waitFor();
  assert.deepEqual(await options.evaluate(async () => (await chrome.storage.local.get('recruitment.profile.v1'))['recruitment.profile.v1']), beforeFactConflict);
  assert.equal(await options.getByLabel('项目名称', { exact: true }).first().inputValue(), profile.projects[0].name);
  await options.getByLabel('是否有项目经历', { exact: true }).selectOption('known');
  await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  await options.reload();
  await options.getByRole('button', { name: /03 项目经历/ }).click();
  assert.equal(await options.getByLabel('是否有项目经历', { exact: true }).inputValue(), 'known');
  report.checks.push('Collection fact editor preserves project records on a contradictory No, refuses the storage write, then saves explicit Yes and reloads its metadata');

  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  const originalStorage = await options.evaluate(async () => (await chrome.storage.local.get('recruitment.profile.v1'))['recruitment.profile.v1']);
  for (const invalid of [
    { ...profile, basic: { ...profile.basic, birthday: '2026-02-30' } },
    { ...profile, projects: [{ id: 'fictional-invalid-range', technologies: [], startDate: '2026-10-01', endDate: '2026-09' }] },
  ]) {
    await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(invalid));
    await options.getByRole('button', { name: '校验并载入预览' }).click();
    await options.getByText('档案格式有误：', { exact: false }).waitFor();
    assert.deepEqual(await options.evaluate(async () => (await chrome.storage.local.get('recruitment.profile.v1'))['recruitment.profile.v1']), originalStorage);
  }
  report.checks.push('Invalid calendar date and necessarily reversed mixed-precision range reject import without replacing the current profile or stored data');
  const downloadPromise = options.waitForEvent('download');
  await options.getByRole('button', { name: /导出当前档案 JSON/ }).click();
  const download = await downloadPromise;
  const backupPath = resolve(artifacts, 'test-profile-export.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.deepEqual(backup.education, profile.education);
  assert.deepEqual(backup.basic, profile.basic);
  assert.equal(backup.collectionFacts.projects.state, 'known');
  assert.equal(backup.collectionFacts.projects.source, 'user');
  assert.equal(backup.collectionFacts.projects.confirmed, true);
  assert.ok(backup.collectionFacts.projects.updatedAt);
  report.checks.push('Actual JSON download contains saved fictional profile');
  await options.close();

  const form = await context.newPage();
  await form.goto('http://127.0.0.1:4173/test-form.html');
  await form.getByLabel('姓名', { exact: true }).first().waitFor();
  const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const targetInfo = targetInfos.find(target => target.type === 'tab' && target.url === form.url());
  assert.ok(targetInfo, `Test tab target missing: ${JSON.stringify(targetInfos)}`);
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfo.targetId });
  // Headless Chromium does not expose toolbar bubbles as Playwright pages. Load the
  // same production popup document in an inactive extension tab after a real action grant.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const formTab = tabs.find(tab => tab.url === 'http://127.0.0.1:4173/test-form.html');
    if (!formTab?.id) throw new Error('No activeTab grant for the fixture');
    await chrome.tabs.update(formTab.id, { active: true });
  });
  await popup.getByRole('button', { name: '扫描页面', exact: true }).click();
  await popup.getByRole('heading', { name: /匹配结果/ }).waitFor();
  const initialStats = await popup.locator('.popup-stats strong').allTextContents();
  report.initialStats = initialStats;
  assert.equal(initialStats[0], '42');
  assert.ok(Number(initialStats[1]) >= 25, `Too few high-confidence matches: ${initialStats}`);
  assert.equal(await form.locator('#major-category').inputValue(), '');
  const recordV2Production = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'RA_RECORD_V2_STATUS' }, { frameId: 0 });
  });
  assert.deepEqual(recordV2Production?.data?.state,
    { enabled: false, state: 'disabled', snapshotVersion: 0 });
  const projectionResults = await worker.evaluate(async targetUrl => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(candidate => candidate.url === targetUrl);
    if (!tab?.id) throw new Error('No content tab for projection check');
    return chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: async () => (
      chrome.runtime.sendMessage({ type: 'RA_PROFILE_PROJECT' })
    ) });
  }, form.url());
  const projection = projectionResults[0]?.result;
  assert.equal(projection.ok, true);
  assert.deepEqual(projection.data.projects.map(item => item.id), profile.projects.map(item => item.id));
  assert.equal(projection.data.projects[0].name, profile.projects[0].name);
  assert.equal(JSON.stringify(projection).includes(profile.basic.name), false);
  assert.equal(JSON.stringify(projection).includes(profile.internships[0].organization), false);
  await popup.locator('.popup-app').screenshot({ path: resolve(artifacts, 'popup.png') });
  report.checks.push('Real toolbar action grants activeTab; production popup scans native fixture, keeps record-v2 disabled, and content-only project projection excludes unrelated profile data');

  await popup.getByRole('button', { name: '一键填写高置信度字段' }).click();
  await popup.getByRole('status').filter({ hasText: /已填写/ }).waitFor();
  const fillMessage = await popup.getByRole('status').textContent();
  report.fillMessage = fillMessage;
  assert.ok(fillMessage.includes(`已填写 ${Number(initialStats[1])} 项，跳过或未完成 0 项`), fillMessage);
  assert.equal(await form.locator('#applicant-name').inputValue(), profile.basic.name);
  assert.equal(await form.locator('#mobile').inputValue(), profile.basic.phone);
  assert.equal(await form.locator('#mail-field').inputValue(), profile.basic.email);
  assert.equal(await form.locator('#bachelor-school').inputValue(), profile.education[1].school);
  assert.equal(await form.locator('#master-school').inputValue(), profile.education[0].school);
  assert.equal(await form.locator('#master-level').inputValue(), 'master');
  assert.equal(await form.locator('#master-degree').inputValue(), 'master');
  assert.equal(await form.locator('#major-category').inputValue(), '');
  assert.equal(await form.locator('#master-gpa').inputValue(), '');
  assert.equal(await form.locator('#unknown-question').inputValue(), '');
  assert.ok((await form.locator('#self-evaluation').inputValue()).length <= 200);
  for (const id of ['sms-code', 'captcha', 'password', 'resume-file']) assert.equal(await form.locator(`#${id}`).inputValue(), '');
  assert.equal(await form.locator('#agreement').isChecked(), false);
  assert.equal(await form.locator('#existing-email').inputValue(), 'keep-this@example.invalid');
  assert.equal(await form.locator('#existing-gender').inputValue(), 'F');
  assert.equal(await form.locator('#submit-count').textContent(), '0');
  report.checks.push('High-confidence fill preserves missing, ambiguous, existing and verification controls; submit count stays zero');

  await popup.getByLabel('我已核对这个候选').check();
  await popup.getByRole('button', { name: /确认填写已勾选的 1 项/ }).click();
  await popup.getByRole('status').filter({ hasText: /已填写 1 项/ }).waitFor();
  assert.equal(await form.locator('#major-category').inputValue(), 'computer');
  report.checks.push('78% major category is written only after explicit checkbox confirmation');
  await form.screenshot({ path: resolve(artifacts, 'filled-form.png'), fullPage: true });

  const denied = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      try { await chrome.storage.local.get('recruitment.profile.v1'); return false; }
      catch { return true; }
    } });
    return result[0]?.result;
  });
  assert.equal(denied, true);
  report.checks.push('Content script cannot read the full profile from chrome.storage.local');
  await popup.close();
  await form.getByRole('button', { name: '新增“民族”字段' }).click();
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfo.targetId });
  const nextPopup = await context.newPage();
  await nextPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const formTab = tabs.find(tab => tab.url === 'http://127.0.0.1:4173/test-form.html');
    await chrome.tabs.update(formTab.id, { active: true });
  });
  await nextPopup.getByRole('button', { name: '扫描页面', exact: true }).click();
  await nextPopup.getByRole('heading', { name: /匹配结果/ }).waitFor();
  assert.equal((await nextPopup.locator('.popup-stats strong').allTextContents())[0], '43');
  await nextPopup.getByRole('button', { name: '一键填写高置信度字段' }).click();
  await nextPopup.getByRole('status').filter({ hasText: /已填写 1 项/ }).waitFor();
  assert.equal(await form.getByLabel('民族', { exact: true }).inputValue(), profile.basic.ethnicity);
  assert.equal(await form.locator('#submit-count').textContent(), '0');
  report.checks.push('Reopened popup rescans a dynamic field and preserves all previously filled values');

  // A second, deliberately old-fashioned portal fixture exercises semantic IDs,
  // table/div labels, readonly calendar inputs, same-origin frames and open shadow roots.
  await nextPopup.close();
  const legacyUrl = 'http://127.0.0.1:4173/legacy-recruitment-form.html';
  const legacy = await context.newPage();
  await legacy.goto(legacyUrl);
  await legacy.locator('#RecruitmentPortalPersonProfile_Birthday').waitFor();
  await legacy.frameLocator('#legacy-profile-frame').locator('#LegacyIframeHouseholdLocation').waitFor();
  await legacy.locator('#legacy-shadow-host').locator('#LegacyShadowPoliticalStatus').waitFor();
  const legacyTargets = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const legacyTarget = legacyTargets.targetInfos.find(target => target.url === legacyUrl);
  assert.ok(legacyTarget, `Legacy fixture tab target missing: ${JSON.stringify(legacyTargets.targetInfos)}`);
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: legacyTarget.targetId });
  const legacyPopup = await context.newPage();
  await legacyPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find(tab => tab.url === url);
    if (!target?.id) throw new Error('Legacy fixture activeTab grant missing');
    await chrome.tabs.update(target.id, { active: true });
  }, legacyUrl);
  await legacyPopup.getByRole('button', { name: '扫描页面', exact: true }).click();
  await legacyPopup.getByRole('heading', { name: /匹配结果/ }).waitFor();
  const legacyStats = await legacyPopup.locator('.popup-stats strong').allTextContents();
  report.legacyStats = legacyStats;
  assert.ok(Number(legacyStats[0]) >= 22, `Nested controls were not all scanned: ${legacyStats}`);
  assert.ok(Number(legacyStats[1]) >= 17, `Too few legacy fields are high confidence: ${legacyStats}`);
  await legacyPopup.getByRole('button', { name: '一键填写高置信度字段' }).click();
  await legacyPopup.getByRole('status').filter({ hasText: /已填写/ }).waitFor();
  report.legacyFillMessage = await legacyPopup.getByRole('status').textContent();
  assert.match(report.legacyFillMessage, /自动重扫 1 次/, 'Dependent field did not trigger the bounded rescan loop');

  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_Name').inputValue(), profile.basic.name);
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_Birthday').inputValue(), profile.basic.birthday);
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_CertificateType').inputValue(), 'ID');
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_CertificateNumber').inputValue(), profile.basic.idNumber);
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_HighestEducation').inputValue(), 'master');
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_HighestDegree').inputValue(), 'master');
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_EducationStudyMode').inputValue(), 'fulltime');
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_MajorCourse').inputValue(), profile.education[0].courses);
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_ProfessionalRanking').inputValue(), '');
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_RecruitmentChannel').inputValue(), '');
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_TalentSource').inputValue(), '');
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_Gender_Male').isChecked(), true);
  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_Gender_Female').isChecked(), false);

  assert.equal(await legacy.locator('#RecruitmentPortalPersonProfile_Interests').inputValue(), profile.basic.interests);
  assert.ok((await legacy.locator('#RecruitmentPortalPersonProfile_Honors').inputValue()).includes(profile.awards[0].name));
  assert.ok((await legacy.locator('#RecruitmentPortalPersonProfile_AcademicWorks').inputValue()).includes(profile.research.papers[0].title));
  assert.ok((await legacy.locator('#RecruitmentPortalPersonProfile_PatentAchievements').inputValue()).includes(profile.research.patents[0].title));
  assert.ok((await legacy.locator('#RecruitmentPortalPersonProfile_Strengths').inputValue()).includes(profile.skills.programmingLanguages[0]));
  assert.ok((await legacy.locator('#RecruitmentPortalPersonProfile_SpecialSkills').inputValue()).includes(profile.skills.programmingLanguages[0]));
  assert.ok((await legacy.locator('#RecruitmentPortalPersonProfile_SocialActivities').inputValue()).includes(profile.studentWork[0].organization));
  assert.equal(await legacy.frameLocator('#legacy-profile-frame').locator('#LegacyIframeHouseholdLocation').inputValue(), profile.basic.householdLocation);
  assert.equal(await legacy.locator('#legacy-shadow-host').locator('#LegacyShadowPoliticalStatus').inputValue(), profile.basic.politicalStatus);
  assert.equal(await legacy.locator('#legacy-submit-count').textContent(), '0');
  await legacyPopup.locator('.popup-app').screenshot({ path: resolve(artifacts, 'legacy-popup.png') });
  await legacy.screenshot({ path: resolve(artifacts, 'legacy-form.png'), fullPage: true });
  report.checks.push('Traditional portal: semantic long IDs, table/div labels, readonly birthday, radio, profile-level education, aggregate answers, iframe and open shadow fields fill automatically; unknown source fields stay empty; no submit');
  await legacyPopup.close();

  const factsProfile = { ...profile, projects: [profile.projects[0]], internships: [], certificates: [] };
  await worker.evaluate(async value => {
    await chrome.storage.local.set({ 'recruitment.profile.v1': value });
  }, factsProfile);
  const factsOptions = await context.newPage();
  await factsOptions.goto(`chrome-extension://${extensionId}/options.html`);
  await factsOptions.getByRole('button', { name: /04 实习经历/ }).click();
  await factsOptions.getByLabel('是否有实习经历', { exact: true }).selectOption('none');
  await factsOptions.getByRole('button', { name: '保存档案' }).click();
  await factsOptions.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  await factsOptions.getByRole('button', { name: /03 项目经历/ }).click();
  await factsOptions.getByLabel('结束时间状态', { exact: true }).selectOption('ongoing');
  assert.equal(await factsOptions.getByLabel('结束时间', { exact: true }).inputValue(), profile.projects[0].endDate);
  await factsOptions.getByRole('button', { name: '保存档案' }).click();
  await factsOptions.getByText('结束时间状态与已填写日期冲突', { exact: false }).waitFor();
  await factsOptions.getByLabel('结束时间', { exact: true }).fill('');
  await factsOptions.getByRole('button', { name: '保存档案' }).click();
  await factsOptions.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  await factsOptions.reload();
  await factsOptions.getByRole('button', { name: /04 实习经历/ }).click();
  assert.equal(await factsOptions.getByLabel('是否有实习经历', { exact: true }).inputValue(), 'none');
  await factsOptions.getByRole('button', { name: /03 项目经历/ }).click();
  assert.equal(await factsOptions.getByLabel('结束时间状态', { exact: true }).inputValue(), 'ongoing');
  assert.equal(await factsOptions.getByLabel('结束时间', { exact: true }).inputValue(), '');
  await factsOptions.close();
  const factsUrl = 'http://127.0.0.1:4173/collection-facts-form.html';
  const factsPage = await context.newPage();
  await factsPage.goto(factsUrl);
  const factsTargets = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const factsTarget = factsTargets.targetInfos.find(target => target.url === factsUrl);
  assert.ok(factsTarget);
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: factsTarget.targetId });
  const factsPopup = await context.newPage();
  await factsPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(target => target.url === url);
    await chrome.tabs.update(tab.id, { active: true });
  }, factsUrl);
  await factsPopup.getByRole('button', { name: '扫描页面', exact: true }).click();
  await factsPopup.getByRole('heading', { name: /匹配结果/ }).waitFor();
  await factsPopup.getByRole('button', { name: '一键填写高置信度字段' }).click();
  await factsPopup.getByRole('status').filter({ hasText: /已填写/ }).waitFor();
  assert.equal(await factsPage.locator('#projects-present').inputValue(), 'opaque-a');
  assert.equal(await factsPage.locator('#internships-present').inputValue(), 'opaque-d');
  assert.equal(await factsPage.locator('#papers-present').inputValue(), 'opaque-g');
  assert.equal(await factsPage.locator('#certificates-present').inputValue(), '');
  assert.equal(await factsPage.locator('#combined').inputValue(), '');
  assert.equal(await factsPage.locator('#project-name').inputValue(), profile.projects[0].name);
  assert.equal(await factsPage.locator('#project-end').inputValue(), 'opaque-present');
  assert.equal(await factsPage.locator('#project-end-date').inputValue(), '');
  assert.equal(await factsPage.locator('#submit-count').textContent(), '0');
  assert.match(await factsPopup.getByRole('status').textContent(), /自动重扫 1 次/);
  report.checks.push('Explicit No edited in the production options persists; ordinary collection questions use unique visible Yes/No, keep unknown empty and combined questions unanswered, and rescan/fill the project field revealed by Yes without submitting');
  report.checks.push('Ongoing end-date state edited in production options preserves conflicting old dates for correction, persists without inventing a day, selects the unique visible Present option after dynamic reveal, and leaves an unsupported native date input empty');
  await factsPopup.close();
  await factsPage.close();
  await worker.evaluate(async value => {
    await chrome.storage.local.set({ 'recruitment.profile.v1': value });
  }, backup);

  await worker.evaluate(async value => {
    await chrome.storage.local.set({ 'recruitment.profile.v1': { ...value, projects: [value.projects[0]] } });
  }, backup);
  const commonOptions = await context.newPage(); await commonOptions.goto(`chrome-extension://${extensionId}/options.html`);
  await commonOptions.getByLabel('英文姓名', { exact: true }).fill('Fictional User');
  await commonOptions.getByLabel('健康状况', { exact: true }).fill('健康');
  await commonOptions.getByLabel('婚姻状况', { exact: true }).fill('未婚');
  await commonOptions.getByLabel('身高（厘米）', { exact: true }).fill('175');
  await commonOptions.getByLabel('体重（千克）', { exact: true }).fill('65');
  await commonOptions.getByRole('button', { name: /12 求职意向与作品/ }).click();
  await commonOptions.getByLabel('期望岗位', { exact: true }).fill('研发岗');
  await commonOptions.getByLabel('意向城市', { exact: true }).fill('虚构城');
  await commonOptions.getByLabel('期望薪资', { exact: true }).fill('10000-15000元/月');
  await commonOptions.getByLabel('GitHub主页', { exact: true }).fill('javascript:alert(1)');
  const beforeCommonSave = await commonOptions.evaluate(async () => (await chrome.storage.local.get('recruitment.profile.v1'))['recruitment.profile.v1']);
  await commonOptions.getByRole('button', { name: '保存档案' }).click();
  await commonOptions.getByText('links.github：链接须为完整', { exact: false }).waitFor();
  assert.deepEqual(await commonOptions.evaluate(async () => (await chrome.storage.local.get('recruitment.profile.v1'))['recruitment.profile.v1']), beforeCommonSave);
  await commonOptions.getByLabel('GitHub主页', { exact: true }).fill('https://github.com/fictional-example');
  await commonOptions.getByLabel('作品展示链接', { exact: true }).fill('https://portfolio.example.test/');
  await commonOptions.getByLabel('个人主页', { exact: true }).fill('https://home.example.test/');
  await commonOptions.getByRole('button', { name: /03 项目经历/ }).click();
  await commonOptions.getByLabel('项目作品 / 仓库链接', { exact: true }).fill('https://github.com/fictional-example/project');
  await commonOptions.getByRole('button', { name: '保存档案' }).click();
  await commonOptions.getByText('档案已保存在此浏览器。', { exact: false }).waitFor();
  const commonSaved = await commonOptions.evaluate(async () => (await chrome.storage.local.get('recruitment.profile.v1'))['recruitment.profile.v1']);
  assert.match(commonSaved.revision, /^[\da-f]{8}-[\da-f-]{27}$/i);
  assert.notEqual(commonSaved.revision, beforeCommonSave.revision);
  await commonOptions.reload();
  assert.equal(await commonOptions.getByLabel('英文姓名', { exact: true }).inputValue(), 'Fictional User');
  await commonOptions.close();
  const commonUrl = 'http://127.0.0.1:4173/common-facts-form.html'; const commonPage = await context.newPage();
  await commonPage.goto(commonUrl);
  const commonTarget = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos.find(target => target.url === commonUrl);
  assert.ok(commonTarget); await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: commonTarget.targetId });
  const commonPopup = await context.newPage(); await commonPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(target => target.url === url); await chrome.tabs.update(tab.id, { active: true });
  }, commonUrl);
  await commonPopup.getByRole('button', { name: '扫描页面', exact: true }).click();
  await commonPopup.getByRole('heading', { name: /匹配结果/ }).waitFor();
  await commonPopup.getByRole('button', { name: '一键填写高置信度字段' }).click();
  await commonPopup.getByRole('status').filter({ hasText: /已填写/ }).waitFor();
  for (const [id, value] of Object.entries({ 'english-name': 'Fictional User', health: 'opaque-health', marital: 'opaque-marital', height: '175', weight: '65',
    position: '研发岗', city: '虚构城', salary: '10000-15000元/月', github: 'https://github.com/fictional-example', portfolio: 'https://portfolio.example.test/',
    homepage: 'https://home.example.test/', 'project-url': 'https://github.com/fictional-example/project' })) assert.equal(await commonPage.locator(`#${id}`).inputValue(), value);
  for (const id of ['height-no-unit', 'first-name', 'contact-english']) assert.equal(await commonPage.locator(`#${id}`).inputValue(), '');
  assert.equal(await commonPage.locator('#submit-count').textContent(), '0');
  report.checks.push('Production options edits and persists common facts, preference lists, personal and project URLs; invalid script URL leaves storage unchanged; save replaces the opaque revision; real popup fills all 12 known fields while protecting missing units, split English names and contacts');
  await commonPopup.close(); await commonPage.close();
  await worker.evaluate(async value => { await chrome.storage.local.set({ 'recruitment.profile.v1': value }); }, backup);

  // Fulfill an isolated synthetic fixture at the adapter's origin. This never reaches the actual site.
  const mobileUrl = 'https://job.10086.cn/personal/resume_campus.html?fixture=1';
  await context.route(mobileUrl, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', path: resolve(root, 'tests/fixtures/mobile-resume.html') }));
  await nextPopup.close();
  const mobile = await context.newPage();
  await mobile.goto(mobileUrl);
  const mobileTargets = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const mobileTarget = mobileTargets.targetInfos.find(target => target.url === mobileUrl);
  assert.ok(mobileTarget);
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: mobileTarget.targetId });
  const mobilePopup = await context.newPage();
  await mobilePopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find(tab => tab.url === url);
    await chrome.tabs.update(target.id, { active: true });
  }, mobileUrl);
  await mobilePopup.getByRole('button', { name: '扫描页面', exact: true }).click();
  await mobilePopup.getByRole('heading', { name: /匹配结果/ }).waitFor();
  const mobileStats = await mobilePopup.locator('.popup-stats strong').allTextContents();
  report.mobileStats = mobileStats;
  assert.ok(Number(mobileStats[1]) >= 5, `Mobile fixture still blocked: ${mobileStats}`);
  await mobilePopup.getByRole('button', { name: '一键填写高置信度字段' }).click();
  await mobilePopup.getByRole('status').filter({ hasText: /已填写/ }).waitFor();
  report.mobileFillMessage = await mobilePopup.getByRole('status').textContent();
  assert.ok(report.mobileFillMessage.includes(`已填写 ${Number(mobileStats[1])} 项，跳过或未完成 0 项`), report.mobileFillMessage);
  assert.equal(await mobile.locator('#name').inputValue(), profile.basic.name);
  assert.equal(await mobile.locator('#phone').inputValue(), profile.basic.phone);
  assert.equal(await mobile.locator('#email').inputValue(), profile.basic.email);
  assert.equal(await mobile.locator('#sltNation > span').textContent(), profile.basic.ethnicity);
  assert.equal(JSON.parse(await mobile.locator('#selection-state').textContent()).sltNation, '01');
  assert.equal(await mobile.locator('#englishName').inputValue(), '请输入英文名');
  assert.equal(await mobile.locator('#existingEmail').inputValue(), 'keep@example.invalid');
  assert.equal(await mobile.locator('#emergencyContactPerson').inputValue(), '请输入紧急联系人姓名');
  assert.equal(await mobile.locator('#projectName').inputValue(), '输入项目名称');
  assert.equal(await mobile.locator('#sltId > span').textContent(), '请选择');
  assert.equal(await mobile.locator('#sltBirth > span').textContent(), '请选择');
  assert.equal(await mobile.locator('#nationality > span').textContent(), '测试已有国籍');
  assert.equal(await mobile.locator('[name="gender"]').isChecked(), true);
  assert.equal(await mobile.locator('#submit-count').textContent(), '0');
  await mobilePopup.locator('.popup-app').screenshot({ path: resolve(artifacts, 'mobile-popup.png') });
  await mobile.screenshot({ path: resolve(artifacts, 'mobile-form.png'), fullPage: true });
  report.checks.push('Synthetic China Mobile template: value prompts filled, custom select event updates site state, existing/hidden/English/contact/dependent controls protected; no actual site request or submit');
  await mobile.getByRole('button', { name: '编辑项目经历（测试）' }).click();
  await mobilePopup.getByRole('button', { name: '扫描页面', exact: true }).click();
  await mobilePopup.getByRole('combobox', { name: '项目名称：选择档案经历' }).waitFor();
  assert.equal(await mobilePopup.getByRole('combobox', { name: '项目名称：选择档案经历' }).inputValue(), '');
  await mobilePopup.getByRole('combobox', { name: '项目名称：选择档案经历' }).selectOption('projects.1.name');
  await mobilePopup.getByRole('button', { name: '同组使用这段经历（2 项，仍需核对）' }).click();
  assert.equal(await mobilePopup.getByRole('combobox', { name: '项目职责：选择档案经历' }).inputValue(), 'projects.1.responsibilities');
  const confirmations = mobilePopup.getByLabel('我已核对这个候选');
  assert.equal(await confirmations.count(), 2);
  for (const checkbox of await confirmations.all()) { assert.equal(await checkbox.isChecked(), false); await checkbox.check(); }
  await mobilePopup.getByRole('button', { name: '确认填写已勾选的 2 项' }).click();
  await mobilePopup.getByRole('status').filter({ hasText: '已填写 2 项，跳过或未完成 0 项' }).waitFor();
  assert.equal(await mobile.locator('#projectName').inputValue(), profile.projects[1].name);
  assert.equal(await mobile.locator('#projectDuty').inputValue(), profile.projects[1].responsibilities);
  assert.equal(await mobile.locator('#submit-count').textContent(), '0');
  report.checks.push('Open hidden project editor, rescan, choose second original project for both fields, confirm and fill; never defaults to first project');
  const problemDownload = mobilePopup.waitForEvent('download');
  await mobilePopup.getByRole('button', { name: '下载问题报告（填写值已隐藏）' }).click();
  const problemFile = await problemDownload;
  const problemPath = resolve(artifacts, 'problem-report.json');
  await problemFile.saveAs(problemPath);
  const problem = JSON.parse(await readFile(problemPath, 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8'));
  assert.equal(problem.extensionVersion, manifest.version);
  assert.equal(problem.contentVersion, manifest.version);
  assert.equal(problem.summary.filled, 2);
  assert.equal(problem.pageType, 'china-mobile-campus');
  assert.ok(!JSON.stringify(problem).includes(profile.basic.name));
  assert.ok(!JSON.stringify(problem).includes(profile.projects[1].name));
  report.extensionVersion = manifest.version;
  report.checks.push('Actual diagnostic download has current versions and fill outcomes, masks candidate names and project names');
  await mobilePopup.locator('.popup-app').screenshot({ path: resolve(artifacts, 'mobile-project-popup.png') });
  await worker.evaluate(async () => {
    const key = 'recruitment.profile.v1'; const saved = (await chrome.storage.local.get(key))[key];
    saved.education = saved.education.map(entry => ({ ...entry, educationType: '统招', country: '中国',
      schoolProperty: entry.level === '本科' ? '国内普通院校' : '211', durationYears: entry.level === '本科' ? '4' : '3' }));
    saved.revision = crypto.randomUUID(); await chrome.storage.local.set({ [key]: saved });
  });
  const educationUrl = 'http://127.0.0.1:4173/education-facts'; const educationPage = await context.newPage(); await educationPage.goto(educationUrl);
  const educationTargets = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: educationTargets.targetInfos.find(target => target.url === educationUrl).targetId });
  const educationPopup = await context.newPage(); await educationPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(item => item.url === url); await chrome.tabs.update(tab.id, { active: true }); }, educationUrl);
  await educationPopup.getByRole('button', { name: '扫描页面', exact: true }).click();
  await educationPopup.getByRole('heading', { name: /匹配结果/ }).waitFor();
  await educationPopup.getByRole('button', { name: '一键填写高置信度字段' }).click();
  await educationPopup.getByRole('status').filter({ hasText: /已填写 8 项，跳过或未完成 0 项/ }).waitFor();
  for (const [id, value] of Object.entries({ 'b-type': 'b-admission', 'm-type': 'm-admission', 'b-property': 'b-school', 'm-property': 'm-school',
    'b-duration': '4', 'm-duration': '3', 'b-country': '中国', 'm-country': '中国', highest: '' }))
    assert.equal(await educationPage.locator('#' + id).inputValue(), value);
  assert.equal(await educationPage.locator('#submits').textContent(), '0');
  report.checks.push('Known undergraduate/master admission, school category, duration and country fill eight distinct facts through the production popup; highest-degree boolean stays unresolved and Submit remains zero');
  for (const mode of ['independent', 'missing-degree', 'missing-mode', 'tied-level']) {
    const records = [
      { id: 'summary-master', level: '硕士研究生', degree: '硕士学位', school: '虚构硕士学校', studyMode: '非全日制' },
      { id: 'summary-bachelor', level: '本科', degree: '学士学位', school: '虚构本科学校', studyMode: '全日制' },
      { id: 'summary-doctor', level: '博士研究生', degree: '学士学位', school: '虚构博士学校', studyMode: '非全日制' },
    ];
    if (mode === 'missing-degree') delete records[1].degree;
    if (mode === 'missing-mode') delete records[0].studyMode;
    if (mode === 'tied-level') records.push({ ...records[2], id: 'summary-doctor-two', school: '虚构第二博士学校' });
    await worker.evaluate(async education => {
      const key = 'recruitment.profile.v1'; const saved = (await chrome.storage.local.get(key))[key];
      saved.education = education; saved.revision = crypto.randomUUID(); await chrome.storage.local.set({ [key]: saved });
    }, records);
    const url = 'http://127.0.0.1:4173/highest-summary?case=' + mode;
    const page = await context.newPage(); await page.goto(url);
    const targets = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: targets.find(target => target.url === url).targetId });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async value => { const tab = (await chrome.tabs.query({})).find(item => item.url === value);
      await chrome.tabs.update(tab.id, { active: true }); }, url);
    await popup.getByRole('button', { name: '扫描页面', exact: true }).click();
    await popup.getByRole('heading', { name: /匹配结果/ }).waitFor();
    await popup.getByRole('button', { name: '一键填写高置信度字段' }).click();
    const written = mode === 'independent' ? 5 : mode === 'missing-mode' ? 3 : 4;
    await popup.getByRole('status').filter({ hasText: new RegExp('已填写 ' + written + ' 项，跳过或未完成 0 项') }).waitFor();
    for (const [id, value] of Object.entries({ 'summary-level': 'doctoral', 'summary-degree': mode === 'missing-degree' ? '' : 'm',
      'summary-fulltime': mode === 'missing-mode' ? '' : 'bf', 'summary-fulltime-school': mode === 'missing-mode' ? '' : '虚构本科学校',
      'summary-school': mode === 'tied-level' ? '' : '虚构博士学校', 'summary-earned': '', 'summary-marker': '', 'summary-manual': '人工原值' })) {
      assert.equal(await page.locator('#' + id).inputValue(), value, mode + '/' + id);
    }
    assert.equal(await page.evaluate(() => window.summarySubmits), 0);
    report.checks.push(mode + ': production ordinary popup resolves level/degree/full-time independently, protects missing facts, earned/boolean questions, ties and manual values');
    await popup.close(); await page.close();
  }
  for (const mode of ['first', 'second', 'missing-description', 'multiple']) {
    const records = [{ id: 'fictional-cloud', organization: '虚构云桥科技', department: '平台研发部', role: '软件开发实习生',
      description: '维护课程演示服务并编写接口测试。', achievements: '完成课程接口交付。', startDate: '2025-07-01', endDate: '2025-09-30',
      experienceType: '实习经历', workType: '实习', companyProperty: '民营企业', monthlySalary: '1000-2000/月', hasProof: '否' },
    { id: 'fictional-library', organization: '虚构星河图书馆', department: '信息服务部', role: '信息整理实习生',
      description: '核对检索记录并协助处理读者反馈。', achievements: '完成检索记录核对。', startDate: '2026-01-10', endDate: '2026-02-20',
      experienceType: '社会实践', workType: '兼职', companyProperty: '事业单位', monthlySalary: '2000-3000/月', hasProof: '是' }];
    const current = mode === 'second' ? records[1] : records[0];
    if (mode === 'missing-description') delete current.description;
    await worker.evaluate(async internships => { const key = 'recruitment.profile.v1'; const saved = (await chrome.storage.local.get(key))[key];
      saved.internships = internships; saved.revision = crypto.randomUUID(); await chrome.storage.local.set({ [key]: saved }); }, mode === 'multiple' ? records : [current]);
    const url = 'http://127.0.0.1:4173/internship-facts?case=' + mode;
    const page = await context.newPage(); await page.goto(url);
    const targets = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: targets.find(target => target.url === url).targetId });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async value => { const tab = (await chrome.tabs.query({})).find(item => item.url === value);
      await chrome.tabs.update(tab.id, { active: true }); }, url);
    await popup.getByRole('button', { name: '扫描页面', exact: true }).click();
    await popup.getByRole('heading', { name: /匹配结果/ }).waitFor();
    const written = mode === 'multiple' ? 0 : mode === 'missing-description' ? 11 : 12;
    if (Number((await popup.locator('.popup-stats strong').allTextContents())[1]) !== written) {
      report.internshipDiagnostic = await popup.locator('.match-card').evaluateAll(cards => cards.map(card => ({
        label: card.querySelector('.match-label')?.textContent, status: card.querySelector('.result-badge')?.textContent,
        meta: card.querySelector('.match-meta')?.textContent, reason: card.querySelector('.match-reason')?.textContent,
      })));
    }
    assert.equal(Number((await popup.locator('.popup-stats strong').allTextContents())[1]), written);
    if (written) {
      await popup.getByRole('button', { name: '一键填写高置信度字段' }).click();
      await popup.getByRole('status').filter({ hasText: new RegExp('已填写 ' + written + ' 项，跳过或未完成 0 项') }).waitFor();
    } else assert.equal(await popup.getByRole('button', { name: '一键填写高置信度字段' }).isDisabled(), true);
    const expected = { 'intern-company': current.organization, 'intern-department': current.department, 'intern-role': current.role,
      'intern-description': current.description ?? '', 'intern-achievements': current.achievements, 'intern-start': current.startDate, 'intern-end': current.endDate,
      'intern-experience': mode === 'second' ? 'practice' : 'intern', 'intern-work': mode === 'second' ? 'p' : 'i',
      'intern-property': mode === 'second' ? 'public' : 'private', 'intern-salary': mode === 'second' ? 'r2' : 'r1', 'intern-proof': mode === 'second' ? 'yes' : 'no' };
    for (const [id, value] of Object.entries(expected)) assert.equal(await page.locator('#' + id).inputValue(), mode === 'multiple' ? '' : value, mode + '/' + id);
    for (const id of ['intern-currency', 'intern-amount', 'intern-contact']) assert.equal(await page.locator('#' + id).inputValue(), '');
    assert.equal(await page.locator('#intern-manual').inputValue(), '人工原值'); assert.equal(await page.evaluate(() => window.internActions), 0);
    report.checks.push(mode + ': production ordinary popup fills current internship facts, preserves missing description and ambiguous records, and rejects currency/amount/contact guessing; no Add/Save/Submit');
    await popup.close(); await page.close();
  }
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error instanceof Error ? error.stack : String(error);
  console.error(report.failure);
  if (context) report.openPages = context.pages().map(page => page.url());
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  server.kill();
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifacts, 'extension-e2e.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
}
