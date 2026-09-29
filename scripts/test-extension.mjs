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
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
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

  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  const downloadPromise = options.waitForEvent('download');
  await options.getByRole('button', { name: /导出当前档案 JSON/ }).click();
  const download = await downloadPromise;
  const backupPath = resolve(artifacts, 'test-profile-export.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.deepEqual(backup.education, profile.education);
  assert.deepEqual(backup.basic, profile.basic);
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
