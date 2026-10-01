import { collectionPresence, type CollectionKey } from '../profile/facts';
import type { UserProfile } from '../profile/schema';
import type { FieldDescriptor, MatchResult } from '../shared/types';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
const questions = new Map<string, CollectionKey>();
const labels: Record<CollectionKey, string[]> = {
  projects: ['项目经历'], internships: ['实习经历'], studentWork: ['校内职务', '学生工作经历'],
  awards: ['在校奖励活动', '奖励', '获奖经历'], papers: ['专业论著', '论文'],
  patents: ['专利'], certificates: ['证书'], computerSkills: ['计算机技能'],
};
for (const [key, captions] of Object.entries(labels)) for (const caption of captions) {
  for (const prefix of ['是否有', '是否具有']) questions.set(normalize(`${prefix}${caption}`), key as CollectionKey);
}
/** Only exact applicant existence questions. Broader questions must not become descriptions or default No. */
export function matchCollectionPresence(field: FieldDescriptor, profile: UserProfile, blank: MatchResult): MatchResult | undefined {
  const primary = [field.label, field.ariaLabel, field.tableHeader].filter(text => !!text.trim());
  const captions = (primary.length ? primary : [field.title]).filter(Boolean).map(normalize);
  const keys = captions.map(caption => questions.get(caption));
  if (!captions.some(caption => /^(?:是否有|是否具有)/u.test(caption))) return undefined;
  const key = keys[0];
  if (!key || keys.some(candidate => candidate !== key)) return { ...blank, status: 'review', reason: '问题范围或资料来源不明确，不能用经历列表代替回答。' };
  const result = { ...blank, matchedProfileKey: `collectionFacts.${key}` };
  if (!['select', 'radio', 'checkbox'].includes(field.kind)) return { ...result, status: 'review', reason: '存在性问题需要明确的可选答案，不能填入经历原文。' };
  const presence = collectionPresence(profile, key);
  if (presence === 'unknown' || presence === 'not_applicable') return { ...result,
    reason: presence === 'unknown' ? '尚未确认是否有这类经历；空列表不代表没有。请在档案中补充。' : '档案标记为不适用，不能自动回答是或否。' };
  const answers = presence === 'known' ? ['是', '有', '存在', 'yes', 'true', 'y', 'on'] : ['否', '无', '没有', '不存在', 'no', 'false', 'n', 'off'];
  const options = field.options.filter(option => !option.disabled && option.value !== '' && answers.includes(normalize(option.label)));
  if (options.length !== 1) return { ...result, status: 'review', reason: '网页没有唯一可用的是或否选项，需要人工选择。' };
  return { ...result, value: options[0]!.value, confidence: 1, status: 'auto',
    reason: presence === 'known' ? '档案有对应经历或已明确确认有，网页答案唯一。' : '档案已明确确认没有这类经历，网页答案唯一。' };
}
