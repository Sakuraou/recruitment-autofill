import type { AliasScope, FieldAlias } from '../profile/aliases';
import type { EducationExperience, TextVariants, UserProfile } from '../profile/schema';
import type { FieldDescriptor } from '../shared/types';
import { directTexts } from './fieldMatcher';
import { normalize } from './confidence';

export interface Resolution {
  key: string;
  value?: string;
  reason: string;
  confidence?: number;
  review?: boolean;
  fuzzy?: boolean;
}

const levelRanks: Record<EducationExperience['level'], number> = { '其他': 0, '专科': 1, '本科': 2, '硕士研究生': 3, '博士研究生': 4 };
const levels: [EducationExperience['level'], RegExp][] = [
  ['博士研究生', /博士|doctor|phd/i], ['硕士研究生', /硕士|master/i],
  ['本科', /本科|学士|bachelor|undergraduate/i], ['专科', /专科|大专|associate/i],
];

function readString(record: unknown, key: string): string | undefined {
  if (typeof record !== 'object' || record === null) return undefined;
  const value = (record as Record<string, unknown>)[key];
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.filter(Boolean).join('；') || undefined;
  return undefined;
}

export function effectiveMaxLength(field: FieldDescriptor): number | null {
  const limits = [...directTexts(field), field.parentText].flatMap((text) => [
    ...text.matchAll(/(?:不超过|最多|限|上限|以内|within|max(?:imum)?\s*)\s*(\d{1,5})\s*(?:个?(?:字符|汉字|字)|characters?)/gi),
    ...text.matchAll(/(\d{1,5})\s*(?:个?(?:字符|汉字|字)|characters?)\s*(?:以内|以下|上限|为限)/gi),
  ]).map((match) => Number(match[1])).filter((value) => value > 0);
  if (field.maxLength !== null && field.maxLength >= 0) limits.push(field.maxLength);
  return limits.length ? Math.min(...limits) : null;
}

function variantsValue(variants: TextVariants | undefined, prefix: string, limit: number | null): Resolution {
  if (!variants) return { key: prefix, reason: '未找到可靠信息，需要人工填写。' };
  const values = [
    ...(['short', 'medium', 'long'] as const).map((key) => ({ key: `${prefix}.${key}`, value: variants[key] })),
    ...Object.entries(variants.byLimit).map(([key, value]) => ({ key: `${prefix}.byLimit.${key}`, value })),
  ].filter((entry): entry is { key: string; value: string } => typeof entry.value === 'string' && entry.value.trim().length > 0)
    .sort((a, b) => b.value.length - a.value.length);
  const choice = values.find((entry) => limit === null || entry.value.length <= limit);
  if (!choice) return { key: prefix, review: values.length > 0,
    reason: values.length ? `所有已保存版本均超过 ${limit} 字限制，请手动改写；没有截断原文。` : '未找到可靠信息，需要人工填写。' };
  return { ...choice, reason: limit === null ? '使用档案中最完整的原文版本。' : `使用不超过 ${limit} 字的最完整已保存原文。` };
}

function aggregateValue(key: string, detailed: string[], compact: string[], limit: number | null, subject: string): Resolution {
  const complete = detailed.filter(Boolean).join('\n');
  const concise = compact.filter(Boolean).join('；');
  const choice = [complete, concise].find((value) => value && (limit === null || value.length <= limit));
  if (choice) return { key, value: choice, reason: `按档案顺序汇总全部${subject}，只使用已保存事实。` };
  return { key, review: true, confidence: 0.85,
    reason: `全部${subject}的最简汇总仍超过 ${limit} 字限制；为避免遗漏或截断，请人工精简。` };
}

function sameEducationValue(profile: UserProfile, alias: FieldAlias): string | undefined {
  if (profile.education.length < 2) return undefined;
  const values = profile.education.map((entry) => readString(entry, alias.key));
  if (!values.length || values.some((value) => value === undefined)) return undefined;
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}

function educationValue(field: FieldDescriptor, profile: UserProfile, alias: FieldAlias): Resolution {
  const genericKey = `education.${alias.key}`;
  if (!profile.education.length) return { key: genericKey, reason: '档案尚未填写教育经历。' };
  const direct = directTexts(field).join(' ');
  const context = `${field.sectionText} ${field.name} ${field.htmlId}`;
  const directLevels = levels.filter(([, pattern]) => pattern.test(direct)).map(([level]) => level);
  const selectedLevels = directLevels.length ? directLevels : levels.filter(([, pattern]) => pattern.test(context)).map(([level]) => level);
  if (selectedLevels.length > 1) return { key: genericKey, review: true, confidence: 0.65, reason: '字段包含多个教育阶段，请先确认对应哪一段教育经历。' };
  const explicitlyHighest = /最高|highest/i.test(direct) || (!selectedLevels.length && /最高|highest/i.test(context));
  if (!selectedLevels.length && !explicitlyHighest) {
    const invariant = sameEducationValue(profile, alias);
    if (invariant) return { key: `education.*.${alias.key}`, value: invariant,
      reason: '所有教育经历在该字段上的已保存值一致，直接使用这一共同事实。' };
  }
  const profileSummary = !selectedLevels.length
    && /(?:person|candidate|applicant|resume)[\s_.:[\]-]*profile|个人信息|基本信息/iu.test(`${direct} ${context}`)
    && ['school', 'college', 'major', 'majorCategory', 'level', 'degree', 'studyMode', 'gpa', 'gpaScale', 'ranking', 'researchDirection', 'courses', 'educationType', 'schoolProperty', 'country', 'durationYears'].includes(alias.key);
  const highest = explicitlyHighest || profileSummary;
  let entries = profile.education.map((education, index) => ({ education, index }));
  if (selectedLevels[0]) entries = entries.filter(({ education }) => education.level === selectedLevels[0]);
  else if (highest) {
    const highestRank = Math.max(...entries.map(({ education }) => levelRanks[education.level]));
    entries = entries.filter(({ education }) => levelRanks[education.level] === highestRank);
  } else if (/研究生|graduate/i.test(`${direct} ${context}`)) {
    entries = entries.filter(({ education }) => ['硕士研究生', '博士研究生'].includes(education.level));
  }
  if (!entries.length) return { key: genericKey, reason: '档案中没有该教育阶段的资料，请人工填写。' };
  if (entries.length > 1 && !(highest && alias.key === 'level')) {
    return { key: genericKey, review: true, confidence: 0.65, reason: '存在多段可能的教育经历，不能默认使用第一条；请明确本科、硕士等阶段或人工选择。' };
  }
  const entry = entries[0];
  if (!entry) return { key: genericKey, reason: '未找到可靠信息，需要人工填写。' };
  const key = `education.${entry.index}.${alias.key}`;
  const value = readString(entry.education, alias.key);
  if (alias.key === 'majorCategory' && !value && /^(软件工程|计算机科学与技术|计算机技术)$/.test(entry.education.major ?? '')) {
    return { key: `education.${entry.index}.major`, value: '计算机类', confidence: 0.78, review: true, fuzzy: true,
      reason: `档案只有专业“${entry.education.major}”；“计算机类”仅为待确认建议，需按招聘方专业目录核实。` };
  }
  return { key, value, reason: value ? `${highest ? '按个人资料页的最高学历' : selectedLevels.length ? '按明确教育阶段' : '按唯一教育经历'}读取已保存的${alias.key === 'degree' ? '学位；学位与学历独立保存' : '事实'}。`
    : alias.key === 'degree' ? '该教育经历未填写学位；不能从学历推断学位。' : '这段教育经历尚未填写该项资料。' };
}

const recordCollections = new Set<AliasScope>(['projects', 'internships', 'studentWork', 'awards', 'certificates']);

function collectionValue(field: FieldDescriptor, profile: UserProfile, alias: FieldAlias): Resolution {
  const entries = profile[alias.scope as 'projects' | 'internships' | 'studentWork' | 'awards' | 'certificates'];
  const genericKey = `${alias.scope}.${alias.key}`;
  if (!entries.length) return { key: genericKey, reason: '档案尚未填写此类经历，不能生成或猜测。' };
  if (field.kind === 'textarea' && alias.scope === 'awards' && alias.key === 'description') {
    return aggregateValue('awards', entries.map((entry) => {
      const name = readString(entry, 'shortName') ?? readString(entry, 'name');
      const details = [readString(entry, 'level'), readString(entry, 'issuer'), readString(entry, 'date')].filter(Boolean).join('，');
      return name ? `${name}${details ? `（${details}）` : ''}` : '';
    }), entries.map((entry) => readString(entry, 'shortName') ?? readString(entry, 'name') ?? ''), effectiveMaxLength(field), '获奖与荣誉');
  }
  const summaryLabel = directTexts(field).join(' ');
  if (field.kind === 'textarea' && alias.scope === 'studentWork' && alias.key === 'description'
    && /社会活动|校园活动|学生工作(?:经历)?|社团活动|social\s*activit/iu.test(summaryLabel)) {
    return aggregateValue('studentWork', entries.map((entry) => {
      const organization = readString(entry, 'organization');
      const role = readString(entry, 'role');
      const dates = [readString(entry, 'startDate'), readString(entry, 'endDate')].filter(Boolean).join('—');
      const description = readString(entry, 'description');
      return [[organization, role].filter(Boolean).join('·'), dates && `（${dates}）`, description && `：${description}`].filter(Boolean).join('');
    }), entries.map((entry) => [readString(entry, 'organization'), readString(entry, 'role')].filter(Boolean).join('·')), effectiveMaxLength(field), '校园与社会活动');
  }
  const context = normalize([...directTexts(field), field.sectionText].join(' '));
  const named = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
    const name = readString(entry, 'name') ?? readString(entry, 'organization');
    return name && normalize(name).length >= 2 && context.includes(normalize(name));
  });
  const candidates = named.length ? named : entries.map((entry, index) => ({ entry, index }));
  if (candidates.length !== 1) return { key: genericKey, review: true, confidence: 0.65, reason: '档案有多条相关经历，页面未唯一指明哪条；请人工选择，不能默认第一条。' };
  const candidate = candidates[0];
  if (!candidate) return { key: genericKey, reason: '未找到可靠信息，需要人工填写。' };
  const value = readString(candidate.entry, alias.key);
  return { key: `${alias.scope}.${candidate.index}.${alias.key}`, value,
    reason: value ? '读取唯一对应经历中已保存的原始资料。' : '该经历尚未填写此项资料；不会补造。' };
}

function researchValue(field: FieldDescriptor, profile: UserProfile, alias: FieldAlias): Resolution {
  const key = `research.${alias.key}`;
  if (alias.key !== 'papers' && alias.key !== 'patents') return { key, value: readString(profile.research, alias.key), reason: '读取科研档案中的原始资料。' };
  const entries = profile.research[alias.key];
  if (!entries.length) return { key, reason: '没有已录入的论文或专利；不会虚构，也不会擅自填写“无”。' };
  if (field.kind !== 'textarea') return { key, review: true, confidence: 0.65, reason: '论文或专利包含多个子项，请使用文本区汇总或人工选择具体信息。' };
  const isPapers = alias.key === 'papers';
  const detailed = entries.map((entry) => {
    const title = readString(entry, 'shortTitle') ?? readString(entry, 'title');
    const details = (isPapers
      ? [readString(entry, 'venue'), readString(entry, 'status'), readString(entry, 'date')]
      : [readString(entry, 'number'), readString(entry, 'status'), readString(entry, 'date')])
      .filter(Boolean).join('，');
    return title ? `${title}${details ? `（${details}）` : ''}` : '';
  });
  const compact = entries.map((entry) => readString(entry, 'shortTitle') ?? readString(entry, 'title') ?? '');
  return aggregateValue(key, detailed, compact, effectiveMaxLength(field), isPapers ? '论文与学术成果' : '专利成果');
}

export function resolveProfileValue(field: FieldDescriptor, profile: UserProfile, alias: FieldAlias): Resolution {
  if (alias.scope === 'education') {
    const stageContext = [...directTexts(field), field.sectionText, field.name, field.htmlId].join(' ');
    if (alias.key === 'researchDirection' && !/教育|学历|院校|本科|硕士|博士|专科|研究生|最高|education|bachelor|master|doctor|graduate|highest/i.test(stageContext)
      && profile.research.researchDirection) {
      return { key: 'research.researchDirection', value: profile.research.researchDirection, reason: '读取已保存的研究方向。' };
    }
    return educationValue(field, profile, alias);
  }
  if (recordCollections.has(alias.scope)) return collectionValue(field, profile, alias);
  if (alias.scope === 'research') return researchValue(field, profile, alias);
  if (alias.scope === 'commonAnswers') return variantsValue(profile.commonAnswers[alias.key as keyof UserProfile['commonAnswers']], `commonAnswers.${alias.key}`, effectiveMaxLength(field));
  if (alias.scope === 'skills' && alias.key === '*') {
    const value = Object.values(profile.skills).flat().filter(Boolean).join('；') || undefined;
    const limit = effectiveMaxLength(field);
    return value && limit !== null && value.length > limit
      ? { key: 'skills', review: true, confidence: 0.85, reason: `已保存的技能汇总超过 ${limit} 字限制，请人工精简；不会截断。` }
      : { key: 'skills', value, reason: '汇总档案中已保存的技能条目。' };
  }
  return { key: `${alias.scope}.${alias.key}`, value: readString(profile[alias.scope], alias.key), reason: '从本地档案读取已保存的原始资料。' };
}
