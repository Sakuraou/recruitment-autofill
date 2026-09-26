import type { SemanticEvidence, SemanticSectionRole } from '../../shared/semanticGraph';

export type SectionLabelEvidence = Extract<SemanticEvidence, 'legend' | 'heading' | 'aria-name'>;

export interface SectionLabelCandidate {
  /** The caller must remove field values and other personal content before classification. */
  text: string;
  evidence: SectionLabelEvidence;
}

export interface ClassifiedSection {
  role: SemanticSectionRole;
  confidence: number;
  /** Only fixed evidence tags are returned; source text is never copied into the result. */
  evidence: SectionLabelEvidence[];
}

const SOURCE_WEIGHT: Readonly<Record<SectionLabelEvidence, number>> = {
  legend: 0.98,
  heading: 0.95,
  'aria-name': 0.87,
};

const labels: Readonly<Record<Exclude<SemanticSectionRole, 'other'>, readonly string[]>> = {
  basic: [
    '基础信息', '基本信息', '个人信息', '个人资料', '基本资料',
    'basic information', 'personal information', 'personal details', 'profile',
  ],
  'job-intent': [
    '投递意向', '求职意向', '应聘信息', '应聘意向', '职位意向', '申请意向',
    'job preference', 'job preferences', 'career objective', 'application information',
    'application preference',
  ],
  education: [
    '教育经历', '教育背景', '学历信息', '学习经历',
    'education', 'educational background', 'education history', 'academic background',
  ],
  'student-work': [
    '校内职务', '学生工作', '校园职务', '校园经历', '学生干部经历', '社团经历', '校内实践',
    'campus experience', 'campus activities', 'student leadership', 'student activities',
    'on-campus experience',
  ],
  internship: [
    '实习经历', '工作经历', '实践经历', '实习工作经历', '实习及工作经历', '实习与工作经历',
    'internship', 'internships', 'internship experience', 'work experience',
    'professional experience', 'employment history',
  ],
  project: [
    '项目经历', '项目经验', '科研项目', '项目实践',
    'project experience', 'projects', 'research projects',
  ],
  award: [
    '在校奖励', '在校奖励活动', '获奖经历', '奖励经历', '荣誉奖励', '荣誉奖项', '荣誉与奖项',
    '竞赛经历', '奖学金及荣誉', '奖励与荣誉',
    'honors and awards', 'awards', 'competitions', 'achievements',
  ],
  publication: [
    '专业论著', '论文论著', '论文成果', '学术成果', '发表论文', '科研成果',
    'publications', 'publication', 'research publications', 'papers and publications',
    'academic publications',
  ],
  language: [
    '语言证书', '语言能力', '外语能力', '英语能力',
    'language skills', 'language proficiency', 'languages', 'language certificates',
  ],
  skill: [
    '技能特长', '专业技能', '计算机技能', 'it技能', '个人技能',
    'special skills', 'skills', 'technical skills', 'computer skills', 'competencies',
  ],
  family: [
    '家庭成员', '家庭信息', '家庭关系', '亲属关系',
    'family members', 'family information', 'family details',
  ],
};

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*(?:第\s*)?[一二三四五六七八九十百\d]+\s*[、.．:：)）-]\s*/u, '')
    .replace(/[（(]\s*(?:必填|选填|可选|required|optional|最多\s*\d+\s*(?:条|项)?)\s*[)）]/giu, '')
    .replace(/^[*＊•·\s]+|[*＊•·\s:：]+$/gu, '')
    .replace(/[／]/gu, '/')
    .replace(/\s+/gu, ' ')
    .trim();
}

const labelToRole = new Map<string, Exclude<SemanticSectionRole, 'other'>>(
  Object.entries(labels).flatMap(([role, values]) => values.map(value => [
    normalizeLabel(value), role as Exclude<SemanticSectionRole, 'other'>,
  ] as const)),
);

const promptOrAction = /(?:是否|有无|暂无|请(?:选择|输入|填写|补充)|(?:新增|添加|新建|填写|编辑|修改|删除|保存|取消).*(?:经历|信息|项目|职务|奖励|论文|证书|技能|成员)|do\s+you|please\s+(?:select|enter|fill)|(?:add|create|edit|delete|save)\s+)/iu;

function recognizedRole(value: string): Exclude<SemanticSectionRole, 'other'> | undefined {
  const normalized = normalizeLabel(value);
  if (!normalized || normalized.length > 64 || promptOrAction.test(normalized)) return undefined;
  return labelToRole.get(normalized);
}

/**
 * Classifies sanitized section-name candidates without retaining or returning their text.
 * Conflicting weak signals deliberately fall back to `other`.
 */
export function classifySection(candidates: readonly SectionLabelCandidate[]): ClassifiedSection {
  const scores = new Map<Exclude<SemanticSectionRole, 'other'>, number>();
  const sources = new Map<Exclude<SemanticSectionRole, 'other'>, Set<SectionLabelEvidence>>();

  for (const candidate of candidates) {
    const role = recognizedRole(candidate.text);
    if (!role) continue;
    const roleSources = sources.get(role) ?? new Set<SectionLabelEvidence>();
    roleSources.add(candidate.evidence);
    sources.set(role, roleSources);
    scores.set(role, Math.max(scores.get(role) ?? 0, SOURCE_WEIGHT[candidate.evidence]));
  }

  const ranked = [...scores.entries()]
    .map(([role, base]) => ({
      role,
      confidence: Math.min(1, base + Math.max(0, (sources.get(role)?.size ?? 1) - 1) * 0.02),
    }))
    .sort((left, right) => right.confidence - left.confidence || left.role.localeCompare(right.role));
  const best = ranked[0];
  if (!best) return { role: 'other', confidence: 0, evidence: [] };

  const runnerUp = ranked[1];
  if (runnerUp && best.confidence - runnerUp.confidence < 0.08) {
    return { role: 'other', confidence: 0, evidence: [] };
  }

  const evidence = [...(sources.get(best.role) ?? [])]
    .sort((left, right) => SOURCE_WEIGHT[right] - SOURCE_WEIGHT[left]);
  return { role: best.role, confidence: best.confidence, evidence };
}
