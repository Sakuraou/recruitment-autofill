import { beforeEach, describe, expect, it } from 'vitest';
import { compareInternshipCard, internshipCardComparator } from '../src/content/internshipRecordIdentity';
import { internshipFillOrder } from '../src/profile/internshipFillOrder';
import { scanDocument } from '../src/content/scanner';
import { firstInternship, secondInternship } from './fixtures/internship-facts';
import type { InternshipProjectionEntry } from '../src/profile/internshipProjection';

const record = firstInternship;
function card(html: string): Element {
  document.body.innerHTML = `<article role="listitem">${html}<button type="button">编辑</button><button type="button">删除</button></article>`;
  return document.querySelector('article')!;
}
const heading = `<h3>${record.organization}</h3>`;
const role = `<p>岗位：${record.role}</p>`;
const dates = '<p>入职日期：2025-07-01</p><p>离职日期：2025-09-30</p>';
beforeEach(() => { document.body.innerHTML = ''; });
describe('可见实习记录身份', () => {
  it.each([record.role, '实习经历', '未标注公司'])('没有明确公司标签的标题 %s 不作为不同公司的证据', caption => {
    const element = card(`<h3>${caption}</h3>${role}${dates}`);
    expect(compareInternshipCard(element, record).verdict).toBe('insufficient');
    expect(internshipCardComparator(element).ready).toBe(false);
  });
  it('明确工作单位允许卡片以岗位作标题', () => {
    const element = card(`<h3>${record.role}</h3><p>工作单位：${record.organization}</p>${role}${dates}`);
    expect(compareInternshipCard(element, record).verdict).toBe('same');
  });
  it('完整可信集合中的公司标题可以独立区分另一条来源记录', () => {
    const element = card(`<h3>${secondInternship.organization}</h3><p>岗位：${secondInternship.role}</p>`);
    const comparator = internshipCardComparator(element, [record, secondInternship]);
    expect(comparator.ready).toBe(true);
    expect(comparator.compare(record)).toEqual({ verdict: 'different', signals: ['primary'], provenance: 'rule' });
    expect(comparator.compare(secondInternship).verdict).toBe('same');
    expect(compareInternshipCard(element, record).verdict).toBe('insufficient');
  });
  it.each(['另一公司', `${record.organization} / ${record.role}`, '实习经历'])('未核对公司标题 %s 不因来源集合完整就取得主证据', caption => {
    const comparator = internshipCardComparator(card(`<h3>${caption}</h3>${role}${dates}`), [record, secondInternship]);
    expect(comparator.ready).toBe(false); expect(comparator.compare(record).verdict).toBe('insufficient');
  });
  it('只有无上下文的公司标题不能对任意来源判不同，明确标签不受此限制', () => {
    const withoutContext = internshipCardComparator(card(`${heading}${role}`));
    expect(withoutContext.ready).toBe(false); expect(withoutContext.compare(record).verdict).toBe('insufficient');
    const explicit = internshipCardComparator(card(`<h3>实习经历</h3><p>工作单位：${record.organization}</p>${role}`));
    expect(explicit.ready).toBe(true); expect(explicit.compare(record).verdict).toBe('same');
  });
  it('公司原文同时是另一条岗位名时，未标注标题仍有歧义', () => {
    const source = [record, { ...secondInternship, role: record.organization }];
    const comparator = internshipCardComparator(card(`${heading}${role}`), source);
    expect(comparator.ready).toBe(false); expect(comparator.compare(record).verdict).toBe('insufficient');
    const explicit = internshipCardComparator(card(`${heading}<p>工作单位：${record.organization}</p>${role}`), source);
    expect(explicit.ready).toBe(true); expect(explicit.compare(record).verdict).toBe('same');
  });
  it('已核对的公司标题与明确单位冲突，不选其中一个', () => {
    const comparator = internshipCardComparator(card(`<h3>${secondInternship.organization}</h3><p>工作单位：${record.organization}</p>${role}`), [record, secondInternship]);
    expect(comparator.ready).toBe(false); expect(comparator.compare(record).verdict).toBe('insufficient');
  });
  it('集合公司证据与可见标题只保留于私有快照，源改动不会改写旧判断', () => {
    const source = [{ ...record }, { ...secondInternship }];
    const element = card(`${heading}${role}`); const comparator = internshipCardComparator(element, source);
    source[0]!.organization = '虚构变更公司'; element.querySelector('h3')!.textContent = '虚构变更公司';
    expect(comparator.compare(record).verdict).toBe('same');
    expect(internshipCardComparator(element, [record, secondInternship]).ready).toBe(false);
    expect(JSON.stringify(comparator)).not.toMatch(/云桥|实习生|2025|fictional/iu);
    expect(Object.isFrozen(comparator)).toBe(true);
  });
  it.each([null, {}, [null], [record, record], [{ ...record, organization: undefined }],
    [{ ...record, certifierContact: 'fictional-forbidden' }], Array.from({ length: 101 }, (_, index) => ({ ...record, id: 'fictional-' + index }))])('无效完整上下文不授权标题或明确公司：%j', source => {
    const comparator = internshipCardComparator(card(`${heading}<p>工作单位：${record.organization}</p>${role}`), source as unknown as InternshipProjectionEntry[]);
    expect(comparator.ready).toBe(false); expect(comparator.compare(record).verdict).toBe('insufficient');
  });
  it.each([`${heading}${role}`, `<dl><dt>工作单位</dt><dd>${record.organization}</dd><dt>职务</dt><dd>${record.role}</dd></dl>`,
    `<table><tr><th>实习公司</th><td>${record.organization}</td></tr><tr><th>实习岗位</th><td>${record.role}</td></tr></table>`])('三种布局同卡公司与岗位可以核对', html => {
    expect(compareInternshipCard(card(html), record)).toEqual({ verdict: 'same', signals: ['primary', 'secondary'], provenance: 'rule' });
  });
  it('可见定义和英文表头保持有限含义', () => {
    expect(compareInternshipCard(card(`<dl><dt>Employer</dt><dd>${record.organization}</dd><dt>Position</dt><dd>${record.role}</dd></dl>`), record).verdict).toBe('same');
  });
  it('公司不同是独立主证据；同公司只有名称不能判重复', () => {
    expect(compareInternshipCard(card(heading), record)).toEqual({ verdict: 'insufficient', signals: ['primary'], provenance: 'rule' });
    expect(compareInternshipCard(card(`<p>工作单位：${secondInternship.organization}</p>`), record)).toEqual({ verdict: 'different', signals: ['primary'], provenance: 'rule' });
  });
  it('同公司不同岗位可以区分，不把第一条用于全部经历', () => {
    const comparator = internshipCardComparator(card(`${heading}${role}`), [record]);
    expect(comparator.ready).toBe(true); expect(comparator.compare(record).verdict).toBe('same');
    expect(comparator.compare({ ...record, id: 'another', role: secondInternship.role }).verdict).toBe('different');
  });
  it('完整同公司日期区间不依赖岗位原文', () => {
    expect(compareInternshipCard(card(`${heading}${dates}`), { ...record, role: undefined }))
      .toEqual({ verdict: 'same', signals: ['primary', 'start-date', 'end-date'], provenance: 'rule' });
  });
  it('同公司同岗位但不同完整区间仍是不同实习', () => {
    expect(compareInternshipCard(card(`${heading}${role}<p>入职日期：2024-07-01</p><p>离职日期：2024-09-30</p>`), record).verdict).toBe('different');
  });
  it('岗位冲突不会被相同完整日期掩盖', () => {
    expect(compareInternshipCard(card(`${heading}<p>岗位：另一岗位</p>${dates}`), record).verdict).toBe('different');
  });
  it('公司可规范空白和全角，数字和名称标点不被删掉', () => {
    expect(compareInternshipCard(card('<h3>ＡＣＭＥ　Studio</h3><p>岗位：开发实习生</p>'), { id: 'fictional-ascii', organization: 'ACME Studio', role: '开发实习生' }).verdict).toBe('same');
    expect(compareInternshipCard(card('<p>工作单位：虚构 A.B 科技</p><p>岗位：开发实习生</p>'), { id: 'fictional-dot', organization: '虚构 AB 科技', role: '开发实习生' }).verdict).toBe('different');
  });
  it('日日期的点和斜杠分隔可以核对，但不补日期', () => {
    expect(compareInternshipCard(card(`${heading}<p>开始日期：2025.07.01</p><p>结束日期：2025/09/30</p>`), record).verdict).toBe('same');
    expect(record.startDate).toBe('2025-07-01');
  });
  it.each(['<p>入职日期：2025-07</p><p>离职日期：2025-09</p>', '<p>入职日期：2025-02-30</p>',
    '<p>入职日期：2026-01-01</p><p>离职日期：2025-09-30</p>', '<p>入职日期：2024-07-01</p>', '<p>离职日期：未知</p>'])('日期精度不足、非法、倒置或局部冲突不能被同岗位掩盖：%s', text => {
    expect(compareInternshipCard(card(`${heading}${role}${text}`), record).verdict).toBe('insufficient');
  });
  it('来源仅有月份也不能把网页完整日当成同一日期', () => {
    expect(compareInternshipCard(card(`${heading}${role}${dates}`), { ...record, startDate: '2025-07', endDate: '2025-09' }).verdict).toBe('insufficient');
  });
  it('网页明确岗位而源岗位未知，不依赖同公司日期忽略未知', () => {
    expect(compareInternshipCard(card(`${heading}${role}${dates}`), { ...record, role: undefined }).verdict).toBe('insufficient');
  });
  it('工作描述和成果不作为公司之外的身份依据', () => {
    expect(compareInternshipCard(card(`${heading}<p>工作描述：${record.description}</p><p>工作业绩：${record.achievements}</p>`), record).verdict).toBe('insufficient');
  });
  it('已确认进行中和完整开始日期可核对，不把至今转换成今天', () => {
    const ongoing = { ...record, endDate: undefined, endDateFact: { state: 'ongoing', source: 'user', confirmed: true } as const };
    const element = card(`${heading}<p>开始日期：2025-07-01</p><p>结束日期：至今</p>`);
    expect(compareInternshipCard(element, ongoing).verdict).toBe('same');
    expect(compareInternshipCard(element, { ...record, endDate: undefined }).verdict).toBe('insufficient');
    expect(compareInternshipCard(element, record).verdict).toBe('insufficient');
  });
  it('进行中与已结束／无日期不同，不被岗位一致掩盖', () => {
    const ongoing = { ...record, endDate: undefined, endDateFact: { state: 'ongoing', source: 'user', confirmed: true } as const };
    expect(compareInternshipCard(card(`${heading}${role}${dates}`), ongoing).verdict).toBe('insufficient');
    expect(compareInternshipCard(card(`${heading}${role}`), ongoing).verdict).toBe('insufficient');
    expect(compareInternshipCard(card(`${heading}<p>开始日期：2025-07</p><p>结束日期：至今</p>`), { ...ongoing, startDate: '2025-07' }).verdict).toBe('insufficient');
  });
  it.each([{ state: 'unknown', source: 'user', confirmed: true }, { state: 'known', source: 'legacy', confirmed: true },
    { state: 'known', source: 'user', confirmed: false }] as const)('结束状态未经确认，不把残留日期当成已结束：%j', endDateFact => {
    expect(compareInternshipCard(card(`${heading}${role}${dates}`), { ...record, endDateFact }).verdict).toBe('insufficient');
  });
  it.each(['hidden', 'aria-hidden="true"', 'inert', 'style="display:none"', 'style="text-overflow:ellipsis;overflow:hidden"',
    'style="-webkit-line-clamp:2"'])('隐藏或截断岗位不给第二证据：%s', attributes => {
    expect(compareInternshipCard(card(`${heading}<div ${attributes}>${role}</div>`), record).verdict).toBe('insufficient');
  });
  it.each(['<input value="岗位：软件开发实习生">', '<textarea>岗位：软件开发实习生</textarea>',
    `<article>${role}</article>`, `<form>${role}</form>`, `<div role="dialog">${role}</div>`,
    `<div contenteditable="true">${role}</div>`, `<div role="textbox">${role}</div>`, '<p>岗位：软件开发…</p>'])('控件、草稿、别的卡片或截断文字不供身份：%s', text => {
    expect(compareInternshipCard(card(heading + text), record).verdict).toBe('insufficient');
  });
  it('外层网申总表不阻止读取自己的卡片，但内部编辑表单不供证据', () => {
    // Create the nested editor explicitly instead of relying on repaired nested-form HTML.
    document.body.innerHTML = `<form><article>${heading}${role}</article></form>`;
    const element = document.querySelector('article')!; const editor = document.createElement('form');
    editor.innerHTML = '<p>岗位：另一岗位</p>'; element.append(editor);
    expect(compareInternshipCard(element, record).verdict).toBe('same');
  });
  it('标题、公司或岗位证据冲突不挑某一个匹配', () => {
    expect(internshipCardComparator(card(`${heading}<h3>另一公司</h3>${role}`)).ready).toBe(false);
    expect(compareInternshipCard(card(`${heading}<p>工作单位：另一公司</p>${role}`), record).verdict).toBe('insufficient');
    expect(compareInternshipCard(card(`${heading}${role}<p>岗位：另一岗位</p>`), record).verdict).toBe('insufficient');
  });
  it.each(['未知', '暂无', '无', '否', '请选择', '虚构云桥…'])('公司身份不完整时不授权比较：%s', organization => {
    expect(compareInternshipCard(card(`${heading}${role}`), { ...record, organization }).verdict).toBe('insufficient');
  });
  it('缺公司、非法来源日历、倒置日期和外来字段均不比较', () => {
    const element = card(`${heading}${role}`);
    for (const altered of [{ ...record, organization: undefined }, { ...record, startDate: '2025-02-30' },
      { ...record, startDate: '2026-01-01' }, { ...record, certifierContact: 'fictional-forbidden' }])
      expect(compareInternshipCard(element, altered).verdict).toBe('insufficient');
  });
  it('单卡读取有界，过量元素或文本不能把前缀当完整公司', () => {
    expect(compareInternshipCard(card(`${heading}${role}${'<p>无关内容</p>'.repeat(1001)}`), record).verdict).toBe('insufficient');
    expect(compareInternshipCard(card(`<h3>${record.organization}${'<span></span>'.repeat(1001)}</h3>${role}`), record).verdict).toBe('insufficient');
  });
  it('不点击、不修改源、不在共享图或比较结果保留个人值', () => {
    const before = JSON.stringify(record);
    document.body.innerHTML = `<section aria-label="实习经历"><h2>实习经历</h2><div role="list"><article role="listitem">${heading}${role}<button type="button">编辑实习经历</button><button type="button">删除</button></article><button type="button">添加实习经历</button></div></section>`;
    let clicks = 0; document.body.addEventListener('click', () => clicks++, { once: true });
    const result = compareInternshipCard(document.querySelector('article')!, record);
    expect(result.verdict).toBe('same'); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.signals)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/云桥|实习生|2025|fictional/iu);
    expect(JSON.stringify(scanDocument(document).result)).not.toContain(record.organization);
    expect(clicks).toBe(0); expect(JSON.stringify(record)).toBe(before);
  });
  it('断开或隐藏的卡片不可比较', () => {
    const element = card(`${heading}${role}`); element.remove();
    expect(compareInternshipCard(element, record).verdict).toBe('insufficient');
    const hidden = card(`${heading}${role}`); hidden.setAttribute('hidden', '');
    expect(compareInternshipCard(hidden, record).verdict).toBe('insufficient');
  });
});
describe('实习完整集合的填写顺序', () => {
  it('保留源顺序而不按日期、公司或岗位排序，并冻结结果', () => {
    const source = [secondInternship, firstInternship]; const before = JSON.stringify(source);
    const result = internshipFillOrder(source); expect(result).toEqual({ status: 'ready', indices: [0, 1] });
    expect(Object.isFrozen(result)).toBe(true); if (result.status === 'ready') expect(Object.isFrozen(result.indices)).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('空集合为空计划，不能借项目或校内职务', () => {
    expect(internshipFillOrder([])).toEqual({ status: 'ready', indices: [] });
  });
  it.each([null, undefined, {}, [null], ['fictional'], [{ ...record, id: undefined }]])('运行时无效来源拒绝而非抛错：%j', source => {
    expect(internshipFillOrder(source as unknown as InternshipProjectionEntry[]))
      .toEqual({ status: 'request-human', reason: 'internship-record-invalid' });
  });
  it('公司加完整时间可作为没有岗位时的可验证身份', () => {
    expect(internshipFillOrder([{ ...record, role: undefined }])).toEqual({ status: 'ready', indices: [0] });
    expect(internshipFillOrder([{ ...record, role: undefined, endDate: undefined,
      endDateFact: { state: 'ongoing', source: 'user', confirmed: true } }])).toEqual({ status: 'ready', indices: [0] });
  });
  it.each(['duplicate', 'missing-company', 'missing-secondary', 'month-only', 'invalid-date', 'ongoing-unconfirmed', 'unknown-company', 'too-many'])('无效或无法核验的源列表拒绝顺序：%s', change => {
    let source = [{ ...record }, { ...secondInternship }]; const first = source[0]!;
    if (change === 'duplicate') source[1]!.id = first.id;
    if (change === 'missing-company') first.organization = undefined;
    if (change === 'missing-secondary') { first.role = undefined; first.endDate = undefined; }
    if (change === 'month-only') { first.role = undefined; first.startDate = '2025-07'; first.endDate = '2025-09'; }
    if (change === 'invalid-date') first.startDate = '2025-02-30';
    if (change === 'ongoing-unconfirmed') { first.role = undefined; first.endDate = undefined; first.endDateFact = { state: 'ongoing', source: 'user', confirmed: false }; }
    if (change === 'unknown-company') first.organization = '未知';
    if (change === 'too-many') source = Array.from({ length: 101 }, (_, index) => ({ ...record, id: 'fictional-' + index }));
    expect(internshipFillOrder(source).status).toBe('request-human');
  });
});
