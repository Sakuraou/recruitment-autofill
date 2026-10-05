import { createEmptyProfile, profileSchema } from '../../src/profile/schema';
import { installEducationSessionPage, educationSessionProfile } from './education-session-page';
import { installWeakProjectSessionPage } from './weak-project-session-page';
import { installInternshipSessionPage, internshipSessionProfile } from './internship-session-page';
export function installAgentPage(doc: Document, mode: string) {
  const education = installEducationSessionPage(doc); const educationSection = education.list.closest('section')!;
  const project = installWeakProjectSessionPage(doc); const projectSection = project.list.closest('section')!;
  const internship = installInternshipSessionPage(doc); const internshipSection = internship.list.closest('section')!;
  doc.body.replaceChildren(educationSection, projectSection, internshipSection);
  const basic = doc.createElement('section'); basic.setAttribute('aria-label', '个人信息');
  basic.innerHTML = `<h2>个人信息</h2><label>如何称呼您<input id="${mode === 'weak' ? 'agent-name' : 'u'}" required></label>`;
  if (mode === 'unknown') basic.insertAdjacentHTML('beforeend', '<label>未知必答问题<input required id="unknown-answer"></label>');
  doc.body.prepend(basic);
  if (mode === 'award') doc.body.insertAdjacentHTML('beforeend', '<section aria-label="在校奖励"><h2>在校奖励</h2><p>暂无奖励</p><button>添加奖励</button></section>');
  let submits = 0;
  const submit = doc.createElement('button'); submit.type = 'button'; submit.textContent = '最终提交'; submit.onclick = () => { submits++; }; doc.body.append(submit);
  const profile = profileSchema.parse({ ...createEmptyProfile(), basic: { name: '虚构浏览器应聘者' }, education: educationSessionProfile.education,
    projects: [{ id: 'p-a', name: '虚构方案甲', description: '虚构方案甲用于独立验证项目', technologies: [] },
      { id: 'p-b', name: '虚构方案乙', description: '虚构方案乙采用另一条项目说明', technologies: [] }], internships: internshipSessionProfile.internships });
  return { profile, education, project, internship, state: () => ({
    education: education.saved, projects: project.saved, internships: internship.saved,
    counts: [education.counts, project.counts, internship.counts], submits,
  }) };
}
