import { afterEach, describe, expect, it } from 'vitest';
import { compareEducationCard, educationCardComparator } from '../src/content/educationRecordIdentity';
import { compareProjectCard, projectCardComparator } from '../src/content/projectRecordIdentity';
import type { EducationProjectionEntry } from '../src/profile/educationProjection';
import type { ProjectProjectionEntry } from '../src/profile/projection';

const education: EducationProjectionEntry = { id: 'fictional-heading-school', school: '虚构青岚大学', level: '本科',
  major: '软件工程', degree: '学士学位', startDate: '2020-09', endDate: '2024-06' };
const project: ProjectProjectionEntry = { id: 'fictional-heading-project', name: '虚构校园检索平台', role: '开发成员',
  organization: '虚构测试实验室', description: '为虚构校园资料提供检索、收藏与分类管理。', technologies: [] };
function card(html: string): Element {
  document.body.innerHTML = `<article>${html}<button type="button">编辑</button><button type="button">删除</button></article>`;
  return document.querySelector('article')!;
}
afterEach(() => { document.body.innerHTML = ''; });

it('标题与另一条教育的专业同名时保持歧义，明确学校仍可核对', () => {
  const other = { ...education, id: 'fictional-other-school', school: '虚构云川大学', major: education.school };
  const element = card(`<h3>${education.school}</h3><p>学历：本科</p>`);
  expect(educationCardComparator(element, [education, other]).ready).toBe(false);
  element.insertAdjacentHTML('beforeend', `<p>学校：${education.school}</p>`);
  const reader = educationCardComparator(element, [education, other]);
  expect(reader.ready).toBe(true); expect(reader.compare(education).verdict).toBe('same');
  expect(reader.compare(other).verdict).toBe('different');
});
it('标题与另一项目的岗位同名时保持歧义，明确名称仍可核对', () => {
  const other = { ...project, id: 'fictional-other-project', name: '虚构设备管理平台', role: project.name };
  const element = card(`<h3>${project.name}</h3><p>项目描述：${project.description}</p>`);
  expect(projectCardComparator(element, [project, other]).ready).toBe(false);
  element.insertAdjacentHTML('beforeend', `<p>项目名称：${project.name}</p>`);
  const reader = projectCardComparator(element, [project, other]);
  expect(reader.ready).toBe(true); expect(reader.compare(project).verdict).toBe('same');
  expect(reader.compare(other).verdict).toBe('different');
});
it.each(['education', 'project'] as const)('直接 %s 比较拒绝异常源记录，不抛错或读取源外事实', kind => {
  const source = kind === 'education' ? education : project;
  const element = card(kind === 'education' ? `<p>学校：${education.school}</p><p>学历：本科</p>`
    : `<p>项目名称：${project.name}</p><p>项目描述：${project.description}</p>`);
  for (const record of [null, { ...source, unexpected: true }, { ...source, startDate: '2026-02-30' }]) {
    const result = kind === 'education' ? compareEducationCard(element, record as never) : compareProjectCard(element, record as never);
    expect(result.verdict).toBe('insufficient');
  }
});

describe('教育未标注标题与明确学校证据', () => {
  it.each(['本科', '软件工程', '教育经历', '另一所虚构大学'])('标题 %s 不证明学校不同', heading => {
    const element = card(`<h3>${heading}</h3><p>学历：本科</p><p>专业：软件工程</p>`);
    expect(compareEducationCard(element, education).verdict).toBe('insufficient');
    expect(educationCardComparator(element, [education]).ready).toBe(false);
  });
  it.each(['本科', '软件工程', '教育经历'])('明确学校加 %s 标题仍可核对', heading => {
    const element = card(`<h3>${heading}</h3><p>学校：${education.school}</p><p>学历：本科</p>`);
    expect(compareEducationCard(element, education).verdict).toBe('same');
    expect(educationCardComparator(element).ready).toBe(true);
  });
  it('无来源集合不把标题当学校；完整集合可核对并区分其他学校', () => {
    const other = { ...education, id: 'fictional-other-school', school: '虚构云川大学' };
    const element = card(`<h3>${education.school}</h3><p>学历：本科</p>`);
    expect(educationCardComparator(element).ready).toBe(false);
    const reader = educationCardComparator(element, [other, education]);
    expect(reader.ready).toBe(true); expect(reader.compare(education).verdict).toBe('same');
    expect(reader.compare(other).verdict).toBe('different');
    expect(JSON.stringify(reader.compare(education))).not.toMatch(/虚构|本科|fictional/u);
  });
  it.each(['level', 'major', 'degree'] as const)('学校与 %s 同名时标题不足；明确学校可解除歧义', key => {
    const record = { ...education, school: education[key] };
    expect(compareEducationCard(card(`<h3>${record.school}</h3><p>学历：本科</p>`), record).verdict).toBe('insufficient');
    expect(compareEducationCard(card(`<h3>${record.school}</h3><p>学校：${record.school}</p><p>学历：本科</p>`), record).verdict).toBe('same');
  });
  it('已核对学校标题与明确学校冲突不能挑一个', () => {
    const element = card(`<h3>${education.school}</h3><p>学校：另一所虚构大学</p><p>学历：本科</p>`);
    expect(educationCardComparator(element, [education]).ready).toBe(false);
    expect(compareEducationCard(element, education).verdict).toBe('insufficient');
  });
  it('明确另一学校可以区分，不要求陌生学校存在于当前集合', () => {
    const element = card('<h3>本科</h3><p>学校：另一所虚构大学</p>');
    expect(educationCardComparator(element, [education]).compare(education).verdict).toBe('different');
  });
  it('快照不读取后来修改的来源名称或卡片文字', () => {
    const local = { ...education }; const element = card(`<h3>${education.school}</h3><p>学历：本科</p>`);
    const reader = educationCardComparator(element, [local]);
    local.school = '另一个虚构名称'; element.querySelector('h3')!.textContent = '本科';
    expect(reader.compare(education).verdict).toBe('same');
    expect(educationCardComparator(element, [education]).ready).toBe(false);
  });
});

describe('项目未标注标题与明确项目名称', () => {
  it.each(['开发成员', '虚构测试实验室', '项目经历', '另一虚构平台'])('标题 %s 不证明另一项目', heading => {
    const element = card(`<h3>${heading}</h3><p>项目描述：${project.description}</p>`);
    expect(compareProjectCard(element, project).verdict).toBe('insufficient');
    expect(projectCardComparator(element, [project]).ready).toBe(false);
  });
  it.each(['开发成员', '虚构测试实验室', '项目经历'])('明确名称加 %s 标题仍可去重', heading => {
    const element = card(`<h3>${heading}</h3><p>项目名称：${project.name}</p><p>项目描述：${project.description}</p>`);
    expect(compareProjectCard(element, project).verdict).toBe('same');
    expect(projectCardComparator(element).ready).toBe(true);
  });
  it('仅可信集合核对标题，已知另一项目仍可区分', () => {
    const other = { ...project, id: 'fictional-other-project', name: '虚构设备管理平台' };
    const element = card(`<h3>${project.name}</h3><p>项目描述：${project.description}</p>`);
    expect(projectCardComparator(element).ready).toBe(false);
    const reader = projectCardComparator(element, [other, project]);
    expect(reader.ready).toBe(true); expect(reader.compare(project).verdict).toBe('same');
    expect(reader.compare(other).verdict).toBe('different');
    expect(JSON.stringify(reader.compare(project))).not.toMatch(/虚构|fictional|开发/u);
  });
  it.each(['role', 'organization'] as const)('名称与 %s 同名的标题保持歧义，明确名称可核对', key => {
    const record = { ...project, name: project[key] };
    expect(compareProjectCard(card(`<h3>${record.name}</h3><p>项目描述：${record.description}</p>`), record).verdict).toBe('insufficient');
    expect(compareProjectCard(card(`<h3>${record.name}</h3><p>项目名称：${record.name}</p><p>项目描述：${record.description}</p>`), record).verdict).toBe('same');
  });
  it('已核对标题与明确名称冲突时不采用任一个', () => {
    const element = card(`<h3>${project.name}</h3><p>项目名称：另一虚构平台</p><p>项目描述：${project.description}</p>`);
    expect(projectCardComparator(element, [project]).ready).toBe(false);
    expect(compareProjectCard(element, project).verdict).toBe('insufficient');
  });
  it('明确另一名称独立区分，即使标题是岗位', () => {
    expect(projectCardComparator(card('<h3>开发成员</h3><p>项目名称：另一虚构平台</p>'), [project]).compare(project).verdict).toBe('different');
  });
  it('外层申请 form 不妨碍项目可见摘要核对', () => {
    const element = card(`<h3>${project.name}</h3><p>项目描述：${project.description}</p>`);
    const outer = document.createElement('form'); element.replaceWith(outer); outer.append(element);
    expect(compareProjectCard(element, project).verdict).toBe('same');
  });
  it.each(['contenteditable', 'role="textbox"', 'role="button"', 'style="text-overflow:ellipsis"', 'style="-webkit-line-clamp:2"'])('项目摘要在编辑或截断祖先 %s 内时不读为完整', attributes => {
    expect(compareProjectCard(card(`<h3>${project.name}</h3><div ${attributes}><p>项目描述：${project.description}</p></div>`), project).verdict).toBe('insufficient');
  });
  it('卡片内编辑表单和超量段落不给项目完整身份', () => {
    expect(compareProjectCard(card(`<h3>${project.name}</h3><form><p>项目描述：${project.description}</p></form>`), project).verdict).toBe('insufficient');
    expect(compareProjectCard(card(`<h3>${project.name}</h3>${`<p>项目描述：${project.description}</p>`.repeat(1001)}`), project).verdict).toBe('insufficient');
  });
});

it.each(['education', 'project'] as const)('完整 %s 来源集合异常时拒绝标题和明确名称', kind => {
  const source = kind === 'education' ? education : project;
  const primary = kind === 'education' ? 'school' : 'name'; const caption = kind === 'education' ? '学校' : '项目名称';
  const text = kind === 'education' ? education.school : project.name;
  const element = card(`<h3>${text}</h3><p>${caption}：${text}</p>`);
  const malformed: unknown[] = [null, [null], Array(1), [source, source], [{ ...source, unexpected: true }],
    [{ ...source, [primary]: '' }], [source, { ...source, id: 'fictional-incomplete', [primary]: '虚构…' }], [{ ...source, startDate: '2026-02-30' }],
    Array.from({ length: kind === 'education' ? 31 : 101 }, (_, i) => ({ ...source, id: `fictional-${i}` }))];
  for (const context of malformed) {
    const reader = kind === 'education' ? educationCardComparator(element, context as readonly EducationProjectionEntry[])
      : projectCardComparator(element, context as readonly ProjectProjectionEntry[]);
    expect(reader.ready).toBe(false); expect(reader.compare(source as never).verdict).toBe('insufficient');
  }
});
