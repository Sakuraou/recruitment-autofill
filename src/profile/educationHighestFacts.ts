import { educationProjectionEntrySchema, type EducationProjectionEntry } from './educationProjection';

export type EducationHighestFacet = 'level' | 'degree' | 'fulltimeLevel';
export type EducationHighestReason = 'education-record-invalid' | 'education-records-missing'
  | 'education-stage-unknown' | 'education-degree-unknown' | 'education-study-mode-unknown'
  | 'education-current-record-missing' | 'education-highest-tied' | 'education-facet-unknown';
type Unresolved = Readonly<{ status: 'request-human'; reason: EducationHighestReason }>;
export type EducationHighestFact = Readonly<{ status: 'known'; rank: number; candidateIds: readonly string[] }>
  | Readonly<{ status: 'none'; reason: 'education-no-degree' | 'education-no-fulltime' }> | Unresolved;
export type EducationHighestMarker = Readonly<{ status: 'known'; value: boolean }> | Unresolved;
const reject = (reason: EducationHighestReason): Unresolved => Object.freeze({ status: 'request-human', reason });
const levelRanks = { 专科: 1, 本科: 2, 硕士研究生: 3, 博士研究生: 4 } as const;
const canonical = (value?: string) => value?.trim().toLowerCase().replace(/[’]/gu, "'").replace(/\s+/gu, ' ');
const disciplines = new Set(['', '哲学', '经济学', '法学', '教育学', '文学', '历史学', '理学', '工学', '农学',
  '医学', '军事学', '管理学', '艺术学', '工程', '金融', '法律', '教育', '翻译', '工商管理', '公共管理', '会计', '审计',
  '应用统计', '电子信息', '计算机技术']);
const englishDegrees: Readonly<Record<string, number>> = {
  bachelor: 1, "bachelor's degree": 1, 'bachelor of science': 1, 'bachelor of arts': 1,
  master: 2, "master's degree": 2, 'master of science': 2, 'master of arts': 2,
  doctorate: 3, 'doctoral degree': 3, 'doctor of philosophy': 3, phd: 3,
};
function degreeRank(value?: string): number | undefined {
  const name = canonical(value); if (!name) return undefined;
  if (['无', '无学位', 'no degree'].includes(name)) return 0;
  if (Object.hasOwn(englishDegrees, name)) return englishDegrees[name];
  const matched = /^(.*?)(学士|硕士|博士)(?:学位)?$/u.exec(name);
  if (!matched || !disciplines.has(matched[1]!)) return undefined;
  return ({ 学士: 1, 硕士: 2, 博士: 3 } as const)[matched[2] as '学士' | '硕士' | '博士'];
}
function fulltime(value?: string): boolean | undefined {
  const mode = canonical(value);
  if (mode && ['全日制', 'full-time', 'full time'].includes(mode)) return true;
  if (mode && ['非全日制', 'part-time', 'part time'].includes(mode)) return false;
  return undefined;
}
function validate(records: readonly EducationProjectionEntry[]): Unresolved | undefined {
  if (!Array.isArray(records) || records.length > 30
    || records.some(record => !educationProjectionEntrySchema.safeParse(record).success)
    || new Set(records.map(record => record.id)).size !== records.length) return reject('education-record-invalid');
  return records.length ? undefined : reject('education-records-missing');
}
/** Pure full-collection facts; neither current editor nor source order chooses the highest record. */
export function educationHighestFact(records: readonly EducationProjectionEntry[], facet: EducationHighestFacet): EducationHighestFact {
  if (!['level', 'degree', 'fulltimeLevel'].includes(facet)) return reject('education-facet-unknown');
  const invalid = validate(records); if (invalid) return invalid;
  const ranks: { id: string; rank: number }[] = [];
  for (const record of records) {
    if (facet === 'degree') {
      const rank = degreeRank(record.degree); if (rank === undefined) return reject('education-degree-unknown');
      if (rank) ranks.push({ id: record.id, rank });
      continue;
    }
    if (facet === 'fulltimeLevel') {
      const mode = fulltime(record.studyMode); if (mode === undefined) return reject('education-study-mode-unknown');
      if (!mode) continue;
    }
    if (record.level === '其他') return reject('education-stage-unknown');
    ranks.push({ id: record.id, rank: levelRanks[record.level] });
  }
  if (!ranks.length) return Object.freeze({ status: 'none', reason: facet === 'degree' ? 'education-no-degree' : 'education-no-fulltime' });
  const rank = Math.max(...ranks.map(record => record.rank));
  return Object.freeze({ status: 'known', rank, candidateIds: Object.freeze(ranks.filter(record => record.rank === rank).map(record => record.id)) });
}
/** A unique highest record is required for Yes. Definite lower records may still answer No. */
export function educationHighestMarker(records: readonly EducationProjectionEntry[], currentId: string,
  facet: EducationHighestFacet): EducationHighestMarker {
  const invalid = validate(records); if (invalid) return invalid;
  if (!records.some(record => record.id === currentId)) return reject('education-current-record-missing');
  const fact = educationHighestFact(records, facet); if (fact.status === 'request-human') return fact;
  if (fact.status === 'none' || !fact.candidateIds.includes(currentId)) return Object.freeze({ status: 'known', value: false });
  if (fact.candidateIds.length !== 1) return reject('education-highest-tied');
  return Object.freeze({ status: 'known', value: true });
}
