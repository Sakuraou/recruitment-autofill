import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

import {chromium} from 'playwright';
const dir=resolve(process.env.RA_VISUAL_TEST_DIST??'dist');
const report={scope:'installed label handshake with trusted popup local candidate; actual full content/index has no profile; popup local semantic session; actual background index and popup local capture/coordinator clients and content-local scanner/owner/PNG redaction through actual background visual port and actual authenticated companion with compatible provider and fictional upstream fetch; no external model or writes',checks:[],errors:[],externalRequests:[]};
const requests=[];let hold=false,pendingResponse,aborted=0;
await build({entryPoints:['src/companion/server.ts','src/companion/chatCompletionsProvider.ts'],outdir:'artifacts/i012c-real-companion',bundle:true,platform:'node',format:'esm',target:'node22'});
const {createSemanticServer}=await import('../artifacts/i012c-real-companion/server.js');
const {createVisualChatCompletionsProvider}=await import('../artifacts/i012c-real-companion/chatCompletionsProvider.js');
const fetcher=async(url,options)=>{
 assert.equal(url,'https://fictional.invalid/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer fictional-only');
 const body=JSON.parse(options.body);const parts=body.messages[1].content;
 const input={request:JSON.parse(parts[0].text),image:{mime:'image/png',redacted:true,data:parts[1].image_url.url}};
 assert.ok(!JSON.stringify(input).includes('本机虚构姓名'));assert.ok(!JSON.stringify(input).includes('installed-capture'));
 const png=Buffer.from(input.image.data.split(',')[1],'base64');assert.ok(png.readUInt32BE(16)<800);requests.push(input);
 if(hold){pendingResponse={};return new Promise((resolve,reject)=>{const abort=()=>{aborted++;reject(new DOMException('Aborted','AbortError'))};if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true})})}
 const f=input.request.fields[0];return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({requestId:input.request.requestId,status:'mapped',bindings:[{ref:f.ref,fingerprint:f.fingerprint,path:'basic.name',certainty:'certain',evidence:'label'}]})}}]}));
};
const server=createSemanticServer({token:'a'.repeat(64),visualProvider:createVisualChatCompletionsProvider({baseUrl:'https://fictional.invalid/v1',apiKey:'fictional-only',model:'fictional-vision',fetcher})});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(43127,'127.0.0.1',resolve)});
let context;
try{
 context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dir}`,`--load-extension=${dir}`,'--enable-unsafe-extension-debugging','--enable-extension-target-discovery']});
 await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith('chrome-extension://')||u.startsWith('http://127.0.0.1:43127/'))return route.continue();if(u.startsWith('http://127.0.0.1:8123/installed-capture'))return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><form><section><h2 style="margin:0;height:24px">个人信息</h2><div style="position:absolute;left:100px;top:100px;width:200px;height:100px"><label style="display:block;width:160px;height:24px;overflow:hidden;background:white;color:black" for="unknown">陌生问题甲</label><input style="display:block;margin-top:12px;width:160px;height:24px" id="unknown"></div></section></form>'});report.externalRequests.push(u);return route.abort()});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const form=await context.newPage();form.on('pageerror',e=>report.errors.push(e.message));await form.goto('http://127.0.0.1:8123/installed-capture');

 const cdp=await context.browser().newBrowserCDPSession();const{targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab'}]});const tab=targetInfos.find(t=>t.url===form.url());assert.ok(tab);
 await cdp.send('Extensions.triggerAction',{id,targetId:tab.targetId});
 let popupTarget;let all;for(let i=0;i<30;i++){all=await cdp.send('Target.getTargets');popupTarget=all.targetInfos.find(t=>t.url===`chrome-extension://${id}/popup.html`);if(popupTarget)break;await new Promise(r=>setTimeout(r,100));}assert.ok(popupTarget,'actual popup CDP target must exist: '+JSON.stringify(all));
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:popupTarget.targetId,flatten:false});let seq=0;
 const evaluate=expression=>new Promise((resolve,reject)=>{const requestId=++seq;const handler=event=>{if(event.sessionId!==sessionId)return;const m=JSON.parse(event.message);if(m.id!==requestId)return;cdp.off('Target.receivedMessageFromTarget',handler);if(m.error||m.result?.exceptionDetails)reject(new Error(JSON.stringify(m)));else resolve(m.result.result.value)};cdp.on('Target.receivedMessageFromTarget',handler);void cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:requestId,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject)});
 const wait=async(expression)=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,20))}throw Error('UI wait failed: '+expression+' text='+await evaluate('document.body.innerText'))};
 const click=async text=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('button unavailable');b.click();return true})()`);
 await worker.evaluate(()=>{const p={schemaVersion:1,basic:{},education:[],research:{papers:[],patents:[]},projects:[],internships:[],studentWork:[],awards:[],certificates:[],skills:{},commonAnswers:{},family:[]};p.basic.name='本机虚构姓名';return chrome.storage.local.set({'recruitment.profile.v1':p,'recruitment.semantic.connection.v1':{protocol:1,token:'a'.repeat(64),enabled:true,userConfirmed:true}})});
 await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='扫描页面'&&!b.disabled)");await click('扫描页面');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='局部截图识别未知字段'&&!b.disabled)");await click('局部截图识别未知字段');await wait("document.body.innerText.includes('局部截图识别得到 0 项候选')");assert.equal(requests.length,0);report.checks.push('Full PopupApp UI defaults to zero model calls without visual consent');
 await worker.evaluate(()=>chrome.storage.local.set({'recruitment.visual.consent.v1':{version:1,enabled:true,userConfirmed:true}}));await new Promise(r=>setTimeout(r,150));await click('局部截图识别未知字段');await wait("document.body.innerText.includes('局部截图识别得到 1 项候选')");assert.equal(requests.length,1);assert.equal(await form.locator('#unknown').inputValue(),'');report.checks.push('Full PopupApp scan and visual button produce local review candidate without writing form');
 pendingResponse=undefined;await click('扫描页面');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='局部截图识别未知字段'&&!b.disabled)");await new Promise(r=>setTimeout(r,650));hold=true;const previousAborted=aborted;await click('局部截图识别未知字段');for(let i=0;i<100&&!pendingResponse;i++)await new Promise(r=>setTimeout(r,20));assert.ok(pendingResponse);
 await form.goto('http://127.0.0.1:8123/installed-capture?new-page');for(let i=0;i<100&&aborted===previousAborted;i++)await new Promise(r=>setTimeout(r,20));assert.ok(aborted>previousAborted,'navigation must abort pending HTTP');assert.equal(await form.locator('#unknown').inputValue(),'');report.checks.push('Full PopupApp navigation cancels actual HTTP and new page remains empty');
 await cdp.send('Target.detachFromTarget',{sessionId});
 assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);report.passed=true;report.finishedAt=new Date().toISOString();
}catch(e){report.errors.push(String(e));throw e}finally{await context?.close();await new Promise(resolve=>server.close(resolve));await writeFile('artifacts/i012c-real-companion-navigation-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));



