import type { UserProfile } from '../profile/schema';
import type { FillOutcome, MatchResult, ScanResult } from '../shared/types';
import { EXTENSION_VERSION } from '../shared/version';

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return value.trim().length >= 2 ? [value] : [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}
export function createDebugReport(scan: ScanResult, matches: MatchResult[], profile: UserProfile, outcomes: FillOutcome[] = []): string {
  const privateValues = [...new Set(stringsIn(profile))].sort((a, b) => b.length - a.length);
  const redact = (value: string) => {
    let text = value;
    for (const secret of privateValues) text = text.split(secret).join('[档案值已隐藏]');
    return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱已隐藏]')
      .replace(/\d[\d\s-]{5,}\d[Xx]?/g, '[号码已隐藏]');
  };
  const report = {
    extensionVersion: EXTENSION_VERSION, contentVersion: scan.contentVersion ?? 'unknown', origin: new URL(scan.url).origin,
    pageType: new URL(scan.url).hostname === 'job.10086.cn' && new URL(scan.url).pathname === '/personal/resume_campus.html' ? 'china-mobile-campus' : 'generic',
    summary: { detected: scan.fields.length, auto: matches.filter(item => item.status === 'auto').length,
      review: matches.filter(item => item.status === 'review').length, missing: matches.filter(item => item.status === 'missing').length,
      blocked: matches.filter(item => item.status === 'blocked').length, existing: matches.filter(item => item.status === 'existing').length,
      filled: outcomes.filter(item => item.status === 'filled').length, errors: outcomes.filter(item => item.status === 'error').length,
      skipped: outcomes.filter(item => item.status === 'skipped').length },
    note: '候选值隐藏，字段元数据已遮盖已知档案值与号码。分享前仍请检查站点文字中是否含其他个人信息。',
    fields: scan.fields.map(field => {
      const match = matches.find(item => item.fieldId === field.id);
      const outcome = outcomes.find(item => item.fieldId === field.id);
      return { kind: field.kind, type: field.type, label: redact(field.label),
        name: redact(field.name), htmlId: redact(field.htmlId), ariaLabel: redact(field.ariaLabel),
        title: redact(field.title), placeholder: redact(field.placeholder),
        parentText: redact(field.parentText), previousText: redact(field.previousText),
        sectionText: redact(field.sectionText), tableHeader: redact(field.tableHeader),
        options: field.options.map(option => ({ label: redact(option.label), value: redact(option.value), disabled: option.disabled })),
        maxLength: field.maxLength, hasValue: field.hasValue, blockedReason: redact(field.blockedReason ?? ''),
        outcome: outcome ? { status: outcome.status, reason: redact(outcome.reason) } : undefined,
        profileKey: match?.matchedProfileKey, source: match?.source, confidence: match?.confidence,
        status: match?.status, reason: redact(match?.reason ?? ''),
        value: match?.value !== undefined ? `[已隐藏，${match.value.length} 字符]` : undefined,
      };
    }),
  };
  return JSON.stringify(report, null, 2);
}

export function downloadDebugReport(report: string): void {
  const url = URL.createObjectURL(new Blob([report], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `网申助手_问题报告_v${EXTENSION_VERSION}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
