import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { inflateSync } from 'node:zlib';

const dir = resolve(process.env.RA_VISUAL_TEST_DIST ?? 'artifacts/i014e-visual-reason-dist');
const reportPath = process.env.RA_VISUAL_TEST_REPORT ?? 'artifacts/i014e-visual-reason-installed-report.json';
const focused = process.env.RA_VISUAL_TEST_FOCUS === 'reasons';
const transparentSuite = process.env.RA_VISUAL_TEST_FOCUS === 'transparent';
const unclippedSuite = process.env.RA_VISUAL_TEST_FOCUS === 'unclipped';
const paintSuite = process.env.RA_VISUAL_TEST_FOCUS === 'paint';
const reviewSuite = process.env.RA_VISUAL_TEST_FOCUS === 'review';
const viewportSuite = process.env.RA_VISUAL_TEST_FOCUS === 'viewport';
const placeholderSuite = process.env.RA_VISUAL_TEST_FOCUS === 'placeholder';
const colorSuite = process.env.RA_VISUAL_TEST_FOCUS === 'color';
const report = { scope: 'Unmodified full MV3 popup/content/background; actual companion and compatible text, next-step and image providers; fictional upstream only', checks: [], errors: [], externalRequests: [], scenarios: [] };
await build({ entryPoints: ['src/companion/server.ts', 'src/companion/chatCompletionsProvider.ts', 'src/companion/agentProvider.ts'],
  outdir: 'artifacts/i014e-visual-reason-service', bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { createSemanticServer } = await import('../artifacts/i014e-visual-reason-service/server.js');
const { createChatCompletionsProvider, createVisualChatCompletionsProvider } = await import('../artifacts/i014e-visual-reason-service/chatCompletionsProvider.js');
const { createAgentProvider } = await import('../artifacts/i014e-visual-reason-service/agentProvider.js');
let activeMode = '', fixtureIslands;
function verifyLabelOnlyPng(data) {
  assert.ok(data.startsWith('data:image/png;base64,'));
  const png = Buffer.from(data.split(',')[1], 'base64');
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks = [];
  assert.equal(png[24], 8); assert.equal(png[25], 6);
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(chunks));
  assert.equal(rows.length, (width * 4 + 1) * height);
  assert.ok(width >= 160 && height > 24);
  const labelCount=['inline-multi','transparent-multi'].includes(activeMode)?2:1, labelHeight=activeMode==='inline-lines'?48:24;
  const islands = fixtureIslands ?? Array.from({length:labelCount},(_,i)=>({left:13,top:13+i*32,width:158,height:labelHeight-2}));
  const retained = Array(islands.length).fill(0);
  for (let y = 0; y < height; y++) {
    assert.equal(rows[y * (width * 4 + 1)], 0);
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4, [r, g, b, a] = rows.subarray(offset, offset + 4);
      assert.equal(a, 255);
      // The crop includes the existing 12px context margin; retain only the
      // fixture label's inward-rounded interior at (13,13), 158x22 pixels.
      const island=islands.findIndex(rect=>x>=rect.left&&x<rect.left+rect.width&&y>=rect.top&&y<rect.top+rect.height);
      if (island>=0) { if (r > 0) retained[island]++; }
      else assert.deepEqual([r, g, b], [0, 0, 0], `Only label pixels may survive at ${x},${y} in ${width}x${height}`);
    }
  }
  assert.ok(retained.every(count=>count>100), 'Every original label interior must actually be retained');
  report.pixelChecks = (report.pixelChecks ?? 0) + 1;
}
const requests = []; let hold = false, held = false, cancelled = 0, ignoreAbort = false, lateResponse;
const fetcher = async (url, options) => {
  assert.equal(url, 'https://fictional.invalid/v1/chat/completions');
  const body = JSON.parse(options.body), content = body.messages[1].content;
  assert.ok(!JSON.stringify(body).includes('本机虚构姓名')); assert.ok(!JSON.stringify(body).includes('CANDIDATEZXQ')); assert.ok(!JSON.stringify(body).includes('recruitment.profile'));
  const image = Array.isArray(content), request = JSON.parse(image ? content[0].text : content);
  if (image) {
    try { verifyLabelOnlyPng(content[1].image_url.url); }
    catch (error) { report.errors.push('PNG verification: ' + String(error)); throw error; }
  }
  requests.push(image ? 'visual' : request.tasks ? 'agent' : 'text');
  if(image&&activeMode==='provider-failure')return new Response('{}',{status:503});
  if(image&&activeMode==='invalid-model')return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({requestId:request.requestId,status:'mapped',bindings:[{ref:request.fields[0].ref,fingerprint:request.fields[0].fingerprint,path:'invented.private.answer',certainty:'certain',evidence:'label'}]})}}]}));
  if (image && hold) {
    held = true;
    return new Promise((resolve, reject) => {
      const field = request.fields[0];
      lateResponse = () => resolve(new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        requestId: request.requestId, status: 'mapped', bindings: [{ ref: field.ref, fingerprint: field.fingerprint, path: 'basic.name', certainty: 'certain', evidence: 'label' }],
      }) } }] })));
      const abort = () => { cancelled++; if (!ignoreAbort) reject(new DOMException('Cancelled', 'AbortError')); };
      if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
    });
  }
  let answer;
  if (request.tasks) answer = { requestId: request.requestId, status: 'act', ref: request.tasks[0].ref, reason: 'available-task' };
  else if (image) {
    assert.ok(content[1].image_url.url.startsWith('data:image/png;base64,'));
    const field = request.fields[0];
    answer = { requestId: request.requestId, status: 'mapped', bindings: [{ ref: field.ref, fingerprint: field.fingerprint,
      path: 'basic.name', certainty: 'certain', evidence: 'label' }] };
  } else answer = { requestId: request.requestId, status: 'unresolved', bindings: [] };
  return new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }] }));
};
const config = { baseUrl: 'https://fictional.invalid/v1', apiKey: 'fictional-only', model: 'fictional-vision', fetcher };
const server = createSemanticServer({ token: 'a'.repeat(64), provider: createChatCompletionsProvider(config), agentProvider: createAgentProvider(config), visualProvider: createVisualChatCompletionsProvider(config) });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(43127, '127.0.0.1', resolve); });
let context;
try {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--enable-unsafe-extension-debugging', '--enable-extension-target-discovery'] });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension://') || url.startsWith('http://127.0.0.1:43127/')) return route.continue();
    if (url.startsWith('http://127.0.0.1:8123/agent-visual')) {
      const mode = new URL(url).searchParams.get('mode'), count = mode === 'budget' ? 4 : mode?.endsWith('-batch') ? 3 : mode === 'mixed-layout' ? 2 : 1;
      const inputs = Array.from({ length: count }, (_, i) => {
        let text='陌生问题'+['甲','乙','丙','丁'][i];
        if(mode.startsWith('inline-'))text='<span>'+text+'</span>';
        if(mode==='inline-nested')text='<span><strong>陌生问题甲</strong></span>';
        if(mode==='inline-star')text='陌生问题甲<span aria-hidden="true" style="color:red">*</span>';
        if(mode==='inline-bold')text='<b>陌生问题甲</b><i>附加说明</i>';
        if(mode==='inline-lines')text='<span>陌生问题甲<br>附加说明</span>';
        if(mode==='transparent-nested')text='<span><strong>陌生问题甲</strong></span>';
        if(mode==='blocked-link')text='<a href="#help">陌生问题甲</a>';
        if(mode==='blocked-button')text='<button>陌生问题甲</button>';
        if(mode==='blocked-closed-shadow')text='<span>陌生问题甲</span>';
        if(mode==='blocked-fixed')text='<b style="position:fixed;left:100px;top:100px">陌生问题甲</b>';
        if(mode==='blocked-overflow')text='<b style="margin-left:300px">陌生问题甲</b>';
        if(mode==='blocked-background')text='<b style="background-image:linear-gradient(red,blue)">陌生问题甲</b>';
        if(mode==='blocked-pseudo')text='<b class="generated">陌生问题甲</b>';
        const height=mode==='inline-lines'?48:24;
        const unclipped=mode.startsWith('unclipped-'),translucent=mode.startsWith('transparent-')||unclipped;
        const second=['inline-multi','transparent-multi','unclipped-multi'].includes(mode)?`<label for="unknown${i}" style="display:block;margin-top:8px;${translucent?'margin-left:20px;':''}width:160px;height:24px;overflow:${unclipped?'visible':'hidden'};background:${translucent?'transparent':'white'};color:black"><span>附加问题甲</span></label>`:'';
        const block=translucent?'left:80px;top:'+String(80+i*180)+'px;width:220px;height:160px;background:white':'left:100px;top:'+String(100+i*100)+'px;width:200px;height:'+String(mode==='inline-multi'||mode==='inline-lines'?160:90)+'px';
        return `<div class="surface" style="position:absolute;${block}"><label style="display:block;${translucent?'margin-left:20px;margin-top:20px;':''}width:160px;height:${height}px;overflow:${unclipped?'visible':'hidden'};background:${translucent||mode==='mixed-layout'&&i===1?'transparent':'white'};color:black" for="unknown${i}">${text}</label>${second}<input style="display:block;margin-top:12px;${translucent?'margin-left:20px;':''}width:160px;height:24px" id="unknown${i}" ${mode==='existing'?'value="用户已填"':''} required></div>`;
      }).join('');
      const isImage = mode === 'own-image' || mode === 'decoration-image';
      const decorated = mode.startsWith('own-') || mode.startsWith('decoration-') || mode.startsWith('blocked-');
      const contained = mode.startsWith('decoration-') ? 'contain:paint;overflow:hidden;' : '';
      const mediaStyle = mode === 'blocked-visible' ? 'overflow:visible' : mode === 'blocked-margin' ? 'overflow:clip;overflow-clip-margin:600px' : mode === 'blocked-outline' ? 'outline:600px solid red' : '';
      const position = mode === 'blocked-overlap' ? 'left:100px;top:100px' : 'left:700px;top:20px';
      const decoration = decorated ? `<div class="decoration" style="position:absolute;${position};width:48px;height:48px;${contained}">${isImage ? '<img width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">' : `<svg xmlns="http://www.w3.org/2000/svg" style="${mediaStyle}" width="40" height="40"><circle cx="20" cy="20" r="15" fill="blue"/></svg>`}</div>` : '';
      const overlay=mode==='blocked-aria-overlay'||mode==='blocked-inert-overlay'?`<input ${mode==='blocked-aria-overlay'?'aria-hidden="true"':'inert'} style="position:absolute;left:100px;top:100px;width:150px;height:24px" value="已有私密信息">`:'';
      const pseudo=mode==='blocked-pseudo'?'<style>.generated::before{content:"其他文字"}</style>':'';
      const shadow=mode==='blocked-closed-shadow'?'<script>document.querySelector("label span").attachShadow({mode:"closed"}).innerHTML="<b>本机虚构姓名</b>"</script>':mode==='blocked-ancestor-shadow'?'<script>document.querySelector("section").attachShadow({mode:"closed"}).innerHTML="<slot></slot><b style=position:absolute;left:100px;top:100px>本机虚构姓名</b>"</script>':'';
      const paintFixture=mode.includes('-css-')?'<style id="fixture-rules">.surface{background-color:#ddeeff!important}label{color:black!important}</style><script>window.fixtureSheet=new CSSStyleSheet();window.fixtureSheet.replaceSync("label{letter-spacing:normal}");document.adoptedStyleSheets=[window.fixtureSheet];</script>':'';
      const backdrop=/^(?:transparent|unclipped)-/u.test(mode)?`<script>(()=>{const mode=${JSON.stringify(mode.replace(/^unclipped-/u,'transparent-'))},unclipped=${mode.startsWith('unclipped-')},panel=document.querySelector('.surface'),label=document.querySelector('label');
        if(unclipped&&mode==='transparent-inline'){label.style.display='inline';label.style.width='auto';label.style.height='auto';panel.style.padding='20px';panel.style.boxSizing='border-box';label.style.margin='0';document.querySelector('input').style.marginLeft='0';}
        if(unclipped&&mode==='transparent-inline-block')label.style.display='inline-block';
        if(unclipped&&mode==='transparent-nested')label.innerHTML='<span><strong>陌生问题甲</strong></span>';
        if(unclipped&&mode==='transparent-star')label.innerHTML='陌生问题甲<span aria-hidden="true" style="color:red">*</span>';
        if(unclipped&&mode==='transparent-lines'){label.innerHTML='<span>陌生问题甲<br>附加说明</span>';label.style.height='48px';}
        if(unclipped&&mode==='transparent-indent')label.style.textIndent='-100px';
        if(unclipped&&mode==='transparent-overflow')label.style.width='20px';
        if(unclipped&&mode==='transparent-long'){label.textContent='陌生问题ABCDEFGHIJKLMN';label.style.width='40px';label.style.whiteSpace='nowrap';}
        if(unclipped&&mode==='transparent-scroll')label.style.overflow='auto';
        if(mode==='transparent-tint')panel.style.backgroundColor='#ddeeff';
        if(mode==='transparent-body'){panel.style.backgroundColor='transparent';document.body.style.backgroundColor='white';document.body.style.minHeight='100vh';}
        if(mode==='transparent-grandparent'){const outer=document.createElement('div');outer.style.cssText='position:absolute;left:70px;top:70px;width:300px;height:220px;background:white';panel.before(outer);outer.append(panel);panel.style.left='10px';panel.style.top='10px';panel.style.backgroundColor='transparent';}
        if(mode==='transparent-no-backdrop')panel.style.backgroundColor='transparent';
        if(mode==='transparent-half-parent')panel.style.backgroundColor='rgba(255,255,255,.5)';
        if(mode==='transparent-half-label')label.style.backgroundColor='rgba(255,255,255,.5)';
        if(mode==='transparent-short')panel.style.width='120px';
        if(mode==='transparent-rounded')panel.style.borderRadius='24px';
        if(mode==='transparent-content-clip')panel.style.backgroundClip='content-box';
        if(mode==='transparent-unclipped')label.style.overflow='visible';
        if(mode==='transparent-overlay'){const input=document.createElement('input');input.value='已有私密信息';input.style.cssText='position:absolute;left:100px;top:100px;width:150px;height:24px';input.setAttribute('aria-hidden','true');document.body.append(input);}
        if(mode==='transparent-closed')panel.attachShadow({mode:'closed'}).innerHTML='<slot></slot><b>已有私密信息</b>';
        if(unclipped&&mode==='transparent-css-agent-batch')document.querySelector('#unknown0').addEventListener('input',()=>{const sheet=document.querySelector('#fixture-rules').sheet;sheet.insertRule('label[for="unknown1"]::before{content:"变更后的问题"}',sheet.cssRules.length)},{once:true});
        if(unclipped&&mode==='transparent-css-viewport-below')panel.style.top='1600px';
        if(unclipped&&mode==='transparent-css-viewport-right')panel.style.left='2000px';
        if(unclipped&&mode==='transparent-css-viewport-partial')panel.style.left='-30px';
        if(unclipped&&mode==='transparent-css-viewport-control'){panel.style.height='2000px';document.querySelector('input').style.marginTop='1500px';}
        if(unclipped&&mode==='transparent-css-viewport-wide')document.querySelector('input').style.width='2000px';
        if(unclipped&&mode.startsWith('transparent-placeholder-')){
          let input=document.querySelector('input');
          if(mode.endsWith('-textarea')||mode.endsWith('-margin')){const textarea=document.createElement('textarea');textarea.id=input.id;textarea.style.cssText=input.style.cssText;input.replaceWith(textarea);input=textarea;}
          input.placeholder=mode.endsWith('-private')||mode.endsWith('-textarea')?'CANDIDATEZXQ':'请输入内容';
          if(mode.endsWith('-margin')){input.style.overflow='clip';input.style.overflowClipMargin='200px';}
          const style=document.createElement('style');
          style.id='placeholder-rules';
          style.textContent=mode.endsWith('-shadow')?'input::placeholder,textarea::placeholder{text-shadow:0 -40px red}':mode.endsWith('-background')?'input::placeholder{background-image:linear-gradient(red,blue)}':mode.endsWith('-transform')?'input::placeholder{transform:translateY(-40px)}':mode.endsWith('-color')||mode.endsWith('-css-change')?'input::placeholder{color:#777}':'';
          if(style.textContent)document.head.append(style);
        }
        if(unclipped&&mode.startsWith('transparent-color-')){
          const colors={'transparent-color-oklch':'oklch(.95 .02 220)','transparent-color-oklab':'oklab(.95 .02 .02)','transparent-color-lab':'lab(95 2 2)','transparent-color-p3':'color(display-p3 .9 .9 .9)','transparent-color-half':'oklch(.95 .02 220 / .5)','transparent-color-p3-half':'color(display-p3 .9 .9 .9 / .5)','transparent-color-almost':'oklch(.95 .02 220 / .9999)'};
          if(colors[mode])label.style.backgroundColor=colors[mode];
          if(mode==='transparent-color-foreground')label.style.color='lch(20 10 30)';
          if(mode==='transparent-color-parent'){label.style.backgroundColor='oklch(.95 .02 220 / 0)';panel.style.backgroundColor='oklch(.95 .02 220)';}
          if(mode==='transparent-color-css-change'){const style=document.createElement('style');style.id='color-rules';style.textContent='label{background-color:oklch(.95 .02 220)!important}';document.head.append(style);}
        }
      })()</script>`:'';
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html>'+pseudo+paintFixture+'<form><section><h2 style="margin:0;height:24px">个人信息</h2>' + inputs + '</section></form>' + decoration +overlay+shadow+backdrop });
    }
    report.externalRequests.push(url); return route.abort();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  report.version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(report.version, JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8')).version);
  const cdp = await context.browser().newBrowserCDPSession();
  let seq = 0;
  async function scenario(mode, visual, mutate, action='agent') {
    activeMode = mode;
    hold = !!mutate; held = false; ignoreAbort = mode === 'late'; lateResponse = undefined;
    const start = requests.length, cancelledBefore = cancelled;
    await worker.evaluate(async ({enabled,placeholder}) => {
      const profile = { schemaVersion: 1, basic: { name: placeholder ? 'CANDIDATEZXQ' : '本机虚构姓名' }, education: [], research: { papers: [], patents: [] },
        projects: [], internships: [], studentWork: [], awards: [], certificates: [], skills: {}, commonAnswers: {}, family: [] };
      await chrome.storage.local.set({ 'recruitment.profile.v1': profile, 'recruitment.semantic.connection.v1': { protocol: 1, token: 'a'.repeat(64), enabled: true, userConfirmed: true } });
      if (enabled) await chrome.storage.local.set({ 'recruitment.visual.consent.v1': { version: 1, enabled: true, userConfirmed: true } });
      else await chrome.storage.local.remove('recruitment.visual.consent.v1');
    }, {enabled:visual,placeholder:mode.startsWith('unclipped-placeholder-')});
    const form = await context.newPage(); form.on('pageerror', error => report.errors.push(error.message));
    await form.goto('http://127.0.0.1:8123/agent-visual?mode=' + mode); await form.bringToFront();
    fixtureIslands=undefined;
    if(mode.startsWith('unclipped-'))fixtureIslands=await form.evaluate(()=>{
      // Observe the disposable fixture's original rectangles independently of
      // the model and extension; verify that no pixels outside them are sent.
      const input=document.querySelector('#unknown0'),labels=[...input.labels],rectangles=[input,...labels].map(node=>node.getBoundingClientRect());
      const left=Math.floor(Math.min(...rectangles.map(r=>r.left))-12),top=Math.floor(Math.min(...rectangles.map(r=>r.top))-12);
      return labels.map(label=>{const r=label.getBoundingClientRect();return {left:Math.ceil(r.left)+1-left,top:Math.ceil(r.top)+1-top,width:Math.floor(r.right)-Math.ceil(r.left)-2,height:Math.floor(r.bottom)-Math.ceil(r.top)-2};});
    });
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const tab = targetInfos.find(target => target.url === form.url()); assert.ok(tab);
    let popupTarget;
    for(let attempt=0;attempt<3&&!popupTarget;attempt++){
      // Some disposable headless windows lose their first action dispatch.
      // Retry only opening a missing popup, before any scan, model or fill.
      await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
      for (let i = 0; i < 50; i++) {
        popupTarget = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url === `chrome-extension://${id}/popup.html`);
        if (popupTarget) break; await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    assert.ok(popupTarget);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: false });
    const evaluate = expression => new Promise((resolve, reject) => {
      const requestId = ++seq;
      const handler = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message); if (message.id !== requestId) return;
        cdp.off('Target.receivedMessageFromTarget', handler);
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message))); else resolve(message.result.result.value);
      };
      cdp.on('Target.receivedMessageFromTarget', handler);
      void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }) }).catch(reject);
    });
    const wait = async expression => {
      for (let i = 0; i < 400; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw Error('UI wait failed: ' + expression + ' text=' + await evaluate('document.body.innerText'));
    };
    const click = text => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('button unavailable: '+${JSON.stringify(text)});button.click();return true})()`);
    await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='启动 Agent 连续填写'&&!b.disabled)");
    if (mode === 'blocked-api') {
      // Simulate an unavailable browser capability in this disposable content
      // world only; production code and all other native API checks are unchanged.
      await worker.evaluate(async formUrl => {
        // The action popup may be the current window; bind this fixture's exact
        // observed tab instead of assuming an active tab exists in that window.
        const tab = (await chrome.tabs.query({})).find(tab => tab.url === formUrl);
        if (!tab?.id) throw Error('test fixture tab is unavailable');
        const [result] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
          chrome.dom.openOrClosedShadowRoot = undefined; return typeof chrome.dom.openOrClosedShadowRoot;
        }});
        if (result.result !== 'undefined') throw Error('test capability unavailable simulation failed');
      }, form.url());
    }
    if(action==='standalone'||action==='review-fill'){
      await click('扫描页面');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='局部截图识别未知字段'&&!b.disabled)");
      await click('局部截图识别未知字段');
    }else await click('启动 Agent 连续填写');
    if (mutate) {
      for (let i = 0; i < 400 && !held; i++) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(held, 'visual upstream must be waiting before mutation');
      await mutate(form, click, worker);
    }
    await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='启动 Agent 连续填写'&&!b.disabled)");
    if(action==='review-fill'){
      const count=mode.endsWith('-batch')?3:1;
      await wait(`document.querySelector('.notice')?.textContent.includes('局部截图识别得到 ${count} 项候选')`);
      await form.evaluate(mode=>{
        const sheet=document.querySelector('#fixture-rules').sheet,label=document.querySelector('label');
        if(mode.endsWith('-post-rule'))sheet.insertRule('label::before{content:"变更后的问题"}',sheet.cssRules.length);
        if(mode.endsWith('-post-disabled'))sheet.disabled=true;
        if(mode.endsWith('-post-adopted')){const added=new CSSStyleSheet();added.replaceSync('label::before{content:"变更后的问题"}');document.adoptedStyleSheets.push(added);}
        if(mode.endsWith('-post-shadow'))document.querySelector('.surface').attachShadow({mode:'closed'}).innerHTML='<slot></slot><b>变更后的问题</b>';
        if(mode.endsWith('-post-replace'))label.replaceWith(label.cloneNode(true));
        if(mode.endsWith('-post-batch'))document.querySelector('#unknown0').addEventListener('input',()=>sheet.insertRule('label[for="unknown1"]::before{content:"变更后的问题"}',sheet.cssRules.length),{once:true});
      },mode);
      if(mode.endsWith('-post-manual'))await form.locator('#unknown0').fill('用户手改');
      await evaluate("(()=>{const labels=[...document.querySelectorAll('label')].filter(label=>label.textContent.includes('我已核对这个候选'));if(!labels.length)throw Error('candidate confirmation missing');for(const label of labels)label.querySelector('input').click();return true})()");
      await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='确认填写已勾选的 ${count} 项'&&!b.disabled)`);
      await click(`确认填写已勾选的 ${count} 项`);await wait("document.querySelector('.notice')?.textContent.startsWith('已填写 ')");
    }
    if (mutate) { for (let i = 0; i < 100 && cancelled === cancelledBefore; i++) await new Promise(resolve => setTimeout(resolve, 25)); assert.ok(cancelled > cancelledBefore); }
    if (mode === 'late') { assert.ok(lateResponse); lateResponse(); await new Promise(resolve => setTimeout(resolve, 250)); }
    const text = await evaluate('document.body.innerText'), values = await form.locator('input,textarea').evaluateAll(inputs => inputs.map(input => input.value));
    await cdp.send('Target.detachFromTarget', { sessionId }); await cdp.send('Target.closeTarget', { targetId: popupTarget.targetId });
    for (let i = 0; i < 100; i++) {
      if (!(await cdp.send('Target.getTargets')).targetInfos.some(target => target.targetId === popupTarget.targetId)) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await form.close(); await new Promise(resolve => setTimeout(resolve, 100));
    const result = { text, values, requests: requests.slice(start) }; report.scenarios.push({ mode, ...result }); return result;
  }
  if(colorSuite){
    for(const mode of ['unclipped-color-rgb','unclipped-color-oklch','unclipped-color-oklab','unclipped-color-lab','unclipped-color-p3','unclipped-color-foreground','unclipped-color-parent']){
      const result=await scenario(mode,true);assert.deepEqual(result.values,['本机虚构姓名']);assert.equal(result.requests.filter(kind=>kind==='visual').length,1);assert.ok(result.text.includes('本页可访问且支持的任务已核验完成'));
      report.checks.push(mode+' uses current label-only PNG with exact opaque or known parent alpha');
    }
    for(const mode of ['unclipped-color-half','unclipped-color-p3-half','unclipped-color-almost']){
      const result=await scenario(mode,true);assert.deepEqual(result.values,['']);assert.equal(result.requests.filter(kind=>kind==='visual').length,0);assert.ok(result.text.includes('标签布局暂不支持截图识别'));
      report.checks.push(mode+' cannot round a partial alpha into an opaque label proof');
    }
    const changed=await scenario('unclipped-color-css-change',true,async form=>{
      await form.evaluate(()=>document.querySelector('#color-rules').sheet.cssRules[0].style.setProperty('background-color','oklch(.95 .02 220 / .5)','important'));
    });assert.deepEqual(changed.values,['']);assert.equal(changed.requests.filter(kind=>kind==='visual').length,1);assert.ok(!changed.text.includes('本页可访问且支持的任务已核验完成'));
    report.checks.push('Modern color CSSOM changes during inference cancel the request and cannot apply its old local fact');
  }else if(placeholderSuite){
    for(const mode of ['unclipped-placeholder-default','unclipped-placeholder-private','unclipped-placeholder-textarea','unclipped-placeholder-color']){
      const result=await scenario(mode,true);assert.deepEqual(result.values,['CANDIDATEZXQ']);
      assert.equal(result.requests.filter(kind=>kind==='visual').length,1);assert.ok(result.text.includes('本页可访问且支持的任务已核验完成'));
      report.checks.push(mode+' keeps all control pixels black and reads its answer only from the local profile');
    }
    for(const mode of ['unclipped-placeholder-shadow','unclipped-placeholder-background','unclipped-placeholder-transform','unclipped-placeholder-margin']){
      const result=await scenario(mode,true);assert.ok(result.values.every(value=>value===''));assert.equal(result.requests.filter(kind=>kind==='visual').length,0);assert.ok(result.text.includes('标签布局暂不支持截图识别'));
      report.checks.push(mode+' refuses special placeholder paint without image inference or writes');
    }
    for(const mode of ['unclipped-placeholder-change','unclipped-placeholder-css-change']){
      const result=await scenario(mode,true,async form=>{
        await form.evaluate(mode=>{
          if(mode.endsWith('-css-change'))document.querySelector('#placeholder-rules').sheet.cssRules[0].style.setProperty('text-shadow','0 -40px red');
          else document.querySelector('input').placeholder='变更后的提示';
        },mode);
      });
      assert.deepEqual(result.values,['']);assert.equal(result.requests.filter(kind=>kind==='visual').length,1);assert.ok(!result.text.includes('本页可访问且支持的任务已核验完成'));
      report.checks.push(mode+' during inference cancels its request without copying a hint or late local fact');
    }
  }else if(viewportSuite){
    for(const mode of (process.env.RA_VISUAL_VIEWPORT_BASELINE==='1'?['unclipped-css-viewport-below']:['unclipped-css-viewport-below','unclipped-css-viewport-right','unclipped-css-viewport-partial','unclipped-css-viewport-control','unclipped-css-viewport-wide'])){
      for(const action of (process.env.RA_VISUAL_VIEWPORT_BASELINE==='1'?['agent']:['agent','standalone'])){
        const result=await scenario(mode,true,undefined,action);assert.deepEqual(result.values,['']);assert.equal(result.requests.filter(kind=>kind==='visual').length,0);
        assert.ok(result.text.includes('字段或标签不在截图范围内'),mode+' must show viewport cause');assert.ok(!result.text.includes('请检查本机服务及图片模型'));
        report.checks.push(mode+' in '+action+' reports outside-viewport with zero image inference and zero writes');
      }
    }
  }else if(reviewSuite){
    for(const mode of ['unclipped-css-post-normal','unclipped-css-post-normal-batch','unclipped-css-post-rule','unclipped-css-post-disabled','unclipped-css-post-adopted','unclipped-css-post-shadow','unclipped-css-post-replace','unclipped-css-post-manual','unclipped-css-post-batch']){
      const result=await scenario(mode,true,undefined,'review-fill');const expected=mode.endsWith('-post-normal')?['本机虚构姓名']:mode.endsWith('-normal-batch')?Array(3).fill('本机虚构姓名'):mode.endsWith('-post-batch')?['本机虚构姓名','','']:mode.endsWith('-post-manual')?['用户手改']:[''];
      assert.deepEqual(result.values,expected,mode);assert.equal(result.requests.filter(kind=>kind==='visual').length,expected.length);
      const filled=expected.filter(value=>value==='本机虚构姓名').length;assert.ok(result.text.includes('已填写 '+filled+' 项'));
      report.checks.push(mode+' uses original candidate paint at each confirmed native write and preserves existing values');
    }
    const batch=await scenario('unclipped-css-agent-batch',true);assert.deepEqual(batch.values,['本机虚构姓名','','']);assert.equal(batch.requests.filter(kind=>kind==='visual').length,3);assert.ok(!batch.text.includes('本页可访问且支持的任务已核验完成'));
    report.checks.push('Agent checks original candidate paint before each write after the previous native event and retains only the first verified value');
  }else if(paintSuite){
    const modes=process.env.RA_VISUAL_PAINT_BASELINE==='1'?['unclipped-css-rule']:['unclipped-css-rule','unclipped-css-disabled','unclipped-css-adopted','unclipped-css-replace','unclipped-css-property','unclipped-css-media'];
    for(const mode of modes){
      const result=await scenario(mode,true,async form=>{
        const records=await form.evaluate(async mode=>{
          const observer=new MutationObserver(()=>{});observer.observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
          const sheet=document.querySelector('#fixture-rules').sheet;
          if(mode.endsWith('-rule'))sheet.insertRule('label::before{content:"变更后的问题"}',sheet.cssRules.length);
          if(mode.endsWith('-disabled'))sheet.disabled=true;
          if(mode.endsWith('-adopted')){const added=new CSSStyleSheet();added.replaceSync('label::before{content:"变更后的问题"}');document.adoptedStyleSheets=[...document.adoptedStyleSheets,added];}
          if(mode.endsWith('-replace'))window.fixtureSheet.replaceSync('label::before{content:"变更后的问题"}');
          if(mode.endsWith('-property'))sheet.cssRules[1].style.setProperty('color','red','important');
          if(mode.endsWith('-media'))sheet.media.mediaText='not all';
          const records=observer.takeRecords().length;observer.disconnect();return records;
        },mode);assert.equal(records,0,'CSSOM fixture must not generate a DOM mutation');
        await new Promise(resolve=>setTimeout(resolve,750));assert.ok(lateResponse);lateResponse();
        if(process.env.RA_VISUAL_PAINT_BASELINE==='1'){
          await new Promise(resolve=>setTimeout(resolve,500));report.paintBaselineValues=await form.locator('input').evaluateAll(inputs=>inputs.map(input=>input.value));
        }
      });
      assert.deepEqual(result.values,['']);assert.equal(result.requests.filter(kind=>kind==='visual').length,1);assert.ok(!result.text.includes('本页可访问且支持的任务已核验完成'));
      report.checks.push(mode+' cancels the image request and rejects its late proposal despite zero DOM mutation');
    }
  }else if(transparentSuite||unclippedSuite){
    for(const mode of (unclippedSuite?['unclipped-block','unclipped-inline','unclipped-inline-block','unclipped-nested','unclipped-star','unclipped-lines','unclipped-multi']:['transparent-panel','transparent-tint','transparent-body','transparent-grandparent','transparent-nested','transparent-multi','transparent-unclipped'])){
      const result=await scenario(mode,true);assert.deepEqual(result.values,['本机虚构姓名']);assert.equal(result.requests.filter(kind=>kind==='visual').length,1);
      assert.ok(result.text.includes('本页可访问且支持的任务已核验完成'));report.checks.push(mode+' retains only original label PNG islands and fills the verified local fact');
    }
    for(const mode of (unclippedSuite?['unclipped-indent','unclipped-overflow','unclipped-long','unclipped-scroll','unclipped-no-backdrop','unclipped-overlay','unclipped-closed']:['transparent-no-backdrop','transparent-half-parent','transparent-half-label','transparent-short','transparent-rounded','transparent-content-clip','transparent-overlay','transparent-closed'])){
      const result=await scenario(mode,true);assert.equal(result.values[0],'');assert.equal(result.requests.filter(kind=>kind==='visual').length,0);
      if(mode.endsWith('-overlay'))assert.deepEqual(result.values.slice(1),['已有私密信息']);else assert.deepEqual(result.values,['']);
      assert.ok(result.text.includes(mode.endsWith('-closed')?'页面含暂不支持截图识别的组件':'标签布局暂不支持截图识别'));
      report.checks.push(mode+' is pending with no image or write and preserves existing pixels/values');
    }
    const standalone=await scenario(unclippedSuite?'unclipped-inline':'transparent-panel',true,undefined,'standalone');assert.deepEqual(standalone.values,['']);assert.equal(standalone.requests.filter(kind=>kind==='visual').length,1);
    assert.ok(standalone.text.includes('局部截图识别得到 1 项候选'));report.checks.push('Standalone transparent-label recognition remains review-only');
    for(const mode of ['change','transient','replace','shadow','stop','manual'].map(suffix=>(unclippedSuite?'unclipped-':'transparent-')+suffix)){
      const result=await scenario(mode,true,async(form,click)=>{
        if(mode.endsWith('-stop')){await click('停止 Agent');return;}
        if(mode.endsWith('-manual')){await form.locator('input').fill('用户手改');return;}
        await form.locator('.surface').evaluate((panel,mode)=>{
          if(mode.endsWith('-replace')){panel.replaceWith(panel.cloneNode(true));return;}
          if(mode.endsWith('-shadow')){panel.attachShadow({mode:'closed'}).innerHTML='<slot></slot><b>已有私密信息</b>';return;}
          const color=panel.style.backgroundColor;panel.style.backgroundColor='transparent';if(mode.endsWith('-transient'))panel.style.backgroundColor=color;
        },mode);
      });
      assert.deepEqual(result.values,[mode.endsWith('-manual')?'用户手改':'']);assert.ok(!result.text.includes('本页可访问且支持的任务已核验完成'));
      report.checks.push(mode+' while inference waits cancels upstream without a late write');
    }
  }else{
  if (!focused) {
  const disabled = await scenario('disabled', false);
  assert.deepEqual(disabled.values, ['']); assert.equal(disabled.requests.filter(kind => kind === 'visual').length, 0);
  assert.ok(disabled.text.includes('仍有待办')); report.checks.push('One explicit Agent intent without visual consent leaves an unresolved text field pending and sends no image');
  const normal = await scenario('normal', true);
  assert.deepEqual(normal.values, ['本机虚构姓名']); assert.equal(normal.requests.filter(kind => kind === 'visual').length, 1);
  assert.ok(normal.requests.indexOf('text') < normal.requests.indexOf('visual')); assert.ok(normal.text.includes('本页可访问且支持的任务已核验完成'));
  report.checks.push('Agent hands off its text owner, uses one redacted image after unresolved text, fills the verified local fact and freshly confirms completion');
  }
  for(const mode of (focused ? ['inline-span'] : ['own-svg','own-image','inline-span','inline-nested','inline-star','inline-bold','inline-lines','inline-multi'])){
    const value=await scenario(mode,true);assert.deepEqual(value.values,['本机虚构姓名']);assert.equal(value.requests.filter(kind=>kind==='visual').length,1);assert.ok(value.text.includes('本页可访问且支持的任务已核验完成'));report.checks.push('Actual '+mode+' outside the label has one current redacted PNG request, local fact fill and fresh completion');
  }
  for (const mode of (focused?['blocked-fixed','blocked-closed-shadow','blocked-api']:['blocked-link','blocked-button','blocked-fixed','blocked-overflow','blocked-background','blocked-pseudo','blocked-aria-overlay','blocked-inert-overlay','blocked-closed-shadow','blocked-ancestor-shadow','blocked-api'])) {
    const result = await scenario(mode, true);
    assert.equal(result.values[0], '');
    if(mode.endsWith('-overlay'))assert.deepEqual(result.values.slice(1),['已有私密信息']);else assert.deepEqual(result.values,['']);
    assert.equal(result.requests.filter(kind => kind === 'visual').length, 0);
    const reason=mode==='blocked-api'?'当前浏览器缺少截图所需的页面检查能力':mode==='blocked-closed-shadow'||mode==='blocked-ancestor-shadow'?'页面含暂不支持截图识别的组件':mode==='blocked-button'?'字段缺少可核验的本地识别范围':'标签布局暂不支持截图识别';
    assert.ok(result.text.includes(reason),mode+' must show its actual local cause');
    assert.ok(!result.text.includes('请检查本机服务及图片模型'),mode+' must not blame service/model');
    assert.ok(result.text.includes('仍有待办')); report.checks.push('Actual ' + mode + ' keeps the field pending with no image or write');
  }
  for(const mode of ['provider-failure','invalid-model']){
    const result=await scenario(mode,true);assert.deepEqual(result.values,['']);assert.equal(result.requests.filter(kind=>kind==='visual').length,1);
    assert.ok(result.text.includes(mode==='provider-failure'?'截图或图片识别未完成，请检查本机服务及图片模型':'模型结果无法核验，已保留待办'));
    report.checks.push('Actual '+mode+' distinguishes model/service failure from local page rejection');
  }
  const mixed=await scenario('mixed-layout',true);assert.deepEqual(mixed.values,['','']);assert.equal(mixed.requests.filter(kind=>kind==='visual').length,1);
  assert.ok(mixed.text.includes('标签布局暂不支持截图识别'));assert.ok(mixed.text.includes('（1项）'));
  report.checks.push('One identified candidate plus one unsupported label remains review-only and shows the exact pending count');
  for(const mode of ['blocked-fixed','blocked-api']){
    const result=await scenario(mode,true,undefined,'standalone');assert.deepEqual(result.values,['']);assert.equal(result.requests.filter(kind=>kind==='visual').length,0);
    assert.ok(result.text.includes('局部截图识别得到 0 项候选'));assert.ok(result.text.includes(mode==='blocked-api'?'当前浏览器缺少截图所需的页面检查能力':'标签布局暂不支持截图识别'));
    report.checks.push('Standalone screenshot button reports '+mode+' without image inference or fill');
  }
  if (!focused) {
  const existing = await scenario('existing', true);
  assert.deepEqual(existing.values, ['用户已填']); assert.equal(existing.requests.length, 0);
  report.checks.push('Already answered fields are preserved with zero model calls');
  const budget = await scenario('budget', true);
  assert.deepEqual(budget.values, ['本机虚构姓名', '本机虚构姓名', '本机虚构姓名', '']);
  assert.equal(budget.requests.filter(kind => kind === 'visual').length, 3); assert.ok(budget.text.includes('仍有待办')); assert.ok(budget.text.includes('1 个字段'));
  report.checks.push('Three image attempts share one Agent run; the fourth field remains pending after fresh observation without repeated screenshots');
  }
  for (const mode of (focused ? ['inline-attach-shadow'] : ['stop', 'late', 'replace', 'transient', 'manual', 'profile', 'consent','inline-child-replace','inline-child-transient','inline-child-move','inline-attach-shadow'])) {
    const result = await scenario(mode, true, async (form, click, worker) => {
      if (mode === 'stop' || mode === 'late') await click('停止 Agent');
      else if (mode === 'profile') await worker.evaluate(async () => { const data = await chrome.storage.local.get('recruitment.profile.v1'); data['recruitment.profile.v1'].basic.name = '修改后的档案'; await chrome.storage.local.set(data); });
      else if (mode === 'consent') await worker.evaluate(() => chrome.storage.local.remove('recruitment.visual.consent.v1'));
      else if (mode.startsWith('inline-')) await form.locator('label span').evaluate((span, mode) => {
        if(mode==='inline-attach-shadow'){span.attachShadow({mode:'closed'}).innerHTML='<b>本机虚构姓名</b>';return;}
        if(mode==='inline-child-replace'){span.replaceWith(span.cloneNode(true));return;}
        if(mode==='inline-child-move'){span.style.marginLeft='400px';return;}
        const text=span.textContent;span.textContent='已改动的问题';span.textContent=text;
      }, mode);
      else await form.locator('#unknown0').evaluate((input, mode) => {
        if (mode === 'replace') { input.replaceWith(input.cloneNode(true)); return; }
        input.value = '用户手改'; input.dispatchEvent(new Event('input', { bubbles: true }));
        if (mode === 'transient') { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
      }, mode);
    });
    assert.deepEqual(result.values, [mode === 'manual' ? '用户手改' : '']);
    assert.ok(!result.text.includes('本页可访问且支持的任务已核验完成'));
    report.checks.push(`Actual ${mode} during image wait cancels upstream and cannot apply a late local fact or claim completion`);
  }
  }
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []);
  report.requests = requests; report.passed = true; report.finishedAt = new Date().toISOString();
} catch (error) { report.errors.push(String(error)); throw error; }
finally {
  await context?.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({passed:report.passed,version:report.version,checks:report.checks.length,errors:report.errors}));
