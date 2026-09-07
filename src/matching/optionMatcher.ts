import type { FieldDescriptor, FieldOption, MatchResult } from '../shared/types';
import { candidateStatus, normalize } from './confidence';

const optionAliases: readonly (readonly string[])[] = [
  ['硕士研究生', '硕士', 'Master', "Master's", "Master's degree"],
  ['博士研究生', '博士', 'Doctor', 'Doctoral', 'PhD'],
  ['本科', '大学本科', 'Bachelor', "Bachelor's"],
  ['专科', '大专', '大学专科', 'College diploma', 'Associate'],
  ['学士', '学士学位', "Bachelor's degree"],
  ['硕士学位', 'Master degree'], ['博士学位', 'Doctoral degree'],
  ['男', '男性', 'Male', 'M'], ['女', '女性', 'Female', 'F'],
  ['全日制', '普通全日制', 'Full time'], ['非全日制', 'Part time'],
  ['中华人民共和国', '中国', 'China', 'Chinese'],
  ['居民身份证', '身份证', '中华人民共和国居民身份证'],
];

/** Numeric punctuation carries meaning: 前5.0% must never become 前50%. */
function normalizeOption(value: string): string {
  const text = value.normalize('NFKC').toLowerCase();
  return /\d/u.test(text) ? text.replace(/\s+/gu, '') : normalize(text);
}

function equivalent(a: string, b: string): boolean {
  const left = normalizeOption(a);
  const right = normalizeOption(b);
  return optionAliases.some((group) => group.some((value) => normalizeOption(value) === left)
    && group.some((value) => normalizeOption(value) === right));
}

function optionTexts(option: FieldOption): string[] {
  // Only visible labels carry meaning. Form values may be arbitrary or even contradictory IDs.
  return [option.label];
}

function choose(result: MatchResult, option: FieldOption, confidence: number, source: MatchResult['source'], reason: string): MatchResult {
  const score = Math.min(result.confidence, confidence);
  return { ...result, value: option.value, confidence: score,
    source: result.source === 'fuzzy' ? 'fuzzy' : source,
    status: result.status === 'review' ? 'review' : candidateStatus(score, source),
    reason: `${result.reason}；${reason}：${option.label}` };
}

/** Native option values are returned only after matching their visible labels. */
export function matchOption(field: FieldDescriptor, result: MatchResult): MatchResult {
  if (result.value === undefined || !['select', 'radio', 'checkbox'].includes(field.kind)) return result;
  const value = result.value;
  const available = field.options.filter((option) => !option.disabled && option.value !== ''
    && !/^(?:请选择|选择|please select|select an option|--)/i.test(option.label.trim()));
  const exact = available.filter((option) => optionTexts(option).some((text) => normalizeOption(text) === normalizeOption(value)));
  if (exact.length === 1 && exact[0]) return choose(result, exact[0], 1, result.source, '选项唯一精确匹配');
  if (exact.length > 1) return { ...result, value: undefined, confidence: 0.75, status: 'review', reason: '存在多个同名选项，需要人工选择。' };
  const aliases = available.filter((option) => optionTexts(option).some((text) => equivalent(text, value)));
  if (aliases.length === 1 && aliases[0]) return choose(result, aliases[0], 0.95, 'alias', '选项唯一别名匹配');
  if (aliases.length > 1) return { ...result, value: undefined, confidence: 0.75, status: 'review', reason: '多个选项均符合别名，无法唯一确定。' };
  const fuzzy = available.filter((option) => optionTexts(option).some((text) => {
    const candidate = normalizeOption(text);
    const desired = normalizeOption(value);
    return candidate.length > 1 && desired.length > 1 && (candidate.includes(desired) || desired.includes(candidate));
  }));
  if (fuzzy.length === 1 && fuzzy[0]) return choose(result, fuzzy[0], 0.78, 'fuzzy', '选项只有模糊匹配，需要确认');
  return { ...result, value: undefined, confidence: 0, status: 'review', reason: '档案有值，但网页没有唯一可靠的对应选项，需要人工选择。' };
}
