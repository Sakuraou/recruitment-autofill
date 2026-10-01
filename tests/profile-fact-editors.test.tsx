import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CollectionEditor } from '../src/options/Editors';
import { collections } from '../src/options/fields';
import { createEmptyProfile, profileSchema, type UserProfile } from '../src/profile/schema';
import { updatePath } from '../src/shared/profilePaths';

afterEach(cleanup);
function Editor({ initial }: { initial: UserProfile }) {
  const [profile, setProfile] = useState(initial);
  return <><CollectionEditor profile={profile} spec={collections.projects!} onChange={(path, value) => setProfile(previous => updatePath(previous, path, value))} />
    <output data-testid="profile">{JSON.stringify(profile)}</output>
    <output data-testid="valid">{String(profileSchema.safeParse(profile).success)}</output></>;
}
const shown = () => JSON.parse(screen.getByTestId('profile').textContent!) as UserProfile;
it('用户可以明确没有；记录来源和确认时间，且不自动添加记录', () => {
  render(<Editor initial={createEmptyProfile()} />);
  expect((screen.getByLabelText('是否有项目经历') as HTMLSelectElement).value).toBe('unknown');
  fireEvent.change(screen.getByLabelText('是否有项目经历'), { target: { value: 'none' } });
  expect(shown().collectionFacts?.projects).toMatchObject({ state: 'none', source: 'user', confirmed: true });
  expect(shown().collectionFacts?.projects?.updatedAt).toMatch(/^\d{4}-/);
  expect(shown().projects).toEqual([]);
  expect(screen.getByTestId('valid').textContent).toBe('true');
});
it('已有资料选没有会产生明确冲突，但保留资料以供更正', () => {
  const initial = createEmptyProfile(); initial.projects = [{ id: 'p', name: '虚构项目', technologies: [] }];
  render(<Editor initial={initial} />);
  expect((screen.getByLabelText('是否有项目经历') as HTMLSelectElement).value).toBe('known');
  fireEvent.change(screen.getByLabelText('是否有项目经历'), { target: { value: 'none' } });
  expect(screen.getByTestId('valid').textContent).toBe('false');
  expect(shown().projects).toEqual(initial.projects);
  fireEvent.change(screen.getByLabelText('是否有项目经历'), { target: { value: 'known' } });
  expect(screen.getByTestId('valid').textContent).toBe('true');
});
it('主动新增解除旧的没有状态，删除空草稿不能推测没有', () => {
  const initial = createEmptyProfile(); initial.collectionFacts = { projects: { state: 'none', source: 'user', confirmed: true } };
  render(<Editor initial={initial} />);
  fireEvent.click(screen.getByRole('button', { name: '＋ 添加项目经历' }));
  expect(shown().collectionFacts?.projects).toMatchObject({ state: 'unknown', confirmed: false });
  expect(shown().projects).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '移除' }));
  expect(shown().projects).toEqual([]);
  expect((screen.getByLabelText('是否有项目经历') as HTMLSelectElement).value).toBe('unknown');
});
