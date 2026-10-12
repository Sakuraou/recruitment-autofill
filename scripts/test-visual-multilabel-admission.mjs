import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'multilabel-admission.ts', loader: 'ts', contents: `
import {scanDocument} from './src/content/scanner';
import {AgentPageLease} from './src/agent/pageLease';
import {SemanticCropAdmission} from './src/visual/semanticCropAdmission';
import {SemanticRedactionPipeline} from './src/visual/semanticRedactionPipeline';
import {controlLabels} from './src/content/domUtils';
window.multiAdmissionProbe=(mode)=>{
 const node=document.querySelector('input'), labels=[...node.labels];let time=10;
 if(mode==='private')labels[1].textContent='本机虚构姓名';
 if(mode==='split-private'){labels[0].textContent='本机虚构';labels[1].textContent='资料别称'}
 if(mode==='nested')labels[1].innerHTML='<span>附加问题甲</span>';
 if(mode==='outline')labels[1].style.textShadow='-20px 0 4px red';
 const scan=scanDocument();
 const id=[...scan.controls].find(([,c])=>c.node===node)[0], lease=new AgentPageLease(()=>document.URL,()=>false),token=lease.begin();
 let checked='';const admission=new SemanticCropAdmission({lease,getScan:()=>scan,occupied:()=>false,privateFacts:()=>['本机虚构姓名','本机虚构资料别称'],clock:()=>time,
 labelPermission:mode==='private'||mode==='split-private'?undefined:(_token,_id,text)=>{checked=text;return text===controlLabels(node)},
 viewport:()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollX,scrollY,visualScale:1,offsetLeft:0,offsetTop:0})});
 const image={width:innerWidth,height:innerHeight,rgba:new Uint8ClampedArray(innerWidth*innerHeight*4).fill(255)};
 const proof=admission.issue(token,id);if(!proof)return {state:'no-proof',checked};
 if(mode==='proof-clone')return {state:admission.plan({...proof},{width:image.width,height:image.height}).state};
 if(mode==='label-replace')labels[1].replaceWith(labels[1].cloneNode(true));
 if(mode==='label-transient'){labels[1].textContent='更换问题';labels[1].textContent='附加问题甲'}
 if(mode==='before-stop')lease.end(token);
 const plan=admission.plan(proof,{width:image.width,height:image.height});if(plan.state!=='planned')return {state:'no-plan'};
 if(mode==='plan-clone')return {state:new SemanticRedactionPipeline(admission).redact({...plan},image).state};
 if(mode==='after-replace')labels[1].replaceWith(labels[1].cloneNode(true));
 if(mode==='after-add'){const label=document.createElement('label');label.htmlFor=node.id;label.textContent='附加问题丙';document.body.append(label)}
 if(mode==='after-move')labels[1].style.left='110px';
 if(mode==='after-stop')lease.end(token);
 if(mode==='expire')time=1011;
 const pipeline=new SemanticRedactionPipeline(admission), result=pipeline.redact(plan,image);
 if(result.state!=='redacted')return {state:result.state};
 let gapBlack=true, allLabels=true;
 for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){
  const inLabel=labels.some((_label,i)=>x>=13&&x<171&&y>=13+i*32&&y<35+i*32), offset=(y*result.width+x)*4;
  if(inLabel&&result.rgba[offset]!==255)allLabels=false;
  if(!inLabel&&[0,1,2].some(c=>result.rgba[offset+c]!==0))gapBlack=false;
  if(result.rgba[offset+3]!==255)gapBlack=false;
 }
 return {state:result.state,checked,count:plan.keeps.length,allLabels,gapBlack,replay:pipeline.redact(plan,image).state};
};` }, bundle: true, write: false, platform: 'browser', format: 'iife' });
const report = { scope: 'Real scan/owner/multiple original labels, one-use plan and local pixel transform; no image send or model', checks: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: {width:1280,height:720} });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { report.externalRequests.push(route.request().url()); return route.abort(); }
    const count = new URL(route.request().url()).searchParams.get('count') ?? '2';
    const labels = Array.from({length:Number(count)},(_,i)=>`<label for="opaque" style="position:absolute;left:100px;top:${100+i*32}px;display:block;width:160px;height:24px;overflow:hidden;background:white;color:black">${i===0?'陌生问题甲':['附加问题甲','附加问题乙','附加问题丙','附加问题丁'][i-1]}</label>`).join('');
    return route.fulfill({ contentType:'text/html;charset=utf-8',body:`<!doctype html><form><section><h2>个人信息</h2>${labels}<input id="opaque" style="position:absolute;left:100px;top:${100+Number(count)*32+8}px;width:160px;height:24px"></section></form>` });
  });
  for (const [mode, count, expected] of [
    ['normal',2,'redacted'],['normal',4,'redacted'],['normal',5,'no-proof'],['private',2,'no-proof'],['split-private',2,'no-proof'],['nested',2,'no-proof'],['outline',2,'no-proof'],
    ['proof-clone',2,'rejected'],['plan-clone',2,'rejected'],['label-replace',2,'no-plan'],['label-transient',2,'no-plan'],['before-stop',2,'no-plan'],
    ['after-replace',2,'rejected'],['after-add',2,'rejected'],['after-move',2,'rejected'],['after-stop',2,'rejected'],['expire',2,'rejected'],
  ]) {
    await page.goto('http://127.0.0.1:8123/multilabel-admission?count=' + count); await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result = await page.evaluate(mode=>window.multiAdmissionProbe(mode),mode);
    assert.equal(result.state,expected,mode);
    if(expected==='redacted'){assert.equal(result.count,count);assert.ok(result.gapBlack&&result.allLabels);assert.equal(result.replay,'rejected');assert.equal(result.checked.split(' ').length,count);}
    report.checks.push({mode,count,result});
  }
  assert.deepEqual(report.externalRequests,[]); report.passed=true;
} catch(error){report.errors.push(String(error));throw error;}
finally{await browser.close();await writeFile(process.env.RA_VISUAL_ADMISSION_REPORT??'artifacts/i014c-multilabel-admission-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));
