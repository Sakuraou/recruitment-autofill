import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { visualShadowObserverScript } from './fixtures/visual-shadow-observer.mjs';

const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'marker-layout.ts', loader: 'ts',
  contents: "import {inspectSemanticLabelPaint} from './src/visual/semanticLabelRegion';window.markerProbe=()=>inspectSemanticLabelPaint(document.querySelector('input'),document.querySelector('label'));" },
  bundle: true, write: false, format: 'iife', platform: 'browser' });
const cases = [
  ['plain', true], ['before', true], ['after', true], ['both', true], ['inline-block', true],
  ['transparent', true], ['clip', true], ['escaped-star', true], ['attribute-star', true], ['foreign-clipped-star', true],
  ['visible-overflow', false], ['inline-host', false], ['descendant-star', false], ['attribute', false],
  ['private-literal', false], ['alternative-text', false], ['counter', false], ['image', false],
  ['fixed', false], ['absolute', false], ['shadow', false], ['transform', false], ['outline', false],
  ['gradient', false], ['clip-margin', false], ['foreign-unclipped-star', false],
  ['foreign-clipped-private', false], ['closed-root', false],
];
const report = { scope: 'Actual Chromium original clipped label and fixed generated required marker; numerical layout only, no capture/model/write authority', checks: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript({ content: visualShadowObserverScript });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { report.externalRequests.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<!doctype html><style>.surface{position:absolute;left:80px;top:80px;width:240px;height:160px;background:white}label{display:block;margin:20px;width:160px;height:24px;overflow:hidden;background:white;color:black}input{display:block;width:160px;height:24px}</style><div class="surface"><label for="opaque">陌生问题甲</label><input id="opaque"></div>' });
  });
  for (const [mode, eligible] of cases) {
    await page.goto('http://127.0.0.1:8123/marker-layout?mode=' + mode);
    await page.evaluate(mode => {
      const label = document.querySelector('label');
      let selector = 'label::before', rule = 'content:"*";color:red';
      if (mode === 'plain') return;
      if (mode === 'after') selector = 'label::after';
      if (mode === 'both') selector = 'label::before,label::after';
      if (mode === 'inline-block') label.style.display = 'inline-block';
      if (mode === 'transparent') label.style.backgroundColor = 'transparent';
      if (mode === 'clip') label.style.overflow = 'clip';
      if (mode === 'escaped-star') rule = 'content:"\\2a";color:red';
      if (mode === 'visible-overflow') label.style.overflow = 'visible';
      if (mode === 'inline-host') label.style.display = 'inline';
      if (mode === 'descendant-star') { label.innerHTML = '<span>陌生问题甲</span>'; selector = 'label span::before'; }
      if (mode === 'attribute') { label.dataset.private = 'CANDIDATEZXQ'; rule = 'content:attr(data-private)'; }
      if (mode === 'attribute-star') { label.dataset.private = '*'; rule = 'content:attr(data-private)'; }
      if (mode === 'private-literal') rule = 'content:"CANDIDATEZXQ"';
      if (mode === 'alternative-text') rule = 'content:"*" / "CANDIDATEZXQ"';
      if (mode === 'counter') rule = 'content:counter(secret)';
      if (mode === 'image') rule = 'content:url(data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=)';
      if (mode === 'fixed') rule += ';position:fixed;left:100px;top:100px';
      if (mode === 'absolute') rule += ';position:absolute;left:100px;top:100px';
      if (mode === 'shadow') rule += ';text-shadow:100px 0 red';
      if (mode === 'transform') rule += ';transform:translateX(100px)';
      if (mode === 'outline') rule += ';outline:100px solid red';
      if (mode === 'gradient') rule += ';background-image:linear-gradient(red,blue)';
      if (mode === 'clip-margin') { label.style.overflow = 'clip'; label.style.overflowClipMargin = '200px'; }
      if (mode.startsWith('foreign-')) {
        const other = document.createElement('label'); other.textContent = '其他问题';
        other.id = 'foreign'; other.style.cssText = 'position:absolute;left:700px;top:100px';
        if (mode === 'foreign-unclipped-star') other.style.overflow = 'visible';
        document.body.append(other); selector = '#foreign::before';
        if (mode === 'foreign-clipped-private') rule = 'content:"CANDIDATEZXQ"';
      }
      if (mode === 'closed-root') label.parentElement.attachShadow({ mode: 'closed' }).innerHTML = '<slot></slot>';
      const style = document.createElement('style'); style.textContent = selector + '{' + rule + '}'; document.head.append(style);
    }, mode);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(() => window.markerProbe());
    const computed = await page.locator('label').first().evaluate(label => ({ before: getComputedStyle(label, '::before').content,
      after: getComputedStyle(label, '::after').content, display: getComputedStyle(label).display,
      overflow: getComputedStyle(label).overflow, clipMargin: getComputedStyle(label).overflowClipMargin }));
    report.checks.push({ mode, computed, result, expected: eligible ? 'eligible' : 'rejected', passed: result.state === (eligible ? 'eligible' : 'rejected') });
  }
  report.passed = report.checks.every(check => check.passed) && report.errors.length === 0;
  assert.deepEqual(report.externalRequests, []);
  assert.ok(report.passed, JSON.stringify(report.checks.filter(check => !check.passed)));
} catch (error) { report.errors.push(String(error)); throw error; }
finally { await browser.close(); await writeFile(process.env.RA_VISUAL_MARKER_REPORT ?? 'artifacts/i014m-marker-layout-report.json', JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors }));
