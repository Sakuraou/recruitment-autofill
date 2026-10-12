/** This module has no transport, logging, storage or DOM access. */
export function semanticRedactor(profile: unknown): (text: string) => string {
  const literals = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) literals.add(value.normalize('NFKC').trim());
    else if (Array.isArray(value)) value.forEach(collect);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(collect);
  };
  collect(profile);
  const escaped = [...literals].sort((a, b) => b.length - a.length).map(value => {
    // A fact can be split across explicit labels or layout whitespace. Redact
    // it before any text metadata leaves the local profile, just as for images.
    const compact = value.replace(/\s/gu, '');
    const literal = [...compact].map(character => character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s*');
    // Single Latin letters (e.g. C) must not consume the letters in a field label.
    return /^[a-z\d]{1,2}$/iu.test(compact) ? `(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])` : literal;
  });
  const pattern = escaped.length ? new RegExp(escaped.join('|'), 'giu') : undefined;
  return text => {
    let redacted = text.normalize('NFKC');
    // Mask complete literals before imposing a label length limit.
    if (pattern) redacted = redacted.replace(pattern, '[redacted]');
    return redacted
      .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/giu, '[redacted]')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[redacted]')
      .replace(/\b\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b/gu, '[redacted]')
      .replace(/(?<!\d)(?:\+?\d[\s()-]?){6,}\d[xX]?(?!\d)/gu, '[redacted]')
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim();
  };
}
