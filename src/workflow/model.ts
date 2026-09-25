import { z } from 'zod';
import { awardSchema, basicSchema, educationSchema, projectSchema, experienceSchema, certificateSchema, paperSchema, profileSchema, type UserProfile } from '../profile/schema';
import { additionalRecords } from './sections';

export const workflowRequestSchema = z.object({
  education: z.array(educationSchema).max(30), projects: z.array(projectSchema).max(100),
  monthBoundaryDates: z.boolean().default(false),
  awards: z.array(awardSchema).max(100).optional(),
  studentCadre: basicSchema.shape.studentCadre, studentCadreDescription: basicSchema.shape.studentCadreDescription,
  wholeResume: z.boolean().optional(),
  studentWork: z.array(experienceSchema).max(100).optional(), internships: z.array(experienceSchema).max(100).optional(),
  certificates: z.array(certificateSchema).max(100).optional(), papers: z.array(paperSchema).max(100).optional(),
  skills: profileSchema.shape.skills.optional(),
}).strict();
export type WorkflowRequest = z.infer<typeof workflowRequestSchema>;
export type WorkflowPhase = 'idle' | 'running' | 'paused' | 'blocked' | 'review' | 'completed' | 'stopped';
export interface WorkflowState {
  phase: WorkflowPhase; total: number; index: number; saved: number; existing: number;
  current: string; message: string; issues: string[];
}
export type WorkflowField = { target: string; kind: 'text' | 'school' | 'select' | 'date' | 'month' | 'radio'; label: string; value?: string };
export interface WorkflowRecord {
  id: string; section: 'educationInfo' | 'projectInfo' | 'awardInfo' | 'schoolPostInfo' | 'workInfo' | 'languageInfo' | 'skillInfo' | 'computerSkillInfo' | 'treatiseInfo'; title: string;
  tab?: string; identity?: string[]; identityTargets?: string[]; dateTargets?: string[]; verifyTargets?: string[]; replaceTargets?: string[];
  name: string; stage?: string; startDate?: string; endDate?: string; fields: WorkflowField[];
}
export const idleWorkflow = (): WorkflowState => ({ phase: 'idle', total: 0, index: 0, saved: 0, existing: 0, current: '', message: '', issues: [] });
const ranks = { '其他': 0, '专科': 1, '本科': 2, '硕士研究生': 3, '博士研究生': 4 };
export function fullDate(value: string | undefined, end: boolean, monthBoundaryDates: boolean): string | undefined {
  if (!value || !/^\d{4}-\d{2}$/.test(value) || !monthBoundaryDates) return value;
  const [year, month] = value.split('-').map(Number);
  return `${value}-${end ? new Date(Date.UTC(year!, month!, 0)).getUTCDate() : '01'}`;
}
export function workflowRequest(profile: UserProfile, monthBoundaryDates = false, scope: 'education-projects' | 'awards' | 'whole' = 'education-projects'): WorkflowRequest {
  if (scope === 'whole') return { education: profile.education, projects: profile.projects, awards: profile.awards,
    studentCadre: profile.basic.studentCadre, studentCadreDescription: profile.basic.studentCadreDescription, monthBoundaryDates,
    wholeResume: true, studentWork: profile.studentWork, internships: profile.internships, certificates: profile.certificates,
    papers: profile.research.papers, skills: profile.skills };
  if (scope === 'awards') return { education: [], projects: [], awards: profile.awards,
    studentCadre: profile.basic.studentCadre, studentCadreDescription: profile.basic.studentCadreDescription, monthBoundaryDates };
  return { education: profile.education, projects: profile.projects, monthBoundaryDates };
}
export function buildWorkflowRecords(request: WorkflowRequest): WorkflowRecord[] {
  const education = request.education.map((entry, index) => ({ entry, index }))
    .sort((a, b) => ranks[a.entry.level] - ranks[b.entry.level] || (a.entry.startDate ?? '').localeCompare(b.entry.startDate ?? '') || a.index - b.index);
  const highest = education.at(-1)?.entry.id;
  const isFulltime = (value?: string) => value && /全日制/.test(value) && !/非全日制/.test(value);
  const highestFulltime = education.filter(item => isFulltime(item.entry.studyMode)).at(-1)?.entry.id;
  const degreeRank = (degree?: string) => {
    const name = degree?.trim().replace(/学位$/u, '');
    return name?.endsWith('博士') ? 3 : name?.endsWith('硕士') ? 2 : name?.endsWith('学士') ? 1 : 0;
  };
  const highestAcademicCandidate = education.filter(item => degreeRank(item.entry.degree) > 0)
    .sort((a, b) => degreeRank(a.entry.degree) - degreeRank(b.entry.degree)).at(-1)?.entry;
  // A missing degree in a higher education record is not evidence that the lower degree is highest.
  const unknownHigherDegree = highestAcademicCandidate && education.some(({ entry }) =>
    ranks[entry.level] > ranks[highestAcademicCandidate.level] && !degreeRank(entry.degree) && entry.degree?.trim() !== '无');
  const highestAcademic = unknownHigherDegree ? undefined : highestAcademicCandidate?.id;
  const field = (target: string, kind: WorkflowField['kind'], label: string, value?: string): WorkflowField => ({ target, kind, label, value });
  const records: WorkflowRecord[] = [
    ...education.map(({ entry }): WorkflowRecord => ({
      id: `education:${entry.id}`, section: 'educationInfo', title: `${entry.level} · ${entry.school ?? '未填写学校'}`,
      name: entry.school ?? '', stage: entry.level, startDate: entry.startDate, endDate: entry.endDate,
      fields: [
        field('education', 'select', '学历', entry.level), field('educationType', 'select', '教育类型', entry.educationType),
        field('schoolProperty', 'select', '院校性质', entry.schoolProperty), field('degree1', 'select', '学位', entry.degree),
        field('educationSchool', 'school', '学校名称', entry.school),
        field('country', 'select', '院校国家/地区', entry.country), field('lengthOfSchooling', 'select', '学制', entry.durationYears),
        field('isFulltime', 'radio', '是否全日制', entry.studyMode ? isFulltime(entry.studyMode) ? 'Y' : /非全日制/.test(entry.studyMode) ? 'N' : undefined : undefined),
        field('isHigestDegree', 'radio', '是否最高学历', entry.id === highest ? 'Y' : 'N'),
        field('isFulltimeMaxEdu', 'radio', '是否全日制最高学历', entry.id === highestFulltime ? 'Y' : 'N'),
        field('isMainStudy1', 'radio', '是否主学习经历', education.find(item => item.entry.level === entry.level)?.entry.id === entry.id ? 'Y' : 'N'),
        field('isHigestAcademic1', 'radio', '是否最高学位', highestAcademic ? entry.id === highestAcademic ? 'Y' : 'N' : undefined),
        field('sltTime', 'date', '入学日期', fullDate(entry.startDate, false, request.monthBoundaryDates)),
        field('sltTime_t', 'date', '毕业日期', fullDate(entry.endDate, true, request.monthBoundaryDates)),
        field('college1', 'text', '院系', entry.college), field('specialty1', 'text', '专业名称', entry.major),
        field('researchArea1', 'text', '研究方向', entry.researchDirection), field('course1', 'text', '专业课程', entry.courses),
        field('rank', 'select', '年级排名', entry.ranking),
      ],
    })),
    ...request.projects.map((entry): WorkflowRecord => ({
      id: `projects:${entry.id}`, section: 'projectInfo', title: entry.name ?? '未填写项目名称', name: entry.name ?? '',
      startDate: entry.startDate, endDate: entry.endDate,
      verifyTargets: ['projectName', 'projectJob', 'projectDuty', 'projectDesc', 'projectArchievement'],
      replaceTargets: ['projectName', 'projectJob', 'projectDuty', 'projectDesc', 'projectArchievement'],
      fields: [field('projectName', 'text', '项目名称', entry.name), field('projectCompany', 'text', '所在单位', entry.organization),
        field('projectJob', 'text', '职务', entry.role),
        field('projectTime', 'date', '项目开始日期', fullDate(entry.startDate, false, request.monthBoundaryDates)),
        field('projectTime_t', 'date', '项目结束日期', fullDate(entry.endDate, true, request.monthBoundaryDates)),
        field('projectDuty', 'text', '项目职责', entry.responsibilities), field('projectDesc', 'text', '项目简述', entry.description),
        field('projectArchievement', 'text', '项目业绩', entry.achievements)],
    })),
    ...(request.awards ?? []).map((entry): WorkflowRecord => ({
      id: `awards:${entry.id}`, section: 'awardInfo', title: entry.name ?? '未填写奖励名称', name: entry.shortName || entry.name || '',
      startDate: entry.date?.slice(0, 7), verifyTargets: ['awardSummary'], replaceTargets: ['awardSummary'],
      fields: [
        field('isCadres', 'radio', '是否学生干部', request.studentCadre === '否' ? 'N' : request.studentCadre === '是' ? 'Y' : undefined),
        field('cadresDesc', 'text', '学生干部描述', request.studentCadreDescription),
        field('awardSchool', 'text', '所在学校', entry.school), field('awardType', 'text', '奖项类别', entry.category),
        field('awardName', 'text', '奖励名称', entry.shortName || entry.name),
        field('awardLevel', 'select', '奖励级别', awardLevel(entry.level)),
        field('awardObtainTime', 'month', '获奖时间', entry.date?.slice(0, 7)),
        field('scholarshipLevel', 'select', '奖学金等级', /奖学金/u.test(`${entry.name ?? ''}${entry.category ?? ''}`) ? entry.scholarshipLevel || entry.level?.match(/[一二三]等奖/u)?.[0] : undefined),
        field('awardSummary', 'text', '简要描述', entry.description),
      ],
    })),
  ];
  const order: WorkflowRecord['section'][] = ['educationInfo', 'schoolPostInfo', 'workInfo', 'projectInfo', 'awardInfo', 'treatiseInfo', 'languageInfo', 'skillInfo', 'computerSkillInfo'];
  return [...records, ...additionalRecords(request)].sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
}
function awardLevel(value?: string): string | undefined {
  const level = value?.match(/^(国际级|国家级|省部级|省级|地市级|市级|院校级|校级|其他)/u)?.[1];
  return level === '省级' ? '省部级' : level === '校级' ? '院校级' : level === '市级' ? '地市级' : level ?? value;
}
