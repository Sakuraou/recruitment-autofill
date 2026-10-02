import type { EducationHighestFacet } from '../profile/educationHighestFacts';

/** Explicit question captions only; no profile values, DOM or execution authority. */
export function educationHighestQuestionFacet(value: string): EducationHighestFacet | undefined {
  const caption = value.normalize('NFKC').trim().toLowerCase().replace(/[\s*＊:：?？]/gu, '');
  const chinese = /^是否(?:为)?(?:本人|您的|我的)?(?:的)?(最高学历|最高学位|全日制最高学历|最高全日制学历)$/u.exec(caption);
  if (chinese) return chinese[1] === '最高学历' ? 'level' : chinese[1] === '最高学位' ? 'degree' : 'fulltimeLevel';
  const english: Readonly<Record<string, EducationHighestFacet>> = {
    isthisyourhighestqualification: 'level', isthisyourhighesteducation: 'level',
    isthisyourhighestdegree: 'degree', isthisyourhighestfulltimeeducation: 'fulltimeLevel',
  };
  return Object.hasOwn(english, caption) ? english[caption] : undefined;
}
