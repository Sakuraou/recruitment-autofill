import type { EducationProjectionEntry } from '../profile/educationProjection';
import type { FieldDescriptor, MatchResult } from '../shared/types';
import { detectField } from './fieldMatcher';
import { AUTO_CONFIDENCE, normalize } from './confidence';
import { matchOption } from './optionMatcher';
import { effectiveMaxLength } from './profileResolver';
import { calendarDateBounds, dateRangePossible } from '../profile/calendarDates';
import { resolveEndDate } from './endDate';
import type { RecordFieldReason } from './recordFieldReason';

export type EducationFieldResolution = Readonly<{ status: 'known'; key: string; value: string; confidence: number }>
  | Readonly<{ status: 'request-human'; reason: RecordFieldReason }>;
const reject = (reason: RecordFieldReason): EducationFieldResolution => Object.freeze({ status: 'request-human', reason });
const keys = ['school', 'college', 'major', 'majorCategory', 'level', 'degree', 'startDate', 'endDate', 'studyMode',
  'gpa', 'gpaScale', 'ranking', 'researchDirection', 'courses', 'educationType', 'schoolProperty', 'country', 'durationYears'] as const;
type Key = typeof keys[number];
const allowed: ReadonlySet<string> = new Set(keys);
const captions = new Set(['教育经历', '教育', '教育背景', 'education', 'education experience', 'academic background'].map(normalize));
const stages: readonly [EducationProjectionEntry['level'], RegExp][] = [['本科', /本科|学士|bachelor|undergraduate/iu],
  ['硕士研究生', /硕士|master/iu], ['博士研究生', /博士|doctor|phd/iu], ['专科', /专科|大专|associate/iu]];
function fieldProblem(field: FieldDescriptor, record: EducationProjectionEntry): RecordFieldReason | undefined {
  const direct = [field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder].join(' ');
  if (field.blockedReason || field.disabled || field.kind === 'checkbox'
    || field.readOnly && !['date', 'month'].includes(field.type)
    || /隐私协议|用户协议|我同意|授权|承诺|声明|验证码|consent|signature|i\s+agree|verification\s+code/iu.test(direct)) return 'field-unsupported';
  if (/最高|highest/iu.test(direct)) return 'field-semantic-ambiguous';
  const selected = stages.filter(([, pattern]) => pattern.test([field.label, field.ariaLabel, field.tableHeader].join(' ')));
  if (selected.some(([level]) => level !== record.level)) return 'field-semantic-ambiguous';
  return undefined;
}
/** Pure value formatting for an already-owned editor's explicit current education record. */
export function resolveEducationField(field: FieldDescriptor, record: EducationProjectionEntry): EducationFieldResolution {
  const problem = fieldProblem(field, record); if (problem) return reject(problem);
  const withoutCaption = (text: string) => captions.has(normalize(text)) ? '' : text;
  const scoped = { ...field, label: withoutCaption(field.label), ariaLabel: withoutCaption(field.ariaLabel),
    tableHeader: withoutCaption(field.tableHeader), title: withoutCaption(field.title), placeholder: withoutCaption(field.placeholder) };
  const labelled = [scoped.label, scoped.ariaLabel, scoped.tableHeader].some(text => text.trim());
  const detected = detectField({ ...scoped, sectionText: '教育经历', previousText: '', parentText: '',
    ...(labelled ? { name: '', htmlId: '', title: '', placeholder: '' } : {}) });
  if (!detected || detected.alias.scope !== 'education' || !allowed.has(detected.alias.key)) return reject('field-semantic-unknown');
  if (detected.ambiguous || detected.confidence < AUTO_CONFIDENCE) return reject('field-semantic-ambiguous');
  return resolveValue(field, record, detected.alias.key as Key, detected.confidence, detected.source);
}
/** A caller must separately verify model provenance and current-record authority before using this pure formatter. */
export function resolveBoundEducationField(field: FieldDescriptor, record: EducationProjectionEntry, path: string): EducationFieldResolution {
  const key = path.startsWith('education.') ? path.slice(10) : '';
  if (!allowed.has(key)) return reject('field-semantic-unknown');
  const problem = fieldProblem(field, record); if (problem) return reject(problem);
  return resolveValue(field, record, key as Key, 0.9, 'rule');
}
function resolveValue(field: FieldDescriptor, record: EducationProjectionEntry, key: Key,
  confidence: number, source: MatchResult['source']): EducationFieldResolution {
  const isDate = key === 'startDate' || key === 'endDate';
  if (field.kind === 'input' && (!['text', 'search', 'number', 'date', 'month'].includes(field.type)
    || ['date', 'month'].includes(field.type) && !isDate
    || field.type === 'number' && !['gpa', 'gpaScale', 'durationYears'].includes(key))) return reject('field-unsupported');
  let value: string | undefined = record[key];
  if (key === 'endDate') {
    const end = resolveEndDate(record, field);
    if (!end.value) return reject(end.ongoing ? 'field-options-unresolved' : 'profile-value-missing');
    value = end.value;
    if (end.ongoing) {
      const option = field.options.find(entry => entry.label === value && !entry.disabled);
      return option ? Object.freeze({ status: 'known', key: `education.${key}`, value: option.value, confidence }) : reject('field-options-unresolved');
    }
  }
  if (!value?.trim()) return reject('profile-value-missing');
  if (isDate) {
    if (!calendarDateBounds(value) || !dateRangePossible(record.startDate, record.endDate)) return reject('profile-value-invalid');
    if (field.type === 'date' && value.length !== 10) return reject('profile-date-precision');
    if (field.type === 'month') value = value.slice(0, 7);
  }
  if (field.type === 'number' && (!/^\d+(?:\.\d+)?$/u.test(value) || !Number.isFinite(Number(value)))) return reject('profile-value-invalid');
  const limit = effectiveMaxLength(field); if (limit !== null && value.length > limit) return reject('profile-value-too-long');
  if (field.kind === 'select' || field.kind === 'radio') {
    const candidate: MatchResult = { fieldId: field.id, fieldName: '', matchedProfileKey: `education.${key}`, value,
      confidence, source, status: 'auto', sensitive: false, reason: '' };
    const result = matchOption(field, candidate);
    if (result.status !== 'auto' || result.value === undefined) return reject('field-options-unresolved');
    value = result.value;
  }
  return Object.freeze({ status: 'known', key: `education.${key}`, value, confidence });
}
