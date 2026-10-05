import { afterEach, expect, it } from 'vitest';
import { compareStudentWorkCard, studentWorkCardComparator } from '../src/content/studentWorkRecordIdentity';
import type { StudentWorkProjectionEntry } from '../src/profile/studentWorkProjection';
const record: StudentWorkProjectionEntry = { id: 'fictional-a', organization: '虚构学院', role: '辅导员助理',
  startDate: '2021-09-01', endDate: '2022-06-30' };
const entries = { organization: record.organization!, role: record.role!, startDate: record.startDate!, endDate: record.endDate! };
const captions = { organization: '组织团体名称', role: '担任职务', startDate: '开始日期', endDate: '结束日期' };
function text(values: Partial<typeof entries> = entries): string {
  return Object.entries(values).map(([key, value]) => '<p>' + captions[key as keyof typeof captions] + '：' + value + '</p>').join('');
}
function card(html: string): Element {
  document.body.innerHTML = '<article role="listitem">' + html + '<button>编辑</button><button>删除</button></article>';
  return document.querySelector('article')!;
}
afterEach(() => { document.body.innerHTML = ''; });
it.each([
  text(),
  '<dl>' + Object.entries(entries).map(([key, value]) => '<dt>' + captions[key as keyof typeof captions] + '</dt><dd>' + value + '</dd>').join('') + '</dl>',
  '<table>' + Object.entries(entries).map(([key, value]) => '<tr><th>' + captions[key as keyof typeof captions] + '</th><td>' + value + '</td></tr>').join('') + '</table>',
  '<p>Organization: 虚构学院</p><p>Role: 辅导员助理</p><p>Start date: 2021/09/01</p><p>End date: 2022.06.30</p>',
])('compares bounded visible full organization, role and term: %s', html => {
  const element = card(html);
  expect(compareStudentWorkCard(element, record).verdict).toBe('same');
  expect(studentWorkCardComparator(element).ready).toBe(true);
});
it('same organization with a different role is a separate record', () => {
  expect(compareStudentWorkCard(card(text()), { ...record, id: 'fictional-b', role: '就业办助理' }).verdict).toBe('different');
});
it('same role with a distinct nonoverlapping complete term is a separate record', () => {
  expect(compareStudentWorkCard(card(text()), { ...record, startDate: '2022-09-01', endDate: '2023-06-30' }).verdict).toBe('different');
});
it('different organization is a separate record with full term evidence', () => {
  expect(compareStudentWorkCard(card(text()), { ...record, organization: '虚构其他学院' }).verdict).toBe('different');
});
it.each([
  { startDate: '2021-09-02', endDate: '2022-06-30' },
  { startDate: '2021-09-01', endDate: '2022-07-01' },
  { startDate: '2022-06-30', endDate: '2023-06-30' },
])('overlapping changed term is a conflict, not permission to add: %j', dates => {
  expect(compareStudentWorkCard(card(text()), { ...record, ...dates }).verdict).toBe('insufficient');
});
it.each(['organization', 'role', 'startDate', 'endDate'] as const)('missing page %s cannot prove same or different', key => {
  const values = { ...entries }; delete (values as Partial<typeof entries>)[key];
  const element = card(text(values)); const comparator = studentWorkCardComparator(element);
  expect(comparator.ready).toBe(false);
  expect(comparator.compare(record).verdict).toBe('insufficient');
  expect(comparator.compare({ ...record, organization: '另一学院', role: '另一职务' }).verdict).toBe('insufficient');
});
it.each(['organization', 'role', 'startDate', 'endDate'] as const)('missing source %s cannot authorize duplicate decisions', key => {
  expect(compareStudentWorkCard(card(text()), { ...record, [key]: undefined }).verdict).toBe('insufficient');
});
it.each(['2021-09', '2021-02-30', '2021-9-1', '2021-09-01…', '尚未确认', ''])('untrusted page start %s never acquires a day', startDate => {
  const element = card(text({ ...entries, startDate }));
  expect(studentWorkCardComparator(element).ready).toBe(false);
  expect(compareStudentWorkCard(element, record).verdict).toBe('insufficient');
});
it('a reversed page term is invalid even if role differs', () => {
  expect(compareStudentWorkCard(card(text({ ...entries, startDate: '2023-01-01' })), { ...record, role: '另一职务' }).verdict).toBe('insufficient');
});
it.each(['无', '请选择', '虚构…', '未知', 'n/a'])('invalid organization %s is not identity', organization => {
  expect(compareStudentWorkCard(card(text({ ...entries, organization })), record).verdict).toBe('insufficient');
});
it('unconfirmed ending cannot reuse a stale source end', () => {
  expect(compareStudentWorkCard(card(text()), { ...record, endDateFact: { state: 'known', confirmed: false, source: 'user' } }).verdict).toBe('insufficient');
});
const ongoing = { ...record, endDate: undefined, endDateFact: { state: 'ongoing' as const, confirmed: true, source: 'user' as const } };
it('explicit ongoing identity retains start and does not synthesize today', () => {
  expect(compareStudentWorkCard(card(text({ ...entries, endDate: '至今' })), ongoing).verdict).toBe('same');
});
it('ongoing start conflict or known/ongoing mismatch is uncertain', () => {
  const element = card(text({ ...entries, endDate: '至今' }));
  expect(compareStudentWorkCard(element, { ...ongoing, startDate: '2021-10-01' }).verdict).toBe('insufficient');
  expect(compareStudentWorkCard(element, record).verdict).toBe('insufficient');
});
it.each([
  '<p hidden>担任职务：辅导员助理</p>', '<p style="display:none">担任职务：辅导员助理</p>',
  '<p style="text-overflow:ellipsis">担任职务：辅导员助理</p>',
  '<form><p>担任职务：辅导员助理</p></form>', '<div role="dialog"><p>担任职务：辅导员助理</p></div>',
  '<article><p>担任职务：辅导员助理</p></article>', '<p contenteditable>担任职务：辅导员助理</p>',
  '<input value="辅导员助理"><p>担任职务：<input value="辅导员助理"></p>',
])('hidden, clipped and nested editor identity is not evidence: %s', role => {
  const element = card(text({ organization: entries.organization, startDate: entries.startDate, endDate: entries.endDate }) + role);
  expect(studentWorkCardComparator(element).ready).toBe(false);
  expect(compareStudentWorkCard(element, record).verdict).toBe('insufficient');
});
it('conflicting visible labels cannot select one convenient value', () => {
  const element = card(text() + '<p>担任职务：就业办助理</p>');
  expect(studentWorkCardComparator(element).ready).toBe(false);
  expect(compareStudentWorkCard(element, record).verdict).toBe('insufficient');
});
it('a title alone never supplies organization or role authority', () => {
  expect(compareStudentWorkCard(card('<h3>虚构学院</h3>' + text({ role: entries.role, startDate: entries.startDate, endDate: entries.endDate })), record).verdict).toBe('insufficient');
});
it('does not erase punctuation from identity names', () => {
  expect(compareStudentWorkCard(card(text({ ...entries, organization: 'Ａ.Ｂ　学院' })), { ...record, organization: 'A.B 学院' }).verdict).toBe('same');
  expect(compareStudentWorkCard(card(text({ ...entries, organization: 'A.B 学院' })), { ...record, organization: 'AB 学院' }).verdict).toBe('different');
});
it('detached or oversized cards provide no identity', () => {
  const element = card(text()); element.remove();
  expect(studentWorkCardComparator(element).ready).toBe(false);
  expect(compareStudentWorkCard(card(text() + '<p>x</p>'.repeat(1001)), record).verdict).toBe('insufficient');
});
it('snapshot is private and immutable; next transaction must recapture changed DOM', () => {
  const element = card(text()); const snapshot = studentWorkCardComparator(element);
  element.querySelector('p')!.textContent = '组织团体名称：虚构变更学院';
  expect(snapshot.compare(record).verdict).toBe('same');
  expect(compareStudentWorkCard(element, record).verdict).toBe('different');
  expect(JSON.stringify(snapshot)).toBe('{"ready":true}');
  const verdict = snapshot.compare(record);
  expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(verdict)).toBe(true); expect(Object.isFrozen(verdict.signals)).toBe(true);
  expect(JSON.stringify(verdict)).not.toMatch(/虚构|辅导员|2021|fictional/u);
});
