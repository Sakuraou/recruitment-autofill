import type { FieldDescriptor, MatchResult } from '../shared/types';
import { effectiveMaxLength } from './profileResolver';
import { matchOption } from './optionMatcher';
import { directTexts } from './fieldMatcher';
import { internshipSalaryProblem } from './internshipSalary';

/** Units are visible evidence, never inferred from a saved number or a model claim. */
export function hasMeasurementUnits(field: FieldDescriptor, key: 'heightCm' | 'weightKg'): boolean {
  const evidence = directTexts(field).join(' ').normalize('NFKC');
  return key === 'heightCm'
    ? /厘米|\bcm\b/iu.test(evidence) && !/英寸|inch|feet|\bft\b|米(?![\p{L}])/iu.test(evidence.replace(/厘米/gu, ''))
    : /千克|公斤|\bkg\b/iu.test(evidence) && !/磅|\blbs?\b|pounds?|斤/iu.test(evidence);
}

/** Shared value formatting: never invent a day, truncate text or infer a numeric answer. */
export function finalizeCandidateValue(field: FieldDescriptor, matched: MatchResult): MatchResult {
  if (matched.value === undefined) return matched;
  const value = matched.value;
  if (/^internships\.(?:\d+|\*)\.monthlySalary$/u.test(matched.matchedProfileKey ?? '') && internshipSalaryProblem(field, value)) {
    return { ...matched, value: undefined, status: 'review', reason: '档案仅保存税前月薪范围；金额、币种、税后或其他周期不能推算，请核对口径。' };
  }
  const maxLength = effectiveMaxLength(field);
  if (maxLength !== null && value.length > maxLength) return { ...matched, status: 'review', value: undefined,
    reason: `档案原文超过 ${maxLength} 字限制，请人工改写；没有截断内容。` };
  if (field.type === 'month' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) matched = { ...matched, value: value.slice(0, 7) };
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return { ...matched, value: undefined, status: 'review', reason: '网页需要完整日期，但档案只有年月；不能推测具体日期。' };
  if (field.type === 'number' && !/^-?\d+(?:\.\d+)?$/u.test(value)) return { ...matched, value: undefined, status: 'review', reason: '网页要求纯数字，档案格式不一致，需要人工确认数值。' };
  return matchOption(field, matched);
}
