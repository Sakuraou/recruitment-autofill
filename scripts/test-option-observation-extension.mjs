// Actual MV3 and compatible HTTP; fictional data only; complete release regression required.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),artifacts=resolve(root,'artifacts');
const report={startedAt:new Date().toISOString(),version:JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8')).version,scope:'actual candidate MV3 popup/content/background and fictional OpenAI-compatible HTTP; complete release gate pending',checks:[],errors:[],externalRequests:[]};
async function moduleAt(source,name){const outfile=resolve(artifacts,name+'.mjs');await build({entryPoints:[resolve(root,source)],outfile,bundle:true,platform:'node',format:'esm',target:'node22'});return import(pathToFileURL(outfile).href);}
const {createSemanticServer}=await moduleAt('src/companion/server.ts','i012a-mv3-server');
const {createAgentProvider}=await moduleAt('src/companion/agentProvider.ts','i012a-mv3-agent-provider');
const {createChatCompletionsProvider}=await moduleAt('src/companion/chatCompletionsProvider.ts','i012a-mv3-field-provider');
const fixtureBundle=await build({stdin:{resolveDir:root,sourcefile:'i012a-mv3-fixture.ts',loader:'ts',contents:`
import {createEmptyProfile,profileSchema} from './src/profile/schema';
const mode=new URL(location.href).searchParams.get('mode')||'normal';
document.body.innerHTML='<form><section aria-label="个人信息"><h2>个人信息</h2><label for="c">未知招聘问题</label><button id="c" type="button" role="combobox" aria-controls="l" aria-expanded="false">请选择</button><div id="l" role="listbox" hidden></div><button type="submit">最终提交</button></section></form>';
const node=document.querySelector<HTMLElement>('#c')!,list=document.querySelector<HTMLElement>('#l')!;let opens=0,selections=0,submits=0;
document.querySelector('form')!.addEventListener('submit',event=>{event.preventDefault();submits++;});
node.addEventListener('click',()=>{opens++;node.setAttribute('aria-expanded','true');list.hidden=false;setTimeout(()=>{
 if(mode==='no-options')return;
 if(mode==='replace')node.replaceWith(node.cloneNode(true));
 if(mode==='manual')node.textContent='网页手选';
 list.innerHTML='<div role="option" data-value="opaque-choice-m">男</div><div role="option" data-value="opaque-choice-f">女</div>';
},mode==='slow'?450:25);});
list.addEventListener('click',event=>{const option=(event.target as Element).closest('[role="option"]');if(option){selections++;option.setAttribute('aria-selected','true');node.textContent=option.textContent;}});
window.optionFixture={profile:profileSchema.parse({...createEmptyProfile(),basic:{gender:'男'}}),state:()=>({opens,selections,submits,text:document.querySelector('#c')!.textContent})};
`},bundle:true,write:false,format:'iife',platform:'browser'});
const fixtureJs=fixtureBundle.outputFiles[0].text,token='d'.repeat(64),requests=[];
let context,worker,fixture,upstream,service,pending,holdMeaning=false;
async function listen(server,port=0){await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});return server.address().port;}
async function close(server){if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}}
try{
 upstream=createServer((req,res)=>{const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{void(async()=>{
  assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer fictional-observation-key');
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.equal(input.tools,undefined);const request=JSON.parse(input.messages[1].content);requests.push(request);
  // The profile's literal answer is redacted even when it also appears as an
  // option. Recognize the category from another visible label, not that answer.
  const bindings=request.fields?.flatMap(field=>field.options.some(option=>option.label==='女')?[{ref:field.ref,fingerprint:field.fingerprint,path:'basic.gender',certainty:'certain',evidence:'options'}]:[])??[];
  if(holdMeaning&&bindings.length)await new Promise(done=>{pending=done;res.on('close',done);});if(res.destroyed)return;
  const proposal=request.tasks?{requestId:request.requestId,status:'act',ref:(request.tasks.find(task=>task.kind==='observe-options')??request.tasks[0]).ref,reason:'available-task'}:{requestId:request.requestId,status:bindings.length?'mapped':'unresolved',bindings};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(proposal)}}]}));
 })().catch(error=>{report.errors.push(error.message);if(!res.destroyed){res.writeHead(500);res.end();}});});});
 const upstreamPort=await listen(upstream),config={apiKey:'fictional-observation-key',model:'fictional-observation-model',baseUrl:'http://127.0.0.1:'+upstreamPort+'/v1'};
 service=createSemanticServer({token,provider:createChatCompletionsProvider(config),agentProvider:createAgentProvider(config)});await listen(service,43127);
 fixture=createServer((req,res)=>{res.writeHead(200,{'Content-Type':req.url.startsWith('/fixture.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});res.end(req.url.startsWith('/fixture.js')?fixtureJs:'<!doctype html><html lang="zh"><meta charset="utf-8"><title>虚构陌生下拉框</title><script defer src="/fixture.js"></script><body></body></html>');});
 const fixturePort=await listen(fixture),url='http://127.0.0.1:'+fixturePort+'/';
 context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:['--disable-extensions-except='+resolve(root,'dist'),'--load-extension='+resolve(root,'dist'),'--enable-unsafe-extension-debugging','--enable-extension-target-discovery']});context.setDefaultTimeout(20_000);
 await context.route(/^https?:/,async route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){report.externalRequests.push(route.request().url());await route.abort();}else await route.continue();});
 context.on('page',page=>page.on('pageerror',error=>report.errors.push(error.message)));
 worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const cdp=context.browser()?await context.browser().newBrowserCDPSession():await context.newCDPSession(context.pages()[0]);
 const form=await context.newPage();await form.goto(url);await form.waitForFunction(()=>!!window.optionFixture);
 const options=await context.newPage();await options.goto('chrome-extension://'+id+'/options.html');
 await options.getByRole('button',{name:/11 导入与备份/}).click();await options.getByLabel('或粘贴 JSON').fill(JSON.stringify(await form.evaluate(()=>window.optionFixture.profile)));
 await options.getByRole('button',{name:'校验并载入预览'}).click();await options.getByRole('button',{name:'保存档案'}).click();await options.getByText('档案已保存在此浏览器。',{exact:false}).waitFor();
 await options.getByRole('button',{name:/13 AI 识别连接/}).click();await options.getByLabel('导入 AI 连接文件',{exact:true}).setInputFiles({name:'fictional-connection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({protocol:1,token}))});await options.getByText('AI 连接已启用。回到招聘网页',{exact:false}).waitFor();
 report.checks.push('Actual options validates and saves fictional profile and compatible pairing, without a storage bypass');
 async function openPopup(){await form.bringToFront();const pageUrl=form.url(),{targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab'}]});const target=targetInfos.find(info=>info.url===pageUrl&&info.type==='tab');assert.ok(target);await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});const popup=await context.newPage();
  await worker.evaluate(async pageUrl=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===pageUrl);await chrome.tabs.update(tab.id,{active:true});},pageUrl);await popup.goto('chrome-extension://'+id+'/popup.html');await worker.evaluate(async pageUrl=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===pageUrl);await chrome.tabs.update(tab.id,{active:true});},pageUrl);return popup;}
 const start=popup=>popup.getByRole('button',{name:'启动 Agent 连续填写',exact:true}).click();
 const done=(popup,complete)=>popup.getByText(complete?'本页可访问且支持的任务已核验完成':'仍有待办或需要补充的资料',{exact:false}).waitFor({timeout:60_000});
 let popup=await openPopup(),before=requests.length;await start(popup);
 try{await done(popup,true);}catch(error){report.diagnostic=await popup.locator('body').innerText();report.fixture=await form.evaluate(()=>window.optionFixture.state());report.requests=requests;throw error;}
 assert.deepEqual(await form.evaluate(()=>window.optionFixture.state()),{opens:1,selections:1,submits:0,text:'男'});
 assert.deepEqual(requests.slice(before).filter(request=>request.tasks).map(request=>request.tasks.map(task=>task.kind)),[['fill-visible'],['observe-options'],['fill-visible']]);
 assert.ok(requests.slice(before).filter(request=>request.fields).some(request=>request.fields.some(field=>field.options.length===2)));
 report.checks.push('Actual compatible Agent observes once, re-infers meaning from fresh option labels and selects the answer from local facts');
 before=requests.length;await start(popup);await popup.getByText('Agent 已执行 0 步',{exact:false}).waitFor();assert.equal(requests.length,before);assert.deepEqual(await form.evaluate(()=>window.optionFixture.state()),{opens:1,selections:1,submits:0,text:'男'});await popup.close();
 report.checks.push('A second Agent run neither observes nor selects again, and completion keeps final submission untouched');
 for(const mode of ['no-options','replace','manual']){
  await form.goto(url+'?mode='+mode);popup=await openPopup();await start(popup);await done(popup,false);const state=await form.evaluate(()=>window.optionFixture.state());assert.equal(state.opens,1);assert.equal(state.selections,0);assert.equal(state.submits,0);if(mode==='manual')assert.equal(state.text,'网页手选');await popup.close();
  report.checks.push('Actual '+mode+' preserves pending work after one open and never chooses or submits');
 }
 for(const mode of ['stop','close']){
  await form.goto(url+'?mode=slow');popup=await openPopup();await start(popup);await form.waitForFunction(()=>window.optionFixture.state().opens===1);if(mode==='stop')await popup.getByRole('button',{name:'停止 Agent',exact:true}).click();else await popup.close();await new Promise(done=>setTimeout(done,650));const state=await form.evaluate(()=>window.optionFixture.state());assert.equal(state.opens,1);assert.equal(state.selections,0);assert.equal(state.submits,0);if(mode==='stop')await popup.close();
  report.checks.push('Actual popup '+mode+' aborts ownership during option observation; late options never cause a choice');
 }
 // Prior successful runs have a verified semantic recipe. Use the actual UI
 // to revise the connection and clear that recipe scope before testing HTTP.
 await options.getByLabel('导入 AI 连接文件',{exact:true}).setInputFiles({name:'fictional-new-connection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({protocol:1,token}))});
 await options.getByText('AI 连接已启用。回到招聘网页',{exact:false}).waitFor();
 await form.goto(url);holdMeaning=true;pending=undefined;popup=await openPopup();await start(popup);for(let i=0;i<400&&!pending;i++)await new Promise(done=>setTimeout(done,25));assert.ok(pending);await popup.getByRole('button',{name:'停止 Agent',exact:true}).click();holdMeaning=false;pending();await new Promise(done=>setTimeout(done,400));assert.deepEqual(await form.evaluate(()=>window.optionFixture.state()),{opens:1,selections:0,submits:0,text:'请选择'});await popup.close();
 report.checks.push('Stop during the subsequent HTTP meaning request rejects a late model binding and preserves the unanswered field');
 const taskRequests=requests.filter(request=>request.tasks),model=JSON.stringify(requests);for(const secret of [token,'fictional-observation-key','opaque-choice-m','opaque-choice-f','男'])assert.ok(!model.includes(secret));assert.ok(taskRequests.every(request=>request.tasks.every(task=>['fill-visible','observe-options'].includes(task.kind))));
 report.checks.push('Agent model receives bounded task refs only; field model receives option labels, without local answer, opaque values or credentials');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.message;throw error;}
finally{holdMeaning=false;pending?.();await context?.close();await close(fixture);await close(service);await close(upstream);report.finishedAt=new Date().toISOString();await writeFile(resolve(artifacts,'i012a-observation-mv3-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failure:report.failure}));}
