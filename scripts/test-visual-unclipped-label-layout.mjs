import assert from 'node:assert/strict';
import{build}from'esbuild';import{writeFile}from'node:fs/promises';import{chromium}from'playwright';
import{visualShadowObserverScript}from'./fixtures/visual-shadow-observer.mjs';
const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'unclipped-label.ts',loader:'ts',contents:"import{inspectSemanticLabelPaint}from'./src/visual/semanticLabelRegion';window.unclippedProbe=()=>inspectSemanticLabelPaint(document.querySelector('input'),document.querySelector('label'));"},bundle:true,write:false,format:'iife',platform:'browser'});
const cases=[['block',true],['inline',true],['inline-block',true],['nested',true],['required-star',true],['two-lines',true],['opaque',true],['visible-negative-indent',false],['visible-overflow',false],['long-word',false],['textarea-child',false],['foreign-overlay',false],['closed-span',false],['half-label',false],['unknown-backdrop',false],['transform',false],['pseudo',false],['scroll',false]];
const report={scope:'Actual Chromium original text ranges for visible-overflow labels; test-only shadow registry, no capture or model authority',checks:[],errors:[],externalRequests:[]};
const browser=await chromium.launch({channel:'chromium',headless:true});
try{const page=await browser.newPage();await page.addInitScript({content:visualShadowObserverScript});
await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){report.externalRequests.push(route.request().url());return route.abort();}return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><style>body{margin:0}.surface{position:absolute;left:80px;top:80px;width:240px;height:180px;background:white}label{position:absolute;left:20px;top:20px;display:block;width:180px;height:24px;overflow:visible;background:transparent;color:black}input{position:absolute;left:20px;top:120px;width:180px;height:24px}</style><div class="surface"><label for="opaque">陌生问题甲</label><input id="opaque"></div>'});});
for(const[mode,eligible]of cases){await page.goto('http://127.0.0.1:8123/unclipped-label?mode='+mode);await page.evaluate(mode=>{const panel=document.querySelector('.surface'),label=document.querySelector('label');
if(mode==='inline'){label.style.position='static';label.style.display='inline';label.style.width='auto';label.style.height='auto';panel.style.padding='20px';panel.style.boxSizing='border-box';}
if(mode==='inline-block')label.style.display='inline-block';
if(mode==='nested')label.innerHTML='<span><strong>陌生问题甲</strong></span>';
if(mode==='required-star')label.innerHTML='陌生问题甲<span aria-hidden="true" style="color:red">*</span>';
if(mode==='two-lines'){label.innerHTML='<span>陌生问题甲<br>附加说明</span>';label.style.height='48px';}
if(mode==='opaque')label.style.backgroundColor='white';
if(mode==='visible-negative-indent')label.style.textIndent='-100px';
if(mode==='visible-overflow')label.style.width='20px';
if(mode==='long-word'){label.textContent='陌生问题ABCDEFGHIJKLMN';label.style.width='40px';label.style.whiteSpace='nowrap';}
if(mode==='textarea-child')label.innerHTML='<textarea>已有私密信息</textarea>';
if(mode==='foreign-overlay'){const text=document.createElement('div');text.textContent='已有私密信息';text.style.cssText='position:absolute;left:100px;top:100px';document.body.append(text);}
if(mode==='closed-span'){label.innerHTML='<span>陌生问题甲</span>';label.firstElementChild.attachShadow({mode:'closed'}).innerHTML='<b>已有私密信息</b>';}
if(mode==='half-label')label.style.backgroundColor='rgba(255,255,255,.5)';
if(mode==='unknown-backdrop')panel.style.backgroundColor='transparent';
if(mode==='transform')label.style.transform='translateX(1px)';
if(mode==='pseudo'){const style=document.createElement('style');style.textContent='label::before{content:"已有私密信息"}';document.head.append(style);}
if(mode==='scroll')label.style.overflow='auto';
},mode);await page.addScriptTag({content:bundle.outputFiles[0].text});const result=await page.evaluate(()=>window.unclippedProbe());report.checks.push({mode,result,expected:eligible?'eligible':'rejected',passed:result.state===(eligible?'eligible':'rejected')});}
report.passed=report.checks.every(check=>check.passed);assert.deepEqual(report.externalRequests,[]);assert.ok(report.passed,JSON.stringify(report.checks.filter(check=>!check.passed)));
}catch(error){report.errors.push(String(error));throw error;}finally{await browser.close();await writeFile(process.env.RA_VISUAL_LAYOUT_REPORT??'artifacts/i014g-unclipped-label-layout-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));
