// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { absentShadowPaint, currentShadowPaintAbsent, isPainted } from '../src/visual/shadowPaint';
afterEach(()=>{vi.unstubAllGlobals();document.body.replaceChildren();});
function fixture(){document.body.innerHTML='<span>公开标签</span>';return document.querySelector('span')!;}
it.each(['unavailable','no-method','throws'])('keeps unavailable browser shadow inspection pending: %s',mode=>{
  const node=fixture();vi.stubGlobal('chrome',mode==='unavailable'?undefined:mode==='no-method'?{dom:{}}:{dom:{openOrClosedShadowRoot:()=>{throw Error('unavailable')}}});
  expect(absentShadowPaint(node)).toBe(false);expect(currentShadowPaintAbsent()).toBe(false);
});
it('does not infer absence from a null public shadowRoot',()=>{
  const node=fixture(),root=node.attachShadow({mode:'closed'});expect(node.shadowRoot).toBeNull();
  vi.stubGlobal('chrome',{dom:{openOrClosedShadowRoot:(element:HTMLElement)=>element===node?root:null}});
  expect(absentShadowPaint(node)).toBe(false);expect(currentShadowPaintAbsent()).toBe(false);
});
it('admits only a native null answer, without returning any root content',()=>{
  const node=fixture(),inspect=vi.fn(()=>null);vi.stubGlobal('chrome',{dom:{openOrClosedShadowRoot:inspect}});
  expect(absentShadowPaint(node)).toBe(true);expect(inspect).toHaveBeenCalledWith(node);
  expect(currentShadowPaintAbsent()).toBe(true);
});
it.each([undefined,{},false])('rejects malformed native absence result %s',value=>{
  const node=fixture();vi.stubGlobal('chrome',{dom:{openOrClosedShadowRoot:()=>value}});expect(absentShadowPaint(node)).toBe(false);
});
it('rechecks a closed root attached after admission even without a light DOM mutation',()=>{
  const node=fixture(),roots=new WeakMap();vi.stubGlobal('chrome',{dom:{openOrClosedShadowRoot:(element:HTMLElement)=>roots.get(element)??null}});
  expect(currentShadowPaintAbsent()).toBe(true);
  const observer=new MutationObserver(()=>{});observer.observe(document.body,{subtree:true,childList:true,attributes:true});
  roots.set(node,node.attachShadow({mode:'closed'}));
  expect(observer.takeRecords()).toEqual([]);observer.disconnect();expect(currentShadowPaintAbsent()).toBe(false);
});
it.each(['aria-hidden','inert'])('still checks visible pixels on %s content',mode=>{
  const node=fixture();if(mode==='aria-hidden')node.setAttribute('aria-hidden','true');else node.inert=true;
  const root=node.attachShadow({mode:'closed'});vi.stubGlobal('chrome',{dom:{openOrClosedShadowRoot:(element:HTMLElement)=>element===node?root:null}});
  expect(isPainted(node)).toBe(true);expect(currentShadowPaintAbsent()).toBe(false);
});
it('does not mistake CSS-hidden shadow paint for visible paint',()=>{
  const node=fixture();node.style.display='none';const root=node.attachShadow({mode:'closed'});
  vi.stubGlobal('chrome',{dom:{openOrClosedShadowRoot:(element:HTMLElement)=>element===node?root:null}});
  expect(isPainted(node)).toBe(false);expect(currentShadowPaintAbsent()).toBe(true);
  node.style.display='inline';expect(currentShadowPaintAbsent()).toBe(false);
});
it('does not query internal native form-control roots as author shadow hosts',()=>{
  const input=document.createElement('input'),inspect=vi.fn(()=>{throw Error('must not query')});
  vi.stubGlobal('chrome',{dom:{openOrClosedShadowRoot:inspect}});expect(absentShadowPaint(input)).toBe(true);expect(inspect).not.toHaveBeenCalled();
});
