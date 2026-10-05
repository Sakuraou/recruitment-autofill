import { createEmptyProfile, profileSchema } from '../../src/profile/schema';
import { installEducationSessionPage, educationSessionProfile } from './education-session-page';
import { installWeakProjectSessionPage } from './weak-project-session-page';
import { installInternshipSessionPage, internshipSessionProfile } from './internship-session-page';
import {installPublicationSessionPage,publicationSessionProfile} from './publication-session-page';
import {installAwardSessionPage,awardSessionProfile} from './award-session-page';
export function installAgentPage(doc: Document, mode: string) {
  const education = installEducationSessionPage(doc); const educationSection = education.list.closest('section')!;
  const project = installWeakProjectSessionPage(doc); const projectSection = project.list.closest('section')!;
  const internship = installInternshipSessionPage(doc); const internshipSection = internship.list.closest('section')!;
  const award=(mode.startsWith('awards-')||mode.startsWith('papers-'))?installAwardSessionPage(doc,[],{cadre:mode==='awards-radio'?'radio':'select',dynamicCadre:mode==='awards-dynamic',cadreConflict:mode==='awards-conflict',saveRefused:mode==='awards-save-uncertain'}):undefined;
  const awardSection=award?.list.closest('section');
  const publication=mode.startsWith('papers-')?installPublicationSessionPage(doc,mode==='papers-none-existing'?[0]:[],{dynamicVenue:mode==='papers-dynamic',unknown:mode==='papers-unknown',existingConflict:mode==='papers-conflict',saveRefused:mode==='papers-save-uncertain',corruptSummary:mode==='papers-corrupt-summary'}):undefined;
  const publicationSection=publication?.list.closest('section');
  if(mode==='papers-none-draft')publication?.add.click();
  doc.body.replaceChildren(educationSection, projectSection, internshipSection,...(awardSection?[awardSection]:[]),...(publicationSection?[publicationSection]:[]));
  if(award&&mode.startsWith('awards-presence-')){
    award.list.hidden=true;const question=doc.createElement('form');
    question.innerHTML=mode==='awards-presence-radio'?'<fieldset><legend>是否有在校奖励活动</legend><label><input type="radio" name="award-presence" value="yes">是</label><label><input type="radio" name="award-presence" value="no">否</label></fieldset>':'<label>是否有在校奖励活动<select><option value="">请选择</option><option value="yes">是</option><option value="no">否</option></select></label>';
    question.addEventListener('change',event=>{if((event.target as HTMLInputElement).value==='yes')setTimeout(()=>{award.list.hidden=false;},30);});award.list.before(question);
  }
  if(publication&&mode.startsWith('papers-presence-')){
    publication.list.hidden=true;const question=doc.createElement('form');
    question.innerHTML=mode==='papers-presence-radio'?'<fieldset><legend>是否有专业论著</legend><label><input type="radio" name="paper-presence" value="yes">是</label><label><input type="radio" name="paper-presence" value="no">否</label></fieldset>':'<label>是否有专业论著<select><option value="">请选择</option><option value="yes">是</option><option value="no">否</option></select></label>';
    question.addEventListener('change',event=>{if((event.target as HTMLInputElement).value==='yes')setTimeout(()=>{publication.list.hidden=false;},30);});publication.list.before(question);
  }
  const basic = doc.createElement('section'); basic.setAttribute('aria-label', '个人信息');
  basic.innerHTML = `<h2>个人信息</h2><label>如何称呼您<input id="${mode === 'weak' ? 'agent-name' : 'u'}" required></label>`;
  if (mode === 'weak-applicant') basic.innerHTML = '<h2>个人信息</h2><label>申请人的出生日期<input id="u" type="date" required></label>';
  if (mode === 'unknown') basic.insertAdjacentHTML('beforeend', '<label>未知必答问题<input required id="unknown-answer"></label>');
  doc.body.prepend(basic);
  if (mode === 'award') doc.body.insertAdjacentHTML('beforeend', '<section aria-label="在校奖励"><h2>在校奖励</h2><p>暂无奖励</p><button>添加奖励</button></section>');
  let submits = 0;
  const submit = doc.createElement('button'); submit.type = 'button'; submit.textContent = '最终提交'; submit.onclick = () => { submits++; }; doc.body.append(submit);
  const profile = profileSchema.parse({ ...createEmptyProfile(), basic: { name: '虚构浏览器应聘者', birthday: '2002-04-15',...((mode.startsWith('awards-')||mode.startsWith('papers-'))&&mode!=='awards-missing-cadre'?{studentCadre:mode==='awards-dynamic'?'是':'否',studentCadreDescription:'协助组织学院迎新活动。'}:{}) }, education: educationSessionProfile.education,
    projects: [{ id: 'p-a', name: '虚构方案甲', description: '虚构方案甲用于独立验证项目', technologies: [] },
      { id: 'p-b', name: '虚构方案乙', description: '虚构方案乙采用另一条项目说明', technologies: [] }], internships: internshipSessionProfile.internships,awards:award?awardSessionProfile.awards:[],research:{papers:publication?publicationSessionProfile.publications:[],patents:[]} });
  if (mode === 'known-empty') { profile.projects = []; profile.collectionFacts = { projects: { state: 'known', source: 'user', confirmed: true } }; }
  if(mode==='awards-known-empty'){profile.awards=[];profile.collectionFacts={awards:{state:'known',source:'user',confirmed:true}};}
  if(mode==='papers-missing-identity')profile.research.papers=profile.research.papers.map(paper=>({...paper,doi:undefined,date:undefined}));
  if(['papers-known-empty','papers-none','papers-none-existing','papers-none-draft'].includes(mode)){profile.research.papers=[];profile.collectionFacts={papers:{state:mode==='papers-known-empty'?'known':'none',source:'user',confirmed:true}};}
  return { profile, education, project, internship, award, publication, state: () => ({
    education: education.saved, projects: project.saved, internships: internship.saved,
    awards:award?.saved??[],publications:publication?.saved??[],counts: [education.counts, project.counts, internship.counts,...(award?[award.counts]:[]),...(publication?[publication.counts]:[])], submits,
  }) };
}
