import { beforeEach, describe, expect, it } from 'vitest';
import { compareProjectCard, projectCardIdentityReady } from '../src/content/projectRecordIdentity';
import type { ProjectProjectionEntry } from '../src/profile/projection';
import { scanDocument } from '../src/content/scanner';

const project: ProjectProjectionEntry = { id: 'fictional-project', name: '虚构检索平台',
  description: '面向虚构校园资料的检索与收藏管理平台。', startDate: '2026-01-01', endDate: '2026-06-30', technologies: [] };
function card(html: string): Element {
  document.body.innerHTML = `<article>${html}<button>编辑</button><button>删除</button></article>`;
  return document.querySelector('article')!;
}
beforeEach(() => { document.body.innerHTML = ''; });
describe('页面内项目身份比较', () => {
  it.each([
    `<h3>${project.name}</h3><p>项目描述：${project.description}</p>`,
    `<dl><dt>项目名称</dt><dd>${project.name}</dd><dt>项目简介</dt><dd>${project.description}</dd></dl>`,
    `<table><tr><th>项目名称</th><td>${project.name}</td></tr><tr><th>项目简述</th><td>${project.description}</td></tr></table>`,
  ])('不同结构用名称和描述确认同一项目', html => {
    expect(compareProjectCard(card(html), project)).toEqual({ verdict: 'same', signals: ['primary', 'secondary'], provenance: 'rule' });
  });
  it('同名不同完整时间段对应不同经历', () => {
    const element = card(`<h3>${project.name}</h3><p>开始时间：2025.01.01</p><p>结束时间：2025.06.30</p>`);
    expect(compareProjectCard(element, project)).toMatchObject({ verdict: 'different', signals: ['primary', 'start-date', 'end-date'] });
  });
  it('同名和相同完整时间段不依赖描述即可对应', () => {
    const element = card(`<h3>${project.name}</h3><dl><dt>开始日期</dt><dd>2026/01/01</dd><dt>结束日期</dt><dd>2026/06/30</dd></dl>`);
    expect(compareProjectCard(element, project).verdict).toBe('same');
  });
  it.each(['hidden', 'style="display:none"', 'aria-hidden="true"', 'inert'])('隐藏证据不用于去重：%s', attribute => {
    expect(compareProjectCard(card(`<h3>${project.name}</h3><p ${attribute}>项目描述：${project.description}</p>`), project).verdict).toBe('insufficient');
  });
  it.each(['<textarea>项目描述：面向虚构校园资料的检索与收藏管理平台。</textarea>',
    '<p>项目描述：面向虚构校园资料的检索…</p>', '<p>项目描述：不同的完整描述内容，不能强行认为一致。</p>',
    '<p>开始时间：2026-02-30</p><p>结束时间：2026-06-30</p>'])('缺失、截断、冲突和非法日期不制造同一身份', html => {
    expect(compareProjectCard(card(`<h3>${project.name}</h3>${html}`), project).verdict).toBe('insufficient');
  });
  it('不同名称独立判别，比较结果不携带私密原值', () => {
    const result = compareProjectCard(card('<h3>另一虚构平台</h3>'), project);
    expect(result).toEqual({ verdict: 'different', signals: ['primary'], provenance: 'rule' });
    expect(JSON.stringify(result)).not.toMatch(/虚构|检索|2026/u);
  });
  it('多标题或名称冲突不得退回其中一个名字', () => {
    const element = card(`<h3>${project.name}</h3><h3>其它项目</h3><p>项目描述：${project.description}</p>`);
    expect(projectCardIdentityReady(element)).toBe(false);
    expect(compareProjectCard(element, project).verdict).toBe('insufficient');
  });

  it.each(['<p>开始时间：2026-02-30</p>', '<p>开始时间：2025-01-01</p>',
    '<p>开始时间：2026-01-01</p><p>开始时间：2025-01-01</p>'])('日期证据有错或不完整冲突时，不能被相同描述掩盖', html => {
    expect(compareProjectCard(card(`<h3>${project.name}</h3><p>项目描述：${project.description}</p>${html}`), project).verdict).toBe('insufficient');
  });
  it('CSS 截断的摘要不当作完整可见描述', () => {
    const element = card(`<h3>${project.name}</h3><p style="text-overflow:ellipsis;overflow:hidden">项目描述：${project.description}</p>`);
    expect(compareProjectCard(element, project).verdict).toBe('insufficient');
  });
  it('嵌套卡片不能提供外层卡片身份', () => {
    const element = card(`<article><h3>${project.name}</h3><p>项目描述：${project.description}</p></article>`);
    expect(projectCardIdentityReady(element)).toBe(false);
  });
  it('卡片内容不会进入共享语义图', () => {
    document.body.innerHTML = `<section aria-label="项目经历"><h2>项目经历</h2><div role="list"><article role="listitem"><h3>${project.name}</h3><p>项目描述：${project.description}</p><button type="button">编辑项目经历</button><button type="button">删除</button></article><button type="button">添加项目经历</button></div></section>`;
    const scan = scanDocument(document);
    expect(scan.result.semanticGraph?.nodes.some(node => node.kind === 'record')).toBe(true);
    expect(JSON.stringify(scan.result)).not.toContain(project.name);
    expect(JSON.stringify(scan.result)).not.toContain(project.description);
  });
});
