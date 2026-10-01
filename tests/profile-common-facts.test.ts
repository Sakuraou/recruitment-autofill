import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProfile, parseProfileJson, profileSchema } from '../src/profile/schema';
import { matchField } from '../src/matching/ruleMatcher';
import { scanDocument } from '../src/content/scanner';
import { getPath } from '../src/shared/profilePaths';
import { saveProfile } from '../src/profile/storage';
import { projectProfile } from '../src/profile/projection';
import { resolveProjectField } from '../src/matching/projectFieldResolver';

const raw = () => ({ ...createEmptyProfile(), basic: { englishName: 'Fictional User', healthStatus: '健康', maritalStatus: '未婚', heightCm: '175', weightKg: '65' },
  jobPreferences: { positions: ['研发岗'], cities: ['虚构城'], expectedSalary: '10000-15000元/月' },
  links: { github: 'https://github.com/fictional-example', portfolio: 'https://portfolio.example.test/', personalSite: 'https://home.example.test/' } });
function field(label: string, control = '<input>') {
  document.body.innerHTML = `<label>${label}${control}</label>`;
  return scanDocument().result.fields[0]!;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('常用档案事实、作品链接和修订号', () => {
  it('旧档案不自动添加新字段或默认值', () => {
    const old = createEmptyProfile(); expect(parseProfileJson(JSON.stringify(old))).toEqual(old);
    expect(getPath(old, 'revision')).toBeUndefined();
    for (const label of ['英文名', '健康状况', '身高（CM）', 'GitHub主页', '期望薪资']) expect(matchField(field(label), old).value).toBeUndefined();
  });
  it.each([
    ['英文名', 'basic.englishName', 'Fictional User'], ['英文姓名', 'basic.englishName', 'Fictional User'], ['健康状况', 'basic.healthStatus', '健康'],
    ['婚姻状况', 'basic.maritalStatus', '未婚'], ['身高（CM）', 'basic.heightCm', '175'], ['体重（KG）', 'basic.weightKg', '65'],
    ['期望岗位', 'jobPreferences.positions', '研发岗'], ['意向城市', 'jobPreferences.cities', '虚构城'],
    ['期望薪资', 'jobPreferences.expectedSalary', '10000-15000元/月'], ['GitHub主页', 'links.github', 'https://github.com/fictional-example'],
    ['作品展示链接', 'links.portfolio', 'https://portfolio.example.test/'], ['个人主页', 'links.personalSite', 'https://home.example.test/'],
  ])('只读取已保存的 %s', (label, key, value) => {
    const profile = parseProfileJson(JSON.stringify(raw()));
    expect(matchField(field(label), profile)).toMatchObject({ matchedProfileKey: key, value, status: 'auto' });
  });
  it.each(['English first name', 'English surname', '身高', '体重', 'Height (inches)', 'Weight (lb)', '紧急联系人英文名', '母亲健康状况'])('范围或单位不同不能用现有值代填 %s', label => {
    const profile = parseProfileJson(JSON.stringify(raw()));
    expect(matchField(field(label), profile).status).not.toBe('auto');
  });
  it('健康和婚姻仍须唯一可见选项，不能用内部 ID 或默认值', () => {
    const profile = parseProfileJson(JSON.stringify(raw()));
    expect(matchField(field('健康状况', '<select><option value="">请选择</option><option value="opaque">健康</option></select>'), profile)).toMatchObject({ value: 'opaque', status: 'auto' });
    expect(matchField(field('健康状况', '<select><option value="健康">其它状态</option></select>'), profile).value).toBeUndefined();
  });
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///C:/private.txt', 'https://user:password@example.test/', 'not a URL', 'https://exam\nple.test/'])('链接拒绝非网页协议、认证内容和非法 URL %s', url => {
    const value = raw(); value.links.github = url;
    const result = profileSchema.safeParse(value); expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.path.join('.'))).toContain('links.github');
  });
  it('个人主页不代替项目地址，项目投影只含该项目明确的 URL', () => {
    const profile = parseProfileJson(JSON.stringify({ ...raw(), projects: [{ id: 'p', name: '虚构项目', url: 'https://github.com/fictional-example/project', technologies: [] }] }));
    document.body.innerHTML = '<section><h2>项目经历</h2><label>项目链接<input type="url"></label></section>';
    const target = scanDocument().result.fields[0]!;
    const projection = projectProfile(profile);
    expect(resolveProjectField(target, projection.projects[0]!)).toMatchObject({ status: 'known', key: 'projects.url', value: 'https://github.com/fictional-example/project' });
    expect(JSON.stringify(projection)).not.toContain(String(getPath(profile, 'basic.englishName')));
    const noProjectUrl = { id: 'p', technologies: [] };
    expect(resolveProjectField(target, noProjectUrl).status).toBe('request-human');
  });
  it('同时刻连续保存生成不同且不含原值的修订号，导入旧号不复用', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-01T00:00:00Z');
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { runtime: { id: 'test' }, storage: { local: { setAccessLevel: vi.fn(), set } } });
    const profile = createEmptyProfile(); profile.basic.name = '虚构姓名';
    const first = await saveProfile(profile); const second = await saveProfile(first);
    expect(first.updatedAt).toBe(second.updatedAt);
    const firstRevision = getPath(first, 'revision'); const secondRevision = getPath(second, 'revision');
    expect(firstRevision).toMatch(/^[\da-f]{8}-[\da-f-]{27}$/i);
    expect(firstRevision).not.toBe(secondRevision);
    expect(projectProfile(second).profileRevision).toBe(secondRevision);
    expect(parseProfileJson(JSON.stringify(second))).toEqual(second);
    expect(String(secondRevision)).not.toContain('虚构姓名');
  });
  it('测量值不能存成带单位、负数或非法数字；明确零也不作为身高体重', () => {
    for (const value of ['175cm', '-1', '0', 'NaN', '1,75']) {
      const profile = raw(); profile.basic.heightCm = value;
      const result = profileSchema.safeParse(profile); expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map(issue => issue.path.join('.'))).toContain('basic.heightCm');
    }
  });
  it('已知英文名也不能填入学校或互相冲突的中英文姓名字段', () => {
    const profile = parseProfileJson(JSON.stringify({ ...raw(), basic: { ...raw().basic, name: '虚构中文名' } }));
    expect(matchField(field('学校英文名'), profile).status).not.toBe('auto');
    const target = field('姓名'); target.htmlId = 'EnglishName';
    expect(matchField(target, profile).value).toBeUndefined();
  });
});
