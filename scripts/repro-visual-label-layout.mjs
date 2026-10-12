// Actual Chromium read-only layout probe. No screenshot upload, API or personal profile.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'label-layout-probe.ts',loader:'ts',contents:
  "import {inspectSemanticLabelPaint} from './src/visual/semanticLabelRegion';window.labelLayoutProbe=()=>inspectSemanticLabelPaint(document.querySelector('#u'),document.querySelector('label'));"},bundle:true,write:false,format:'iife',platform:'browser'});
const report={scope:'Read-only real Chromium semantic label geometry, no full capture proof or model request',checks:[],externalRequests:[],errors:[]};
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage();
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='127.0.0.1'){report.externalRequests.push(url.href);return route.abort();}
  const mode=url.searchParams.get('mode');
  const decoration=mode==='clipped-svg'?'<div class="decoration"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15" fill="blue"/></svg></div>'
    :mode==='clipped-image'?'<div class="decoration"><img width="40" height="40" alt="装饰图片" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></div>'
      :mode==='two-labels'?'<label class="second" for="u">填写你的称呼</label>':'';
  return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><style>
    label{position:absolute;left:80px;top:80px;display:block;width:180px;height:24px;overflow:hidden;background:white;color:black;transition:none}
    input{position:absolute;left:80px;top:120px;width:180px;height:24px}
    .decoration{position:absolute;left:500px;top:20px;width:48px;height:48px;contain:paint;overflow:hidden;transition:none}
    .second{top:150px}
  </style></head><body><label for="u">你希望如何被称呼</label><input id="u">${decoration}</body></html>`});
 });
 for(const mode of ['plain','clipped-svg','clipped-image','two-labels']){
  await page.goto('http://127.0.0.1:8123/label-layout?mode='+mode);await page.addScriptTag({content:bundle.outputFiles[0].text});
  const result=await page.evaluate(()=>window.labelLayoutProbe());
  assert.equal(result.state,mode==='plain'?'eligible':'rejected');
  const geometry=await page.evaluate(()=>{const rect=document.querySelector('label').getBoundingClientRect(),other=document.querySelector('.decoration')?.getBoundingClientRect();return{label:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},decoration:other?{left:other.left,top:other.top,width:other.width,height:other.height}:null};});
  if(geometry.decoration)assert.ok(geometry.decoration.left>geometry.label.left+geometry.label.width);
  report.checks.push({mode,result,geometry});
 }
 assert.deepEqual(report.externalRequests,[]);report.passed=true;
}catch(error){report.errors.push(String(error));throw error;}
finally{await browser.close();await writeFile('artifacts/i014a-visual-label-layout-repro.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
