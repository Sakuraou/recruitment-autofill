// Disposable MV3 browser test with fictional data and a locally fulfilled page.
// Does not attach to a user browser, use a saved session, or contact the live site.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const html = await readFile(resolve(root, 'tests/fixtures/mobile-workflow.html'), 'utf8');
const wholeFixture = await readFile(resolve(root, 'tests/fixtures/mobile-whole-workflow.js'), 'utf8');
const profile = JSON.parse(await readFile(resolve(root, 'tests/fixtures/workflow-profile.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8'));
const url = 'https://job.10086.cn/personal/resume_campus.html?workflow-fixture=local';
const report = { version: manifest.version, startedAt: new Date().toISOString(), checks: [], externalRequests: [], errors: [] };
let context;
try {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`, '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  context.setDefaultTimeout(15000);
  await context.route(/^https?:/, async route => {
    if (route.request().url() === url) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    else { report.externalRequests.push(route.request().url()); await route.abort(); }
  });
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const browserSession = context.browser() ? await context.browser().newBrowserCDPSession() : await context.newCDPSession(context.pages()[0]);
  report.browser = (await browserSession.send('Browser.getVersion')).product;
  const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByRole('button', { name: /11 导入与备份/ }).click();
  await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
  await options.getByRole('button', { name: '校验并载入预览' }).click();
  await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor(); await options.close();
  const page = await context.newPage(); await page.goto(url); await page.locator('#educationInfo').waitFor();
  const targets = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
  const target = targets.find(item => item.url === url); assert.ok(target);
  await browserSession.send('Extensions.triggerAction', { id, targetId: target.targetId });
  async function popup() {
    const view = await context.newPage();
    await worker.evaluate(async targetUrl => {
      const tabs = await chrome.tabs.query({}); const tab = tabs.find(item => item.url === targetUrl);
      await chrome.tabs.update(tab.id, { active: true });
    }, url);
    await view.goto(`chrome-extension://${id}/popup.html`);
    await view.getByRole('region', { name: '中国移动连续填写' }).waitFor();
    return view;
  }
  async function state(view) {
    return view.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'RA_WORKFLOW_STATUS' }, { frameId: 0 });
      if (!response.ok) throw new Error(response.error); return response.data.state;
    });
  }
  let view = await popup();
  const dateLabelFits = await view.locator('.workflow-date-option').evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().height < 80);
  assert.ok(dateLabelFits, 'Month convention option must remain readable inside the popup');
  await view.getByRole('button', { name: '连续填写教育与项目', exact: true }).click();
  await page.waitForFunction(() => window.fixture.sequence.length > 0, undefined, { timeout: 30_000 });
  await view.close();
  await page.waitForFunction(() => window.fixture.sequence.length === 4, undefined, { timeout: 30_000 });
  view = await popup();
  await view.getByText(/教育与项目本轮结束：保存 4 条/).waitFor();
  const result = await page.evaluate(() => ({ sequence: window.fixture.sequence, adds: window.fixture.adds, saves: window.fixture.saves,
    submits: window.fixture.submits, deletes: window.fixture.deletes, scrolls: window.fixture.scrolls.length }));
  assert.deepEqual(result.sequence.map(item => item.educationSchool || item.projectName), ['青岚科技大学', '云川工程大学', '校园图书检索平台', '环境传感数据看板']);
  assert.deepEqual(result.sequence.slice(0, 2).map(item => item.isHigestDegree), ['N', 'Y']);
  assert.deepEqual(result.adds, { educationInfo: 2, projectInfo: 2, awardInfo: 0 });
  assert.deepEqual(result.saves, result.adds); assert.equal(result.submits + result.deletes, 0); assert.ok(result.scrolls > 4);
  report.checks.push('Production popup starts workflow without scan or record selection; closing popup preserves execution: undergraduate, master, project 1, project 2 automatically added and saved in order');
  report.firstRun = result;
  await view.locator('.workflow-panel').screenshot({ path: resolve(artifacts, 'workflow-popup.png') });
  await page.screenshot({ path: resolve(artifacts, 'workflow-completed.png') });
  await view.getByRole('button', { name: '连续填写教育与项目', exact: true }).click();
  await view.getByText(/教育与项目本轮结束：保存 0 条，已有 4 条/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixture.saves), { educationInfo: 2, projectInfo: 2, awardInfo: 0 });
  report.checks.push('Reopening popup recovers completion status; repeated start skips all four existing records without another Add or Save');

  const oneEducation = structuredClone(profile); oneEducation.education = [profile.education[1]]; oneEducation.projects = [];
  await view.evaluate(async data => { await chrome.storage.local.set({ 'recruitment.profile.v1': data }); }, oneEducation);
  await view.close(); await page.reload();
  await page.evaluate(() => {
    window.fixture.config.requireProof = true;
    document.querySelector('#educationInfo .secH a').click();
  });
  view = await popup();
  await view.getByRole('button', { name: '连续填写教育与项目', exact: true }).click();
  await view.getByText(/教育证明：请在网页上传/).waitFor();
  assert.equal((await state(view)).phase, 'blocked');
  assert.equal(await page.evaluate(() => window.fixture.saves.educationInfo), 0);
  await view.locator('.workflow-panel').screenshot({ path: resolve(artifacts, 'workflow-missing-proof.png') });
  await page.locator('#fixture-upload-proof').click();
  await view.getByRole('button', { name: '继续连续填写', exact: true }).click();
  await view.getByText(/教育与项目本轮结束：保存 1 条/).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.adds.educationInfo), 1);
  report.checks.push('Already-open empty education editor is accepted; missing proof pauses before Save; after manual upload Continue saves the same record without another Add');

  const oneProject = structuredClone(profile); oneProject.education = []; oneProject.projects = [profile.projects[0]];
  await view.evaluate(async data => { await chrome.storage.local.set({ 'recruitment.profile.v1': data }); }, oneProject);
  await view.close(); await page.reload();
  await page.evaluate(() => { window.fixture.config.saveDelay = 1800; });
  view = await popup();
  await view.getByRole('button', { name: '连续填写教育与项目', exact: true }).click();
  await page.waitForFunction(() => window.fixture.saves.projectInfo === 1);
  await view.getByRole('button', { name: '暂停连续填写', exact: true }).click();
  await page.waitForFunction(() => window.fixture.records.projectInfo.length === 1);
  assert.equal((await state(view)).phase, 'paused');
  await view.getByRole('button', { name: '继续连续填写', exact: true }).click();
  await view.getByText(/教育与项目本轮结束：保存 1 条/).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.saves.projectInfo), 1);
  assert.equal(await page.evaluate(() => window.fixture.submits + window.fixture.deletes), 0);
  report.checks.push('Pause during asynchronous Save, then Continue after the saved card appears: no duplicate Save, no final Submit, no Delete');
  const sixProjects = structuredClone(profile); sixProjects.education = [];
  sixProjects.projects = Array.from({ length: 6 }, (_, index) => ({ ...profile.projects[index % 2], id: `sequence-${index}`, name: `虚构连续项目${index + 1}｜功能验证`, startDate: '2026-09-01', endDate: index ? '2026-09-08' : undefined, organization: '无' }));
  await view.evaluate(async data => { await chrome.storage.local.set({ 'recruitment.profile.v1': data }); }, sixProjects);
  await view.close(); await page.reload();
  await page.evaluate(() => { window.fixture.config.saveDelay = 500; });
  view = await popup();
  await view.getByRole('button', { name: '连续填写教育与项目', exact: true }).click();
  await view.getByText(/本条可填内容已填好/).waitFor();
  await page.locator('#projectName').fill('虚构连续项目1');
  await page.locator('#projectTime_t').click();
  await page.locator('#projectTime_t .slideConYear li').getByText('2026', { exact: true }).click();
  await page.locator('#projectTime_t .slideConMon li').getByText('9', { exact: true }).click();
  await page.locator('#projectTime_t .slideConDay li').getByText('8', { exact: true }).click();
  await page.locator('#projectInfo .btnP .save').click();
  await view.getByRole('button', { name: '继续连续填写', exact: true }).click();
  await view.getByText(/教育与项目本轮结束：保存 6 条/).waitFor();
  const sixResult = await page.evaluate(() => ({ names: window.fixture.sequence.map(item => item.projectName), saves: window.fixture.saves.projectInfo, adds: window.fixture.adds.projectInfo, submits: window.fixture.submits, deletes: window.fixture.deletes }));
  assert.deepEqual(sixResult.names, ['虚构连续项目1', ...sixProjects.projects.slice(1).map(item => item.name)]);
  assert.equal(sixResult.saves, 6); assert.equal(sixResult.adds, 6); assert.equal(sixResult.submits + sixResult.deletes, 0);
  report.sixProjectRun = sixResult;
  report.checks.push('User fills missing end date, shortens first project name and saves on website; Continue advances through all six projects exactly once, including an in-flight manual save');
  const awardProfile = structuredClone(profile);
  awardProfile.basic.studentCadre = '否';
  awardProfile.awards = JSON.parse(await readFile(resolve(root, 'tests/fixtures/workflow-awards.json'), 'utf8'));
  await view.evaluate(async data => { await chrome.storage.local.set({ 'recruitment.profile.v1': data }); }, awardProfile);
  await view.close(); await page.reload();
  await page.evaluate(() => { window.fixture.config.cadreDelay = 900; window.fixture.config.saveDelay = 200; });
  view = await popup();
  await view.getByRole('button', { name: '连续填写在校奖励', exact: true }).click();
  // Popup-side profile loading is asynchronous. Close only after the page
  // has accepted the task; a click alone is not a dispatch acknowledgement.
  await page.waitForFunction(() => window.fixture.adds.awardInfo > 0);
  await view.close();
  await page.waitForFunction(() => window.fixture.records.awardInfo.length === 3);
  view = await popup();
  await view.getByText(/在校奖励本轮结束：保存 3 条/).waitFor();
  const awardResult = await page.evaluate(() => ({ records: window.fixture.records.awardInfo, cadre: window.fixture.cadre,
    cadreSaves: window.fixture.cadreSaves, saves: window.fixture.saves, adds: window.fixture.adds, submits: window.fixture.submits, deletes: window.fixture.deletes }));
  assert.deepEqual(awardResult.records.map(row => row.awardName), awardProfile.awards.map(row => row.name));
  assert.deepEqual(awardResult.records.map(row => row.awardLevel), ['国家级', '省部级', '院校级']);
  assert.deepEqual(awardResult.records.map(row => row.awardObtainTime), ['2022-08', '2023-05', '请选择']);
  assert.deepEqual(awardResult.records.map(row => row.scholarshipLevel), ['请选择', '请选择', '二等奖']);
  assert.equal(awardResult.cadre, 'N'); assert.equal(awardResult.cadreSaves, 1);
  assert.deepEqual(awardResult.saves, { educationInfo: 0, projectInfo: 0, awardInfo: 3 });
  assert.equal(awardResult.submits + awardResult.deletes, 0);
  await view.locator('.workflow-panel').screenshot({ path: resolve(artifacts, 'workflow-awards-popup.png') });
  await page.locator('#awardInfo').screenshot({ path: resolve(artifacts, 'workflow-awards.png') });
  await view.getByRole('button', { name: '连续填写在校奖励', exact: true }).click();
  await view.getByText(/在校奖励本轮结束：保存 0 条，已有 3 条/).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.saves.awardInfo), 3);
  report.awardRun = awardResult;
  report.checks.push('Real popup award-only action enables awards, adds three distinct entries, saves non-cadre separately, handles month picker and optional missing date, maps award levels, fills scholarship level only for scholarship; popup closure and restart do not duplicate records');
  const wholeProfile = structuredClone(profile);
  wholeProfile.education = []; wholeProfile.projects = []; wholeProfile.awards = [];
  wholeProfile.basic.studentCadre = '否';
  wholeProfile.studentWork = [{ id: 'whole-post', organization: '云川工程大学学生中心', role: '新生助理', startDate: '2021-10-01', endDate: '2022-07-31', shortDuties: '协助迎新、信息统计及学生问题反馈。' }];
  wholeProfile.internships = [{ id: 'whole-internship', organization: '星河软件', role: '后端开发实习生', startDate: '2022-05-01', endDate: '2022-07-31', description: '使用Java开发接口并配合联调。' }];
  wholeProfile.certificates = [{ id: 'whole-cet6', name: '大学英语六级', date: '2021-06', score: '430' }, { id: 'whole-putonghua', name: '普通话等级证书', date: '2020-12', score: '85' }];
  wholeProfile.skills = { programmingLanguages: ['Python（熟悉）'], frameworks: [], tools: [], other: [] };
  wholeProfile.research.papers = [
    { id: 'whole-paper-published', title: 'A Fictional Published Paper', shortTitle: '虚构已发表视觉识别论文', abstract: '研究虚构数据中的视觉识别方法。',
      authorOrder: '第二作者', publicationSituation: '已发表于虚构期刊', coauthors: '合著', date: '2026-01-17', status: '已发表' },
    { id: 'whole-paper-revision', title: 'A Fictional Revision Paper', shortTitle: '虚构返稿件', abstract: '研究虚构场景中的特征融合方法。',
      authorOrder: '第一作者', publicationSituation: '虚构期刊小修返修完成', coauthors: '合著', date: '2026-08-25', status: '小修返修完成' },
    { id: 'whole-paper-submitted', title: 'A Fictional Submitted Paper', shortTitle: '虚构在投稿件', abstract: '研究虚构场景中的预测细化方法。',
      authorOrder: '第一作者', publicationSituation: '投稿虚构会议', coauthors: '合著', date: '2026-08-25', status: '在投' },
  ];
  await view.evaluate(async data => { await chrome.storage.local.set({ 'recruitment.profile.v1': data }); }, wholeProfile);
  await view.close(); await page.reload(); await page.addScriptTag({ content: wholeFixture });
  view = await popup();
  await view.getByRole('button', { name: '补全整份简历', exact: true }).click();
  await view.getByText(/不代表整份简历已填完/).waitFor();
  const wholeState = await state(view);
  const wholeResult = await page.evaluate(() => ({ records: window.fixture.records, saves: window.fixture.saves, submits: window.fixture.submits, deletes: window.fixture.deletes,
    practiceYes: document.querySelector('[name=isHasPractiseInfo][data-code=Y]').checked, workPay: document.querySelector('#workPay > span').textContent }));
  assert.equal(wholeState.phase, 'review');
  assert.ok(wholeState.issues.some(issue => issue.includes('税前月薪'))); assert.ok(wholeState.issues.some(issue => issue.includes('是否有证明')));
  for (const section of ['schoolPostInfo', 'languageInfo', 'skillInfo', 'computerSkillInfo']) assert.equal(wholeResult.records[section].length, 1, section);
  assert.deepEqual(wholeResult.records.treatiseInfo.map(row => row.treatiseName), wholeProfile.research.papers.map(row => row.shortTitle));
  assert.equal(wholeResult.records.workInfo.length, 0); assert.equal(wholeResult.practiceYes, true); assert.equal(wholeResult.workPay, '请选择');
  assert.equal(wholeResult.submits + wholeResult.deletes, 0);
  report.wholeResumeRun = { state: wholeState, saves: wholeResult.saves };
  report.checks.push('Whole-resume action expands dynamic sections and continues across school posts, language, certificates and skills; published, revision and submitted professional works are saved in profile order; missing internship salary/proof preserves its draft and ends in review rather than claiming the resume is complete');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  if (context) {
    // Only the route-fulfilled fictional fixture is inspected; never a user tab.
    report.failurePages = await Promise.all(context.pages().filter(page => page.url() === url)
      .map(page => page.evaluate(() => ({ fixture: window.fixture,
        task: document.querySelector('[data-ra-workflow]')?.textContent ?? null }))));
    const worker = context.serviceWorkers()[0];
    if (worker) {
      const inspect = await context.newPage(); await inspect.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
      report.failureWorkflow = await inspect.evaluate(async targetUrl => {
        const tab = (await chrome.tabs.query({})).find(item => item.url === targetUrl);
        return tab?.id ? chrome.tabs.sendMessage(tab.id, { type: 'RA_WORKFLOW_STATUS' }, { frameId: 0 }) : null;
      }, url);
      report.failurePopup = await inspect.locator('body').innerText();
    }
  }
} finally {
  if (context) await context.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifacts, 'workflow-e2e.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
}
