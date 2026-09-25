// @vitest-environment-options {"url":"https://job.10086.cn/personal/resume_campus.html?isComplete=no"}
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileWorkflow, isMobileWorkflowPage, matchingCards } from '../src/content/mobileWorkflow';
import { chooseOption, emptyValue, fillWorkflowField, requiredIssues } from '../src/content/workflowControls';
import { buildWorkflowRecords, fullDate, workflowRequest } from '../src/workflow/model';
import { parseProfileJson } from '../src/profile/schema';

const fixtureHTML = readFileSync('tests/fixtures/mobile-workflow.html', 'utf8');
const wholeFixture = readFileSync('tests/fixtures/mobile-whole-workflow.js', 'utf8');
const profile = parseProfileJson(readFileSync('tests/fixtures/workflow-profile.json', 'utf8'));
type Fixture = { adds: Record<string, number>; saves: Record<string, number>; sequence: Array<Record<string, string>>;
  cadre?: string; cadreSaves: number; seedCadre(code: string): void;
  seed(section: string, record: Record<string, string>): void;
  records: Record<string, Array<Record<string, string>>>; submits: number; deletes: number; scrolls: unknown[];
  config: { requireProof: boolean; saveFailure: boolean; saveDelay: number; cadreDelay: number; cadreFailure: boolean; baseInfoComplete: boolean } };
const fixture = () => (window as unknown as { fixture: Fixture }).fixture;
let flow: MobileWorkflow;
beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  document.documentElement.innerHTML = fixtureHTML;
  // Execute only this repository's independent, fictional test fixture.
  new Function(fixtureHTML.match(/<script>([\s\S]*)<\/script>/u)![1]!)();
  flow = new MobileWorkflow(undefined, 1000);
});
afterEach(() => { flow.stop(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function settled() {
  for (let step = 0; step < 400 && flow.status().phase === 'running'; step++) await vi.advanceTimersByTimeAsync(100);
  expect(flow.status().phase, JSON.stringify(flow.status())).not.toBe('running');
  await vi.advanceTimersByTimeAsync(1);
  return flow.status();
}
const element = (id: string) => document.getElementById(id)!;
const io = { check: () => {}, wait: async () => {} };
const awardsRequest = () => {
  const data = structuredClone(profile);
  data.basic.studentCadre = '否';
  data.awards = JSON.parse(readFileSync('tests/fixtures/workflow-awards.json', 'utf8'));
  return workflowRequest(data, false, 'awards');
};
function installWholeFixture() { new Function(wholeFixture)(); }

describe('整份简历连续填写', { timeout: 20_000 }, () => {
  it('专业论著按档案顺序全部进入流程，不过滤返修和在投稿件', () => {
    const data = structuredClone(profile); data.education = []; data.projects = [];
    data.research.papers = [
      { id: 'published', shortTitle: '已发表论文', status: '已发表', date: '2025-01-01', abstract: '摘要', authorOrder: '第一作者', publicationSituation: '发表于期刊', coauthors: '合著' },
      { id: 'revision', shortTitle: '返修论文', status: '小修返修完成', date: '2026-08-25', abstract: '摘要', authorOrder: '第二作者', publicationSituation: '期刊小修返修完成', coauthors: '合著' },
      { id: 'submitted', shortTitle: '在投论文', status: '在投', date: '2026-08-25', abstract: '摘要', authorOrder: '第一作者', publicationSituation: '投稿会议', coauthors: '合著' },
    ];
    const records = buildWorkflowRecords(workflowRequest(data, false, 'whole')).filter(record => record.section === 'treatiseInfo');
    expect(records.map(record => record.name)).toEqual(['已发表论文', '返修论文', '在投论文']);
  });
  it('计算机技能按网站100字限制分组，不丢弃后续内容', () => {
    const data = structuredClone(profile); data.education = []; data.projects = [];
    data.skills.other = ['甲'.repeat(60), '乙'.repeat(60), '丙'];
    const records = buildWorkflowRecords(workflowRequest(data, false, 'whole')).filter(record => record.section === 'computerSkillInfo');
    expect(records.map(record => record.name)).toEqual(['甲'.repeat(60), `${'乙'.repeat(60)}、丙`]);
    expect(records.every(record => record.name.length <= 100)).toBe(true);
  });
  it('展开动态栏目并继续处理其他类别；缺薪资和证明答案时保留实习草稿并给出整页待办', async () => {
    installWholeFixture();
    const data = structuredClone(profile);
    data.education = []; data.projects = [];
    data.studentWork = [{ id: 'fictional-post', organization: '青岚科技大学学生发展中心', role: '新生助理', startDate: '2021-10-01', endDate: '2022-07-31', shortDuties: '协助迎新、信息统计和学生问题反馈。' }];
    data.internships = [{ id: 'fictional-internship', organization: '星河软件', role: '后端开发实习生', startDate: '2022-05-01', endDate: '2022-07-31', description: '使用Java开发接口并配合联调。' }];
    data.certificates = [{ id: 'fictional-cet6', name: '大学英语六级', date: '2021-06', score: '430' }, { id: 'fictional-cert', name: '普通话等级证书', date: '2020-12', score: '85' }];
    data.skills = { programmingLanguages: ['Python（熟悉）'], frameworks: [], tools: [], other: [] };
    data.research.papers = [{ id: 'fictional-paper', title: 'A Fictional Paper', shortTitle: '虚构视觉识别论文', abstract: '研究虚构数据中的视觉识别方法。', authorOrder: '第二作者', publicationSituation: '已发表于虚构期刊', coauthors: '合著', date: '2026-01-17', status: '已发表' }];
    flow.start(workflowRequest(data, false, 'whole'));
    const result = await settled();
    expect(result.phase).toBe('review');
    expect(result.issues.join(' ')).toContain('税前月薪');
    expect(result.issues.join(' ')).toContain('是否有证明');
    expect(result.message).toContain('不代表整份简历已填完');
    expect(fixture().records.schoolPostInfo).toHaveLength(1);
    expect(fixture().records.languageInfo).toHaveLength(1);
    expect(fixture().records.skillInfo).toHaveLength(1);
    expect(fixture().records.computerSkillInfo).toHaveLength(1);
    expect(fixture().records.treatiseInfo).toHaveLength(1);
    expect(fixture().records.workInfo).toHaveLength(0);
    expect(document.querySelector<HTMLInputElement>('[name=isHasPractiseInfo][data-code=Y]')!.checked).toBe(true);
    expect(document.getElementById('workPay')!.closest('.secC')!.getAttribute('style')).not.toContain('display: none');
    expect(fixture().submits).toBe(0);
  });

  it('社会实践走对应标签页，不要求实习薪资', async () => {
    installWholeFixture();
    const data = structuredClone(profile); data.education = []; data.projects = []; data.studentWork = [];
    data.internships = [{ id: 'fictional-community', organization: '晨光社区', role: '社区实践志愿者', experienceType: '社会实践',
      startDate: '2021-07-11', endDate: '2021-07-31', description: '协助居民信息核验与志愿服务。' }];
    data.certificates = []; data.skills = { programmingLanguages: [], frameworks: [], tools: [], other: [] }; data.research.papers = [];
    flow.start(workflowRequest(data, false, 'whole'));
    const result = await settled();
    expect(result, JSON.stringify(result)).toMatchObject({ phase: 'review', saved: 1 });
    expect(fixture().records.workInfo![0]).toMatchObject({ activityName: '晨光社区', activityType: '社区实践志愿者' });
    expect(fixture().records.workInfo![0]!.workPay).toBeUndefined();
  });

  it('已有社会实践缺少工作描述时编辑原记录，不重复新增', async () => {
    installWholeFixture();
    const data = structuredClone(profile); data.education = []; data.projects = []; data.studentWork = [];
    data.internships = [{ id: 'fictional-community-update', organization: '晨光社区', role: '社区实践志愿者', experienceType: '社会实践',
      startDate: '2021-07-11', endDate: '2021-07-31', description: '协助居民信息核验与志愿服务。' }];
    data.certificates = []; data.skills = { programmingLanguages: [], frameworks: [], tools: [], other: [] }; data.research.papers = [];
    const request = workflowRequest(data, false, 'whole');
    flow.start(request); await settled();
    const stored = fixture().records.workInfo![0]!; stored.activityDesc = '';
    [...document.querySelectorAll<HTMLElement>('#workInfo .secC_dl p')].find(node => node.textContent?.includes('工作描述'))?.remove();
    flow.stop(); flow.start(request);
    const updated = await settled();
    expect(updated, JSON.stringify(updated)).toMatchObject({ phase: 'review', saved: 1 });
    expect(fixture().records.workInfo).toHaveLength(1);
    expect(fixture().records.workInfo![0]!.activityDesc).toBe('协助居民信息核验与志愿服务。');
    expect(fixture().adds.workInfo).toBe(1);
    expect(fixture().saves.workInfo).toBe(2);
  });

  it('重新运行时替换旧版专业论著中的内部备注，不重复新增', async () => {
    installWholeFixture();
    const data = structuredClone(profile); data.education = []; data.projects = []; data.studentWork = []; data.internships = [];
    data.certificates = []; data.skills = { programmingLanguages: [], frameworks: [], tools: [], other: [] };
    data.research.papers = [{ id: 'fictional-paper-refresh', shortTitle: '虚构视觉识别论文', abstract: '研究虚构数据中的视觉识别方法。',
      authorOrder: '第二作者', publicationSituation: '发表于虚构期刊', coauthors: '合著（第二作者）', date: '2026-01-17', status: '已发表' }];
    const request = workflowRequest(data, false, 'whole');
    flow.start(request); expect(await settled()).toMatchObject({ phase: 'review', saved: 1 });
    fixture().records.treatiseInfo![0]!.treatiseSynopsis = '主档案待补，具体内容未确认。';
    const synopsis = [...document.querySelectorAll<HTMLElement>('#treatiseInfo .secC_dl p')].find(node => node.textContent?.startsWith('内容摘要：'))!;
    synopsis.textContent = '内容摘要：主档案待补，具体内容未确认。';
    flow.stop(); flow.start(request);
    expect(await settled()).toMatchObject({ phase: 'review', saved: 1 });
    expect(fixture().records.treatiseInfo).toHaveLength(1);
    expect(fixture().records.treatiseInfo![0]!.treatiseSynopsis).toBe('研究虚构数据中的视觉识别方法。');
    expect(fixture().adds.treatiseInfo).toBe(1);
    expect(fixture().saves.treatiseInfo).toBe(2);
  });
});

describe('在校奖励连续填写', { timeout: 20_000 }, () => {
  it('单独填写奖励，选择有奖励和非干部，逐条新增、保存，并正确转换级别和月份', async () => {
    flow.start(awardsRequest());
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 3, existing: 0 });
    const records = fixture().records.awardInfo!;
    expect(records.map(row => row.awardName)).toEqual(awardsRequest().awards!.map(row => row.name));
    expect(records.map(row => row.awardLevel)).toEqual(['国家级', '省部级', '院校级']);
    expect(records.map(row => row.awardObtainTime)).toEqual(['2022-08', '2023-05', '请选择']);
    expect(records.map(row => row.scholarshipLevel)).toEqual(['请选择', '请选择', '二等奖']);
    expect(fixture().cadre).toBe('N'); expect(fixture().cadreSaves).toBe(1);
    expect(fixture().saves).toEqual({ educationInfo: 0, projectInfo: 0, awardInfo: 3 });
    expect(document.querySelector<HTMLInputElement>('[name=isHasAwardInfo][data-code=Y]')!.checked).toBe(true);
    expect(fixture().submits + fixture().deletes).toBe(0);
    flow.start(awardsRequest());
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 0, existing: 3 });
    expect(fixture().adds.awardInfo).toBe(3);
  });
  it('先返回干部记录、后返回奖励时，不把干部卡片当成奖励保存成功', async () => {
    fixture().config.cadreDelay = 100; fixture().config.saveDelay = 700;
    flow.start(awardsRequest());
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 3 });
    expect(fixture().sequence.map(row => row.awardName)).toEqual(awardsRequest().awards!.map(row => row.name));
    expect(fixture().cadreSaves).toBe(1);
  });
  it('学生干部保存失败时暂停，不继续新增奖励', async () => {
    fixture().config.cadreFailure = true;
    flow.start(awardsRequest());
    expect(await settled()).toMatchObject({ phase: 'blocked', index: 0 });
    expect(fixture().records.awardInfo).toHaveLength(1);
    expect(fixture().adds.awardInfo).toBe(1);
    flow.resume();
    expect(await settled()).toMatchObject({ phase: 'blocked', index: 0 });
    expect(fixture().adds.awardInfo).toBe(1);
  });
  it('将已保存的干部“是”改为档案明确的“否”，不删除记录', async () => {
    fixture().seedCadre('Y');
    flow.start(awardsRequest());
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 3 });
    expect(fixture().cadre).toBe('N'); expect(fixture().cadreSaves).toBe(1);
    expect(fixture().saves.awardInfo).toBe(4);
    expect(fixture().deletes).toBe(0);
  });
  it('未知干部身份不采用默认否；名称超限不截断、不点击保存', async () => {
    const request = awardsRequest(); request.studentCadre = undefined;
    flow.start(request);
    expect(await settled()).toMatchObject({ phase: 'blocked', index: 0 });
    expect(flow.status().message).toContain('不会把网站默认');
    flow.stop(); request.studentCadre = '否'; request.awards![0]!.name = '奖'.repeat(51);
    flow.start(request);
    expect(await settled()).toMatchObject({ phase: 'blocked' });
    expect(flow.status().issues.join(' ')).toContain('50 字限制');
    expect(fixture().saves.awardInfo).toBe(0);
  });
  it('同名但不同年份的奖励不混为同一条', async () => {
    fixture().seedCadre('N');
    fixture().seed('awardInfo', { awardName: '虚构全国创新竞赛一等奖', awardLevel: '国家级', awardObtainTime: '2021-08', awardSummary: '上年度同名奖项' });
    const request = awardsRequest(); request.awards = request.awards!.slice(0, 1);
    flow.start(request);
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 1, existing: 0 });
    expect(fixture().records.awardInfo).toHaveLength(2);
  });
});

describe('连续填写规划与控件', () => {
  it('本科先于硕士，项目依原档案顺序，且不改写原档案', () => {
    const original = JSON.stringify(profile);
    const records = buildWorkflowRecords(workflowRequest(profile));
    expect(records.map(item => item.name)).toEqual(['青岚科技大学', '云川工程大学', '校园图书检索平台', '环境传感数据看板']);
    expect(records.slice(0, 2).map(item => item.fields.find(field => field.target === 'isHigestDegree')?.value)).toEqual(['N', 'Y']);
    expect(records.slice(0, 2).map(item => item.fields.find(field => field.target === 'isHigestAcademic1')?.value)).toEqual(['N', 'Y']);
    expect(JSON.stringify(profile)).toBe(original);
  });
  it('月份约定必须启用，且正确处理闰年', () => {
    expect(fullDate('2024-02', true, false)).toBe('2024-02');
    expect(fullDate('2024-02', true, true)).toBe('2024-02-29');
    expect(fullDate('2023-02', true, true)).toBe('2023-02-28');
    expect(fullDate('2024-02', false, true)).toBe('2024-02-01');
  });
  it('更高教育的学位缺失时，不把已知学士误判为最高学位', () => {
    const request = workflowRequest(structuredClone(profile));
    request.education[0]!.degree = undefined;
    expect(buildWorkflowRecords(request).filter(item => item.section === 'educationInfo')
      .map(item => item.fields.find(field => field.target === 'isHigestAcademic1')?.value)).toEqual([undefined, undefined]);
    request.education[0]!.degree = '硕士学位';
    expect(buildWorkflowRecords(request).filter(item => item.section === 'educationInfo')
      .map(item => item.fields.find(field => field.target === 'isHigestAcademic1')?.value)).toEqual(['N', 'Y']);
    expect(chooseOption(['学士', '硕士', '博士'], '硕士学位', 'degree1')).toBe(1);
  });
  it('只在精确 HTTPS 校招简历页启用', () => {
    expect(isMobileWorkflowPage(location.href)).toBe(true);
    for (const url of ['http://job.10086.cn/personal/resume_campus.html', 'https://job.10086.cn.evil.invalid/personal/resume_campus.html', 'https://job.10086.cn/personal/other.html']) expect(isMobileWorkflowPage(url)).toBe(false);
  });
  it('学历学位等价、百分比向包含真实排名的范围映射，重复选项不猜', () => {
    expect(chooseOption(['大学本科', '硕士研究生'], '本科', 'education')).toBe(0);
    expect(chooseOption(['硕士', '学士'], '工学学士', 'degree1')).toBe(1);
    expect(chooseOption(['前5%', '前20%', '前30%'], '专业前25%', 'rank')).toBe(2);
    expect(chooseOption(['前5%', '前10%'], '前5.5%', 'rank')).toBe(1);
    expect(chooseOption(['本科', '大学本科'], '本科', 'education')).toBe(-1);
  });
  it('默认提示为空，正文以“请输入”开头仍受保护', () => {
    expect(emptyValue('附件只支持zip和rar格式')).toBe(true);
    expect(emptyValue('请输入用户关键词后返回检索结果')).toBe(false);
  });
  it('只用 hover 打开教育下拉并触发真实选项点击', async () => {
    element('educationInfo').querySelector<HTMLElement>('.secH a')!.click();
    await fillWorkflowField(element('educationInfo'), { target: 'education', kind: 'select', label: '学历', value: '本科' }, io);
    expect(element('education').querySelector('span')!.textContent).toBe('大学本科');
    expect(element('education').querySelector('span')!.getAttribute('data-code')).toBe('3');
  });
  it('无效日期不会点击日历；完整日期自动翻年并选择月份和日', async () => {
    element('educationInfo').querySelector<HTMLElement>('.secH a')!.click();
    const field = { target: 'sltTime', kind: 'date' as const, label: '入学日期', value: '2023-02-29' };
    await expect(fillWorkflowField(element('educationInfo'), field, io)).rejects.toThrow('有效的日历');
    await fillWorkflowField(element('educationInfo'), { ...field, value: '2019-09-07' }, io);
    expect(element('sltTime').querySelector('span')!.textContent).toBe('2019-09-07');
  });
});
describe('中国移动完整多记录流程', { timeout: 20_000 }, () => {
  it('自动新增并保存 2 段教育和 2 个项目，滚动、最高学历和记录对应正确，不投递', async () => {
    flow.start(workflowRequest(profile));
    expect(await settled()).toMatchObject({ phase: 'completed', index: 4, saved: 4, existing: 0 });
    expect(fixture().sequence.map(item => item.educationSchool || item.projectName)).toEqual(['青岚科技大学', '云川工程大学', '校园图书检索平台', '环境传感数据看板']);
    expect(fixture().records.educationInfo!.map(item => item.isHigestDegree)).toEqual(['N', 'Y']);
    expect(fixture().records.educationInfo![0]!.rank).toBe('前30%');
    expect(fixture().records.projectInfo![1]!.projectDuty).toBe(profile.projects[1]!.responsibilities);
    expect(fixture().adds).toEqual({ educationInfo: 2, projectInfo: 2, awardInfo: 0 });
    expect(fixture().saves).toEqual({ educationInfo: 2, projectInfo: 2, awardInfo: 0 });
    expect(fixture().scrolls.length).toBeGreaterThan(4);
    expect(fixture().submits + fixture().deletes).toBe(0);
    flow.start(workflowRequest(profile));
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 0, existing: 4 });
    expect(fixture().saves).toEqual({ educationInfo: 2, projectInfo: 2, awardInfo: 0 });
  });
  it('已经打开的空教育表单直接接着填，不因附件提示误判草稿', async () => {
    element('educationInfo').querySelector<HTMLElement>('.secH a')!.click();
    flow.start(workflowRequest(profile));
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 4 });
    expect(fixture().adds.educationInfo).toBe(2);
  });
  it('已有不同草稿时暂停保护，取消草稿后继续整条流程', async () => {
    element('educationInfo').querySelector<HTMLElement>('.secH a')!.click();
    (element('college1') as HTMLInputElement).value = '保留我的草稿';
    flow.start(workflowRequest(profile));
    expect((await settled()).message).toContain('已有未保存');
    expect((element('college1') as HTMLInputElement).value).toBe('保留我的草稿');
    element('educationInfo').querySelector<HTMLElement>('.cancel')!.click();
    flow.resume(); expect(await settled()).toMatchObject({ phase: 'completed', saved: 4 });
  });
  it('真正缺证明才暂停，上传成功后继续，不反复选择本科和硕士归属', async () => {
    fixture().config.requireProof = true;
    const request = workflowRequest(profile); request.education = request.education.filter(item => item.level === '本科'); request.projects = [];
    flow.start(request);
    expect(await settled()).toMatchObject({ phase: 'blocked', saved: 0 });
    expect(flow.status().issues.join(' ')).toContain('教育证明');
    expect(fixture().saves.educationInfo).toBe(0);
    element('fixture-upload-proof').click(); flow.resume();
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 1 });
    expect(fixture().adds.educationInfo).toBe(1);
  });
  it('暂停后立即继续不会重入旧任务，停止后不再新增或保存', async () => {
    flow.start(workflowRequest(profile)); flow.pause(); flow.resume();
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 4 });
    const saved = fixture().saves.educationInfo! + fixture().saves.projectInfo!;
    flow.start(workflowRequest(profile)); flow.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(flow.status().phase).toBe('stopped');
    expect(fixture().saves.educationInfo! + fixture().saves.projectInfo!).toBe(saved);
  });
  it('保存回执不明时不连点保存，晚到的成功回执允许继续', async () => {
    const request = workflowRequest(profile); request.education = []; request.projects = [request.projects[0]!];
    fixture().config.saveDelay = 5000;
    flow.start(request);
    expect((await settled()).message).toContain('尚未看到保存后的记录');
    expect(fixture().saves.projectInfo).toBe(1);
    flow.resume(); expect((await settled()).message).toContain('上次保存结果尚未确认');
    expect(fixture().saves.projectInfo).toBe(1);
    await vi.advanceTimersByTimeAsync(3000); flow.resume();
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 1 });
  });
  it('手工补齐档案缺失日期后能核验保存记录，不能将成功保存误报超时', async () => {
    const request = workflowRequest(structuredClone(profile)); request.education = []; request.projects = [request.projects[0]!]; request.projects[0]!.endDate = undefined;
    flow.start(request); expect(await settled()).toMatchObject({ phase: 'blocked' });
    await fillWorkflowField(element('projectInfo'), { target: 'projectTime_t', kind: 'date', label: '结束日期', value: '2022-11-28' }, io);
    flow.resume(); expect(await settled()).toMatchObject({ phase: 'completed', saved: 1 });
  });
  it('用户补日期、改名称并直接点击网站保存后，继续进入第二个项目，不重填第一条', async () => {
    const request = workflowRequest(structuredClone(profile)); request.education = [];
    request.projects[0]!.endDate = undefined;
    flow.start(request); expect(await settled()).toMatchObject({ phase: 'blocked', index: 0 });
    await fillWorkflowField(element('projectInfo'), { target: 'projectTime_t', kind: 'date', label: '结束日期', value: '2022-11-28' }, io);
    (element('projectName') as HTMLInputElement).value = '图书检索平台（手动修正）';
    element('projectInfo').querySelector<HTMLElement>('.btnP .save')!.click();
    flow.resume();
    expect(await settled()).toMatchObject({ phase: 'completed', saved: 2 });
    expect(fixture().sequence.map(item => item.projectName)).toEqual(['图书检索平台（手动修正）', '环境传感数据看板']);
    expect(fixture().adds.projectInfo).toBe(2); expect(fixture().saves.projectInfo).toBe(2);
  });
  it('档案缺结束日期但网站有同名同开始月份记录时，跳过它并填写下一项目', async () => {
    const request = workflowRequest(structuredClone(profile)); request.education = [];
    request.projects[0]!.startDate = '2022-03'; request.projects[0]!.endDate = undefined;
    fixture().seed('projectInfo', { projectName: request.projects[0]!.name!, projectCompany: '测试单位', projectJob: '测试角色', projectDuty: '已有职责', projectDesc: '已有简述', projectTime: '2022-03-02', projectTime_t: '2022-11-28' });
    flow.start(request); expect(await settled()).toMatchObject({ phase: 'completed', saved: 1, existing: 1 });
    expect(fixture().adds.projectInfo).toBe(1); expect(fixture().sequence[0]!.projectName).toBe(request.projects[1]!.name);
  });
  it('同名同时间重复记录不会卡住剩余项目，也不会自动删除', async () => {
    const request = workflowRequest(profile); request.education = [];
    const record = { projectName: request.projects[0]!.name!, projectCompany: '测试单位', projectJob: '测试角色', projectDuty: '已有职责', projectDesc: '已有简述', projectTime: '2022-03-02', projectTime_t: '2022-11-28' };
    fixture().seed('projectInfo', record); fixture().seed('projectInfo', record);
    flow.start(request); expect(await settled()).toMatchObject({ phase: 'completed', saved: 1, existing: 1 });
    expect(flow.status().message).toContain('重复记录'); expect(fixture().deletes).toBe(0); expect(fixture().adds.projectInfo).toBe(1);
  });
  it('重启后仅在日期、公司、职务、职责全部一致时识别缩短的项目名', async () => {
    const request = workflowRequest(structuredClone(profile)); request.education = [];
    const project = request.projects[0]!; const shortName = project.name!; project.name += '｜浏览器扩展与个人作品';
    fixture().seed('projectInfo', { projectName: shortName, projectCompany: project.organization!, projectJob: project.role!, projectDuty: project.responsibilities!, projectDesc: project.description!, projectTime: project.startDate!, projectTime_t: project.endDate! });
    flow.start(request); expect(await settled()).toMatchObject({ phase: 'completed', saved: 1, existing: 1 });
    expect(fixture().adds.projectInfo).toBe(1);
  });
  it('识别旧版项目名中的开发说明后缀，避免改名后重复新增', () => {
    const request = workflowRequest(structuredClone(profile)); request.education = [];
    const record = buildWorkflowRecords(request).find(item => item.section === 'projectInfo')!;
    fixture().seed('projectInfo', {
      projectName: `${record.name}（个人项目/AI协作开发）`,
      projectCompany: record.fields.find(field => field.target === 'projectCompany')!.value!,
      projectJob: record.fields.find(field => field.target === 'projectJob')!.value!,
      projectDuty: record.fields.find(field => field.target === 'projectDuty')!.value!,
      projectDesc: record.fields.find(field => field.target === 'projectDesc')!.value!,
      projectTime: record.startDate!, projectTime_t: record.endDate!,
    });
    expect(matchingCards(element('projectInfo'), record)).toHaveLength(1);
  });
  it('网站改写文字后，继续接受页面上保留的有效内容，不反复写回原文', async () => {
    const request = workflowRequest(structuredClone(profile)); request.education = []; request.projects = [request.projects[0]!];
    let writes = 0;
    element('projectDesc').addEventListener('change', () => { writes++; (element('projectDesc') as HTMLTextAreaElement).value = '网站处理后的有效项目简述'; });
    flow.start(request); expect(await settled()).toMatchObject({ phase: 'blocked' });
    flow.resume(); expect(await settled()).toMatchObject({ phase: 'completed', saved: 1 });
    expect(writes).toBe(1); expect(fixture().records.projectInfo![0]!.projectDesc).toBe('网站处理后的有效项目简述');
  });
  it('填完后出现回滚不保存，必填和字数校验在保存前执行', async () => {
    const request = workflowRequest(structuredClone(profile)); request.education = []; request.projects = [request.projects[0]!];
    element('projectDesc').addEventListener('change', () => { (element('projectDuty') as HTMLTextAreaElement).value = '被网站回滚'; });
    flow.start(request); expect(await settled()).toMatchObject({ phase: 'blocked' });
    expect(flow.status().issues.join(' ')).toContain('网站联动'); expect(fixture().saves.projectInfo).toBe(0);
    (element('projectJob') as HTMLInputElement).value = '过长'.repeat(50);
    expect(requiredIssues(element('projectInfo')).join(' ')).toContain('字数限制');
  });
});
