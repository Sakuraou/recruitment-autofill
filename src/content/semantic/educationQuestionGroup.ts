import { educationHighestQuestionFacet } from '../../shared/educationHighestQuestions';
import { contextText } from '../domUtils';

/** Shape only: a single native choice question, with no editor actions or nested boundary. */
export function isEducationHighestQuestionGroup(container: Element): boolean {
  if (container.tagName !== 'FIELDSET' || container.querySelector('fieldset')) return false;
  const legend = Array.from(container.children).find(child => child.tagName === 'LEGEND');
  const facet = educationHighestQuestionFacet(contextText(legend ?? null)); if (!facet) return false;
  const aria = container.getAttribute('aria-label');
  if (container.hasAttribute('aria-labelledby') || aria && educationHighestQuestionFacet(aria) !== facet) return false;
  const controls = Array.from(container.querySelectorAll('input,select,textarea,button,a,[role="button"],[role="combobox"]'));
  if (!controls.length || controls.length > 40) return false;
  if (controls.length === 1 && controls[0]!.tagName === 'SELECT') return true;
  if (!controls.every(control => control.tagName === 'INPUT' && (control as HTMLInputElement).type === 'radio')) return false;
  const first = controls[0] as HTMLInputElement;
  return !!first.name && controls.every(control => (control as HTMLInputElement).name === first.name
    && (control as HTMLInputElement).form === first.form);
}
