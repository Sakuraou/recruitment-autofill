// Internal protocol/context only; fictional DOM in disposable Chromium.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const artifacts=resolve(root,'artifacts');
await mkdir(artifacts,{recursive:true});
const bundle=await build({stdin:{contents:`export * from './src/ai/internshipSemanticContext';
export {createEmptyProfile} from './src/profile/schema';
export {internshipSessionProfile} from './tests/fixtures/internship-session-page';
export {lifecycle} from './tests/fixtures/record-editor-context';
export {bindRecordEditor} from './src/planner/recordEditorBinder';`,resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',globalName:'InternshipContextTest',target:'chrome114'});
const url='https://careers.example.test/internship-context';const report={startedAt:new Date().toISOString(),checks:[],errors:[],externalRequests:[]};let browser;
try{
 browser=await chromium.launch({channel:'chromium',headless:true});const context=await browser.newContext();
 await context.route(/^https?:/,route=>route.request().url()===url?route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><main></main>'}):(report.externalRequests.push(route.request().url()),route.abort()));
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));await page.goto(url);await page.addScriptTag({content:bundle.outputFiles[0].text});report.browser=browser.version();
 for(const mode of ['current','copy','profile','reorder','replace','stop','consume','foreign-profile','missing','radio-outside','radio-hidden','radio-shadow']){
  const result=await page.evaluate(async mode=>{
   const api=window.InternshipContextTest;const profile=api.createEmptyProfile();profile.updatedAt=api.internshipSessionProfile.profileRevision;profile.internships=structuredClone(api.internshipSessionProfile.internships);
   const radio=mode.startsWith('radio-');const fields=radio?[Object.assign(document.createElement('input'),{type:'radio',name:'current-proof',value:'proof-yes',ariaLabel:'是'})]:['当时服务的实体','归属的业务团队','承担的工作内容'].map(ariaLabel=>Object.assign(document.createElement('input'),{ariaLabel}));
   const other=Object.assign(document.createElement('input'),{type:'radio',name:'current-proof',value:'proof-no',ariaLabel:'否'});
   if(mode==='missing')delete profile.internships[1].department;
   if(mode==='foreign-profile')profile.internships[1].certifierContact='虚构第三方资料';
   const state=api.lifecycle(fields,radio?new Map([[fields[0],[fields[0],other]]]):undefined,undefined,1,'internship');
   let clicks=0;document.body.addEventListener('click',()=>clicks++,{once:true});
   const input={plan:state.populatePlan,capture:state.editing,activeTransaction:state.active,runContext:state.context,scanState:state.fixture.scanState,profile};
   const issued=api.createInternshipSemanticContext(input);const before=!!issued;
   if(mode==='profile')profile.internships[1].organization='虚构手改单位';
   if(mode==='reorder')profile.internships.reverse();
   if(mode==='replace')fields[0].replaceWith(fields[0].cloneNode(true));
   if(mode==='stop')state.context.stop();
   if(mode==='radio-outside')document.body.append(other);
   if(mode==='radio-hidden'){const extra=Object.assign(document.createElement('input'),{type:'radio',name:'current-proof',checked:true,hidden:true});state.fixture.editor.append(extra);}
   if(mode==='radio-shadow'){const host=document.createElement('div');document.body.append(host);host.attachShadow({mode:'open'}).append(other);}
   if(mode==='consume')await api.bindRecordEditor({...input,provideValue:()=> '虚构填写值',rescan:()=>state.context.capture(state.fixture.source)});
   const selected=mode==='copy'&&issued?structuredClone(issued):issued;
   const current=selected?api.internshipSemanticContextCurrent(selected,state.fixture.scanState.result,profile,[]):false;
   const values=['organization','department','description'].map((key,index)=>selected?api.resolveCurrentInternshipField(selected,state.fixture.scanState.result,profile,state.fixture.scanState.result.fields[Math.min(index,fields.length-1)].id,'internships.'+key):undefined);
   const expected=api.internshipSessionProfile.internships[1];
   state.context.stop();return {before,current,public:issued?JSON.stringify(issued):undefined,values,expected:[expected.organization,expected.department,expected.description],empty:radio ? !fields[0].checked && !other.checked && fields[0].value==='proof-yes' && other.value==='proof-no' : fields.every(field=>!field.value),clicks};
  },mode);
  assert.equal(result.before,mode!=='foreign-profile',mode);assert.equal(result.current,['current','missing'].includes(mode),mode);
  if(result.before)assert.equal(result.public,'{"recordType":"internship"}',mode);
  if(mode==='current')assert.deepEqual(result.values.map(value=>value.value),result.expected);
  else if(mode==='missing')assert.equal(result.values[1].reason,'profile-value-missing');
  else assert.ok(result.values.every(value=>value===undefined),mode);
  assert.equal(result.empty,mode!=='consume',mode);assert.equal(result.clicks,0,mode);
  report.checks.push(mode+': private current-entry context, original capabilities and complete native ownership; no Save or model transport');
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.passed=true;
 console.info('Internship semantic context Chromium checks passed ('+report.checks.length+' checks)');
}catch(error){report.failure=error.stack??String(error);throw error;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(artifacts,'internship-semantic-context-e2e.json'),JSON.stringify(report,null,2));await browser?.close();}
