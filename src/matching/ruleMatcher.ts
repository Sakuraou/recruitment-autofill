import type { UserProfile } from '../profile/schema';
import type { FieldDescriptor, MatchResult } from '../shared/types';
import { candidateStatus } from './confidence';
import { bestFieldName, detectField, directTexts, fieldContext } from './fieldMatcher';
import { matchOption } from './optionMatcher';
import { effectiveMaxLength, resolveProfileValue } from './profileResolver';
import { matchCollectionPresence } from './collectionPresence';

function blankResult(field: FieldDescriptor): MatchResult {
  return { fieldId: field.id, fieldName: bestFieldName(field),
    value: undefined, confidence: 0, source: 'rule', status: 'missing', reason: '未找到可靠信息，需要人工填写。', sensitive: false };
}

/** All uncertainty is an explicit review state; no yellow-warning write-through. */
export function matchField(field: FieldDescriptor, profile: UserProfile): MatchResult {
  const result = blankResult(field);
  if (field.blockedReason || field.disabled || field.readOnly) return { ...result, status: 'blocked', reason: field.blockedReason || '字段不可编辑。' };
  if (field.hasValue) return { ...result, status: 'existing', reason: '网页中已有内容，保留原值。' };
  if (/平均成绩|平均分|学业成绩|百分制|average\s*(?:score|mark)/iu.test(directTexts(field).join(' '))) {
    return { ...result, reason: '该字段询问平均分或成绩，不能用GPA代替。当前档案没有独立平均分字段，请按成绩单人工填写。' };
  }
  const context = fieldContext(field);
  if (['password', 'file', 'hidden', 'submit', 'button', 'reset'].includes(field.type)
    || /验证码|校验码|短信码|动态口令|动态码|一次性密码|密码|captcha|verification\s*code|one.time.code|\botp\b|最终提交|确认投递|同意.*(?:协议|条款)|隐私政策|consent|agreement/i.test(context)) {
    return { ...result, status: 'blocked', sensitive: true, reason: '验证、认证、协议或提交控件必须由用户手动操作。' };
  }
  // Previous text is scoped by the scanner and may identify another person even when a label exists.
  const localContext = `${context} ${field.previousText} ${!directTexts(field).length && field.parentText.length <= 80 ? field.parentText : ''}`;
  if (/家庭成员|家庭情况|家庭信息|亲属|紧急联系人|联系人|联系人员|推荐人|证明人|父亲|母亲|配偶|监护人|父母|联系人关系|emergency|family\s*(?:member|information)|father|mother|spouse|referee|reference\s*(?:name|phone|email)/i.test(localContext)) {
    return { ...result, status: 'blocked', sensitive: true, reason: '联系人或家庭成员字段需要人工对应，不能填入申请人本人信息。' };
  }
  const nameEvidence = [...directTexts(field), field.name, field.htmlId].join(' ');
  if (/英文(?:姓氏|名字)|英文姓(?!名)|(?:english[\s_-]*)?(?:first[\s_-]*name|last[\s_-]*name|given[\s_-]*name|surname)/iu.test(nameEvidence)) {
    return { ...result, reason: '档案未独立保存英文名和姓的分项，不能拆分或猜测完整姓名。' };
  }
  const englishHint = /英文(?:名|姓名)|english[\s_-]*(?:full[\s_-]*)?name/iu.test(nameEvidence);
  if (englishHint && !profile.basic.englishName?.trim()) return { ...result,
    reason: '当前档案未单独保存英文名，不能使用中文姓名或推测拼音，请人工填写。' };
  const presence = matchCollectionPresence(field, profile, result);
  if (presence) return presence;
  const detected = detectField(field);
  if (!detected) return result;
  const alias = detected.alias;
  const sensitive = alias.sensitive ?? false;
  if (detected.ambiguous) return { ...result, status: 'review', sensitive, confidence: 0.65, reason: '字段同时匹配多个含义，需要人工确认。' };
  if (englishHint && !(alias.scope === 'basic' && alias.key === 'englishName')) return { ...result,
    status: 'review', sensitive: true, reason: '姓名标签与英文名提示不一致，需要确认字段含义。' };
  if (alias.scope === 'basic' && ['heightCm', 'weightKg'].includes(alias.key)) {
    const unitEvidence = directTexts(field).join(' ').normalize('NFKC');
    const hasUnit = alias.key === 'heightCm' ? /厘米|\bcm\b/iu.test(unitEvidence) : /千克|公斤|\bkg\b/iu.test(unitEvidence);
    const conflictingUnit = alias.key === 'heightCm' ? /英寸|inch|feet|\bft\b|米(?![\p{L}])/iu.test(unitEvidence.replace(/厘米/gu, '')) : /磅|\blbs?\b|pounds?|斤/iu.test(unitEvidence);
    if (!hasUnit || conflictingUnit) return { ...result, status: 'review', reason: '网页的身高或体重单位未唯一明确为厘米/千克，不能推算或直接填数字。' };
  }
  if (alias.scope === 'basic' && ['name', 'englishName', 'phone', 'email', 'idNumber', 'birthday', 'address', 'healthStatus', 'maritalStatus', 'heightCm', 'weightKg'].includes(alias.key)
    && /项目|实习|工作经历|公司|学生组织|校内职务|社团|奖项|证书|project|internship|company|employer/i.test(field.sectionText)
    && !/本人|申请人|应聘者|applicant/i.test(directTexts(field).join(' '))) {
    return { ...result, status: 'review', sensitive: true, confidence: 0.5, reason: '该字段位于经历或组织区域，无法确认是否询问本人信息。' };
  }
  const resolved = resolveProfileValue(field, profile, alias);
  const confidence = Math.min(detected.confidence, resolved.confidence ?? 1);
  const source = resolved.fuzzy ? 'fuzzy' : detected.source;
  if (!resolved.value) return { ...result, matchedProfileKey: resolved.key, status: resolved.review ? 'review' : 'missing',
    confidence: resolved.review ? confidence : 0, source, sensitive, reason: resolved.reason };
  let matched: MatchResult = { ...result, matchedProfileKey: resolved.key, value: resolved.value, confidence, source, sensitive,
    status: resolved.review ? 'review' : candidateStatus(confidence, source), reason: resolved.reason };
  const maxLength = effectiveMaxLength(field);
  if (maxLength !== null && resolved.value.length > maxLength) return { ...matched, status: 'review', value: undefined,
    reason: `档案原文超过 ${maxLength} 字限制，请人工改写；没有截断内容。` };
  if (field.type === 'month' && /^\d{4}-\d{2}-\d{2}$/.test(resolved.value)) matched = { ...matched, value: resolved.value.slice(0, 7) };
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(resolved.value)) return { ...matched, value: undefined, status: 'review', reason: '网页需要完整日期，但档案只有年月；不能推测具体日期。' };
  if (field.type === 'number' && !/^-?\d+(?:\.\d+)?$/.test(resolved.value)) return { ...matched, value: undefined, status: 'review', reason: '网页要求纯数字，档案格式不一致，需要人工确认数值。' };
  return matchOption(field, matched);
}

export function matchFields(fields: FieldDescriptor[], profile: UserProfile): MatchResult[] {
  const results = fields.map((field) => matchField(field, profile));
  const occurrences = new Map<string, number>();
  for (const result of results) {
    if (result.status === 'auto' && result.matchedProfileKey && /^(?:education|projects|internships|studentWork|awards|certificates)\.\d+\./.test(result.matchedProfileKey)) {
      occurrences.set(result.matchedProfileKey, (occurrences.get(result.matchedProfileKey) ?? 0) + 1);
    }
  }
  return results.map((result) => result.status === 'auto' && result.matchedProfileKey && (occurrences.get(result.matchedProfileKey) ?? 0) > 1
    ? { ...result, status: 'review', confidence: 0.7, reason: '多个网页字段指向同一条经历的同一项资料，需要分别确认，避免重复填写同一经历。' }
    : result);
}
