import { afterEach, expect, it } from 'vitest';
import { publicationCardComparator, publicationIdentityFactsReady } from '../src/content/publicationRecordIdentity';
import type { PublicationProjectionEntry } from '../src/profile/publicationProjection';
const paper: PublicationProjectionEntry = { id: 'paper-a', title: '虚构红外目标检测甲', doi: '10.1234/fictional-a',
  venue: 'Fictional Journal A', date: '2026-01-17', authorOrder: '第二作者', status: '已发表' };
function card(body: string) { document.body.innerHTML = '<article role="listitem">' + body + '</article>'; return document.querySelector('article')!; }
const full = () => `<h3>${paper.title}</h3><p>期刊名称：${paper.venue}</p><p>发表日期：${paper.date}</p><p>作者排序：${paper.authorOrder}</p>`;
afterEach(() => { document.body.innerHTML = ''; });
it('complete title and DOI establish a paper without inventing missing dates', () => {
  const current = { ...paper, date: undefined };
  expect(publicationIdentityFactsReady(current)).toBe(true);
  expect(publicationCardComparator(card(`<h3>${paper.title}</h3><p>DOI：${paper.doi}</p>`), [current]).compare(current).verdict).toBe('same');
});
it('DOI case and a visible doi.org URL normalize to the same explicit identifier', () => {
  expect(publicationCardComparator(card(`<p>论文名称：${paper.title}</p><p>DOI：https://doi.org/10.1234/FICTIONAL-A</p>`), [paper]).compare(paper).verdict).toBe('same');
});
it('full title, venue, date and author order can establish identity when no DOI is shown', () => {
  expect(publicationCardComparator(card(full()), [paper]).compare(paper).verdict).toBe('same');
});
it('definition lists and two-cell rows carry explicit private evidence', () => {
  for (const body of [`<dl><dt>论著名称</dt><dd>${paper.title}</dd><dt>DOI</dt><dd>${paper.doi}</dd></dl>`,
    `<table><tr><th>论文名称</th><td>${paper.title}</td></tr><tr><th>DOI</th><td>${paper.doi}</td></tr></table>`])
    expect(publicationCardComparator(card(body), [paper]).compare(paper).verdict).toBe('same');
});
it('same-titled papers in different venues remain independent records', () => {
  const other = { ...paper, id: 'paper-b', doi: undefined, venue: 'Fictional Journal B' };
  const reader = publicationCardComparator(card(full()), [paper, other]);
  expect(reader.compare(paper).verdict).toBe('same'); expect(reader.compare(other).verdict).toBe('different');
});
it('a different DOI prevents skipping another same-titled paper', () => {
  const other = { ...paper, id: 'paper-b', doi: '10.1234/fictional-b' };
  expect(publicationCardComparator(card(`<h3>${paper.title}</h3><p>DOI：${paper.doi}</p>`), [paper, other]).compare(other).verdict).toBe('different');
});
it('a differing author order is a conflict rather than another convenient identity', () => {
  expect(publicationCardComparator(card(full().replace('第二作者', '第一作者')), [paper]).compare(paper).verdict).toBe('insufficient');
});
it('the same DOI cannot override contradictory venue facts', () => {
  expect(publicationCardComparator(card(`<h3>${paper.title}</h3><p>DOI：${paper.doi}</p><p>期刊名称：其他刊物</p>`), [paper]).compare(paper).verdict).toBe('insufficient');
});
it('a venue-only contradiction is insufficient evidence to add another same-titled paper', () => {
  expect(publicationCardComparator(card(`<h3>${paper.title}</h3><p>期刊名称：其他刊物</p>`), [paper]).compare(paper).verdict).toBe('insufficient');
});
it.each(['发表状态', '成就/等级'])('the same DOI cannot ignore a conflicting known %s', caption => {
  expect(publicationCardComparator(card(`<h3>${paper.title}</h3><p>DOI：${paper.doi}</p><p>${caption}：在投</p>`), [paper]).compare(paper).verdict).toBe('insufficient');
});
it.each(['title', 'venue', 'date', 'order'])('incomplete %s-only metadata never skips a paper', mode => {
  const body = `<h3>${paper.title}</h3>` + (mode === 'venue' ? `<p>期刊名称：${paper.venue}</p>` :
    mode === 'date' ? `<p>发表日期：${paper.date}</p>` : mode === 'order' ? `<p>作者排序：${paper.authorOrder}</p>` : '');
  expect(publicationCardComparator(card(body), [paper]).compare(paper).verdict).toBe('insufficient');
});
it.each(['2026-01', '2026-02-30', '2026-01-17…'])('incomplete/invalid/clipped dates do not establish identity: %s', date => {
  expect(publicationCardComparator(card(full().replace(paper.date!, date)), [paper]).compare(paper).verdict).toBe('insufficient');
});
it('invalid observed dates remain conflicting even alongside a correct DOI', () => {
  expect(publicationCardComparator(card(full().replace(paper.date!, '2026-02-30') + `<p>DOI：${paper.doi}</p>`), [paper]).compare(paper).verdict).toBe('insufficient');
});
it('source needs sufficient identity before adding rather than finding out after Save', () => {
  expect(publicationIdentityFactsReady({ id: 'b', title: '论文乙', status: '在投' })).toBe(false);
  expect(publicationIdentityFactsReady({ ...paper, doi: undefined, date: '2026-01' })).toBe(false);
  expect(publicationIdentityFactsReady({ ...paper, doi: undefined })).toBe(true);
});
it.each(['bad-doi', 'missing-title', 'invalid-date', 'duplicate-id'])('rejects malformed source %s', mode => {
  const source = { ...paper };
  if (mode === 'bad-doi') source.doi = 'not-a-doi';
  if (mode === 'missing-title') source.title = '';
  if (mode === 'invalid-date') source.date = '2026-02-30';
  const records = mode === 'duplicate-id' ? [source, source] : [source];
  expect(publicationCardComparator(card(full()), records).ready).toBe(false);
});
it('a venue heading cannot be mistaken for a title', () => {
  expect(publicationCardComparator(card(`<h3>${paper.venue}</h3><p>DOI：${paper.doi}</p>`), [paper]).ready).toBe(false);
});
it('contradictory title and heading or duplicate DOI evidence is unverified', () => {
  for (const body of [full() + '<p>论文名称：不同论文</p>', full() + `<p>DOI：${paper.doi}</p><p>DOI：10.1234/other</p>`])
    expect(publicationCardComparator(card(body), [paper]).compare(paper).verdict).toBe('insufficient');
});
it('hidden, detached, nested and editable text cannot complete missing identity', () => {
  const element = card(`<h3>${paper.title}</h3><article><p>DOI：${paper.doi}</p></article><form><p>DOI：${paper.doi}</p></form><p hidden>DOI：${paper.doi}</p>`);
  expect(publicationCardComparator(element, [paper]).compare(paper).verdict).toBe('insufficient');
  element.hidden = true; expect(publicationCardComparator(element, [paper]).ready).toBe(false);
  element.hidden = false; element.remove(); expect(publicationCardComparator(element, [paper]).ready).toBe(false);
});
it('CSS-clipped titles cannot become identity', () => {
  expect(publicationCardComparator(card(full().replace('<h3>', '<h3 style="text-overflow:ellipsis">')), [paper]).ready).toBe(false);
});
it('comparison results are frozen and contain no source or observed values', () => {
  const result = publicationCardComparator(card(full()), [paper]).compare(paper);
  for (const value of [paper.title, paper.venue, paper.date, paper.authorOrder, paper.doi]) expect(JSON.stringify(result)).not.toContain(value);
  expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.signals)).toBe(true);
});
