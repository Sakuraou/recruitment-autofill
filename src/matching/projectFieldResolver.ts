import type { ProjectProjectionEntry } from '../profile/projection';
import type { FieldDescriptor, MatchResult } from '../shared/types';
import { detectField } from './fieldMatcher';
import { matchOption } from './optionMatcher';
import { effectiveMaxLength } from './profileResolver';
import { AUTO_CONFIDENCE, normalize } from './confidence';
import { calendarDateBounds, dateRangePossible } from '../profile/calendarDates';
import { resolveEndDate } from './endDate';

export type ProjectFieldReason = 'field-semantic-unknown' | 'field-semantic-ambiguous' | 'profile-value-missing'
  | 'profile-date-precision' | 'profile-value-invalid' | 'field-options-unresolved' | 'profile-value-too-long'
  | 'field-unsupported';
export type ProjectFieldResolution = Readonly<{
  status: 'known'; key: string; value: string; confidence: number;
}> | Readonly<{ status: 'request-human'; reason: ProjectFieldReason }>;

const keys: ReadonlySet<string> = new Set(['name', 'description', 'responsibilities', 'role', 'organization',
  'startDate', 'endDate', 'achievements', 'technologies', 'url']);
const ownershipCaptions = new Set(['项目经历', '项目', '课题', 'project', 'projects', 'project experience', 'project experiences'].map(normalize));

function dateValue(value: string, field: FieldDescriptor): string | ProjectFieldReason {
  if (!calendarDateBounds(value)) return 'profile-value-invalid';
  if (field.type === 'date' && value.length !== 10) return 'profile-date-precision';
  return field.type === 'month' ? value.slice(0, 7) : value;
}

/** Call only for a field owned by an already-verified project editor. */
export function resolveProjectField(field: FieldDescriptor, record: ProjectProjectionEntry): ProjectFieldResolution {
  const reject = (reason: ProjectFieldReason): ProjectFieldResolution => Object.freeze({ status: 'request-human', reason });
  if (field.blockedReason || field.kind === 'checkbox') return reject('field-unsupported');
  if (/隐私协议|用户协议|我同意|授权|承诺|声明|consent|signature|i\s+agree/iu.test([
    field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder,
  ].join(' '))) return reject('field-unsupported');
  // Editor ownership supplies collection context; it does not turn personal,
  // education, authorization or unknown labels into project fields.
  // Section headings and enclosing editor text provide ownership, never an
  // answer label. In particular, “项目经历” above an unknown input must not
  // turn that input into the project's description.
  const withoutCaption = (text: string): string => ownershipCaptions.has(normalize(text)) ? '' : text;
  const scoped = { ...field, label: withoutCaption(field.label), ariaLabel: withoutCaption(field.ariaLabel),
    tableHeader: withoutCaption(field.tableHeader), title: withoutCaption(field.title), placeholder: withoutCaption(field.placeholder) };
  const hasPrimaryLabel = [scoped.label, scoped.ariaLabel, scoped.tableHeader].some(text => text.trim());
  const detected = detectField({ ...scoped, sectionText: '项目经历', previousText: '', parentText: '',
    ...(hasPrimaryLabel ? { name: '', htmlId: '', title: '', placeholder: '' } : {}) });
  if (!detected || detected.alias.scope !== 'projects' || !keys.has(detected.alias.key)) return reject('field-semantic-unknown');
  if (detected.ambiguous || detected.confidence < AUTO_CONFIDENCE) return reject('field-semantic-ambiguous');
  return resolveProjectValue(field, record, detected.alias.key as Exclude<keyof ProjectProjectionEntry, 'id'>,
    detected.confidence, detected.source);
}

/** Logical meaning already verified by the caller; formatting still uses the same local project rules. */
export function resolveBoundProjectField(field: FieldDescriptor, record: ProjectProjectionEntry, path: string): ProjectFieldResolution {
  const key = path.startsWith('projects.') ? path.slice(9) : '';
  if (!keys.has(key)) return Object.freeze({ status: 'request-human', reason: 'field-semantic-unknown' });
  if (field.blockedReason || field.disabled || field.readOnly || field.kind === 'checkbox'
    || field.kind === 'input' && (!['text', 'search', 'url', 'date', 'month'].includes(field.type)
      || field.type === 'url' && key !== 'url' || ['date', 'month'].includes(field.type) && !['startDate', 'endDate'].includes(key))
    || /隐私协议|用户协议|我同意|授权|承诺|声明|consent|signature|i\s+agree/iu.test([
      field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder,
    ].join(' '))) return Object.freeze({ status: 'request-human', reason: 'field-unsupported' });
  return resolveProjectValue(field, record, key as Exclude<keyof ProjectProjectionEntry, 'id'>, 0.9, 'rule');
}

function resolveProjectValue(field: FieldDescriptor, record: ProjectProjectionEntry, key: Exclude<keyof ProjectProjectionEntry, 'id'>,
  confidence: number, source: MatchResult['source']): ProjectFieldResolution {
  const reject = (reason: ProjectFieldReason): ProjectFieldResolution => Object.freeze({ status: 'request-human', reason });
  if (key === 'endDate') {
    const resolved = resolveEndDate(record, field);
    if (resolved.ongoing) {
      if (!resolved.value) return reject('field-options-unresolved');
      const option = field.options.find(item => item.label === resolved.value && !item.disabled);
      return option ? Object.freeze({ status: 'known', key: 'projects.endDate', value: option.value, confidence }) : reject('field-options-unresolved');
    }
    if (!resolved.value) return reject('profile-value-missing');
  }
  const raw = record[key];
  let value = Array.isArray(raw) ? raw.join('、') : raw;
  if (typeof value !== 'string') value = undefined;
  if (typeof value !== 'string' || !value.trim()) return reject('profile-value-missing');
  if (key === 'startDate' || key === 'endDate') {
    if (!dateRangePossible(record.startDate, record.endDate)) return reject('profile-value-invalid');
    const date = dateValue(value, field);
    if (date === 'profile-value-invalid' || date === 'profile-date-precision') return reject(date);
    value = date;
  }
  const limit = effectiveMaxLength(field);
  if (limit !== null && value.length > limit) return reject('profile-value-too-long');
  if (field.kind === 'select' || field.kind === 'radio') {
    const candidate: MatchResult = { fieldId: field.id, fieldName: '', matchedProfileKey: `projects.${key}`,
      value, confidence, source, status: 'auto', sensitive: false, reason: '' };
    const matched = matchOption(field, candidate);
    if (matched.status !== 'auto' || matched.value === undefined) return reject('field-options-unresolved');
    value = matched.value;
  }
  return Object.freeze({ status: 'known', key: `projects.${key}`, value, confidence });
}
