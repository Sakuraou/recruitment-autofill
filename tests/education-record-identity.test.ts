import { beforeEach, describe, expect, it } from 'vitest';
import { compareEducationCard, educationCardComparator } from '../src/content/educationRecordIdentity';
import { educationFillOrder } from '../src/profile/educationFillOrder';
import type { EducationProjectionEntry } from '../src/profile/educationProjection';
import { scanDocument } from '../src/content/scanner';

const bachelor: EducationProjectionEntry = { id: 'fictional-bachelor', level: '本科', school: '虚构青岚大学', major: '软件工程',
  startDate: '2020-09', endDate: '2024-06' };
const master: EducationProjectionEntry = { ...bachelor, id: 'fictional-master', level: '硕士研究生', major: '人工智能',
  startDate: '2024-09', endDate: '2027-06' };
function card(html: string): Element {
  document.body.innerHTML = `<article role="listitem">${html}<button type="button">编辑</button><button type="button">删除</button></article>`;
  return document.querySelector('article')!;
}
beforeEach(() => { document.body.innerHTML = ''; });
describe('页面内教育身份', () => {
  it.each([
    `<h3>${bachelor.school}</h3><p>学历：本科</p><p>专业：软件工程</p>`,
    `<dl><dt>学校</dt><dd>${bachelor.school}</dd><dt>学历</dt><dd>本科</dd><dt>专业</dt><dd>软件工程</dd></dl>`,
    `<table><tr><th>学校</th><td>${bachelor.school}</td></tr><tr><th>学历</th><td>本科</td></tr><tr><th>专业</th><td>软件工程</td></tr></table>`,
  ])('明确三布局学校与阶段来自同一卡片', html => {
    expect(compareEducationCard(card(html), bachelor)).toMatchObject({ verdict: 'same', provenance: 'rule' });
  });
  it('同校本科与硕士分别匹配，不能拿第一条充当所有条目', () => {
    const compare = educationCardComparator(card(`<h3>${master.school}</h3><p>学历：硕士研究生</p><p>专业：人工智能</p>`));
    expect(compare.ready).toBe(true); expect(compare.compare(master).verdict).toBe('same'); expect(compare.compare(bachelor).verdict).toBe('different');
    expect(JSON.stringify(compare.compare(master))).not.toMatch(/青岚|人工智能|2024|fictional/u);
  });
  it('相同学校但其他专业不可被相同阶段掩盖', () => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p>学历：本科</p><p>专业：其他专业</p>`), bachelor).verdict).toBe('different');
  });
  it('仅学校不授予相同身份；不同明确学校独立区分', () => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3>`), bachelor).verdict).toBe('insufficient');
    expect(compareEducationCard(card('<h3>另一所虚构大学</h3>'), bachelor).verdict).toBe('different');
  });
  it('无效源日期或倒置区间不能参与身份比较', () => {
    const element = card(`<h3>${bachelor.school}</h3><p>学历：本科</p>`);
    expect(compareEducationCard(element, { ...bachelor, startDate: '2020-02-30' }).verdict).toBe('insufficient');
    expect(compareEducationCard(element, { ...bachelor, startDate: '2025-09' }).verdict).toBe('insufficient');
  });
  it('完整同精度年月区间可核对，既不补日也不改原记录', () => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p>入学日期：2020.09</p><p>毕业日期：2024/06</p>`), bachelor).verdict).toBe('same');
    expect(bachelor.startDate).toBe('2020-09');
  });
  it('完整同精度日区间可核对，不同完整区间区分', () => {
    const record = { ...bachelor, startDate: '2020-09-01', endDate: '2024-06-30' };
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p>入学日期：2020/09/01</p><p>毕业日期：2024.06.30</p>`), record).verdict).toBe('same');
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p>入学日期：2019-09-01</p><p>毕业日期：2023-06-30</p>`), record).verdict).toBe('different');
  });
  it.each(['<p>入学日期：2020-09-01</p><p>毕业日期：2024-06-30</p>', '<p>入学日期：2020-02-30</p>',
    '<p>入学日期：2025-09</p><p>毕业日期：2024-06</p>', '<p>入学日期：2019-09</p>'])('不完整、混合精度或非法日期不能被阶段一致掩盖', dates => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p>学历：本科</p>${dates}`), bachelor).verdict).toBe('insufficient');
  });
  it.each(['hidden', 'aria-hidden="true"', 'inert', 'style="display:none"', 'style="text-overflow:ellipsis;overflow:hidden"'])('隐藏或截断的阶段不给第二证据：%s', attributes => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p ${attributes}>学历：本科</p>`), bachelor).verdict).toBe('insufficient');
  });
  it.each(['<input value="学历：本科">', '<textarea>学历：本科</textarea>', '<article><p>学历：本科</p></article>', '<form><p>学历：本科</p></form>', '<p>专业：软件…</p>'])('控件、嵌套、编辑内容或截断证据不使用', html => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3>${html}`), bachelor).verdict).toBe('insufficient');
  });
  it('主卡片在总申请表内仍可读取可见摘要，不读取其内部编辑表单', () => {
    document.body.innerHTML = `<form><article><h3>${bachelor.school}</h3><p>学历：本科</p></article></form>`;
    expect(compareEducationCard(document.querySelector('article')!, bachelor).verdict).toBe('same');
  });
  it.each(['contenteditable="true"', 'role="textbox"', 'role="button"', 'style="text-overflow:ellipsis;overflow:hidden"',
    'style="-webkit-line-clamp:2"'])('编辑或截断祖先内的段落不给第二证据：%s', attributes => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><div ${attributes}><p>学历：本科</p></div>`), bachelor).verdict).toBe('insufficient');
  });
  it('超出卡片读取上限的文本不把部分内容当成完整学校', () => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}${'<span></span>'.repeat(1001)}</h3><p>学历：本科</p>`), bachelor).verdict).toBe('insufficient');
  });
  it('超过卡片读取元素数量上限时拒绝，不扫描每一段重复文本', () => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3>${'<p>学历：本科</p>'.repeat(1001)}`), bachelor).verdict).toBe('insufficient');
  });
  it('冲突标签和多标题不退回其中一个值', () => {
    expect(educationCardComparator(card(`<h3>${bachelor.school}</h3><h3>另一个学校</h3><p>学历：本科</p>`)).ready).toBe(false);
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p>学历：本科</p><p>学历：硕士</p>`), bachelor).verdict).toBe('insufficient');
  });
  it('未知阶段或资料缺专业时不从卡片新写个人事实', () => {
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p>学历：未知</p>`), bachelor).verdict).toBe('insufficient');
    expect(compareEducationCard(card(`<h3>${bachelor.school}</h3><p>专业：软件工程</p>`), { ...bachelor, major: undefined }).verdict).toBe('insufficient');
  });
  it('明确进行中和起始月份共同核对；空日期或未确认状态不可推算至今', () => {
    const ongoing = { ...master, endDate: undefined, endDateFact: { state: 'ongoing', source: 'user', confirmed: true } as const };
    const element = card(`<h3>${master.school}</h3><p>入学日期：2024-09</p><p>毕业日期：至今</p>`);
    expect(compareEducationCard(element, ongoing).verdict).toBe('same');
    expect(compareEducationCard(element, { ...master, endDate: undefined }).verdict).toBe('insufficient');
    expect(compareEducationCard(element, { ...ongoing, endDateFact: { ...ongoing.endDateFact, confirmed: false } }).verdict).toBe('insufficient');
  });
  it('读取比较不点击按钮，也不把卡片事实放进共享语义图', () => {
    document.body.innerHTML = `<section aria-label="教育经历"><h2>教育经历</h2><div role="list"><article role="listitem"><h3>${bachelor.school}</h3><p>学历：本科</p><button type="button">编辑教育经历</button><button type="button">删除</button></article><button type="button">添加教育经历</button></div></section>`;
    let clicks = 0; document.body.addEventListener('click', () => clicks++);
    expect(compareEducationCard(document.querySelector('article')!, bachelor).verdict).toBe('same'); expect(clicks).toBe(0);
    expect(JSON.stringify(scanDocument(document).result)).not.toContain(bachelor.school);
  });
});
describe('独立教育填写顺序', () => {
  it('本科排在硕士前面且原资料保持硕士在前', () => {
    const records = [master, bachelor]; expect(educationFillOrder(records)).toEqual({ status: 'ready', indices: [1, 0] });
    expect(records.map(record => record.id)).toEqual([master.id, bachelor.id]);
  });
  it('同阶段保留源顺序，空列表保持空计划', () => {
    expect(educationFillOrder([bachelor, { ...bachelor, id: 'another' }])).toEqual({ status: 'ready', indices: [0, 1] });
    expect(educationFillOrder([])).toEqual({ status: 'ready', indices: [] });
  });
  it.each(['other', 'duplicate', 'missing-school'])('未知阶段、重复 ID 或缺学校拒绝顺序：%s', change => {
    const records = [master, { ...bachelor }];
    if (change === 'other') records[1]!.level = '其他'; if (change === 'duplicate') records[1]!.id = master.id;
    if (change === 'missing-school') records[1]!.school = undefined;
    expect(educationFillOrder(records).status).toBe('request-human');
  });
});
