import assert from 'node:assert/strict';import{build}from'esbuild';import{writeFile}from'node:fs/promises';import{chromium}from'playwright';
const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'paint-freshness.ts',loader:'ts',contents:"import{createSemanticPaintFreshness}from'./src/visual/semanticPaintFreshness';window.createPaintGuard=()=>createSemanticPaintFreshness(document.querySelector('input'));"},bundle:true,write:false,format:'iife',platform:'browser'});
const cases=['normal','insert-rule','delete-rule','disabled','media','property','replace-sync','adopted-add','adopted-replace','adopted-duplicate','adopted-reorder','inline-style','font-metrics','scroll','label-replace','after-restored','opaque-css','opaque-disabled','oversized-rules','oversized-css','oversized-sheets'];
const report={scope:'Actual Chromium read-only paint freshness predicate; no capture, model or write authority',checks:[],errors:[],externalRequests:[]};const browser=await chromium.launch({channel:'chromium',headless:true});
try{const page=await browser.newPage({viewport:{width:1280,height:720}});await page.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){report.externalRequests.push(url.href);return route.abort();}if(url.pathname==='/public.css')return route.fulfill({contentType:'text/css',body:'label{color:black}'});return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><style id="rules">body{margin:0}.surface{position:absolute;left:80px;top:80px;width:240px;height:160px;background:white}label{display:block;margin:20px;width:180px;height:24px;overflow:visible;color:black}input{width:160px;height:24px}</style><div class="surface"><label for="opaque">陌生问题甲</label><input id="opaque"></div>'});});
for(const mode of cases){await page.goto('http://127.0.0.1:8123/paint-freshness?mode='+mode);await page.evaluate(async mode=>{
 const sheet=new CSSStyleSheet();sheet.replaceSync('label{font-weight:normal}');const second=new CSSStyleSheet();second.replaceSync('input{font-weight:normal}');window.fixtureSheet=sheet;document.adoptedStyleSheets=[sheet,second];
 if(mode.startsWith('opaque-'))await new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href='http://localhost:8124/public.css';link.onload=resolve;link.onerror=reject;document.head.append(link);});
 if(mode==='oversized-rules')sheet.replaceSync(Array.from({length:4097},(_,i)=>'.rule'+i+'{color:black}').join(''));
 if(mode==='oversized-css')sheet.replaceSync('label{--fictional:"'+'x'.repeat(512100)+'"}');
 if(mode==='oversized-sheets')document.adoptedStyleSheets=Array.from({length:65},()=>new CSSStyleSheet());
 },mode);await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(mode=>{const guard=window.createPaintGuard();if(mode.startsWith('oversized-'))return{created:!!guard};if(!guard)return{created:false};const initial=guard.isCurrent(),sheet=document.querySelector('#rules').sheet;
 if(mode==='insert-rule')sheet.insertRule('label::before{content:"变更问题"}',sheet.cssRules.length);
 if(mode==='delete-rule')sheet.deleteRule(0);
 if(mode==='disabled')sheet.disabled=true;
 if(mode==='media')sheet.media.mediaText='not all';
 if(mode==='property')sheet.cssRules[1].style.setProperty('background-color','red');
 if(mode==='replace-sync')window.fixtureSheet.replaceSync('label{font-weight:bold}');
 if(mode==='adopted-add')document.adoptedStyleSheets.push(new CSSStyleSheet());
 if(mode==='adopted-replace'){const copy=new CSSStyleSheet();copy.replaceSync('label{font-weight:normal}');document.adoptedStyleSheets=[copy,document.adoptedStyleSheets[1]];}
 if(mode==='adopted-duplicate')document.adoptedStyleSheets.push(document.adoptedStyleSheets[0]);
 if(mode==='adopted-reorder')document.adoptedStyleSheets.reverse();
 if(mode==='inline-style')document.querySelector('label').style.color='red';
 if(mode==='font-metrics')sheet.insertRule('label{font-size:20px}',sheet.cssRules.length);
 if(mode==='scroll'){document.body.style.height='2000px';window.scrollTo(0,80);}
 if(mode==='label-replace'){const label=document.querySelector('label');label.replaceWith(label.cloneNode(true));}
 if(mode==='after-restored'){sheet.insertRule('label{color:red}',sheet.cssRules.length);const first=guard.isCurrent();sheet.deleteRule(sheet.cssRules.length-1);return{created:true,initial,first,current:guard.isCurrent()};}
 if(mode==='opaque-css'){let denied=false;try{void document.querySelector('link').sheet.cssRules}catch(error){denied=error.name==='SecurityError';}return{created:true,initial,current:guard.isCurrent(),denied};}
 if(mode==='opaque-disabled')document.querySelector('link').sheet.disabled=true;
 return{created:true,initial,current:guard.isCurrent()};},mode);
 if(mode.startsWith('oversized-'))assert.equal(result.created,false,mode);else{assert.equal(result.created,true,mode);assert.equal(result.initial,true,mode);assert.equal(result.current,['normal','opaque-css'].includes(mode),mode);if(mode==='opaque-css')assert.equal(result.denied,true);if(mode==='after-restored')assert.equal(result.first,false);}
 report.checks.push({mode,result});}
assert.deepEqual(report.externalRequests,[]);report.passed=true;
}catch(error){report.errors.push(String(error));throw error;}finally{await browser.close();await writeFile(process.env.RA_VISUAL_PAINT_REPORT??'artifacts/i014h-paint-freshness-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));
