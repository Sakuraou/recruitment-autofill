import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), artifacts = resolve(root, 'artifacts');
const report = { startedAt: new Date().toISOString(), version: JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8')).version, scope: 'actual candidate MV3 popup, background, content and compatible HTTP; fictional data and credentials only; release gate pending complete regression', checks: [], errors: [], externalRequests: [] };
async function moduleAt(source, name) {
  const outfile = resolve(artifacts, name + '.mjs');
  await build({ entryPoints: [resolve(root,source)], outfile, bundle:true, platform:'node', format:'esm', target:'node22' });
  return import(pathToFileURL(outfile).href);
}
const {createSemanticServer}=await moduleAt('src/companion/server.ts','student-work-mv3-server');
const {createAgentProvider}=await moduleAt('src/companion/agentProvider.ts','student-work-mv3-provider');
const {createChatCompletionsProvider}=await moduleAt('src/companion/chatCompletionsProvider.ts','student-work-mv3-field-provider');
const fixtureBundle = await build({ stdin: { resolveDir: root, sourcefile: 'student-work-mv3-fixture.ts', loader: 'ts', contents: `
import {installStudentWorkSessionPage,studentWorkSessionProfile} from './tests/fixtures/student-work-session-page';
import {createEmptyProfile,profileSchema} from './src/profile/schema';
const mode=new URL(location.href).searchParams.get('mode')||'normal';
const page=installStudentWorkSessionPage(document,mode==='partial'?[1]:[],{unknown:mode==='unknown',dynamicDuties:true});
const profile=profileSchema.parse({...createEmptyProfile(),studentWork:studentWorkSessionProfile.studentWork.map(record=>mode==='missing-date'?{...record,startDate:undefined}:record)});
if(mode==='presence'){page.list.hidden=true;const form=document.createElement('form');form.innerHTML='<label>是否有校内职务<select><option value="">请选择</option><option value="y">是</option><option value="n">否</option></select></label>';page.list.before(form);form.addEventListener('change',()=>{page.list.hidden=false;});}
window.studentWorkFixture={profile,state:()=>({counts:page.counts,saved:page.saved,cardCount:page.cards.length})};
` }, bundle:true,write:false,format:'iife',platform:'browser' });
const fixtureJs=fixtureBundle.outputFiles[0].text, token='b'.repeat(64), requests=[];
let hold=false, pending, context, service, worker, fixture, upstream;
async function listen(server,port=0){await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});return server.address().port;}
async function close(server){if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}}
try{
 upstream=createServer((req,res)=>{
  const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{void(async()=>{
   assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer fictional-student-work-key');
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.equal(input.tools,undefined);
   const request=JSON.parse(input.messages[1].content);requests.push(request);
   if(hold)await new Promise(done=>{pending=done;res.on('close',done);});if(res.destroyed)return;
   const proposal=request.tasks?{requestId:request.requestId,status:'act',ref:request.tasks[0].ref,reason:'available-task'}:{requestId:request.requestId,status:'unresolved',bindings:[]};
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(proposal)}}]}));
  })().catch(error=>{report.errors.push(error.message);if(!res.destroyed){res.writeHead(500);res.end();}});});
 });
 const upstreamPort=await listen(upstream),config={apiKey:'fictional-student-work-key',model:'fictional-student-work-model',baseUrl:'http://127.0.0.1:'+upstreamPort+'/v1'};
 service=createSemanticServer({token,provider:createChatCompletionsProvider(config),agentProvider:createAgentProvider(config)});await listen(service,43127);
 fixture=createServer((req,res)=>{res.writeHead(200,{'Content-Type':req.url.startsWith('/fixture.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});res.end(req.url.startsWith('/fixture.js')?fixtureJs:'<!doctype html><html lang="zh"><meta charset="utf-8"><title>虚构校内职务网申</title><script defer src="/fixture.js"></script><body></body></html>');});
 const fixturePort=await listen(fixture),url='http://127.0.0.1:'+fixturePort+'/';
 context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:['--disable-extensions-except='+resolve(root,'dist'),'--load-extension='+resolve(root,'dist'),'--enable-unsafe-extension-debugging','--enable-extension-target-discovery']});context.setDefaultTimeout(20_000);
 await context.route(/^https?:/,async route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){report.externalRequests.push(route.request().url());await route.abort();}else await route.continue();});
 context.on('page',page=>page.on('pageerror',error=>report.errors.push(error.message)));
 worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const cdp=context.browser()?await context.browser().newBrowserCDPSession():await context.newCDPSession(context.pages()[0]);
 const form=await context.newPage();await form.goto(url);await form.waitForFunction(()=>!!window.studentWorkFixture);
 const options=await context.newPage();await options.goto('chrome-extension://'+id+'/options.html');
 // Uses actual options import/validation/save, not a background storage bypass.
 async function importProfile(){const profile=await form.evaluate(()=>window.studentWorkFixture.profile);await options.getByRole('button',{name:/11 导入与备份/}).click();await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(profile));await options.getByRole('button',{name:'校验并载入预览'}).click();await options.getByRole('button',{name:'保存档案'}).click();await options.getByText('档案已保存在此浏览器。',{exact:false}).waitFor();return profile;}
 const profile=await importProfile();await options.getByRole('button',{name:/13 AI 识别连接/}).click();await options.getByLabel('我确认允许将脱敏字段语义发送给已配置的模型服务').check();await options.getByLabel('导入 AI 连接文件',{exact:true}).setInputFiles({name:'fictional-connection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({protocol:1,token}))});await options.getByText('AI 连接已启用。回到招聘网页',{exact:false}).waitFor();
 report.checks.push('Actual options validate and save three fictional campus roles and local compatible API pairing');
 async function openPopup(){await form.bringToFront();const pageUrl=form.url(),{targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab'}]});const target=targetInfos.find(info=>info.url===pageUrl&&info.type==='tab');assert.ok(target);await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});const popup=await context.newPage();
  await worker.evaluate(async pageUrl=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===pageUrl);await chrome.tabs.update(tab.id,{active:true});},pageUrl);
  await popup.goto('chrome-extension://'+id+'/popup.html');await worker.evaluate(async pageUrl=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===pageUrl);await chrome.tabs.update(tab.id,{active:true});},pageUrl);return popup;}
 const clickAgent=popup=>popup.getByRole('button',{name:'启动 Agent 连续填写',exact:true}).click();
 async function doneAgent(popup,complete=true){await popup.getByText(complete?'本页可访问且支持的任务已核验完成':'仍有待办或需要补充的资料',{exact:false}).waitFor({timeout:60_000});}
 let popup=await openPopup();
 await popup.getByRole('button',{name:'连续填写全部校内职务',exact:true}).click();
 await popup.getByText('全部 3 段经历已处理并核验。',{exact:false}).waitFor({timeout:45_000});let state=await form.evaluate(()=>window.studentWorkFixture.state());
 assert.deepEqual(state.saved.map(record=>[record.role,record.startDate,record.endDate]),profile.studentWork.map(record=>[record.role,record.startDate,record.endDate]));assert.deepEqual(state.counts,{add:3,save:3,submit:0,remove:0,cancel:0});
 report.checks.push('Actual independent popup uses fixed background projection and content lifecycle to Add/fill/Save all three distinct roles/terms');
 await clickAgent(popup);await doneAgent(popup);assert.equal(requests.length,0);assert.deepEqual(await form.evaluate(()=>window.studentWorkFixture.state()),state);await popup.close();
 report.checks.push('Agent freshly verifies independent results with zero model calls or duplicate adds');
 for(const mode of ['normal','partial','presence']){
  await form.goto(url+'?mode='+mode);popup=await openPopup();const before=requests.length;await clickAgent(popup);await doneAgent(popup);state=await form.evaluate(()=>window.studentWorkFixture.state());const expected=mode==='partial'?2:3;
  assert.equal(state.counts.add,expected);assert.equal(state.counts.save,expected);assert.equal(state.cardCount,3);assert.equal(state.counts.submit,0);assert.equal(state.counts.remove,0);
  assert.equal(requests.slice(before).filter(request=>request.tasks?.some(task=>task.kind==='student-work-records')&&request.tasks[0].kind==='student-work-records').length,1);
  if(mode!=='presence')assert.equal(requests.length,before+1);
  const after=requests.length,snapshot=structuredClone(state);await clickAgent(popup);await popup.getByText('Agent 已执行 0 步',{exact:false}).waitFor();assert.deepEqual(await form.evaluate(()=>window.studentWorkFixture.state()),snapshot);assert.equal(requests.length,after);await popup.close();
  report.checks.push('Actual Agent '+mode+' uses compatible HTTP, saves only missing roles/terms, and restarts without duplicates');
 }
 for(const mode of ['unknown','missing-date']){
  await form.goto(url+'?mode='+mode);await importProfile();popup=await openPopup();await clickAgent(popup);await doneAgent(popup,false);state=await form.evaluate(()=>window.studentWorkFixture.state());assert.equal(state.counts.add,mode==='unknown'?1:0);assert.equal(state.counts.save,0);assert.equal(state.counts.submit,0);await popup.close();
  report.checks.push('Actual Agent '+mode+' preserves pending records and never claims complete or saves a guessed value');
 }
 for(const mode of ['stop','close']){
  await form.goto(url);await importProfile();hold=true;pending=undefined;popup=await openPopup();const before=requests.length;await clickAgent(popup);
  for(let i=0;i<200&&requests.length===before;i++)await new Promise(done=>setTimeout(done,25));assert.equal(requests.length,before+1);
  if(mode==='stop')await popup.getByRole('button',{name:'停止 Agent',exact:true}).click();else await popup.close();hold=false;pending?.();await new Promise(done=>setTimeout(done,400));
  state=await form.evaluate(()=>window.studentWorkFixture.state());assert.equal(state.counts.add,0);assert.equal(state.counts.save,0);assert.equal(state.counts.submit,0);if(mode==='stop')await popup.close();
  report.checks.push('Actual popup '+mode+' cancels model ownership before any campus-position Add or Save');
 }
 const model=JSON.stringify(requests);for(const secret of ['虚构学院','辅导员助理','就业办助理','2021-09-01','fictional-work-',token,'fictional-student-work-key'])assert.ok(!model.includes(secret));
 assert.ok(requests.filter(request=>request.tasks).every(request=>request.tasks.every(task=>['fill-visible','student-work-records'].includes(task.kind))&&request.tasks.filter(task=>task.kind==='student-work-records').every(task=>task.count===3)));
 report.checks.push('Compatible upstream sees bounded task counts and refs only; no personal roles, dates, IDs, capability token or API key');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.message;throw error;}
finally{hold=false;pending?.();await context?.close();await close(fixture);await close(service);await close(upstream);report.finishedAt=new Date().toISOString();await writeFile(resolve(artifacts,'i011f-student-work-mv3-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failure:report.failure}));}


