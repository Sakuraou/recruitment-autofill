import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { visualShadowObserverScript } from './fixtures/visual-shadow-observer.mjs';

const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'visual-locator-probe.ts', loader: 'ts', contents: `
import {VisualFieldLocator} from './src/content/visualFieldLocator';
import {scanDocument} from './src/content/scanner';
import {AgentPageLease} from './src/agent/pageLease';
import {verifyScanObservation} from './src/content/scanFreshness';
window.locatorProbe=async(mode)=>{
 let scan=scanDocument(),busy=mode==='busy',candidates=mode==='candidates';
 const lease=new AgentPageLease(()=>document.URL,()=>busy),controller=new AbortController();
 const locator=new VisualFieldLocator({lease,getScan:()=>scan,occupied:()=>busy,hasVisualCandidates:()=>candidates});
 const originalScan=scan,field=scan.result.fields[0],node=scan.controls.get(field.id).node;
 let outerToken;if(mode==='owned')outerToken=lease.begin();if(mode==='aborted')controller.abort();
 if(['manual','stop','navigation','replace','label-replace','scan-swap','transient','wheel','hidden'].includes(mode)){
  window.addEventListener('scroll',()=>{
   if(mode==='manual'||mode==='transient'){node.value='用户手改';node.dispatchEvent(new Event('input',{bubbles:true}));if(mode==='transient'){node.value='';node.dispatchEvent(new Event('input',{bubbles:true}));}}
   if(mode==='stop')controller.abort();
   if(mode==='navigation')history.pushState({},'',location.pathname+'?changed=1');
   if(mode==='replace')node.replaceWith(node.cloneNode(true));
   if(mode==='label-replace'){const label=document.querySelector('label');label.replaceWith(label.cloneNode(true));}
   if(mode==='scan-swap')scan=scanDocument();
   if(mode==='wheel')document.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));
   if(mode==='hidden')document.styleSheets[0].insertRule('label{visibility:hidden}',document.styleSheets[0].cssRules.length);
  },{once:true});
 }
 const result=await locator.locate(mode==='wrong-scan'?'wrong':scan.result.scanId,mode==='wrong-field'?'wrong':field.id,controller.signal);
 const moved=result.state==='located'&&result.moved;
 const sameNode=result.state==='located'&&result.scan.controls.get(result.fieldId)?.node===node;
 const newScan=result.state==='located'&&result.scan!==originalScan&&result.scan.result.scanId!==originalScan.result.scanId;
 const originalStillValid=!!verifyScanObservation(originalScan);
 const outerStillHeld=outerToken?lease.mayWrite(outerToken):false;
 if(outerToken)lease.end(outerToken);
 let repeated;if(mode==='budget'&&result.state==='located'){scan=result.scan;repeated=await locator.locate(scan.result.scanId,result.fieldId,controller.signal);}
 return{state:result.state,reason:result.state==='manual'?result.reason:undefined,moved,sameNode,newScan,originalStillValid,outerStillHeld,ownerHeld:lease.holdsPage(),
  repeated:repeated?.state==='manual'?repeated.reason:undefined,scrollCalls:window.scrollCalls,scrollX,scrollY,
  values:[...document.querySelectorAll('input')].map(n=>n.value),rect:node.isConnected?{top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}:null};
};` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const positive = ['below', 'horizontal', 'partial-below', 'smooth', 'budget'];
const refused = ['candidates', 'busy', 'owned', 'aborted', 'wrong-scan', 'wrong-field', 'too-wide', 'split-labels', 'negative', 'nested', 'known', 'value', 'readonly', 'repeated-section'];
const interrupted = ['manual', 'stop', 'navigation', 'replace', 'label-replace', 'scan-swap', 'transient', 'wheel', 'hidden'];
const report = { scope: 'Isolated actual Chromium local viewport controller with original scanner/lease; native scrolling only; no RPC registration, image, provider or fill authority', checks: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript({ content: visualShadowObserverScript });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { report.externalRequests.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<!doctype html><style>body{min-height:3000px;min-width:3000px}label{position:absolute;left:100px;top:1600px;width:160px;height:24px;display:block;overflow:hidden;background:white;color:black}input{position:absolute;left:100px;top:1640px;width:160px;height:24px;box-sizing:border-box}</style><form><section><h2>个人信息</h2><label for="opaque">陌生问题甲</label><input id="opaque"></section></form>' });
  });
  for (const mode of [...positive, 'visible', ...refused, ...interrupted]) {
    await page.goto('http://127.0.0.1:8123/locator?mode=' + mode);
    await page.evaluate(mode => {
      const label = document.querySelector('label'), input = document.querySelector('input');
      if (mode === 'visible' || mode === 'horizontal') { label.style.top = '100px'; input.style.top = '140px'; }
      if (mode === 'horizontal') { label.style.left = '2000px'; input.style.left = '2000px'; }
      if (mode === 'partial-below') { label.style.top = '700px'; input.style.top = '740px'; }
      if (mode === 'smooth') document.documentElement.style.scrollBehavior = 'smooth';
      if (mode === 'too-wide') input.style.width = '2000px';
      if (mode === 'split-labels') { const extra = label.cloneNode(true); extra.style.top = '100px'; extra.textContent = '附加问题甲'; label.after(extra); }
      if (mode === 'negative') { label.style.left = '-30px'; input.style.left = '-30px'; }
      if (mode === 'nested') { const wrapper = document.createElement('div'); wrapper.style.cssText = 'height:200px;width:400px;overflow:auto;position:relative'; label.before(wrapper); wrapper.append(label, input); }
      if (mode === 'known') label.textContent = '姓名';
      if (mode === 'value') input.value = '已有内容';
      if (mode === 'readonly') input.readOnly = true;
      if (mode === 'repeated-section') document.querySelector('h2').textContent = '项目经历';
      window.scrollCalls = 0; const scroll = window.scrollTo.bind(window);
      window.scrollTo = (...args) => { window.scrollCalls++; return scroll(...args); };
      window.effectCounts = { click: 0, submit: 0, focus: 0 };
      for (const event of ['click', 'submit', 'focus']) document.addEventListener(event, () => window.effectCounts[event]++, true);
    }, mode);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(mode => window.locatorProbe(mode), mode);
    report.checks.push({ mode, result });
    assert.equal(result.ownerHeld, false, mode);
    assert.deepEqual(await page.evaluate(() => window.effectCounts), { click: 0, submit: 0, focus: 0 });
    if (positive.includes(mode)) {
      assert.equal(result.state, 'located', mode); assert.equal(result.moved, true, mode);
      assert.equal(result.sameNode, true, mode); assert.equal(result.newScan, true, mode);
      assert.equal(result.originalStillValid, false, 'Old viewport scan must remain invalid after the native move');
      assert.equal(result.scrollCalls, 1, mode); assert.deepEqual(result.values, [''], mode);
      assert.ok(result.rect.top >= 0 && result.rect.bottom <= 720 && result.rect.left >= 0 && result.rect.right <= 1280, mode);
      if (mode === 'budget') assert.equal(result.repeated, 'budget');
    } else if (mode === 'visible') {
      assert.equal(result.state, 'located'); assert.equal(result.moved, false); assert.equal(result.newScan, false); assert.equal(result.scrollCalls, 0);
    } else {
      assert.equal(result.state, 'manual', mode); assert.equal(result.scrollCalls, refused.includes(mode) ? 0 : 1, mode);
      assert.deepEqual(result.values, [mode === 'manual' ? '用户手改' : mode === 'value' ? '已有内容' : ''], mode);
      if (mode === 'owned') assert.equal(result.outerStillHeld, true);
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
} catch (error) { report.errors.push(String(error)); throw error; }
finally { await browser.close(); await writeFile(process.env.RA_VISUAL_LOCATOR_REPORT ?? 'artifacts/i014n-locator-report.json', JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors }));
