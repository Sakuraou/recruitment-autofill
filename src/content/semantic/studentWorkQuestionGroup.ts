import { contextText, hiddenReason } from '../domUtils';

const presenceCaptions = new Set(['是否有校内职务', '有无校内职务']);
const caption = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/[\s*＊:：?？]/gu, '');
/** Shape only. Graph ownership and the record binder still grant all authority. */
function isNativeQuestionGroup(container: Element, captions: ReadonlySet<string>): boolean {
  if (container.tagName !== 'FIELDSET' || !container.isConnected
    || container.hasAttribute('contenteditable')
    || ![null, 'group', 'radiogroup'].includes(container.getAttribute('role'))
    || container.querySelector('fieldset,section,form,article,[role="listitem"],[role="list"],[role="region"],[role="group"],[role="form"],[role="dialog"],[contenteditable]')) return false;
  const legends = Array.from(container.children).filter(child => child.tagName === 'LEGEND');
  if (legends.length !== 1 || hiddenReason(legends[0]!) || !captions.has(caption(contextText(legends[0]!)))) return false;
  const aria = container.getAttribute('aria-label');
  if (container.hasAttribute('aria-labelledby') || aria && !captions.has(caption(aria))) return false;
  if (Array.from(container.querySelectorAll('[role]')).some(element => {
    const role = element.getAttribute('role');
    return !(element.tagName === 'SELECT' && role === 'combobox')
      && !(element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'radio' && role === 'radio')
      && !['note', 'status', 'alert', 'tooltip'].includes(role ?? '');
  })) return false;
  const form = container.closest('form'); if (!form?.isConnected) return false;
  const controls = Array.from(container.querySelectorAll('input,select,textarea,button,a,[role="button"],[role="combobox"],[role="checkbox"],[role="textbox"]'));
  if (!controls.length || controls.length > 40) return false;
  if (controls.length === 1 && controls[0]!.tagName === 'SELECT') return (controls[0] as HTMLSelectElement).form === form
    && [null, 'combobox'].includes(controls[0]!.getAttribute('role'));
  if (!controls.every(control => control.tagName === 'INPUT' && (control as HTMLInputElement).type === 'radio'
    && [null, 'radio'].includes(control.getAttribute('role')))) return false;
  const first = controls[0] as HTMLInputElement;
  return !!first.name && controls.every(control => (control as HTMLInputElement).name === first.name
    && (control as HTMLInputElement).form === form);
}
export function isStudentWorkPresenceQuestionGroup(container: Element): boolean {
 return isNativeQuestionGroup(container,presenceCaptions);
}
