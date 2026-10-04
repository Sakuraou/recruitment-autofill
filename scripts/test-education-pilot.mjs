// Real production MV3 controls; fictional site and account-free disposable Chromium.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const bundle = resolve(artifacts, 'education-pilot-site.js');
await build({ entryPoints: [resolve(root, 'tests/fixtures/education-session-page.ts')], bundle: true, format: 'iife',
  globalName: 'EducationFixture', platform: 'browser', target: 'chrome114', outfile: bundle });
const code = await readFile(bundle, 'utf8');
const html = `<!doctype html><body><script>${code}</script><script>
const identityCase = new URL(location.href).searchParams.get('case');
window.fixture = EducationFixture.installEducationSessionPage(document, EducationFixture.educationSessionProfile,
  identityCase?.startsWith('identity-') ? [1] : []);
if (identityCase?.startsWith('identity-')) {
  fixture.cards[0].querySelector('h3').textContent = identityCase.includes('stage') ? '本科' : identityCase === 'identity-unknown' ? '未标注学校' : '教育经历';
  if (identityCase.includes('labelled')) { const school = document.createElement('p'); school.textContent = '学校：' + EducationFixture.educationSessionProfile.education[1].school; fixture.cards[0].append(school); }
}
const projectSection = document.createElement('section'); projectSection.setAttribute('aria-label', '项目经历');
projectSection.innerHTML = '<h2>项目经历</h2><div role="list" id="project-items"><p role="status">暂无项目经历</p><button type="button" aria-controls="project-items">+</button></div>';
window.projectActions = 0; projectSection.querySelector('button').addEventListener('click', () => window.projectActions++); document.querySelector('main').append(projectSection);
if (new URL(location.href).searchParams.get('case') === 'unknown') fixture.add.addEventListener('click', () => fixture.list.querySelector('form').insertAdjacentHTML('beforeend', '<label>陌生评估项<input></label>'));
</script></body>`;
const origin = 'https://careers.example.test'; const report = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] };
let context;
try {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`,
      '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  context.setDefaultTimeout(15_000); context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  await context.route(/^https?:/, route => route.request().url().startsWith(`${origin}/education?`)
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    : (report.externalRequests.push(route.request().url()), route.abort()));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host; const first = context.pages()[0];
  const browser = context.browser() ? await context.browser().newBrowserCDPSession() : await context.newCDPSession(first);
  report.browser = (await browser.send('Browser.getVersion')).product;
  const happy = await context.newPage(); await happy.goto(`${origin}/education?case=happy`);
  const profile = JSON.parse(await readFile(resolve(root, 'examples/sample-profile.json'), 'utf8'));
  profile.education = await happy.evaluate(() => window.EducationFixture.educationSessionProfile.education);
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: /11 导入与备份/ }).click(); await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
  await options.getByRole('button', { name: '校验并载入预览' }).click(); await options.getByRole('button', { name: '保存档案' }).click();
  await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor(); await options.close();
  async function activate(page) {
    const targets = (await browser.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    const target = targets.find(item => item.url === page.url()); assert.ok(target);
    await browser.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
  }
  async function popupFor(page) {
    await activate(page); const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
      if (!tab?.id) throw new Error('fictional tab missing'); await chrome.tabs.update(tab.id, { active: true }); }, page.url());
    await popup.reload(); return popup;
  }
  async function message(popup, type, payload) {
    return popup.evaluate(async request => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, request, { frameId: 0 }); }, payload === undefined ? { type } : { type, payload });
  }
  const counts = page => page.evaluate(() => ({ ...window.fixture.counts, projectActions: window.projectActions }));
  const expected = { add: 2, save: 2, submit: 0, remove: 0, cancel: 0, projectActions: 0 };
  let popup = await popupFor(happy);
  await popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).waitFor();
  assert.deepEqual(await message(popup, 'RA_EDUCATION_RECORD_START', { selector: 'button', education: profile.education }), { ok: false, error: '无效的扩展请求' });
  const projection = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] },
      func: () => chrome.runtime.sendMessage({ type: 'RA_PROFILE_EDUCATION' }) }); return result[0].result;
  });
  assert.equal(projection.ok, true); assert.deepEqual(Object.keys(projection.data).sort(), ['education', 'profileRevision', 'recordType']);
  assert.equal(projection.data.education[0].level, '硕士研究生');
  report.checks.push('Real content request returns only strict education facts in unchanged source order; injected start payload is rejected');
  await popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).click();
  await popup.getByText(/正在逐条填写 2 段教育经历/).waitFor(); await popup.close();
  await happy.waitForFunction(() => window.fixture.counts.save === 2); assert.deepEqual(await counts(happy), expected);
  const saved = await happy.evaluate(() => window.fixture.saved);
  [1, 0].forEach((sourceIndex, index) => {
    for (const key of ['school', 'major', 'level', 'degree', 'educationType', 'schoolProperty', 'durationYears', 'gpa', 'ranking', 'startDate', 'endDate']) assert.equal(saved[index][key], profile.education[sourceIndex][key], key);
  });
  report.checks.push('One production popup click saves undergraduate then master with all 11 independent facts after popup closure');
  popup = await popupFor(happy); await popup.getByText(/全部 2 段教育经历已处理并核验/).waitFor();
  await popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).click();
  await popup.getByText(/全部 2 段教育经历已处理并核验/).waitFor(); assert.deepEqual(await counts(happy), expected); await popup.close();
  report.checks.push('Reopened popup restores education-only completion; restart adds and saves zero further records');
  for (const mode of ['pause', 'stop', 'unknown']) {
    const page = await context.newPage(); await page.goto(`${origin}/education?case=${mode}`); popup = await popupFor(page);
    await popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).click();
    if (mode === 'unknown') {
      await popup.getByText(/有字段的含义尚未识别/).waitFor();
      assert.equal(await page.locator('form input').first().inputValue(), ''); assert.equal((await counts(page)).save, 0);
      await popup.getByRole('button', { name: '停止教育填写', exact: true }).click();
    } else {
      await popup.getByText(/正在逐条填写 2 段教育经历/).waitFor();
      if (mode === 'pause') {
        await popup.getByRole('button', { name: '暂停教育填写', exact: true }).click();
        await popup.getByText('教育填写已暂停，请检查网页后继续。').waitFor();
        for (const command of ['RA_PROJECT_RECORD_START', 'RA_INTERNSHIP_RECORD_START', 'RA_WORKFLOW_RESUME', 'RA_RECORD_V2_START', 'RA_SCAN_SETTLED']) assert.equal((await message(popup, command)).ok, false, command);
        await popup.close(); popup = await popupFor(page); await popup.getByText('教育填写已暂停，请检查网页后继续。').waitFor();
        await popup.getByRole('button', { name: '继续教育填写', exact: true }).click(); await popup.getByText(/全部 2 段教育经历已处理并核验/).waitFor();
        assert.deepEqual(await counts(page), expected);
      } else {
        await popup.getByRole('button', { name: '停止教育填写', exact: true }).click();
        // A step accepted before the Stop click can already be saved. Stop
        // preserves it; the invariant is no later Add/Save or unsafe action.
        const stopped = await counts(page); assert.ok(stopped.save < 2);
        await popup.getByText('教育任务已停止。已保存记录与网页草稿保留。').waitFor();
        await page.waitForTimeout(1_000); assert.deepEqual(await counts(page), stopped);
      }
    }
    assert.equal((await counts(page)).projectActions, 0); assert.equal((await counts(page)).submit, 0);
    report.checks.push(mode + ': production controls keep accurate state, no other-column or unsafe action'); await popup.close(); await page.close();
  }
  for (const mode of ['identity-stage', 'identity-generic', 'identity-unknown', 'identity-labelled-stage', 'identity-labelled-generic']) {
    const page = await context.newPage(); await page.goto(origin + '/education?case=' + mode); popup = await popupFor(page);
    await popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).click();
    if (mode.includes('labelled')) {
      await popup.getByText(/全部 2 段教育经历已处理并核验/).waitFor();
      await popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).click();
      await popup.getByText(/全部 2 段教育经历已处理并核验/).waitFor();
      assert.deepEqual(await counts(page), { ...expected, add: 1, save: 1 });
      assert.equal(await page.evaluate(() => window.fixture.saved[0].school), profile.education[0].school);
    } else {
      await popup.getByText(/已有教育经历缺少可靠的身份信息/).waitFor();
      assert.deepEqual(await counts(page), { ...expected, add: 0, save: 0 });
      assert.equal(await page.locator('form').count(), 0);
    }
    report.checks.push(mode + ': verified school evidence before Add; restart adds zero duplicates'); await popup.close(); await page.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
  console.info('Education pilot MV3 checks passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'education-pilot-e2e.json'), JSON.stringify(report, null, 2)); await context?.close(); }
