import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const dir = resolve(process.env.RA_VISUAL_TEST_DIST ?? 'artifacts/i012e-capabilities-dist');
const report = { scope: 'Unmodified MV3 options UI with authenticated actual companion capability and old health; fictional local pairing only; zero cloud/provider calls', checks: [], errors: [], externalRequests: [] };
await build({ entryPoints: ['src/companion/server.ts'], outfile: 'artifacts/i012e-capabilities-server.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createSemanticServer } = await import('../artifacts/i012e-capabilities-server.mjs');
let providerCalls = 0, legacy = false, hold = false, delayedResponse;
const provider = async () => { providerCalls++; return { state: 'unavailable', proposal: null }; };
const config = { token: 'a'.repeat(64), provider };
const server = createSemanticServer(config);
const handler = server.listeners('request')[0]; server.removeListener('request', handler);
server.on('request', (req, res) => {
  if (req.url === '/v1/capabilities' && req.method === 'GET' && (legacy || hold)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '');
    if (legacy) { res.writeHead(404); res.end('{}'); } else delayedResponse = res;
    return;
  }
  handler(req, res);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(43127, '127.0.0.1', resolve); });
let context;
try {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension://') || url.startsWith('http://127.0.0.1:43127/')) return route.continue();
    report.externalRequests.push(url); return route.abort();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  report.version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(report.version, JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8')).version);
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.getByRole('button', { name: /AI 识别连接/u }).click();
  const inspect = () => page.getByRole('button', { name: '检查本机视觉接口', exact: true });
  const enable = page.getByRole('button', { name: '启用局部截图识别', exact: true });
  const visualConsent = page.getByRole('checkbox', { name: '我允许发送遮挡后的局部图像用于字段识别', exact: true });
  assert.equal(await inspect().isDisabled(), true); assert.equal(await visualConsent.isChecked(), false);
  assert.equal(providerCalls, 0); report.checks.push('Visual discovery stays disabled without a local AI connection and independent consent remains off');

  legacy = true;
  await page.getByRole('checkbox', { name: '我确认允许将脱敏字段语义发送给已配置的模型服务' }).check();
  await page.getByLabel('导入 AI 连接文件', { exact: true }).setInputFiles({ name: 'fictional-connection.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ protocol: 1, token: config.token })) });
  await page.waitForFunction(() => document.body.innerText.includes('AI 连接已启用'));
  await visualConsent.check(); await inspect().click();
  await inspect().waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent.includes('正在检查')));
  assert.ok(await page.getByText('本机视觉接口能力尚未确认；检查只访问本机，不调用模型。', { exact: true }).isVisible());
  assert.equal(await enable.isDisabled(), false);
  report.checks.push('Old health protocol still imports successfully; missing capability stays unknown and keeps explicit visual opt-in compatible');

  legacy = false;
  await inspect().click();
  await page.getByText('本机服务没有图片请求接口；请升级服务或改用支持图片输入的兼容配置后重启。', { exact: true }).waitFor();
  assert.equal(await enable.isDisabled(), true); assert.equal(providerCalls, 0);
  report.checks.push('Actual companion without a visual provider explains missing interface and prevents enabling it');

  config.visualProvider = provider;
  await inspect().click();
  await page.getByText('本机图片请求接口已配置；云模型是否支持图片仍需实际核验。', { exact: true }).waitFor();
  assert.equal(await enable.isDisabled(), false); assert.equal(providerCalls, 0);
  report.checks.push('Configured interface is reported without claiming cloud readiness or calling any provider');
  await enable.click(); await page.getByRole('button', { name: '关闭局部截图识别', exact: true }).waitFor();
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('recruitment.visual.consent.v1'))['recruitment.visual.consent.v1']),
    { version: 1, enabled: true, userConfirmed: true });
  await page.getByRole('button', { name: '关闭局部截图识别', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('局部截图识别已关闭。'));
  report.checks.push('Independent user opt-in still enables and disables actual stored visual consent');

  hold = true; await inspect().click();
  for (let i = 0; i < 100 && !delayedResponse; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(delayedResponse);
  await worker.evaluate(() => chrome.storage.local.set({ 'recruitment.semantic.connection.v1': {
    protocol: 1, token: 'a'.repeat(64), enabled: true, userConfirmed: true, cacheRevision: crypto.randomUUID(),
  } }));
  await inspect().waitFor();
  delayedResponse.end(JSON.stringify({ protocol: 1, visualBindings: true })); hold = false;
  await page.waitForTimeout(200);
  assert.ok(await page.getByText('本机视觉接口能力尚未确认；检查只访问本机，不调用模型。', { exact: true }).isVisible());
  report.checks.push('Connection replacement aborts discovery and a late ready response cannot restore its old capability');

  await worker.evaluate(() => chrome.storage.local.remove('recruitment.semantic.connection.v1'));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '检查本机视觉接口' && button.disabled));
  assert.equal(await enable.isDisabled(), true);
  assert.ok(await page.getByText('AI 连接未启用', { exact: true }).isVisible());
  assert.equal(providerCalls, 0);
  report.checks.push('External pairing revocation synchronizes the actual AI settings and disables discovery and visual enabling');

  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []);
  report.providerCalls = providerCalls; report.passed = true; report.finishedAt = new Date().toISOString();
} catch (error) { report.errors.push(String(error)); throw error; }
finally {
  await context?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await writeFile('artifacts/i012e-capabilities-installed-report.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
