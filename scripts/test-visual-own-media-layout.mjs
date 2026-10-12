// Real Chromium layout admission, not a capture or image-send grant.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { visualShadowObserverScript } from './fixtures/visual-shadow-observer.mjs';

const reportPath = process.env.RA_VISUAL_LAYOUT_REPORT ?? 'artifacts/i014b-own-media-layout-report.json';
const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'own-media-layout.ts', loader: 'ts', contents:
  "import {inspectSemanticLabelPaint} from './src/visual/semanticLabelRegion';window.labelLayoutProbe=()=>inspectSemanticLabelPaint(document.querySelector('#u'),document.querySelector('label'));" }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const cases = [
  ['plain', true], ['image-default', true], ['image-hidden', true], ['image-fit-none', true], ['image-fit-cover', true],
  ['image-visible', false], ['image-clip-margin', false], ['image-outline', false], ['image-shadow', false], ['image-overlap', false],
  ['svg-default', true], ['svg-hidden', true], ['svg-clip', true], ['svg-visible', false], ['svg-clip-margin', false],
  ['svg-outline', false], ['svg-overlap', false], ['svg-reference', false], ['svg-paint-reference', false], ['svg-foreign-object', false],
  ['ancestor-svg', true], ['ancestor-image', true], ['ancestor-margin', false], ['ancestor-inline', false],
];
const report = { scope: 'Numerical own image/viewport clipping; fictional local page, no capture or model', checks: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript({content:visualShadowObserverScript});
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { report.externalRequests.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><style>label{position:absolute;left:80px;top:80px;display:block;width:180px;height:24px;overflow:hidden;background:white;color:black;transition:none}input{position:absolute;left:80px;top:120px;width:180px;height:24px}.decoration{position:absolute;left:500px;top:20px;width:48px;height:48px;transition:none}</style><label for="u">你希望如何被称呼</label><input id="u">' });
  });
  for (const [mode, eligible] of cases) {
    await page.goto('http://127.0.0.1:8123/own-media?mode=' + mode);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async mode => {
      if (mode === 'plain') return;
      const box = document.createElement('div'); box.className = 'decoration'; document.body.append(box);
      const isImage = mode.startsWith('image-') || mode === 'ancestor-image';
      box.innerHTML = isImage ? '<img width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15" fill="blue"/></svg>';
      const media = box.firstElementChild;
      if (isImage) await media.decode();
      if (mode.endsWith('-hidden')) media.style.overflow = 'hidden';
      if (mode.endsWith('-clip')) media.style.overflow = 'clip';
      if (mode.endsWith('-visible') || mode.startsWith('ancestor-')) media.style.overflow = 'visible';
      if (mode.endsWith('-clip-margin')) { media.style.overflow = 'clip'; media.style.overflowClipMargin = '600px'; }
      if (mode.endsWith('-outline')) media.style.outline = '500px solid red';
      if (mode.endsWith('-shadow')) media.style.boxShadow = '-420px 60px 0 20px red';
      if (mode.endsWith('-overlap')) { box.style.left = '80px'; box.style.top = '80px'; }
      if (mode === 'image-fit-none') { media.style.objectFit = 'none'; media.style.objectPosition = '-500px -500px'; }
      if (mode === 'image-fit-cover') media.style.objectFit = 'cover';
      if (mode === 'svg-reference') box.innerHTML = '<svg width="40" height="40"><use href="#unknown"/></svg>';
      if (mode === 'svg-paint-reference') media.querySelector('circle').setAttribute('fill', 'url(#unknown)');
      if (mode === 'svg-foreign-object') box.innerHTML = '<svg width="40" height="40"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">私密内容</div></foreignObject></svg>';
      if (mode.startsWith('ancestor-')) { box.style.contain = 'paint'; box.style.overflow = 'hidden'; }
      if (mode === 'ancestor-margin') { box.style.overflow = 'clip'; box.style.overflowClipMargin = '600px'; }
      if (mode === 'ancestor-inline') { box.style.position = 'static'; box.style.display = 'inline'; box.style.marginLeft = '500px'; }
    }, mode);
    const result = await page.evaluate(() => window.labelLayoutProbe());
    report.checks.push({ mode, expected: eligible ? 'eligible' : 'rejected', actual: result.state, passed: result.state === (eligible ? 'eligible' : 'rejected') });
  }
  await page.goto('http://127.0.0.1:8123/own-media?mode=change');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => { const box = document.createElement('div'); box.className = 'decoration'; box.innerHTML = '<svg width="40" height="40"><circle cx="20" cy="20" r="15"/></svg>'; document.body.append(box); });
  const before = (await page.evaluate(() => window.labelLayoutProbe())).state;
  await page.evaluate(() => { document.querySelector('svg').style.overflow = 'visible'; });
  const after = (await page.evaluate(() => window.labelLayoutProbe())).state;
  report.checks.push({ mode: 'own-clipping-change', before, after, passed: before === 'eligible' && after === 'rejected' });
  assert.deepEqual(report.externalRequests, []);
  report.passed = report.checks.every(check => check.passed);
  assert.ok(report.passed, JSON.stringify(report.checks.filter(check => !check.passed)));
} catch (error) { report.errors.push(String(error)); throw error; }
finally { await browser.close(); await writeFile(reportPath, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors }));
