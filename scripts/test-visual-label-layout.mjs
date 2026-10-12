// Real layout checks only. Current-capture ownership and PNG are verified separately.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { visualShadowObserverScript } from './fixtures/visual-shadow-observer.mjs';
const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'label-layout-check.ts',loader:'ts',contents:
 "import {inspectSemanticLabelPaint} from './src/visual/semanticLabelRegion';window.labelLayoutProbe=()=>inspectSemanticLabelPaint(document.querySelector('#u'),document.querySelector('label'));"},bundle:true,write:false,format:'iife',platform:'browser'});
const report={scope:'Real Chromium conservative label layout; no model, image upload or full capture grant',checks:[],errors:[],externalRequests:[]};
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage();
 await page.addInitScript({content:visualShadowObserverScript});
 await page.route('**/*',route=>{
  if(new URL(route.request().url()).hostname!=='127.0.0.1'){report.externalRequests.push(route.request().url());return route.abort();}
  return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><style>label{position:absolute;left:80px;top:80px;display:block;width:180px;height:24px;overflow:hidden;background:white;color:black;transition:none}input{position:absolute;left:80px;top:120px;width:180px;height:24px}.decoration{position:absolute;left:500px;top:20px;width:48px;height:48px;contain:paint;overflow:hidden;transition:none}</style></head><body><label for="u">你希望如何被称呼</label><input id="u"></body></html>'});
 });
 for(const mode of ['plain','svg','image','no-clip','layout-only','clip-margin','inline','overlap','foreign-object','reference','paint-reference','canvas','dialog','popover','shadow','second-label']){
  await page.goto('http://127.0.0.1:8123/label-layout-check?mode='+mode);await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(mode=>{
   if(mode==='plain')return;
   if(mode==='second-label'){const label=document.createElement('label');label.htmlFor='u';label.textContent='填写你的称呼';label.style.top='160px';document.body.append(label);return;}
   const clip=document.createElement('div');clip.className='decoration';document.body.append(clip);
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15" fill="blue"/></svg>';
   clip.innerHTML=mode==='image'?'<img width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">':svg;
   if(mode==='no-clip')clip.style.contain='none';if(mode==='layout-only')clip.style.contain='layout';
   // These cases exercise the ancestor proof, without a separate own viewport proof.
   if(['no-clip','layout-only','clip-margin','inline'].includes(mode))clip.querySelector('svg').style.overflow='visible';
   if(mode==='clip-margin'){clip.style.overflow='clip';clip.style.overflowClipMargin='600px';}
   if(mode==='inline'){clip.style.position='static';clip.style.display='inline';clip.style.marginLeft='500px';}
   if(mode==='overlap'){clip.style.left='80px';clip.style.top='80px';}
   if(mode==='foreign-object')clip.innerHTML='<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">其他内容</div></foreignObject></svg>';
   if(mode==='reference')clip.innerHTML='<svg xmlns="http://www.w3.org/2000/svg"><use href="#elsewhere"/></svg>';
   if(mode==='paint-reference')clip.querySelector('circle').setAttribute('fill','url(#elsewhere)');
   if(mode==='canvas')clip.innerHTML='<canvas width="40" height="40"></canvas>';
   if(mode==='dialog'){const dialog=document.createElement('dialog');dialog.textContent='其他窗口';clip.append(dialog);dialog.showModal();}
   if(mode==='popover'){const pop=document.createElement('div');pop.popover='auto';pop.textContent='其他浮层';clip.append(pop);pop.showPopover();}
   if(mode==='shadow'){const host=document.createElement('span');host.attachShadow({mode:'open'}).innerHTML='<span>其他内容</span>';clip.append(host);}
  },mode);
  const result=await page.evaluate(()=>window.labelLayoutProbe());
  assert.equal(result.state,['plain','svg','image','second-label'].includes(mode)?'eligible':'rejected',mode);report.checks.push({mode,result:result.state});
 }
 await page.goto('http://127.0.0.1:8123/label-layout-check?mode=change');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{const clip=document.createElement('div');clip.className='decoration';clip.innerHTML='<img style="overflow:visible" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">';document.body.append(clip);});
 assert.equal((await page.evaluate(()=>window.labelLayoutProbe())).state,'eligible');
 await page.evaluate(()=>document.querySelector('.decoration').style.contain='none');assert.equal((await page.evaluate(()=>window.labelLayoutProbe())).state,'rejected');report.checks.push({mode:'containment-change',result:'rejected'});
 assert.deepEqual(report.externalRequests,[]);report.passed=true;
}catch(error){report.errors.push(String(error));throw error;}
finally{await browser.close();await writeFile(process.env.RA_VISUAL_LAYOUT_REPORT??'artifacts/i014b-ancestor-layout-regression.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));
