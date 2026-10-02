import { internshipProjectionEntrySchema, type InternshipProjectionEntry } from '../profile/internshipProjection';
import type { FieldDescriptor, MatchResult } from '../shared/types';
import { detectField } from './fieldMatcher';
import { AUTO_CONFIDENCE, normalize } from './confidence';
import { matchOption } from './optionMatcher';
import { effectiveMaxLength } from './profileResolver';
import { calendarDateBounds, dateRangePossible } from '../profile/calendarDates';
import { resolveEndDate } from './endDate';
import { internshipSalaryProblem } from './internshipSalary';
import type { RecordFieldReason } from './recordFieldReason';

export type InternshipFieldResolution = Readonly<{ status: 'known'; key: string; value: string; confidence: number }>
  | Readonly<{ status: 'request-human'; reason: RecordFieldReason }>;
const reject = (reason: RecordFieldReason): InternshipFieldResolution => Object.freeze({ status: 'request-human', reason });
const keys = ['organization', 'department', 'role', 'startDate', 'endDate', 'description', 'achievements',
  'experienceType', 'workType', 'companyProperty', 'monthlySalary', 'hasProof'] as const;
type Key = typeof keys[number];
const allowed: ReadonlySet<string> = new Set(keys);
const captions = new Set(['实习', '实习经历', '工作经历', 'internship', 'internships', 'internship experience', 'work experience'].map(normalize));
function fieldProblem(field: FieldDescriptor): RecordFieldReason | undefined {
  const direct = [field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder].join(' ');
  if (field.blockedReason || field.disabled || field.kind === 'checkbox'
    || field.readOnly && !['date', 'month'].includes(field.type)
    || /隐私协议|用户协议|我同意|授权|承诺|声明|验证码|校验码|证明人|联系人|上传|附件|签名|consent|signature|i\s+agree|verification\s+code|captcha|referee|certifier|contact|upload|attachment/iu.test(direct)) return 'field-unsupported';
  return undefined;
}
/** Pure formatting only for an explicit current internship record in an already-owned editor. */
export function resolveInternshipField(field: FieldDescriptor, record: InternshipProjectionEntry): InternshipFieldResolution {
  const problem = fieldProblem(field); if (problem) return reject(problem);
  const withoutCaption = (text: string) => captions.has(normalize(text)) ? '' : text;
  const scoped = { ...field, label: withoutCaption(field.label), ariaLabel: withoutCaption(field.ariaLabel),
    tableHeader: withoutCaption(field.tableHeader), title: withoutCaption(field.title), placeholder: withoutCaption(field.placeholder) };
  const labelled = [scoped.label, scoped.ariaLabel, scoped.tableHeader].some(text => text.trim());
  const detected = detectField({ ...scoped, sectionText: '实习经历', previousText: '', parentText: '',
    ...(labelled ? { name: '', htmlId: '', title: '', placeholder: '' } : {}) });
  if (!detected || detected.alias.scope !== 'internships' || !allowed.has(detected.alias.key)) return reject('field-semantic-unknown');
  if (detected.ambiguous || detected.confidence < AUTO_CONFIDENCE) return reject('field-semantic-ambiguous');
  return resolveValue(field, record, detected.alias.key as Key, detected.confidence, detected.source);
}
/** Meaning supplied by a separately verified caller; no array index or other collection is accepted. */
export function resolveBoundInternshipField(field: FieldDescriptor, record: InternshipProjectionEntry, path: string): InternshipFieldResolution {
  const key = path.startsWith('internships.') ? path.slice(12) : '';
  if (!allowed.has(key)) return reject('field-semantic-unknown');
  const problem = fieldProblem(field); if (problem) return reject(problem);
  return resolveValue(field, record, key as Key, 0.9, 'rule');
}
function resolveValue(field: FieldDescriptor, record: InternshipProjectionEntry, key: Key,
  confidence: number, source: MatchResult['source']): InternshipFieldResolution {
  if (!internshipProjectionEntrySchema.safeParse(record).success) return reject('profile-value-invalid');
  const isDate = key === 'startDate' || key === 'endDate';
  if (field.kind === 'input' && (!['text', 'search', 'date', 'month'].includes(field.type)
    || ['date', 'month'].includes(field.type) && !isDate)) return reject('field-unsupported');
  let value = record[key];
  if (key === 'endDate') {
    const end = resolveEndDate(record, field);
    if (!end.value) return reject(end.ongoing ? 'field-options-unresolved' : 'profile-value-missing');
    value = end.value;
    if (end.ongoing) {
      const option = field.options.find(entry => entry.label === value && !entry.disabled);
      return option ? Object.freeze({ status: 'known', key: `internships.${key}`, value: option.value, confidence }) : reject('field-options-unresolved');
    }
  }
  if (!value?.trim()) return reject('profile-value-missing');
  if (isDate) {
    if (!calendarDateBounds(value) || !dateRangePossible(record.startDate, record.endDate)) return reject('profile-value-invalid');
    if (field.type === 'date' && value.length !== 10) return reject('profile-date-precision');
    if (field.type === 'month') value = value.slice(0, 7);
  }
  if (key === 'monthlySalary') { const problem = internshipSalaryProblem(field, value); if (problem) return reject(problem); }
  if (key === 'hasProof' && !['select', 'radio'].includes(field.kind)) return reject('field-unsupported');
  const limit = effectiveMaxLength(field); if (limit !== null && value.length > limit) return reject('profile-value-too-long');
  if (field.kind === 'select' || field.kind === 'radio') {
    const candidate: MatchResult = { fieldId: field.id, fieldName: '', matchedProfileKey: `internships.${key}`, value,
      confidence, source, status: 'auto', sensitive: false, reason: '' };
    const result = matchOption(field, candidate);
    if (result.status !== 'auto' || result.value === undefined) return reject('field-options-unresolved');
    value = result.value;
  }
  return Object.freeze({ status: 'known', key: `internships.${key}`, value, confidence });
}
