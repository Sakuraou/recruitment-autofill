import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recordCandidates, relatedRecordChoices } from '../src/matching/recordCandidates';
import { createEmptyProfile } from '../src/profile/schema';
import { scanDocument } from '../src/content/scanner';
import { matchFields } from '../src/matching/ruleMatcher';
import { Results } from '../src/popup/Results';
import { PopupApp } from '../src/popup/App';
import { fillPlan, scanPage, type PagePlan } from '../src/popup/bridge';

vi.mock('../src/popup/bridge', async importOriginal => ({
  ...await importOriginal<typeof import('../src/popup/bridge')>(), scanPage: vi.fn(), fillPlan: vi.fn(), readSelection: vi.fn(),
}));
const profile = createEmptyProfile();
profile.projects = [
  { id: 'a', name: '虚构项目甲', description: '甲的原文', technologies: [] },
  { id: 'b', name: '虚构项目乙', description: '乙的原文', technologies: [] },
];
profile.education = [
  { id: 'm', level: '硕士研究生', school: '虚构硕士大学', major: '硕士专业' },
  { id: 'b', level: '本科', school: '虚构本科大学', major: '本科专业' },
];
let plan: PagePlan;
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<fieldset><legend>项目经历</legend><label>项目名称<input></label></fieldset>';
  const scan = scanDocument().result;
  plan = { tabId: 1, scan, profile, matches: matchFields(scan.fields, profile) };
  document.body.innerHTML = '';
  vi.mocked(scanPage).mockResolvedValue(plan);
  vi.mocked(fillPlan).mockResolvedValue([]);
});
afterEach(cleanup);

it('an unusable review result is marked manual and does not create an empty confirmation action', async () => {
  plan.matches = [{ ...plan.matches[0]!, matchedProfileKey: 'basic.politicalStatus', status: 'review', value: undefined, reason: '网站选项不对应' }];
  plan.scan.fields = [{ ...plan.scan.fields[0]!, label: '政治面貌', sectionText: '基本信息', kind: 'select', options: [] }];
  render(<PopupApp />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫描页面' })); });
  expect(screen.getByText('需手动填写')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /确认填写已勾选/ })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '我已核对这个候选' })).toBeNull();
});

it('groups only fields in the same editor and refuses repeated record properties', () => {
  document.body.innerHTML = '<fieldset><legend>项目经历</legend><label>项目名称<input></label><label>项目描述<textarea></textarea></label></fieldset><fieldset><legend>项目经历</legend><label>项目名称<input></label></fieldset>';
  const fields = scanDocument().result.fields;
  const candidates = new Map(fields.map(field => [field.id, recordCandidates(field, profile)]));
  expect(relatedRecordChoices(fields, candidates, fields[0]!.id, 'projects.1.name').map(item => item.value))
    .toEqual(['虚构项目乙', '乙的原文']);
  fields[2]!.groupId = fields[0]!.groupId;
  expect(relatedRecordChoices(fields, candidates, fields[0]!.id, 'projects.1.name')).toEqual([]);
  expect(relatedRecordChoices(fields, candidates, fields[0]!.id, 'projects.99.name')).toEqual([]);
});

it('applying a record to its group updates all candidates but does not write or pre-confirm', async () => {
  document.body.innerHTML = '<fieldset><legend>项目经历</legend><label>项目名称<input></label><label>项目描述<textarea></textarea></label></fieldset>';
  const scan = scanDocument().result;
  plan = { ...plan, scan, matches: matchFields(scan.fields, profile) };
  document.body.innerHTML = '';
  vi.mocked(scanPage).mockResolvedValue(plan);
  render(<PopupApp />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫描页面' })); });
  fireEvent.change(screen.getByRole('combobox', { name: '项目名称：选择档案经历' }), { target: { value: 'projects.1.name' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核对这个候选' }));
  fireEvent.click(screen.getByRole('button', { name: '同组使用这段经历（2 项，仍需核对）' }));
  expect((screen.getByRole('combobox', { name: '项目描述：选择档案经历' }) as HTMLSelectElement).value).toBe('projects.1.description');
  expect(screen.getAllByRole('checkbox', { name: '我已核对这个候选' }).every(item => !(item as HTMLInputElement).checked)).toBe(true);
  expect(fillPlan).not.toHaveBeenCalled();
});

it('provides original record choices without choosing the first or mutating the profile', () => {
  const before = JSON.stringify(profile);
  expect(plan.matches[0]).toMatchObject({ status: 'review', value: undefined });
  const choices = recordCandidates(plan.scan.fields[0]!, profile);
  expect(choices.map(choice => choice.match.value)).toEqual(['虚构项目甲', '虚构项目乙']);
  expect(choices[1]?.match).toMatchObject({ matchedProfileKey: 'projects.1.name', status: 'review', confidence: 0.85 });
  expect(JSON.stringify(profile)).toBe(before);
});

it('keeps explicit education stages and does not suggest the wrong degree', () => {
  const field = { ...plan.scan.fields[0]!, label: '专业名称', sectionText: '教育经历' };
  expect(recordCandidates(field, profile).map(choice => choice.match.value)).toEqual(['硕士专业', '本科专业']);
  expect(recordCandidates({ ...field, sectionText: '本科教育经历' }, profile)).toEqual([]);
  expect(matchFields([{ ...field, sectionText: '本科教育经历' }], profile)[0]?.value).toBe('本科专业');
});

it('preserves blocked, existing, length and option constraints when offering candidates', () => {
  const field = plan.scan.fields[0]!;
  expect(recordCandidates({ ...field, hasValue: true }, profile)).toEqual([]);
  expect(recordCandidates({ ...field, blockedReason: '隐藏字段' }, profile)).toEqual([]);
  expect(recordCandidates({ ...field, maxLength: 2 }, profile)).toEqual([]);
  expect(recordCandidates({ ...field, kind: 'select', options: [{ value: 'b', label: '虚构项目乙', disabled: false }] }, profile)
    .map(choice => choice.match.value)).toEqual(['b']);
});

it('shows an unselected dropdown and requires a separate confirmation after choosing', () => {
  const field = plan.scan.fields[0]!;
  const choose = vi.fn();
  render(<Results fields={plan.scan.fields} matches={plan.matches} selected={new Set()} reveal={false}
    outcomes={[]} busy={false} onSelect={vi.fn()} onChoose={choose}
    candidates={new Map([[field.id, recordCandidates(field, profile)]])} />);
  const select = screen.getByRole('combobox', { name: '项目名称：选择档案经历' }) as HTMLSelectElement;
  expect(select.value).toBe('');
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.change(select, { target: { value: 'projects.1.name' } });
  expect(choose).toHaveBeenCalledWith(field.id, 'projects.1.name');
});

it('popup uses the chosen original record and clears prior confirmation when the choice changes', async () => {
  render(<PopupApp />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫描页面' })); });
  const select = screen.getByRole('combobox', { name: '项目名称：选择档案经历' });
  fireEvent.change(select, { target: { value: 'projects.1.name' } });
  expect((screen.getByRole('button', { name: '一键填写高置信度字段' }) as HTMLButtonElement).disabled).toBe(true);
  const confirmation = screen.getByRole('checkbox', { name: '我已核对这个候选' });
  expect((confirmation as HTMLInputElement).checked).toBe(false);
  fireEvent.click(confirmation);
  fireEvent.change(select, { target: { value: 'projects.0.name' } });
  expect((confirmation as HTMLInputElement).checked).toBe(false);
  fireEvent.change(select, { target: { value: 'projects.1.name' } });
  fireEvent.click(confirmation);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认填写已勾选的 1 项' })); });
  const [sentPlan, selected, mode] = vi.mocked(fillPlan).mock.calls[0]!;
  expect(sentPlan.matches[0]).toMatchObject({ value: '虚构项目乙', matchedProfileKey: 'projects.1.name', status: 'review' });
  expect(selected.has(plan.matches[0]!.fieldId)).toBe(true);
  expect(mode).toBe('review');
});
