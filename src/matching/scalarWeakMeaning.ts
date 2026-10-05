import {profileSchema,type UserProfile} from '../profile/schema';
import type {FieldDescriptor} from '../shared/types';
import {SEMANTIC_BINDING_PATHS} from '../ai/semanticProtocol';
import {detectField} from './fieldMatcher';
import {matchField} from './ruleMatcher';
import {AUTO_CONFIDENCE} from './confidence';
import {weakMeaningEvidenceAgrees,type WeakMeaningQualification} from './weakMeaningEvidence';
const paths:ReadonlySet<string>=new Set(SEMANTIC_BINDING_PATHS.filter(path=>path.startsWith('basic.')||path.startsWith('links.')));
/** Pure qualification of an explicit applicant scalar, with no model or writing authority. */
export function qualifyScalarWeakMeaning(field:FieldDescriptor,profile:UserProfile):WeakMeaningQualification{
 const blocked=(reason:'not-weak'|'conflicting-evidence'|'local-value-unavailable'):WeakMeaningQualification=>Object.freeze({status:'blocked',reason});
 const direct=[field.label,field.ariaLabel,field.tableHeader,field.title,field.placeholder].join(' ');
 if(field.hasValue||field.disabled||field.readOnly||field.blockedReason||field.kind==='checkbox'
  ||field.kind==='input'&&!['text','search','email','tel','url','number','date','month'].includes(field.type)
  ||/是否|有无|有没有|不是|并非|不属于|不包含|无需|已取得|已获得|已经获得|最高|验证码|校验码|证明人|联系人|上传|附件|签名|\b(?:not|without|whether|earned|obtained|highest|captcha|referee|certifier|upload|attachment)\b/iu.test(direct))return blocked('not-weak');
 const detected=detectField(field);if(!detected||detected.ambiguous||detected.confidence>=AUTO_CONFIDENCE||!['basic','links'].includes(detected.alias.scope))return blocked('not-weak');
 const path=detected.alias.scope+'.'+detected.alias.key;if(!paths.has(path))return blocked('not-weak');
 if(path==='basic.birthday'&&!['date','month'].includes(field.type))return blocked('not-weak');
 if(!weakMeaningEvidenceAgrees(field,detected.alias.scope,detected.alias.key))return blocked('conflicting-evidence');
 if(!profileSchema.safeParse(profile).success)return blocked('local-value-unavailable');
 const match=matchField(field,profile);if(match.status!=='review'||match.source==='fuzzy'||match.matchedProfileKey!==path||!match.value?.trim()||match.confidence!==detected.confidence)return blocked('local-value-unavailable');
 return Object.freeze({status:'confirm',path});
}
