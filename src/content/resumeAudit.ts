import { sectionConfig } from '../workflow/sections';
import { normalized, requiredIssues, visible } from './workflowControls';

/** A finished queue is not proof that the entire application is complete. Read the page again. */
export function auditResume(doc: Document): string[] {
  const issues: string[] = [];
  for (const section of doc.querySelectorAll<HTMLElement>('.resumeCon1 .secon')) {
    if (!visible(section)) continue;
    const label = normalized(section.querySelector(':scope > .secH > .lf')?.textContent)
      || sectionConfig[section.id as keyof typeof sectionConfig]?.label || normalized(section.querySelector(':scope > .secH')?.textContent).replace(/添加|编辑/gu, '').trim() || section.id;
    const panes = [...section.querySelectorAll<HTMLElement>(':scope > .secC')];
    const editor = panes[1];
    const cards = [...section.querySelectorAll(':scope > .secC > .secC_dl')].filter(card => !/是否学生干部\s*[:：]/u.test(card.textContent ?? ''));
    const radios = [...section.querySelectorAll<HTMLInputElement>(':scope > .secS input[type="radio"]')].filter(visible);
    const yes = radios.some(radio => radio.checked && radio.dataset.code === 'Y');
    const no = radios.some(radio => radio.checked && radio.dataset.code === 'N');
    if (editor && visible(editor)) {
      const missing = requiredIssues(editor);
      issues.push(`${label}：仍有未保存的编辑表单${missing.length ? `（${missing.join('；')}）` : '，请核对并保存'}`);
    } else if (yes && !cards.length) issues.push(`${label}：已选“是”，但尚未看到保存的记录`);
    else if (radios.length && !yes && !no) issues.push(`${label}：尚未回答是否具备；未知信息不会自动选“否”`);
    else if (no && !cards.length) issues.push(`${label}：网页当前选“否”，请核对是否符合实际`);
    else if (panes[0] && visible(panes[0]) && !cards.length) issues.push(`${label}：尚未看到已保存内容`);
    else if (!(section.id in sectionConfig)) issues.push(`${label}：当前版本尚未自动核验该栏，请检查网页`);
  }
  return [...new Set(issues)];
}
