import { afterEach, expect, it } from 'vitest';
import { runAgentPage, type AgentBridgePorts } from '../src/popup/agentBridge';
import { scanDocument, type ScanState } from '../src/content/scanner';
import { verifyScanObservation } from '../src/content/scanFreshness';
import { fillScan } from '../src/content/autofill';
import { matchFields } from '../src/matching/ruleMatcher';
import { createEmptyProfile, profileSchema } from '../src/profile/schema';
import { EducationRecordWorkflow } from '../src/content/educationRecordWorkflow';
import { ProjectRecordWorkflow } from '../src/content/projectRecordWorkflow';
import { InternshipRecordWorkflow } from '../src/content/internshipRecordWorkflow';
import { AwardRecordWorkflow } from '../src/content/awardRecordWorkflow';
import { awardProfile } from '../src/profile/awardProjection';
import { installAwardSessionPage,awardSessionProfile } from './fixtures/award-session-page';
import { verifyRecordPresence } from '../src/agent/recordCompletion';
import { agentOrdinaryFieldIds } from '../src/agent/pageTasks';
import { EXTENSION_VERSION } from '../src/shared/version';
import { installEducationSessionPage, educationSessionProfile } from './fixtures/education-session-page';
import { installWeakProjectSessionPage } from './fixtures/weak-project-session-page';
import { installInternshipSessionPage, internshipSessionProfile } from './fixtures/internship-session-page';
import type { AgentStepRequest } from '../src/agent/nextStepProtocol';
import type { PagePlan } from '../src/popup/bridge';
const activeFlows: { stop(): unknown }[] = [];
afterEach(() => { activeFlows.splice(0).forEach(flow => flow.stop()); document.body.innerHTML = ''; });
function setup(options: { unknown?: boolean; internship?: boolean; awards?: boolean; partial?: boolean; awardRecords?:boolean } = {}) {
  const education = installEducationSessionPage(document, educationSessionProfile, options.partial ? [1] : []);
  const educationSection = education.list.closest('section')!;
  const projects = installWeakProjectSessionPage(document); const projectSection = projects.list.closest('section')!;
  const internship = options.internship ? installInternshipSessionPage(document) : undefined;
  const internshipSection = internship?.list.closest('section');
  const award = options.awardRecords ? installAwardSessionPage(document,[],{cadre:'radio'}) : undefined;
  const awardSection=award?.list.closest('section');
  document.body.replaceChildren(educationSection, projectSection, ...(internshipSection ? [internshipSection] : []),...(awardSection?[awardSection]:[]));
  const basic = document.createElement('section'); basic.setAttribute('aria-label', '个人信息');
  basic.innerHTML = `<h2>个人信息</h2><label>姓名<input required></label>${options.unknown ? '<label>必须手工回答的问题<input required></label>' : ''}`;
  document.body.prepend(basic);
  if (options.awards) document.body.insertAdjacentHTML('beforeend', '<section aria-label="在校奖励"><h2>在校奖励</h2><p>暂无奖励</p><button>添加奖励</button></section>');
  const profile = profileSchema.parse({ ...createEmptyProfile(), basic: { name: '虚构应聘者',studentCadre:'否' }, education: educationSessionProfile.education,
    projects: [{ id: 'p-a', name: '虚构方案甲', description: '虚构方案甲用于独立验证项目', technologies: [] },
      { id: 'p-b', name: '虚构方案乙', description: '虚构方案乙采用另一条项目说明', technologies: [] }],
    internships: options.internship ? internshipSessionProfile.internships : [],awards:options.awardRecords?awardSessionProfile.awards:[] });
  const projectProjection = { recordType: 'project' as const, profileRevision: 'fictional', projects: profile.projects };
  const flows = { education: new EducationRecordWorkflow(document, async () => educationSessionProfile),
    project: new ProjectRecordWorkflow(document, async () => projectProjection),
    internship: new InternshipRecordWorkflow(document, async () => ({ recordType: 'internship', profileRevision: 'fictional', internships: profile.internships })),
    award:new AwardRecordWorkflow(document,async()=>awardProfile(profile)) };
  activeFlows.push(...Object.values(flows));
  const scans = new WeakMap<PagePlan, ScanState>(); const requests: AgentStepRequest[] = []; const starts: string[] = [];
  let ownerController = new AbortController(); let ownerToken = crypto.randomUUID(); let releases = 0; let context = 'fictional-fixed-context';
  const ports: AgentBridgePorts = {
    scan: async () => { const scan = scanDocument(); const plan = { tabId: 1, scan: scan.result, matches: matchFields(scan.result.fields, profile), profile };
      scans.set(plan, scan); return plan; },
    context: async () => context,
    owner: async () => {
      if (ownerController.signal.aborted) { ownerController = new AbortController(); ownerToken = crypto.randomUUID(); }
      return { token: ownerToken, signal: ownerController.signal, close: () => {
        releases++; ownerController.abort(); Object.values(flows).forEach(flow => { if (flow.holdsPage()) flow.stop(); }); } };
    },
    check: async (_tab, kind, token) => {
      expect(token).toBe(ownerToken);
      const projection = kind === 'education' ? educationSessionProfile : kind === 'project' ? projectProjection
        : kind==='internship'?{ recordType: 'internship', profileRevision: 'fictional', internships: profile.internships }:awardProfile(profile);
      return { version: EXTENSION_VERSION, state: flows[kind].status(), presence: verifyRecordPresence(scanDocument(), projection) };
    },
    verify: async plan => !!verifyScanObservation(scans.get(plan)!),
    decide: async request => { requests.push(request); return { requestId: request.requestId, status: 'act', ref: request.tasks[0]!.ref, reason: 'available-task' }; },
    fields: async (plan, signal, token) => {
      expect(token).toBe(ownerToken); const ordinary = agentOrdinaryFieldIds(plan.scan);
      const items = plan.matches.filter(match => ordinary.has(match.fieldId) && match.status === 'auto' && match.value !== undefined)
        .map(match => ({ fieldId: match.fieldId, value: match.value!, confirmed: true }));
      return items.length ? fillScan(scans.get(plan)!, { scanId: plan.scan.scanId, items }, signal) : [];
    },
    command: async (_tab, request) => {
      const kind = request.type.startsWith('RA_EDUCATION') ? 'education' : request.type.startsWith('RA_PROJECT') ? 'project' : request.type.startsWith('RA_INTERNSHIP')?'internship':'award';
      if (request.type.endsWith('_START')) { expect('agentRunToken' in request && request.agentRunToken).toBe(ownerToken); starts.push(kind); return flows[kind].start(); }
      return { version: EXTENSION_VERSION, state: flows[kind].status() };
    },
    wait: async signal => { signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 20)); signal.throwIfAborted(); },
  };
  return { ports, education, projects, internship, award, flows, requests, starts, basic, get ownerController() { return ownerController; },
    releases: () => releases, setContext: (value: string) => { context = value; } };
}
it('one intent completes four record categories including every award and restarts without duplication',async()=>{
 const s=setup({internship:true,awardRecords:true});const result=await runAgentPage(s.ports,new AbortController().signal);
 expect(result.result).toMatchObject({state:'complete',steps:5,pending:{fields:0,records:0,blockers:0}});
 expect(s.starts).toEqual(['education','project','internship','award']);expect(s.award?.saved.map(award=>award.date)).toEqual(awardSessionProfile.awards.map(award=>award.date));
 expect(s.award?.counts).toEqual({add:3,save:3,submit:0,remove:0,cancel:0});expect(s.award?.saved.every(award=>award.cadre==='no')).toBe(true);
 expect((await runAgentPage(s.ports,new AbortController().signal)).result).toMatchObject({state:'complete',steps:0});expect(s.award?.counts.add).toBe(3);
 expect(JSON.stringify(s.requests)).not.toContain(awardSessionProfile.awards[0]!.name);
},60_000);
it('owner close during award loading prevents award Add and Save',async()=>{
 const s=setup({awardRecords:true});const original=s.ports.command;
 s.ports.command=async(tab,request)=>{if(request.type==='RA_AWARD_RECORD_START'){s.ownerController.abort();return {phase:'stopped',canStart:true,total:3};}return original(tab,request);};
 expect((await runAgentPage(s.ports,new AbortController().signal)).result.state).toBe('stopped');expect(s.award?.counts.add).toBe(0);expect(s.award?.counts.save).toBe(0);
},60_000);
it('one page intent uses original Add/fill/Save for education, projects and internships then freshly proves completion', async () => {
  const s = setup({ internship: true }); const phases: string[] = [];
  const result = await runAgentPage(s.ports, new AbortController().signal, value => phases.push(value.phase));
  expect(result.result).toMatchObject({ state: 'complete', steps: 4, pending: { fields: 0, records: 0, blockers: 0 } });
  expect(s.starts).toEqual(['education','project','internship']);
  expect(s.education.saved.map(record => record.degree)).toEqual(['学士学位','硕士学位']);
  expect(s.projects.saved.map(record => record.name)).toEqual(['虚构方案甲','虚构方案乙']);
  expect(s.internship?.saved.map(record => record.organization)).toEqual(internshipSessionProfile.internships.map(record => record.organization));
  for (const fixture of [s.education, s.projects, s.internship!]) expect(fixture.counts).toMatchObject({ add: 2, save: 2, remove: 0, submit: 0 });
  expect(result.outcomes.filter(value => value.status === 'filled')).toHaveLength(1); expect(phases.at(-1)).toBe('complete');
  expect(s.releases()).toBe(1); expect(JSON.stringify(s.requests)).not.toContain('虚构');
  // The second run reads current records, instead of recreating source records or asking the model again.
  const previous = s.requests.length;
  expect((await runAgentPage(s.ports, new AbortController().signal)).result).toMatchObject({ state: 'complete', steps: 0 });
  expect(s.requests).toHaveLength(previous); expect(s.starts).toHaveLength(3); expect(s.releases()).toBe(2);
}, 60000);
it('unknown fields are deferred while all known records still get processed', async () => {
  const s = setup({ unknown: true }); const result = await runAgentPage(s.ports, new AbortController().signal);
  expect(result.result.state).toBe('needs-user'); expect(result.result.pending?.fields).toBe(1);
  expect(s.education.saved).toHaveLength(2); expect(s.projects.saved).toHaveLength(2);
  expect(s.basic.querySelectorAll('input')[1]!.value).toBe('');
}, 40000);
it('a remaining award section prevents the whole-page complete message', async () => {
  const s = setup({ awards: true }); const result = await runAgentPage(s.ports, new AbortController().signal);
  expect(result.result.state).toBe('needs-user'); expect(result.result.pending?.blockers).toBeGreaterThan(0);
  expect(s.projects.saved).toHaveLength(2); expect(s.education.saved).toHaveLength(2);
}, 40000);
it('existing exact education records are skipped individually', async () => {
  const s = setup({ partial: true }); const result = await runAgentPage(s.ports, new AbortController().signal);
  expect(result.result.state).toBe('complete'); expect(s.education.saved).toHaveLength(1);
  expect(s.education.saved[0]!.degree).toBe('硕士学位'); expect(s.education.counts.add).toBe(1);
}, 30000);
it('context changes while the model is thinking stop every write', async () => {
  const s = setup(); const decide = s.ports.decide;
  s.ports.decide = async (request, signal) => { s.setContext('different profile or page'); return decide(request, signal); };
  const result = await runAgentPage(s.ports, new AbortController().signal);
  expect(result.result.state).toBe('context-changed'); expect(s.starts).toHaveLength(0);
  expect(s.basic.querySelector('input')!.value).toBe(''); expect(s.releases()).toBe(1);
});
it('replacement of a locally observed control is rejected before execution', async () => {
  const s = setup(); const decide = s.ports.decide;
  s.ports.decide = async (request, signal) => { s.projects.add.replaceWith(s.projects.add.cloneNode(true)); return decide(request, signal); };
  expect((await runAgentPage(s.ports, new AbortController().signal)).result.state).toBe('context-changed'); expect(s.starts).toHaveLength(0);
});
it('Stop during a pending model response rejects the late proposal and releases the page', async () => {
  const s = setup(); const controller = new AbortController(); const decide = s.ports.decide;
  s.ports.decide = async (request, signal) => { controller.abort(); return decide(request, signal); };
  expect((await runAgentPage(s.ports, controller.signal)).result.state).toBe('stopped'); expect(s.starts).toHaveLength(0); expect(s.releases()).toBe(1);
});
it('owner connection loss also rejects a late proposal', async () => {
  const s = setup(); const decide = s.ports.decide;
  s.ports.decide = async (request, signal) => { s.ownerController.abort(); return decide(request, signal); };
  expect((await runAgentPage(s.ports, new AbortController().signal)).result.state).toBe('stopped'); expect(s.starts).toHaveLength(0);
});
it('a wrong content version cannot begin an Agent action', async () => {
  const s = setup(); const check = s.ports.check;
  s.ports.check = async (tab, kind, token) => ({ ...await check(tab, kind, token) as object, version: 'old-version' });
  expect((await runAgentPage(s.ports, new AbortController().signal)).result.state).toBe('unavailable'); expect(s.starts).toHaveLength(0);
});
it('an old complete phase without source identity proof cannot claim saved records', async () => {
  const s = setup(); const command = s.ports.command;
  s.ports.command = async (tab, request) => request.type.endsWith('_START') ? { phase: 'complete', total: 2, canStart: true }
    : request.type.endsWith('_STATUS') ? { version: EXTENSION_VERSION, state: { phase: 'complete', total: 2, canStart: true } } : command(tab, request);
  expect((await runAgentPage(s.ports, new AbortController().signal)).result.state).toBe('needs-user');
  expect(s.education.saved).toHaveLength(0); expect(s.projects.saved).toHaveLength(0);
});
