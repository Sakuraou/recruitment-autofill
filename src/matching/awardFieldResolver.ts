import { awardProjectionEntrySchema, type AwardProjectionEntry, type AwardApplicantFacts } from '../profile/awardProjection';
import { resolveAwardApplicantField } from './awardApplicantFieldResolver';
import { calendarDateBounds } from '../profile/calendarDates';
import type { FieldDescriptor, MatchResult } from '../shared/types';
import { AUTO_CONFIDENCE, normalize } from './confidence';
import { detectField } from './fieldMatcher';
import { effectiveMaxLength } from './profileResolver';
import { matchOption } from './optionMatcher';
import type { RecordFieldReason } from './recordFieldReason';
import { recordFinancialQuestion } from './recordFinancialQuestion';

export type AwardFieldResolution = Readonly<{ status: 'known'; key: string; value: string; confidence: number }>
  | Readonly<{ status: 'request-human'; reason: RecordFieldReason }>;
const keys = new Set(['name','school','category','level','issuer','date','description','scholarshipLevel']);
const scopedLabels = new Map<string,string>([
  ['所在学校','school'],['获奖学校','school'],['学校名称','school'],['奖项类别','category'],['奖励类别','category'],
  ['奖学金级别','scholarshipLevel'],['奖学金等级','scholarshipLevel'],['简要描述','description'],['获奖描述','description'],
  ['获奖时间','date'],['获奖日期','date'],['奖励名称','name'],['获奖名称','name'],['奖项名称','name'],
  ['奖励级别','level'],['奖项级别','level'],['获奖级别','level'],['颁奖单位','issuer'],['授奖单位','issuer'],
].map(([label,key])=>[normalize(label!),key!]));
const captions = new Set(['在校奖励活动','在校奖励','奖励','获奖经历','awards'].map(normalize));
const reject = (reason: RecordFieldReason): AwardFieldResolution => Object.freeze({status:'request-human',reason});

/** Local facts only. A future caller must first prove ownership of this exact award editor. */
export function resolveAwardField(field: FieldDescriptor, record: AwardProjectionEntry, applicant?: AwardApplicantFacts): AwardFieldResolution {
  if (!awardProjectionEntrySchema.safeParse(record).success) return reject('profile-value-invalid');
  const applicantField=resolveAwardApplicantField(field,applicant);if(applicantField)return applicantField;
  const direct = [field.label,field.ariaLabel,field.tableHeader,field.title,field.placeholder];
  if (field.disabled || field.readOnly || field.blockedReason || field.kind==='checkbox'
    || field.kind==='input' && !['text','search','date','month'].includes(field.type)
    || /是否|有无|有没有|验证码|校验码|证明人|联系人|上传|附件|签名|授权|协议|声明|承诺|captcha|referee|contact|upload|attachment|consent|signature/iu.test(direct.join(' ')))
    return reject('field-unsupported');
  const primary=[field.label,field.ariaLabel,field.tableHeader].filter(text=>text.trim()&&!captions.has(normalize(text)));
  const evidence=primary.length?primary:direct.filter(text=>text.trim()&&!captions.has(normalize(text)));
  const mapped=evidence.map(text=>scopedLabels.get(normalize(text)));
  const candidates=new Set(mapped.filter((key):key is string=>!!key));
  let key:string|undefined;
  if(candidates.size){
    if(candidates.size!==1 || mapped.some(value=>!value)) return reject('field-semantic-ambiguous');
    key=[...candidates][0];
  } else {
    if (recordFinancialQuestion(direct)) return reject('field-unsupported');
    const meaning=detectField({...field,sectionText:'在校奖励',parentText:'',previousText:'',
      label:captions.has(normalize(field.label))?'':field.label,
      ...(primary.length?{name:'',htmlId:'',title:'',placeholder:''}:{})});
    if(!meaning)return reject('field-semantic-unknown');
    if(meaning.ambiguous||meaning.confidence<AUTO_CONFIDENCE||meaning.alias.scope!=='awards')return reject('field-semantic-ambiguous');
    key=meaning.alias.key;
  }
  if(!key||!keys.has(key))return reject('field-semantic-unknown');
  return resolveAwardValue(field,record,key);
}

/** A model may only supply a logical meaning for a genuinely unknown field.
 * The caller must separately bind the exact current award transaction; no index
 * or personal answer is accepted here. Known/ambiguous/protected fields stay local. */
export function resolveBoundAwardField(field:FieldDescriptor,record:AwardProjectionEntry,path:string,applicant?:AwardApplicantFacts):AwardFieldResolution {
  const direct=resolveAwardField(field,record,applicant);
  if(direct.status==='known')return direct.key===path?direct:reject('field-semantic-ambiguous');
  if(direct.reason!=='field-semantic-unknown')return direct;
  if(!path.startsWith('awards.')||!keys.has(path.slice(7)))return reject('field-semantic-unknown');
  return resolveAwardValue(field,record,path.slice(7),true);
}

function resolveAwardValue(field:FieldDescriptor,record:AwardProjectionEntry,key:string,model=false):AwardFieldResolution {
  if(field.kind==='input'&&['date','month'].includes(field.type)&&key!=='date')return reject('field-unsupported');
  let value=record[key as keyof AwardProjectionEntry];
  if(typeof value!=='string'||!value.trim())return reject('profile-value-missing');
  if(key==='date'){
    if(!calendarDateBounds(value))return reject('profile-value-invalid');
    if(field.type==='date'&&value.length!==10)return reject('profile-date-precision');
    if(field.type==='month')value=value.slice(0,7);
  }
  const limit=effectiveMaxLength(field);
  if(limit!==null&&value.length>limit)return reject('profile-value-too-long');
  if(field.kind==='select'||field.kind==='radio'){
    const candidate:MatchResult={fieldId:field.id,fieldName:'',matchedProfileKey:'awards.'+key,value,
      confidence:AUTO_CONFIDENCE,source:'rule',status:'auto',sensitive:false,reason:''};
    const option=matchOption(field,candidate);
    if(option.status!=='auto'||option.value===undefined||model&&(option.source==='fuzzy'||option.confidence<AUTO_CONFIDENCE))return reject('field-options-unresolved');
    value=option.value;
  }
  return Object.freeze({status:'known',key:'awards.'+key,value,confidence:AUTO_CONFIDENCE});
}
