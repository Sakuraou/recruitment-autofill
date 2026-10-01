import { describe, expect, it } from 'vitest';
import { createEmptyProfile, parseProfileJson, profileSchema } from '../src/profile/schema';
import { matchField } from '../src/matching/ruleMatcher';
import { scanDocument } from '../src/content/scanner';
import { collectionPresence } from '../src/profile/facts';

function question(caption = '是否有项目经历', options = '<option value="">请选择</option><option value="opaque-yes">是</option><option value="opaque-no">否</option>') {
  document.body.innerHTML = `<label>${caption}<select>${options}</select></label>`;
  return scanDocument(document).result.fields[0]!;
}
const none = { state: 'none', source: 'user', confirmed: true, updatedAt: '2026-10-01T00:00:00.000Z' };

describe('集合事实状态与存在性问题', () => {
  it('旧 v1 空数组保持未知，不填否，不改变原备份', () => {
    const original = createEmptyProfile(); const loaded = parseProfileJson(JSON.stringify(original));
    expect(loaded).toEqual(original);
    const result = matchField(question(), loaded); expect(result.value).toBeUndefined(); expect(result.status).not.toBe('auto');
  });
  it('已有名称的项目是存在证据，自动回答有而非项目描述', () => {
    const profile = createEmptyProfile(); profile.projects = [{ id: 'p', name: '虚构项目', description: '这是说明', technologies: [] }];
    expect(matchField(question(), profile)).toMatchObject({ matchedProfileKey: 'collectionFacts.projects', value: 'opaque-yes', status: 'auto' });
  });
  it('仅空草稿 ID 不构成存在证据', () => {
    const profile = createEmptyProfile(); profile.projects = [{ id: 'p', technologies: [] }];
    expect(matchField(question(), profile).value).toBeUndefined();
  });
  it('用户明确没有才回答否，并无损保留来源、确认与时间', () => {
    const raw = { ...createEmptyProfile(), collectionFacts: { projects: none } };
    const profile = parseProfileJson(JSON.stringify(raw));
    expect(profile).toMatchObject(raw);
    expect(matchField(question(), profile)).toMatchObject({ value: 'opaque-no', status: 'auto' });
  });
  it.each([
    { ...none, confirmed: false }, { ...none, source: 'legacy' },
    { ...none, state: 'unknown' }, { ...none, state: 'not_applicable' },
  ])('没有可靠确认或不适用不等于否：%s', metadata => {
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(), collectionFacts: { projects: metadata } }));
    expect(matchField(question(), profile).value).toBeUndefined();
  });
  it('明确有经历但尚未录明细可以回答有，不能误报已填完', () => {
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(), collectionFacts: { projects: { ...none, state: 'known' } } }));
    expect(profile.projects).toEqual([]);
    expect(matchField(question(), profile)).toMatchObject({ value: 'opaque-yes', status: 'auto' });
  });
  it.each(['none', 'not_applicable'])('状态 %s 和已保存项目冲突时拒绝导入，不删除记录', state => {
    const raw = { ...createEmptyProfile(), projects: [{ id: 'p', name: '虚构项目', technologies: [] }], collectionFacts: { projects: { ...none, state } } };
    expect(profileSchema.safeParse(raw).success).toBe(false);
    expect(raw.projects[0]!.name).toBe('虚构项目');
  });
  it.each([
    '是否有项目经历/实习经历', '是否同意项目经历授权', '是否有国外项目经历',
    '是否有英语/其它外语能力', '紧急联系人是否有项目经历',
  ])('组合、范围不同、协议与他人问题不能用集合存在性回答：%s', caption => {
    const profile = createEmptyProfile(); profile.projects = [{ id: 'p', name: '虚构项目', technologies: [] }];
    expect(matchField(question(caption), profile).status).not.toBe('auto');
  });
  it('已回答的问题保留原值，重复/禁用选项不选择', () => {
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(), collectionFacts: { projects: none } }));
    const existing = question(); existing.hasValue = true;
    expect(matchField(existing, profile).status).toBe('existing');
    expect(matchField(question(undefined, '<option value="a">否</option><option value="b">否</option>'), profile).value).toBeUndefined();
    expect(matchField(question(undefined, '<option value="a" disabled>否</option>'), profile).value).toBeUndefined();
  });
  it('未知元数据键和模型来源不能进入用户事实', () => {
    expect(profileSchema.safeParse({ ...createEmptyProfile(), collectionFacts: { selector: '#submit' } }).success).toBe(false);
    expect(profileSchema.safeParse({ ...createEmptyProfile(), collectionFacts: { projects: { ...none, source: 'model' } } }).success).toBe(false);
  });
  it.each([
    ['internships', '是否有实习经历'], ['studentWork', '是否有校内职务'], ['awards', '是否有在校奖励活动'],
    ['papers', '是否有专业论著'], ['patents', '是否有专利'], ['certificates', '是否有证书'], ['computerSkills', '是否有计算机技能'],
  ] as const)('明确没有 %s 只用于对应问题', (key, caption) => {
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(), collectionFacts: { [key]: none } }));
    expect(matchField(question(caption), profile)).toMatchObject({ matchedProfileKey: `collectionFacts.${key}`, value: 'opaque-no', status: 'auto' });
    expect(matchField(question(), profile).value).toBeUndefined();
  });
  it('实习、论文与非空技能是对应存在证据；仅空白技能不是', () => {
    const profile = createEmptyProfile();
    profile.internships = [{ id: 'i', organization: '虚构单位' }];
    profile.research.papers = [{ id: 'paper', title: '虚构论文' }];
    profile.skills.tools = ['  '];
    expect(collectionPresence(profile, 'internships')).toBe('known');
    expect(collectionPresence(profile, 'papers')).toBe('known');
    expect(collectionPresence(profile, 'computerSkills')).toBe('unknown');
    profile.skills.tools.push('Git');
    expect(matchField(question('是否有计算机技能'), profile)).toMatchObject({ value: 'opaque-yes', status: 'auto' });
  });
  it('冲突标签、未知选项和文本问题不能写入存在性答案', () => {
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(), collectionFacts: { projects: none } }));
    const field = question(); field.ariaLabel = '是否有国外项目经历';
    expect(matchField(field, profile).value).toBeUndefined();
    expect(matchField(question(undefined, '<option value="no">未参加/不适用</option>'), profile).value).toBeUndefined();
    document.body.innerHTML = '<label>是否有项目经历<textarea></textarea></label>';
    expect(matchField(scanDocument().result.fields[0]!, profile).value).toBeUndefined();
  });
  it('否与无同时存在不会选择；单选组使用可见是/否而非内部值', () => {
    const profile = parseProfileJson(JSON.stringify({ ...createEmptyProfile(), collectionFacts: { projects: none } }));
    expect(matchField(question(undefined, '<option value="a">无</option><option value="b">没有</option>'), profile).status).not.toBe('auto');
    document.body.innerHTML = '<fieldset><legend>是否有项目经历</legend><label><input type="radio" name="q" value="yes">否</label><label><input type="radio" name="q" value="no">是</label></fieldset>';
    const field = scanDocument().result.fields[0]!;
    const result = matchField(field, profile);
    expect(result.status).toBe('auto');
    expect(field.options.find(option => option.value === result.value)?.label).toBe('否');
  });
});
