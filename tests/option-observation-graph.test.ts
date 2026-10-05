import {afterEach,expect,it} from 'vitest';
import {scanDocument} from '../src/content/scanner';
afterEach(()=>{document.body.innerHTML='';});
it('a scanned choice field is represented once without a phantom unknown button task',()=>{
 document.body.innerHTML='<label for="c">性别</label><button id="c" type="button" role="combobox" aria-controls="l" aria-expanded="false">请选择</button><div id="l" role="listbox" hidden></div><button type="button" id="other">陌生操作</button>';
 const scan=scanDocument();expect(scan.result.fields).toHaveLength(1);
 const actions=scan.result.semanticGraph!.nodes.filter(node=>node.kind==='action');
 expect(actions).toHaveLength(1);expect(scan.semanticTargets.get(actions[0]!.id)).toBe(document.querySelector('#other'));
});
it.each(['submit','reset'] as const)('a %s button disguised as a choice remains an action',type=>{
 document.body.innerHTML=`<label for="c">性别</label><button id="c" type="${type}" role="combobox" aria-controls="l" aria-expanded="false">请选择</button><div id="l" role="listbox" hidden></div>`;
 const scan=scanDocument();expect(scan.result.semanticGraph!.nodes.filter(node=>node.kind==='action')).toHaveLength(1);
});
it.each(['a','button'] as const)('navigation and submission named %s controls remain restricted',tag=>{
 document.body.innerHTML=`<label for="c">性别</label><${tag} id="c" ${tag==='a'?'href="https://example.invalid"':'type="button"'} role="combobox" aria-controls="l" aria-expanded="false">提交</${tag}><div id="l" role="listbox" hidden></div>`;
 const scan=scanDocument();expect(scan.result.semanticGraph!.nodes.filter(node=>node.kind==='action')).toEqual([expect.objectContaining({action:'submit',risk:'restricted'})]);
});
