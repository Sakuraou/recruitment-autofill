import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { visualShadowObserverScript } from './fixtures/visual-shadow-observer.mjs';
const bundle = await build({stdin:{resolveDir:process.cwd(),sourcefile:'inline-label.ts',loader:'ts',contents:
  "import{inspectSemanticLabelRegion}from'./src/visual/semanticLabelRegion';window.inlineLabelProbe=()=>inspectSemanticLabelRegion(document.querySelector('#opaque'),document.querySelector('label'),['本机虚构姓名']);"},bundle:true,write:false,format:'iife',platform:'browser'});
const cases=[['plain',true],['span',true],['nested-span',true],['required-star',true],['bold-italic',true],['two-lines',true],['nested-native',true],
  ['overflow',false],['fixed',false],['link',false],['button',false],['input',false],['svg',false],['shadow',false],['background',false],
  ['pseudo',false],['transform',false],['private',false],['too-many',false],['aria-hidden-overlay',false],['inert-overlay',false],['closed-shadow',false],['closed-shadow-slot',false]];
const report={scope:'Actual Chromium pure inline label descendants and visible paint; no image grant or model',checks:[],errors:[],externalRequests:[]};
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage();
 await page.addInitScript({content:visualShadowObserverScript});
 await page.route('**/*',route=>{
  if(new URL(route.request().url()).hostname!=='127.0.0.1'){report.externalRequests.push(route.request().url());return route.abort();}
  return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><style>label{position:absolute;left:100px;top:100px;display:block;width:200px;height:48px;overflow:hidden;background:white;color:black}input{position:absolute;left:100px;top:170px;width:200px;height:24px}</style><label for="opaque">陌生问题甲</label><input id="opaque">'});
 });
 for(const[mode,eligible]of cases){
  await page.goto('http://127.0.0.1:8123/inline-label?mode='+mode);
  await page.evaluate(mode=>{
   const label=document.querySelector('label');
   if(mode==='span')label.innerHTML='<span>陌生问题甲</span>';
   if(mode==='nested-span')label.innerHTML='<span><strong>陌生问题甲</strong></span>';
   if(mode==='required-star')label.innerHTML='陌生问题甲<small aria-hidden="true" style="color:red">*</small>';
   if(mode==='bold-italic')label.innerHTML='<b>陌生问题甲</b><i>附加说明</i>';
   if(mode==='two-lines')label.innerHTML='<b>陌生问题甲<br>附加说明</b>';
   if(mode==='nested-native')label.innerHTML='<b><em>陌生问题甲</em></b>';
   if(mode==='overflow')label.innerHTML='<span style="margin-left:400px">陌生问题甲</span>';
   if(mode==='fixed')label.innerHTML='<span style="position:fixed;left:100px;top:100px">陌生问题甲</span>';
   if(mode==='link')label.innerHTML='<a href="#elsewhere">陌生问题甲</a>';
   if(mode==='button')label.innerHTML='<button>陌生问题甲</button>';
   if(mode==='input')label.innerHTML='陌生问题甲<input value="已有私密信息">';
   if(mode==='svg')label.innerHTML='陌生问题甲<svg width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>';
   if(mode==='shadow'){label.innerHTML='<span>陌生问题甲</span>';label.firstChild.attachShadow({mode:'open'}).innerHTML='<b>其他文字</b>';}
   if(mode==='closed-shadow'||mode==='closed-shadow-slot'){
    label.innerHTML='<span>陌生问题甲</span>';
    label.firstChild.attachShadow({mode:'closed'}).innerHTML=mode==='closed-shadow-slot'?'<slot></slot><input value="已有私密信息" style="position:absolute;left:100px;top:100px;width:150px;height:24px">':'<b>本机虚构姓名</b>';
   }
   if(mode==='background')label.innerHTML='<span style="background-image:linear-gradient(red,blue)">陌生问题甲</span>';
   if(mode==='pseudo'){label.innerHTML='<span class="generated">陌生问题甲</span>';const css=document.createElement('style');css.textContent='.generated::before{content:"其他文字"}';document.head.append(css);}
   if(mode==='transform')label.innerHTML='<span style="display:inline-block;transform:translateX(5px)">陌生问题甲</span>';
   if(mode==='private')label.innerHTML='<span>本机虚构</span><b>姓名</b>';
   if(mode==='too-many')label.innerHTML='陌生问题甲'+Array(17).fill('<span>甲</span>').join('');
   if(mode==='aria-hidden-overlay'||mode==='inert-overlay'){
    const overlay=document.createElement('input');overlay.value='已有私密信息';overlay.style.cssText='position:absolute;left:100px;top:100px;width:150px;height:24px';
    if(mode==='aria-hidden-overlay')overlay.setAttribute('aria-hidden','true');else overlay.inert=true;document.body.append(overlay);
   }
  },mode);
  await page.addScriptTag({content:bundle.outputFiles[0].text});const result=await page.evaluate(()=>window.inlineLabelProbe());
  report.checks.push({mode,expected:eligible?'eligible':'rejected',actual:result.state,passed:result.state===(eligible?'eligible':'rejected')});
 }
 report.passed=report.checks.every(check=>check.passed);assert.deepEqual(report.externalRequests,[]);assert.ok(report.passed,JSON.stringify(report.checks.filter(check=>!check.passed)));
}catch(error){report.errors.push(String(error));throw error;}
finally{await browser.close();await writeFile(process.env.RA_VISUAL_LAYOUT_REPORT??'artifacts/i014d-inline-label-layout-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));
