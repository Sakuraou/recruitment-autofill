import { publicationProjectionEntrySchema, type PublicationProjectionEntry } from '../profile/publicationProjection';
import { calendarDateBounds } from '../profile/calendarDates';
import type { FieldDescriptor, MatchResult } from '../shared/types';
import { AUTO_CONFIDENCE, normalize } from './confidence';
import { effectiveMaxLength } from './profileResolver';
import { matchOption } from './optionMatcher';
import { detectField } from './fieldMatcher';
import type { RecordFieldReason } from './recordFieldReason';

export type PublicationFieldResolution = Readonly<{ status: 'known'; key: string; value: string; confidence: number }>
  | Readonly<{ status: 'request-human'; reason: RecordFieldReason }>;
const labels = new Map<string, keyof PublicationProjectionEntry>([
  ['论著名称', 'title'], ['论文名称', 'title'], ['论文标题', 'title'], ['publication title', 'title'], ['paper title', 'title'],
  ['内容提要', 'abstract'], ['内容摘要', 'abstract'], ['摘要', 'abstract'], ['abstract', 'abstract'],
  ['成就/等级', 'status'], ['发表状态', 'status'], ['论文状态', 'status'], ['publication status', 'status'],
  ['日期', 'date'], ['日期（没有则选当前日期）', 'date'], ['发表日期', 'date'], ['publication date', 'date'],
  ['作者排序', 'authorOrder'], ['作者排名', 'authorOrder'], ['author order', 'authorOrder'],
  ['出版、登载获奖在学术会议上交流情况', 'publicationSituation'], ['出版情况', 'publicationSituation'],
  ['合（独）著、译', 'coauthors'], ['合著情况', 'coauthors'], ['作者', 'authors'], ['authors', 'authors'],
  ['期刊名称', 'venue'], ['期刊/会议名称', 'venue'], ['发表刊物', 'venue'], ['venue', 'venue'], ['DOI', 'doi'],
].map(([label, key]) => [normalize(label!), key as keyof PublicationProjectionEntry]));
const captions = new Set(['专业论著', '论文', '论文论著', 'publications'].map(normalize));
const reject = (reason: RecordFieldReason): PublicationFieldResolution => Object.freeze({ status: 'request-human', reason });
const bindingKeys = new Set(['title', 'abstract', 'status', 'date', 'authorOrder', 'publicationSituation', 'coauthors', 'authors', 'venue', 'doi']);

/** Current paper facts only. The caller must separately prove editor ownership and write authority. */
export function resolvePublicationField(field: FieldDescriptor, paper: PublicationProjectionEntry): PublicationFieldResolution {
  if (!publicationProjectionEntrySchema.safeParse(paper).success) return reject('profile-value-invalid');
  const direct = [field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder];
  if (field.disabled || field.readOnly || field.blockedReason || field.kind === 'checkbox'
    || field.kind === 'input' && !['text', 'search', 'date', 'month'].includes(field.type)
    || /是否|有无|有没有|验证码|校验码|证明人|联系人|上传|附件|签名|授权|协议|声明|承诺|captcha|referee|contact|upload|attachment|consent|signature/iu.test(direct.join(' ')))
    return reject('field-unsupported');
  const primary = [field.label, field.ariaLabel, field.tableHeader].filter(text => text.trim() && !captions.has(normalize(text)));
  const evidence = primary.length ? primary : direct.filter(text => text.trim() && !captions.has(normalize(text)));
  const mapped = evidence.map(text => labels.get(normalize(text)));
  const keys = new Set(mapped.filter((key): key is keyof PublicationProjectionEntry => key !== undefined));
  if (!keys.size) {
    const other = detectField({ ...field, sectionText: '专业论著', parentText: '', previousText: '', name: '', htmlId: '', title: '', placeholder: '' });
    if (other && (other.ambiguous || other.alias.scope !== 'research' || other.alias.key !== 'papers')) return reject('field-semantic-ambiguous');
    return reject('field-semantic-unknown');
  }
  if (keys.size !== 1 || mapped.some(key => key === undefined)) return reject('field-semantic-ambiguous');
  const key = [...keys][0]!;
  return resolvePublicationValue(field, paper, key);
}

/** Meaning only. The caller must prove the exact current paper transaction separately. */
export function resolveBoundPublicationField(field: FieldDescriptor, paper: PublicationProjectionEntry, path: string): PublicationFieldResolution {
  const direct = resolvePublicationField(field, paper);
  if (direct.status === 'known') return direct.key === path ? direct : reject('field-semantic-ambiguous');
  if (direct.reason !== 'field-semantic-unknown') return direct;
  if (!path.startsWith('papers.') || !bindingKeys.has(path.slice(7))) return reject('field-semantic-unknown');
  return resolvePublicationValue(field, paper, path.slice(7) as keyof PublicationProjectionEntry, true);
}

function resolvePublicationValue(field: FieldDescriptor, paper: PublicationProjectionEntry, key: keyof PublicationProjectionEntry, model = false): PublicationFieldResolution {
  if (field.kind === 'input' && ['date', 'month'].includes(field.type) && key !== 'date') return reject('field-unsupported');
  let value = paper[key];
  if (typeof value !== 'string' || !value.trim()) return reject('profile-value-missing');
  if (key === 'date') {
    if (!calendarDateBounds(value)) return reject('profile-value-invalid');
    if (field.type === 'date' && value.length !== 10) return reject('profile-date-precision');
    if (field.type === 'month') value = value.slice(0, 7);
  }
  const limit = effectiveMaxLength(field);
  if (limit !== null && value.length > limit) return reject('profile-value-too-long');
  if (field.kind === 'select' || field.kind === 'radio') {
    const result: MatchResult = { fieldId: field.id, fieldName: '', matchedProfileKey: 'papers.' + key, value,
      confidence: AUTO_CONFIDENCE, source: 'rule', status: 'auto', sensitive: false, reason: '' };
    const option = matchOption(field, result);
    if (option.status !== 'auto' || option.value === undefined || model && (option.source === 'fuzzy' || option.confidence < AUTO_CONFIDENCE)) return reject('field-options-unresolved');
    value = option.value;
  }
  return Object.freeze({ status: 'known', key: 'papers.' + key, value, confidence: AUTO_CONFIDENCE });
}
