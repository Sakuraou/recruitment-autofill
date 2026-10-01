import { fullDate, type WorkflowField, type WorkflowRecord, type WorkflowRequest } from './model';
import { confirmedEndDate } from '../profile/facts';

export const sectionConfig: Record<WorkflowRecord['section'], { label: string; save: string; radio?: string; max?: number; identity: string[]; dates: string[] }> = {
  educationInfo: { label: '教育经历', save: 'saveEducationInfo', max: 5, identity: ['educationSchool'], dates: ['sltTime', 'sltTime_t'] },
  projectInfo: { label: '项目经历', save: 'saveProjectInfo', radio: 'isHasProjectInfo', identity: ['projectName'], dates: ['projectTime', 'projectTime_t'] },
  awardInfo: { label: '在校奖励', save: 'saveAwardInfo', radio: 'isHasAwardInfo', identity: ['awardName'], dates: ['awardObtainTime'] },
  schoolPostInfo: { label: '校内职务', save: 'saveSchoolPostInfo', max: 5, identity: ['organizationName', 'schoolJob'], dates: ['schoolPost_startTime', 'schoolPost_endTime'] },
  workInfo: { label: '实习经历', save: 'saveWorkInfo', radio: 'isHasPractiseInfo', max: 5, identity: ['companyName', 'job'], dates: ['workTime', 'workTime_t'] },
  languageInfo: { label: '语言证书', save: 'saveLanguageInfo', radio: 'isHasLanguageInfo', identity: ['englishLevel'], dates: ['englishObtainTime'] },
  skillInfo: { label: '技能特长', save: 'saveSkillInfo', radio: 'isHasSkillInfo', identity: ['skillCertificate'], dates: ['skillObtainTime'] },
  computerSkillInfo: { label: '计算机技能', save: 'saveComputerSkillInfo', radio: 'isHasComputerSkillInfo', max: 5, identity: ['computerSkillType'], dates: [] },
  treatiseInfo: { label: '专业论著', save: 'saveTreatiseInfo', radio: 'isHasTreatiseInfo', identity: ['treatiseName'], dates: ['treatisePublishTime'] },
};
const field = (target: string, kind: WorkflowField['kind'], label: string, value?: string): WorkflowField => ({ target, kind, label, value });
function skillGroups(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const previous = result.at(-1);
    if (previous && `${previous}、${value}`.length <= 100) result[result.length - 1] = `${previous}、${value}`;
    else result.push(value);
  }
  return result;
}
export function additionalRecords(request: WorkflowRequest): WorkflowRecord[] {
  const day = (value?: string, end = false) => fullDate(value, end, request.monthBoundaryDates);
  return [
    ...(request.studentWork ?? []).map((entry): WorkflowRecord => ({
      id: `studentWork:${entry.id}`, section: 'schoolPostInfo', title: `${entry.organization ?? ''} · ${entry.role ?? '校内职务'}`,
      name: entry.organization ?? '', identity: [entry.organization ?? '', entry.role ?? ''], verifyTargets: ['dutyAchievement'], replaceTargets: ['dutyAchievement'], startDate: entry.startDate, endDate: confirmedEndDate(entry),
      fields: [field('organizationName', 'text', '组织团体名称', entry.organization), field('schoolJob', 'text', '担任职务', entry.role),
        field('schoolPost_startTime', 'date', '任职开始时间', day(entry.startDate)), field('schoolPost_endTime', 'date', '任职结束时间', day(confirmedEndDate(entry), true)),
        field('cadreLevel', 'text', '干部级别', entry.cadreLevel), field('dutyAchievement', 'text', '职责和成就', entry.shortDuties || [entry.description, entry.achievements].filter(Boolean).join('；'))],
    })),
    ...(request.internships ?? []).map((entry): WorkflowRecord => entry.experienceType === '社会实践' ? ({
      id: `internships:${entry.id}`, section: 'workInfo', title: `${entry.organization ?? ''} · ${entry.role ?? '社会实践'}`, tab: '校内活动/社会实践',
      name: entry.organization ?? '', identity: [entry.organization ?? '', entry.role ?? '社会实践'], identityTargets: ['activityName', 'activityType'], dateTargets: ['startTime', 'endTime'], verifyTargets: ['activityDesc'], replaceTargets: ['activityDesc'],
      startDate: entry.startDate, endDate: confirmedEndDate(entry),
      fields: [field('activityName', 'text', '活动/实践名称', entry.organization), field('activityType', 'text', '活动/实践类型', entry.role || '社会实践'),
        field('startTime', 'date', '开始日期', day(entry.startDate)), field('endTime', 'date', '结束日期', day(confirmedEndDate(entry), true)),
        field('activityDesc', 'text', '活动描述', [entry.description, entry.achievements].filter(Boolean).join('\n'))],
    }) : ({
      id: `internships:${entry.id}`, section: 'workInfo', title: `${entry.organization ?? '待补单位'} · ${entry.role ?? '实习'}`, tab: '实习经历',
      name: entry.organization ?? '', identity: [entry.organization ?? '', entry.role ?? ''], verifyTargets: ['workDescription'], replaceTargets: ['workDescription'], startDate: entry.startDate, endDate: confirmedEndDate(entry),
      fields: [field('experienceType', 'select', '活动经历类型', entry.experienceType || '实习经历'),
        field('companyName', 'text', '工作单位', entry.organization), field('companyProperty', 'select', '企业性质', entry.companyProperty),
        field('department', 'text', '所在部门', entry.department), field('job', 'text', '职务', entry.role),
        field('workType', 'select', '工作类型', entry.workType || '实习'), field('workPay', 'select', '税前月薪', entry.monthlySalary),
        field('workTime', 'date', '入职日期', day(entry.startDate)), field('workTime_t', 'date', '离职日期', day(confirmedEndDate(entry), true)),
        field('workDescription', 'text', '工作描述', [entry.description, entry.achievements].filter(Boolean).join('\n')),
        field('isHasCertifier', 'radio', '是否有证明', entry.hasProof === '是' ? 'Y' : entry.hasProof === '否' ? 'N' : undefined),
        ...(['certifierName', 'certifierRelation', 'certifierDuty', 'certifierCompany', 'certifierContact'] as const).map((key, i) =>
          field(key, 'text', ['证明人', '与证明人关系', '证明人职务', '证明人单位', '证明人电话'][i]!, entry.hasProof === '是' ? entry[key] : undefined))],
    })),
    ...(request.certificates ?? []).map((entry): WorkflowRecord => {
      const level = /CET[-\s]?6|大学英语六级|英语六级/iu.test(entry.name ?? '') ? 'CET6' : /CET[-\s]?4|大学英语四级|英语四级/iu.test(entry.name ?? '') ? 'CET4' : undefined;
      return level ? { id: `certificates:${entry.id}`, section: 'languageInfo', tab: '英语等级', title: entry.name ?? level, name: level, identity: [level], startDate: entry.date?.slice(0, 7),
        fields: [field('englishLevel', 'select', '英语等级', level), field('englishObtainTime', 'month', '获得时间', entry.date?.slice(0, 7)), field('englishScore', 'text', '成绩', entry.score)] }
        : { id: `certificates:${entry.id}`, section: 'skillInfo', tab: '证书', title: entry.name ?? '未填证书名称', name: entry.name ?? '', identity: [entry.name ?? ''], startDate: entry.date?.slice(0, 7),
          fields: [field('skillCertificate', 'text', '证书名称', entry.name), field('skillObtainTime', 'month', '获得时间', entry.date?.slice(0, 7)), field('skillScore', 'text', '成绩', entry.score),
            field('certificateDesc', 'text', '证书简述', entry.issuer ? `颁发单位：${entry.issuer}` : undefined)] };
    }),
    // Preserve the user's proficiency wording inside the category; do not promote 熟悉 into 精通.
    ...(['programmingLanguages', 'frameworks', 'tools', 'other'] as const).flatMap(key => {
      const values = request.skills?.[key] ?? [];
      if (!values.length) return [];
      return skillGroups(values).map((name, index) => ({ id: `skills:${key}:${index}`, section: 'computerSkillInfo' as const, title: `计算机技能 · ${name}`,
        name, identity: [name], fields: [field('computerSkillType', 'text', '技能类别（100字内）', name)] }));
    }),
    ...(request.papers ?? []).map((entry): WorkflowRecord => ({
      id: `papers:${entry.id}`, section: 'treatiseInfo', title: entry.title ?? '未填论著名称', name: entry.shortTitle || entry.title || '', identity: [entry.shortTitle || entry.title || ''], startDate: entry.date,
      verifyTargets: ['treatiseSynopsis', 'treatiseArchievement', 'treatiseSituation', 'treatiseCoauther'],
      replaceTargets: ['treatiseSynopsis', 'treatiseArchievement', 'treatiseSituation', 'treatiseCoauther'],
      fields: [field('treatiseName', 'text', '论著名称', entry.shortTitle || entry.title), field('treatiseSynopsis', 'text', '内容提要', entry.abstract),
        field('treatiseArchievement', 'text', '成就/等级', entry.status), field('treatisePublishTime', 'date', '日期', day(entry.date)),
        field('authorSort', 'select', '作者排序', entry.authorOrder), field('treatiseSituation', 'text', '发表情况', entry.publicationSituation || entry.venue),
        field('treatiseCoauther', 'text', '合独著说明', entry.coauthors)],
    })),
  ];
}
