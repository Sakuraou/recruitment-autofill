import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { resolvePublicationField } from '../src/matching/publicationFieldResolver';
import type { PublicationProjectionEntry } from '../src/profile/publicationProjection';

const paper: PublicationProjectionEntry = { id: 'fictional-paper', title: '虚构红外目标检测方法',
  abstract: '研究红外小目标的轻量化检测方法。', status: '已发表', date: '2026-01-17',
  authorOrder: '第二作者', publicationSituation: '发表于 Fictional Journal。', coauthors: '合著',
  authors: '虚构作者甲、虚构作者乙', venue: 'Fictional Journal', doi: '10.0000/fictional-paper' };
function field(html: string) {
  document.body.innerHTML = '<section><h2>专业论著</h2>' + html + '</section>';
  return scanDocument().result.fields[0]!;
}
afterEach(() => { document.body.innerHTML = ''; });

it.each([
  ['论著名称', 'title'], ['论文名称', 'title'], ['论文标题', 'title'], ['内容提要', 'abstract'],
  ['摘要', 'abstract'], ['成就/等级', 'status'], ['发表状态', 'status'], ['日期', 'date'],
  ['日期（没有则选当前日期）', 'date'], ['作者排序', 'authorOrder'],
  ['出版、登载获奖在学术会议上交流情况', 'publicationSituation'], ['合（独）著、译', 'coauthors'],
  ['作者', 'authors'], ['期刊名称', 'venue'], ['DOI', 'doi'], ['Publication title', 'title'],
] as const)('reads the current paper fact for %s', (label, key) => {
  expect(resolvePublicationField(field('<label>' + label + '<input></label>'), paper))
    .toMatchObject({ status: 'known', key: 'papers.' + key, value: paper[key] });
});
it('each paper keeps its own status, order and abstract', () => {
  const other = { ...paper, id: 'paper-b', status: '在投', authorOrder: '第三作者', abstract: '研究乙方法。' };
  for (const [label, key] of [['发表状态', 'status'], ['作者排序', 'authorOrder'], ['摘要', 'abstract']] as const)
    expect(resolvePublicationField(field('<label>' + label + '<input></label>'), other))
      .toMatchObject({ status: 'known', value: other[key] });
});
it.each(['项目名称', '奖励名称', '专利名称', '是否有专业论著', '联系人姓名', '上传论文附件',
  '验证码', '授权声明', '论文日期/获奖日期', '未知问题'])('rejects unrelated or protected %s', label => {
  expect(resolvePublicationField(field('<label>' + label + '<input></label>'), paper).status).toBe('request-human');
});
it('machine IDs never override the visible current-paper label', () => {
  expect(resolvePublicationField(field('<label>作者排序<input name="BasicName"></label>'), paper))
    .toMatchObject({ status: 'known', value: '第二作者' });
});
it('conflicting primary labels reject even when the machine ID looks useful', () => {
  expect(resolvePublicationField(field('<label>摘要<input aria-label="作者排序" name="Abstract"></label>'), paper))
    .toEqual({ status: 'request-human', reason: 'field-semantic-ambiguous' });
});
it('unknown primary labels cannot borrow meaning from a placeholder', () => {
  expect(resolvePublicationField(field('<label>未知问题<input placeholder="论文名称"></label>'), paper).status).toBe('request-human');
});
it('missing dates stay missing even when the website suggests today', () => {
  expect(resolvePublicationField(field('<label>日期（没有则选当前日期）<input type="date"></label>'), { ...paper, date: undefined }))
    .toEqual({ status: 'request-human', reason: 'profile-value-missing' });
});
it('missing abstract is not replaced with internal notes or the title', () => {
  expect(resolvePublicationField(field('<label>内容提要<textarea></textarea></label>'), { ...paper, abstract: undefined, description: '内部备注' }))
    .toEqual({ status: 'request-human', reason: 'profile-value-missing' });
});
it('honors native date precision and rejects invalid calendar dates', () => {
  expect(resolvePublicationField(field('<label>日期<input type="month"></label>'), paper)).toMatchObject({ value: '2026-01' });
  expect(resolvePublicationField(field('<label>日期<input type="date"></label>'), { ...paper, date: '2026-01' }))
    .toEqual({ status: 'request-human', reason: 'profile-date-precision' });
  expect(resolvePublicationField(field('<label>日期<input></label>'), { ...paper, date: '2026-02-30' }))
    .toEqual({ status: 'request-human', reason: 'profile-value-invalid' });
});
it('never truncates factual abstracts or replaces them with unrelated text', () => {
  expect(resolvePublicationField(field('<label>内容提要<textarea maxlength="4"></textarea></label>'), paper))
    .toEqual({ status: 'request-human', reason: 'profile-value-too-long' });
});
it('matches visible author-order options with opaque values', () => {
  expect(resolvePublicationField(field('<label>作者排序<select><option value="">请选择</option><option value="opaque">第二作者</option></select></label>'), paper))
    .toMatchObject({ status: 'known', value: 'opaque' });
});
it.each([
  '<option value="第二作者">第一作者</option>', '<option disabled value="x">第二作者</option>',
  '<option value="a">第二作者</option><option value="b">第二作者</option>', '<option value="a">第二作者或第三作者</option>',
])('rejects absent, disabled, duplicate or combined visible options', options => {
  expect(resolvePublicationField(field('<label>作者排序<select><option value="">请选择</option>' + options + '</select></label>'), paper))
    .toEqual({ status: 'request-human', reason: 'field-options-unresolved' });
});
it.each(['readonly', 'disabled', 'type="file"', 'type="checkbox"', 'type="password"'])('rejects protected control %s', attr => {
  expect(resolvePublicationField(field('<label>论文名称<input ' + attr + '></label>'), paper).status).toBe('request-human');
});
it('resolution grants no write or replacement authority', () => {
  expect(resolvePublicationField(field('<label>论文名称<input value="网页已有值"></label>'), paper)).toMatchObject({ status: 'known', value: paper.title });
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('网页已有值');
});
