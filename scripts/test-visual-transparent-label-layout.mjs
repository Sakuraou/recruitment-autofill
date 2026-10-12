import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {visualShadowObserverScript} from './fixtures/visual-shadow-observer.mjs';
const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'transparent-label.ts',loader:'ts',contents:
 "import{inspectSemanticLabelPaint}from'./src/visual/semanticLabelRegion';window.transparentLabelProbe=()=>[...document.querySelector('input').labels].map(label=>inspectSemanticLabelPaint(document.querySelector('input'),label));"},bundle:true,write:false,format:'iife',platform:'browser'});
const cases=[['opaque',true],['transparent-panel',true],['transparent-tint',true],['transparent-body',true],['transparent-grandparent',true],['transparent-nested',true],['transparent-multi',true],
 ['no-backdrop',false],['half-parent',false],['half-label',false],['short-surface',false],['rounded',false],['background-image',false],['opacity',false],['content-clip',false],
 ['overlay',false],['aria-hidden-overlay',false],['closed-parent',false],['unclipped',false]];
const report={scope:'Controlled Chromium transparent-label/backdrop layout; test-only shadow registry, no capture/send/model authority',checks:[],errors:[],externalRequests:[]};
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage();await page.addInitScript({content:visualShadowObserverScript});
 await page.route('**/*',route=>{
  if(new URL(route.request().url()).hostname!=='127.0.0.1'){report.externalRequests.push(route.request().url());return route.abort();}
  return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><style>body{margin:0}.surface{position:absolute;left:80px;top:80px;width:240px;height:160px;background:white}label{position:absolute;left:20px;top:20px;display:block;width:180px;height:24px;overflow:hidden;background:transparent;color:black}input{position:absolute;left:20px;top:90px;width:180px;height:24px}</style><div class="surface"><label for="opaque">陌生问题甲</label><input id="opaque"></div>'});
 });
 for(const[mode,eligible]of cases){
  await page.goto('http://127.0.0.1:8123/transparent-label?mode='+mode);
  await page.evaluate(mode=>{
   const panel=document.querySelector('.surface'),label=document.querySelector('label');
   if(mode==='opaque')label.style.backgroundColor='white';
   if(mode==='transparent-tint')panel.style.backgroundColor='#ddeeff';
   if(mode==='transparent-body'){panel.style.backgroundColor='transparent';document.body.style.backgroundColor='white';document.body.style.minHeight='100vh';}
   if(mode==='transparent-grandparent'){const outer=document.createElement('div');outer.style.cssText='position:absolute;left:70px;top:70px;width:300px;height:220px;background:white';panel.before(outer);outer.append(panel);panel.style.left='10px';panel.style.top='10px';panel.style.backgroundColor='transparent';}
   if(mode==='transparent-nested')label.innerHTML='<span>陌生问题甲</span>';
   if(mode==='transparent-multi'){const second=label.cloneNode(true);second.textContent='附加问题甲';second.style.top='56px';label.after(second);document.querySelector('input').style.top='110px';}
   if(mode==='no-backdrop')panel.style.backgroundColor='transparent';
   if(mode==='half-parent')panel.style.backgroundColor='rgba(255,255,255,0.5)';
   if(mode==='half-label')label.style.backgroundColor='rgba(255,255,255,0.5)';
   if(mode==='short-surface')panel.style.width='120px';
   if(mode==='rounded')panel.style.borderRadius='24px';
   if(mode==='background-image')panel.style.backgroundImage='linear-gradient(red,blue)';
   if(mode==='opacity')panel.style.opacity='0.9';
   if(mode==='content-clip')panel.style.backgroundClip='content-box';
   if(mode==='unclipped')label.style.overflow='visible';
   if(mode==='overlay'||mode==='aria-hidden-overlay'){const overlay=document.createElement('input');overlay.value='已有私密信息';overlay.style.cssText='position:absolute;left:100px;top:100px;width:150px;height:24px';if(mode==='aria-hidden-overlay')overlay.setAttribute('aria-hidden','true');document.body.append(overlay);}
   if(mode==='closed-parent')panel.attachShadow({mode:'closed'}).innerHTML='<slot></slot><b>已有私密信息</b>';
  },mode);
  await page.addScriptTag({content:bundle.outputFiles[0].text});const states=await page.evaluate(()=>window.transparentLabelProbe().map(result=>result.state));
  report.checks.push({mode,expected:eligible?'eligible':'rejected',states,passed:states.every(state=>state===(eligible?'eligible':'rejected'))});
 }
 report.passed=report.checks.every(check=>check.passed);assert.deepEqual(report.externalRequests,[]);assert.ok(report.passed,JSON.stringify(report.checks.filter(check=>!check.passed)));
}catch(error){report.errors.push(String(error));throw error;}
finally{await browser.close();await writeFile(process.env.RA_VISUAL_LAYOUT_REPORT??'artifacts/i014f-transparent-label-layout-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));
