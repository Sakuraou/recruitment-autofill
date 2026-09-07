import type { UserProfile } from '../profile/schema';
import type { MatchResult, ScanResult } from '../shared/types';

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return value.trim().length >= 2 ? [value] : [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}
export function createDebugReport(scan: ScanResult, matches: MatchResult[], profile: UserProfile): string {
  const privateValues = [...new Set(stringsIn(profile))].sort((a, b) => b.length - a.length);
  const redact = (value: string) => {
    let text = value;
    for (const secret of privateValues) text = text.split(secret).join('[档案值已隐藏]');
    return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱已隐藏]')
      .replace(/\d[\d\s-]{5,}\d[Xx]?/g, '[号码已隐藏]');
  };
  const report = {
    extensionVersion: '0.1.0', origin: new URL(scan.url).origin,
    note: '候选值隐藏，字段元数据已遮盖已知档案值与号码。分享前仍请检查站点文字中是否含其他个人信息。',
    fields: scan.fields.map(field => {
      const match = matches.find(item => item.fieldId === field.id);
      return { kind: field.kind, type: field.type, label: redact(field.label),
        name: redact(field.name), htmlId: redact(field.htmlId), ariaLabel: redact(field.ariaLabel),
        title: redact(field.title), placeholder: redact(field.placeholder),
        parentText: redact(field.parentText), previousText: redact(field.previousText),
        sectionText: redact(field.sectionText), tableHeader: redact(field.tableHeader),
        options: field.options.map(option => ({ label: redact(option.label), value: redact(option.value), disabled: option.disabled })),
        maxLength: field.maxLength, hasValue: field.hasValue, blockedReason: field.blockedReason,
        profileKey: match?.matchedProfileKey, source: match?.source, confidence: match?.confidence,
        status: match?.status, reason: redact(match?.reason ?? ''),
        value: match?.value !== undefined ? `[已隐藏，${match.value.length} 字符]` : undefined,
      };
    }),
  };
  return JSON.stringify(report, null, 2);
}
