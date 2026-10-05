import {awardApplicantFactsSchema,type AwardApplicantFacts} from '../profile/awardProjection';
import type {FieldDescriptor,MatchResult} from '../shared/types';
import {AUTO_CONFIDENCE,normalize} from './confidence';
import {matchOption} from './optionMatcher';
import {effectiveMaxLength} from './profileResolver';
import type {AwardFieldResolution} from './awardFieldResolver';
const questions=new Set(['是否学生干部','是否为学生干部'].map(normalize));
const descriptions=new Set(['学生干部描述','学生干部经历描述'].map(normalize));
const reject=(reason:'field-unsupported'|'field-semantic-ambiguous'|'field-options-unresolved'|'profile-value-invalid'|'profile-value-missing'|'profile-value-too-long'):AwardFieldResolution=>Object.freeze({status:'request-human',reason});
/** Exact applicant question in an already owned award editor; never inferred from the award. */
export function resolveAwardApplicantField(field:FieldDescriptor,facts:AwardApplicantFacts|undefined):AwardFieldResolution|undefined{
 const primary=[field.label,field.ariaLabel,field.tableHeader].filter(text=>text.trim());
 const labels=primary.length?primary:[field.title,field.placeholder].filter(text=>text.trim());
 const keys=labels.map(text=>questions.has(normalize(text))?'studentCadre':descriptions.has(normalize(text))?'studentCadreDescription':undefined);
 if(!keys.some(Boolean))return undefined;
 if(keys.some(key=>!key)||new Set(keys).size!==1)return reject('field-semantic-ambiguous');
 if(field.blockedReason||field.disabled||field.readOnly||field.kind==='checkbox'
  ||/验证码|校验码|证明人|联系人|上传|附件|签名|授权|协议|声明|承诺|captcha|contact|upload|attachment|consent|signature/iu.test([field.label,field.ariaLabel,field.tableHeader,field.title,field.placeholder].join(' ')))return reject('field-unsupported');
 const parsed=awardApplicantFactsSchema.safeParse(facts??{});if(!parsed.success)return reject('profile-value-invalid');
 const key=keys[0]!;
 if(key==='studentCadre'&&!['select','radio'].includes(field.kind))return reject('field-unsupported');
 if(key==='studentCadreDescription'&&field.kind!=='textarea'&&!(field.kind==='input'&&['text','search'].includes(field.type)))return reject('field-unsupported');
 let value=parsed.data[key];if(!value?.trim())return reject('profile-value-missing');
 const limit=effectiveMaxLength(field);if(limit!==null&&value.length>limit)return reject('profile-value-too-long');
 if(key==='studentCadre'){
  const options=field.options.filter(option=>!option.disabled&&option.label.trim()&&!/请选择|please\s+select/iu.test(option.label));
  if(options.length!==2||new Set(options.map(option=>normalize(option.label))).size!==2
    ||!options.every(option=>['是','否'].includes(normalize(option.label))))return reject('field-options-unresolved');
  const candidate:MatchResult={fieldId:field.id,fieldName:'',matchedProfileKey:'basic.'+key,value,confidence:AUTO_CONFIDENCE,source:'rule',status:'auto',sensitive:false,reason:''};
  const option=matchOption(field,candidate);if(option.status!=='auto'||option.value===undefined)return reject('field-options-unresolved');value=option.value;
 }
 return Object.freeze({status:'known',key:'basic.'+key,value,confidence:AUTO_CONFIDENCE});
}
