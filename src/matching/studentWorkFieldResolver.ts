import type { FieldDescriptor } from '../shared/types';
import { studentWorkProjectionEntrySchema, type StudentWorkProjectionEntry } from '../profile/studentWorkProjection';
import { AUTO_CONFIDENCE, normalize } from './confidence';
import { calendarDateBounds } from '../profile/calendarDates';
import { effectiveMaxLength } from './profileResolver';
import { resolveEndDate } from './endDate';
import { matchOption } from './optionMatcher';
import type { RecordFieldReason } from './recordFieldReason';
export type StudentWorkFieldResolution = Readonly<{ status: 'known'; key: string; value: string; confidence: number }>
  | Readonly<{ status: 'request-human'; reason: RecordFieldReason }>;
type Key = 'organization' | 'department' | 'role' | 'cadreLevel' | 'shortDuties' | 'description' | 'achievements' | 'startDate' | 'endDate';
const labels = new Map<string, Key>([
  ['组织团体名称', 'organization'], ['组织名称', 'organization'], ['organization', 'organization'],
  ['所在部门', 'department'], ['部门名称', 'department'], ['department', 'department'],
  ['担任职务', 'role'], ['职务名称', 'role'], ['role', 'role'], ['position', 'role'],
  ['干部级别', 'cadreLevel'], ['cadre level', 'cadreLevel'],
  ['职责和成就', 'shortDuties'], ['职责与成就', 'shortDuties'], ['duties and achievements', 'shortDuties'],
  ['工作职责', 'description'], ['职责描述', 'description'], ['duties', 'description'],
  ['取得成就', 'achievements'], ['工作成就', 'achievements'], ['achievements', 'achievements'],
  ['开始时间', 'startDate'], ['开始日期', 'startDate'], ['起始日期', 'startDate'], ['start date', 'startDate'],
  ['结束时间', 'endDate'], ['结束日期', 'endDate'], ['end date', 'endDate'],
].map(([label, key]) => [normalize(label!), key as Key]));
const captions = new Set(['校内职务', 'student work', 'campus positions'].map(normalize));
const reject = (reason: RecordFieldReason): StudentWorkFieldResolution => Object.freeze({ status: 'request-human', reason });
function meaning(text: string): Key | undefined {
  return labels.get(normalize(text).replace(/^请输入/u, ''));
}
/** Current local record only; the caller must separately prove scope, freshness and write authority. */
export function resolveStudentWorkField(field: FieldDescriptor, record: StudentWorkProjectionEntry): StudentWorkFieldResolution {
  if (!studentWorkProjectionEntrySchema.safeParse(record).success) return reject('profile-value-invalid');
  const direct = [field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder];
  if (field.disabled || field.blockedReason || field.kind === 'checkbox'
    || field.readOnly && !['date', 'month'].includes(field.type)
    || field.kind === 'input' && !['text', 'search', 'date', 'month'].includes(field.type)
    || /是否|有无|有没有|验证码|校验码|证明人|联系人|上传|附件|签名|授权|协议|声明|承诺|captcha|referee|contact|upload|attachment|consent|signature|whether/iu.test(direct.join(' ')))
    return reject('field-unsupported');
  const withoutCaption = (text: string) => text.trim() && !captions.has(normalize(text));
  const primary = [field.label, field.ariaLabel, field.tableHeader].filter(withoutCaption);
  const mapped = (primary.length ? primary : direct.filter(withoutCaption)).map(meaning);
  const keys = new Set(mapped.filter((key): key is Key => key !== undefined));
  if (!keys.size) return reject('field-semantic-unknown');
  if (keys.size !== 1 || mapped.some(key => key === undefined)) return reject('field-semantic-ambiguous');
  const key = [...keys][0]!;
  const isDate = key === 'startDate' || key === 'endDate';
  if (['date', 'month'].includes(field.type) && !isDate) return reject('field-unsupported');
  let value = record[key];
  if (key === 'endDate') {
    const end = resolveEndDate(record, field);
    if (!end.value) return reject(end.ongoing ? 'field-options-unresolved' : 'profile-value-missing');
    value = end.value;
  }
  if (!value?.trim()) return reject('profile-value-missing');
  const ongoing = key === 'endDate' && resolveEndDate(record, field).ongoing;
  if (isDate && !ongoing) {
    if (!calendarDateBounds(value)) return reject('profile-value-invalid');
    if (field.type === 'date' && value.length !== 10) return reject('profile-date-precision');
    if (field.type === 'month') value = value.slice(0, 7);
  }
  const limit = effectiveMaxLength(field);
  if (limit !== null && value.length > limit) return reject('profile-value-too-long');
  if (field.kind === 'select' || field.kind === 'radio') {
    const option = matchOption(field, { fieldId: field.id, fieldName: '', matchedProfileKey: 'studentWork.' + key,
      value, confidence: AUTO_CONFIDENCE, source: 'rule', status: 'auto', sensitive: false, reason: '' });
    if (option.status !== 'auto' || option.value === undefined) return reject('field-options-unresolved');
    value = option.value;
  }
  return Object.freeze({ status: 'known', key: 'studentWork.' + key, value, confidence: AUTO_CONFIDENCE });
}
