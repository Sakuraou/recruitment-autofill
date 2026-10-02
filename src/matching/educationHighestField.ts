import { educationHighestMarker } from '../profile/educationHighestFacts';
import { educationHighestQuestionFacet } from '../shared/educationHighestQuestions';
import type { EducationProjectionEntry } from '../profile/educationProjection';
import type { FieldDescriptor } from '../shared/types';
import type { EducationFieldResolution } from './educationFieldResolver';
import type { RecordFieldReason } from './recordFieldReason';

export type EducationHighestFieldResolution = EducationFieldResolution | Readonly<{ status: 'not-applicable' }>;
const reject = (reason: RecordFieldReason): EducationFieldResolution => Object.freeze({ status: 'request-human', reason });
const clean = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/[\s*＊:：?？]/gu, '');
function booleanLabel(value: string): boolean | undefined {
  const label = clean(value);
  if (['是', 'yes', 'true', 'y'].includes(label)) return true;
  if (['否', 'no', 'false', 'n'].includes(label)) return false;
  return undefined;
}
/** Only explicit binary highest markers in an already-owned current education editor. No DOM writes or model authority. */
export function resolveEducationHighestField(field: FieldDescriptor, records: readonly EducationProjectionEntry[],
  currentId: string): EducationHighestFieldResolution {
  const direct = [field.label, field.ariaLabel, field.tableHeader].filter(value => value.trim());
  if (!direct.some(value => /最高|highest/iu.test(value))) return Object.freeze({ status: 'not-applicable' });
  if (field.blockedReason || field.disabled || field.readOnly || !['select', 'radio'].includes(field.kind)
    || /协议|同意|授权|承诺|声明|验证码|consent|signature|agree|verification/iu.test(direct.join(' '))) return reject('field-unsupported');
  const facets = direct.map(educationHighestQuestionFacet);
  if (!facets.length || facets.some(facet => facet === undefined) || new Set(facets).size !== 1) return reject('field-semantic-ambiguous');
  const facet = facets[0]!;
  const answer = educationHighestMarker(records, currentId, facet);
  if (answer.status !== 'known') return reject(['education-degree-unknown', 'education-study-mode-unknown', 'education-records-missing'].includes(answer.reason)
    ? 'profile-value-missing' : 'field-semantic-ambiguous');
  const options = field.options.filter(option => !/^(?:请选择|选择|please\s*select|select\s*an\s*option|--)/iu.test(option.label.trim()));
  const yes = options.filter(option => booleanLabel(option.label) === true);
  const no = options.filter(option => booleanLabel(option.label) === false);
  if (options.length !== 2 || yes.length !== 1 || no.length !== 1 || !yes[0]!.value || !no[0]!.value
    || yes[0]!.value === no[0]!.value) return reject('field-options-unresolved');
  const selected = answer.value ? yes[0]! : no[0]!;
  if (selected.disabled) return reject('field-options-unresolved');
  return Object.freeze({ status: 'known', key: `education.${facet === 'level' ? 'highestLevel' : facet === 'degree' ? 'highestDegree' : 'highestFulltimeLevel'}`,
    value: selected.value, confidence: 1 });
}
