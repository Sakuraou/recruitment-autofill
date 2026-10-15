import {afterEach,expect,it,vi} from 'vitest';
import {computedColorAlpha} from '../src/visual/computedColorAlpha';
afterEach(()=>vi.unstubAllGlobals());
it.each([
 ['rgb(255, 255, 255)',1],['rgba(1, 2, 3, 1)',1],['rgba(1, 2, 3, 0)',0],['rgba(1, 2, 3, .9999)',.9999],
 ['transparent',0],['oklch(0.95 0.02 220)',1],['oklab(0.95 0.02 0.02 / 100%)',1],
 ['lab(95 2 2 / 0)',0],['lch(20 10 30 / 99.99%)',.9999],['color(display-p3 .9 .9 .9)',1],
 ['color(srgb .9 .9 .9 / 1e-4)',.0001],['rgb(1 2 3 / 50%)',.5],
] as const)('reads exact computed alpha for %s', (color,alpha)=>{
 vi.stubGlobal('CSS',{supports:()=>true});const value=computedColorAlpha(color);
 if(alpha===0||alpha===1)expect(value).toBe(alpha);
 else {expect(value).toBeCloseTo(alpha,10);expect(value).not.toBe(0);expect(value).not.toBe(1);}
});
it.each(['oklch(.9 0 0 / none)','rgb(from red r g b)','color(--unknown .9 .9 .9)','lab(calc(95) 2 2)',
 'rgba(1,2,3,)','lab(95 2 2 / 1 / 1)','var(--private)','rgba(1,2,3,2)'])('rejects unresolved or unsupported color shape %s',color=>{
 vi.stubGlobal('CSS',{supports:()=>false});expect(computedColorAlpha(color)).toBeUndefined();
});
it('keeps modern unsupported browser colors unknown, including without CSS.supports',()=>{
 vi.stubGlobal('CSS',undefined);expect(computedColorAlpha('oklch(.9 0 0)')).toBeUndefined();
 vi.stubGlobal('CSS',{supports:()=>false});expect(computedColorAlpha('color(display-p3 .9 .9 .9)')).toBeUndefined();
});
