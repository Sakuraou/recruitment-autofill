// Production MV3, fictional facts, disposable account-free browser; no cloud calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const bundle = resolve(artifacts, 'education-highest-site.js');
await build({ entryPoints: [resolve(root, 'tests/fixtures/education-session-page.ts')], bundle: true, format: 'iife',
  globalName: 'EducationFixture', platform: 'browser', target: 'chrome114', outfile: bundle });
const code = await readFile(bundle, 'utf8');
const html = `<!doctype html><body><script>${code}</script><script>
window.fixture = window.EducationFixture.installEducationSessionPage(document);
window.flags = []; window.extraActions = 0;
const mode = new URL(location.href).searchParams.get('case');
window.fixture.add.addEventListener('click', () => {
  const form = window.fixture.list.querySelector('form');
  const captions = ['是否最高学历', mode === 'earned' ? '是否已取得最高学位' : '是否最高学位', '是否全日制最高学历'];
  captions.forEach((caption, index) => {
    const markup = mode === 'radio'
      ? '<fieldset><legend>' + caption + '</legend><label><input required type="radio" name="flag-' + index + '" value="false">是</label><label><input type="radio" name="flag-' + index + '" value="true">否</label></fieldset>'
      : '<label>' + caption + '<select required name="flag-' + index + '"><option value="">请选择</option><option value="opaque-yes">是</option><option value="opaque-no">否</option></select></label>';
    form.querySelector('button').insertAdjacentHTML('beforebegin', markup);
  });
  if (mode === 'duplicate') form.querySelector('[name="flag-0"]').insertAdjacentHTML('beforeend', '<option value="another">是</option>');
  const orphan = () => form.insertAdjacentHTML('beforeend', '<fieldset><legend>额外业务信息</legend><label>未知字段<input required></label></fieldset>');
  if (mode === 'orphan') orphan();
  if (mode === 'dynamic-orphan') form.querySelector('[name="flag-0"]').addEventListener('change', () => setTimeout(orphan, 25), { once: true });
  form.querySelector('button').addEventListener('click', () => window.flags.push(captions.map((_, index) => mode === 'radio'
    ? form.querySelector('[name="flag-' + index + '"]:checked')?.value ?? 'unselected'
    : form.querySelector('[name="flag-' + index + '"]').value)), { capture: true });
});
document.querySelector('main').insertAdjacentHTML('beforeend', '<button type="submit">最终提交</button><button type="button">删除</button>');
document.querySelectorAll('main > button').forEach(button => button.addEventListener('click', () => window.extraActions++));
</script></body>`;
const origin = 'https://careers.example.test'; const report = { startedAt: new Date().toISOString(), checks: [], errors: [], externalRequests: [] };
let context;
try {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve(root, 'dist')}`, `--load-extension=${resolve(root, 'dist')}`,
      '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  context.setDefaultTimeout(15_000); context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  await context.route(/^https?:/, route => route.request().url().startsWith(`${origin}/highest?`)
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    : (report.externalRequests.push(route.request().url()), route.abort()));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const browser = context.browser() ? await context.browser().newBrowserCDPSession() : await context.newCDPSession(context.pages()[0]);
  report.browser = (await browser.send('Browser.getVersion')).product;
  async function importProfile(profile) {
    const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByRole('button', { name: /11 导入与备份/ }).click();
    await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));
    await options.getByRole('button', { name: '校验并载入预览' }).click();
    await options.getByRole('button', { name: '保存档案' }).click();
    await options.getByText('档案已保存在此浏览器。', { exact: false }).waitFor(); await options.close();
  }
  async function popupFor(page) {
    const targets = (await browser.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos;
    const target = targets.find(item => item.url === page.url()); assert.ok(target);
    await browser.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
      if (!tab?.id) throw new Error('fictional tab missing'); await chrome.tabs.update(tab.id, { active: true }); }, page.url());
    await popup.reload(); return popup;
  }
  const counts = page => page.evaluate(() => ({ ...window.fixture.counts, extraActions: window.extraActions }));
  const base = JSON.parse(await readFile(resolve(root, 'examples/sample-profile.json'), 'utf8'));
  for (const mode of ['select', 'radio', 'part-time', 'missing-degree', 'missing-mode', 'earned', 'duplicate', 'orphan', 'dynamic-orphan']) {
    const page = await context.newPage(); await page.goto(`${origin}/highest?case=${mode}`);
    const profile = structuredClone(base);
    profile.education = await page.evaluate(() => window.EducationFixture.educationSessionProfile.education.map(record => ({ ...record, studyMode: '全日制' })));
    if (mode === 'part-time') profile.education[0].studyMode = '非全日制';
    if (mode === 'missing-degree') delete profile.education[0].degree;
    if (mode === 'missing-mode') profile.education[0].studyMode = '';
    await importProfile(profile); let popup = await popupFor(page);
    await popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).click();
    const successful = ['select', 'radio', 'part-time'].includes(mode);
    if (successful) {
      await popup.getByText(/正在逐条填写 2 段教育经历/).waitFor(); await popup.close();
      await page.waitForFunction(() => window.fixture.counts.save === 2);
      assert.deepEqual(await counts(page), { add: 2, save: 2, submit: 0, remove: 0, cancel: 0, extraActions: 0 });
      const flags = await page.evaluate(() => window.flags);
      const expected = mode === 'radio' ? [['true', 'true', 'true'], ['false', 'false', 'false']]
        : mode === 'part-time' ? [['opaque-no', 'opaque-no', 'opaque-yes'], ['opaque-yes', 'opaque-yes', 'opaque-no']]
          : [['opaque-no', 'opaque-no', 'opaque-no'], ['opaque-yes', 'opaque-yes', 'opaque-yes']];
      assert.deepEqual(flags, expected, mode);
      assert.deepEqual(await page.evaluate(() => window.fixture.saved.map(record => record.school)), [profile.education[1].school, profile.education[0].school]);
      popup = await popupFor(page); await popup.getByText(/全部 2 段教育经历已处理并核验/).waitFor();
      await popup.getByRole('button', { name: '连续填写全部教育经历', exact: true }).click();
      await popup.getByText(/全部 2 段教育经历已处理并核验/).waitFor(); assert.equal((await counts(page)).add, 2);
      report.checks.push(mode + ': source master first, saves undergraduate then master, highest facets correct, popup closure and restart deduplicated');
    } else {
      await popup.getByRole('button', { name: '停止教育填写', exact: true }).waitFor();
      // Wait for the production status to leave running and request review.
      await popup.getByText('教育填写需要检查，当前草稿已保留。处理网页后，停止本轮再重新启动。', { exact: true }).waitFor();
      await page.waitForTimeout(1_000); const actual = await counts(page);
      assert.equal(actual.save, 0, mode); assert.equal(actual.submit, 0); assert.equal(actual.extraActions, 0);
      assert.deepEqual(await page.evaluate(() => window.flags), []);
      if (mode !== 'dynamic-orphan') assert.equal(await page.locator('[data-test-key="school"]').inputValue(), '', mode);
      await popup.getByRole('button', { name: '停止教育填写', exact: true }).click();
      report.checks.push(mode + ': incomplete/ambiguous/omitted controls do not grant Save, highest facts never guessed');
    }
    await popup.close(); await page.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
  console.info('Education highest MV3 checks passed (' + report.checks.length + ' checks)');
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(artifacts, 'education-highest-e2e.json'), JSON.stringify(report, null, 2)); await context?.close(); }
