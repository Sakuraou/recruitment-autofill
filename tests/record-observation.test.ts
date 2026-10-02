import { beforeEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { recordEditorCoverageComplete, recordObservationMatches } from '../src/content/recordObservation';

function fixture() {
  document.body.innerHTML = '<section aria-label="项目经历"><h2>项目经历</h2><div role="list" aria-label="项目经历列表"><article role="listitem"><h3>虚构项目</h3><button type="button">编辑项目经历</button><button type="button">删除</button></article><form aria-label="新增项目经历编辑器"><label>项目名称<input></label><label>项目描述<textarea></textarea></label><button type="button">保存</button><button type="button">取消</button></form><button type="button">添加项目经历</button></div></section>';
  const scan = scanDocument(document);
  const list = scan.result.semanticGraph!.nodes.find(node => node.kind === 'record-list')!;
  expect(list).toBeDefined();
  return { scan, listId: list.id };
}
beforeEach(() => { document.body.innerHTML = ''; });
describe('记录观察新鲜度', () => {
  it('即使已归属子树未变，新出现的未归属可见字段仍使观察失效', () => {
    const { scan, listId } = fixture();
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<fieldset><legend>额外业务信息</legend><label>未知问题<input></label></fieldset>');
    const current = scanDocument(document);
    expect(recordEditorCoverageComplete(current, listId)).toBe(false);
    expect(recordObservationMatches(scan, current, listId)).toBe(false);
  });
  it('最高题不能越过项目或未识别栏目的边界归入编辑器', () => {
    const { listId } = fixture();
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<fieldset><legend>是否最高学位</legend><label><input type="radio" name="q">是</label><label><input type="radio" name="q">否</label></fieldset>');
    expect(recordEditorCoverageComplete(scanDocument(document), listId)).toBe(false);
  });
  it('新扫描的字段 ID 不同仍可验证同一观察', () => {
    const { scan, listId } = fixture();
    const fresh = scanDocument(document);
    expect(scan.result.scanId).not.toBe(fresh.result.scanId);
    expect(recordObservationMatches(scan, fresh, listId)).toBe(true);
  });
  it.each(['value', 'disabled', 'label', 'replace', 'remove', 'type'])('无 input 事件的字段变化仍令观察失效：%s', mode => {
    const { scan, listId } = fixture();
    const input = document.querySelector('input')!;
    if (mode === 'value') input.value = '用户保留答案';
    if (mode === 'disabled') input.disabled = true;
    if (mode === 'label') input.setAttribute('aria-label', '身份证号码');
    if (mode === 'replace') input.replaceWith(input.cloneNode(true));
    if (mode === 'remove') input.remove();
    if (mode === 'type') input.type = 'hidden';
    expect(recordObservationMatches(scan, scanDocument(document), listId)).toBe(false);
  });
  it('仅 bounds 变化不会将滚动误判为新记录', () => {
    const { scan, listId } = fixture();
    const fresh = scanDocument(document);
    for (const node of fresh.result.semanticGraph!.nodes) node.bounds = { x: 10, y: 40, width: 50, height: 20, coordinateSpace: 'viewport' };
    expect(recordObservationMatches(scan, fresh, listId)).toBe(true);
  });
});
