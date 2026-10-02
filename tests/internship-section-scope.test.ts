import { beforeEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { matchField } from '../src/matching/ruleMatcher';
import { createEmptyProfile } from '../src/profile/schema';
import { firstInternship } from './fixtures/internship-facts';

const prefix = '<label>未知前置字段<input></label>'.repeat(10);
function last(html: string) { document.body.innerHTML = html; return scanDocument(document).result.fields.at(-1)!; }
beforeEach(() => { document.body.innerHTML = ''; });
describe('长栏目内的普通字段归属', () => {
  it.each(['<h2>实习经历</h2>', '<h2>工作经历</h2>', ''])('标题超过相邻搜索距离仍读取自己的明确实习区域：%s', heading => {
    const control = last(`<section aria-label="${heading.includes('工作经历') ? '工作经历' : '实习经历'}">${heading}${prefix}<label>离职日期<input type="date"></label></section>`);
    const profile = createEmptyProfile(); profile.internships = [firstInternship];
    expect(control.sectionText).toMatch(/实习经历|工作经历/u);
    expect(matchField(control, profile)).toMatchObject({ status: 'auto', value: firstInternship.endDate });
  });
  it('没有 ARIA 的唯一直接栏目标题也可恢复归属', () => {
    expect(last(`<section><h2>实习经历</h2>${prefix}<label>工作描述<textarea></textarea></label></section>`).sectionText).toBe('实习经历');
  });
  it('相邻教育和项目栏目不抢走最后的实习字段', () => {
    const control = last(`<section><h2>教育经历</h2>${prefix}</section><section><h2>项目经历</h2>${prefix}</section><section><h2>实习经历</h2>${prefix}<label>企业性质<input></label></section>`);
    expect(control.sectionText).toBe('实习经历');
  });
  it.each(['<section><h2>未知业务区域</h2>', '<section>', '<section aria-label="未知业务区域">'])('嵌套未知边界不从外层实习借归属：%s', opening => {
    expect(last(`<section aria-label="实习经历"><h2>实习经历</h2>${opening}${prefix}<label>企业性质<input></label></section></section>`).sectionText).toBe('');
  });
  it.each(['<h2 hidden>实习经历</h2>', '<h2 aria-hidden="true">实习经历</h2>', '<h2>项目经历</h2><h2>实习经历</h2>',
    '<h2>未知业务区域</h2>', '<article><h3>实习经历</h3></article>'])('隐藏、冲突、未知或卡片标题不当成栏目证据：%s', heading => {
    expect(last(`<section>${heading}${prefix}<label>离职日期<input></label></section>`).sectionText).toBe('');
  });
  it('明确 ARIA 与直接标题冲突时不挑其中一个', () => {
    expect(last(`<section aria-label="项目经历"><h2>实习经历</h2>${prefix}<label>工作类型<input></label></section>`).sectionText).toBe('');
  });
});
