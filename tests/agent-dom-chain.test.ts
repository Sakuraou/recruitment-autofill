import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createSemanticServer } from '../src/companion/server';
import { createAgentProvider } from '../src/companion/agentProvider';
import { runAgentSteps, type AgentActionResult, type AgentObservation, type AgentStepPorts } from '../src/agent/nextStepWorkflow';
import { EducationRecordWorkflow } from '../src/content/educationRecordWorkflow';
import { ProjectRecordWorkflow } from '../src/content/projectRecordWorkflow';
import { scanDocument, type ScanState } from '../src/content/scanner';
import { verifyScanObservation } from '../src/content/scanFreshness';
import { fillScan } from '../src/content/autofill';
import { verifyRecordPresence } from '../src/agent/recordCompletion';
import { educationSessionProfile, installEducationSessionPage } from './fixtures/education-session-page';
import { installWeakProjectSessionPage } from './fixtures/weak-project-session-page';
import type { ProjectProjectionResponse } from '../src/profile/projection';
const servers: Server[] = [];
async function listen(server: Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address'); return `http://127.0.0.1:${address.port}`; }
afterEach(async () => { document.body.innerHTML = ''; await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
}))); });
async function setup(remainingAward = false, replaceAdd = false) {
  const education = installEducationSessionPage(document); const educationSection = education.list.closest('section')!;
  const projects = installWeakProjectSessionPage(document); document.body.prepend(educationSection);
  const basic = document.createElement('section'); basic.setAttribute('aria-label', '个人信息'); basic.innerHTML = '<h2>个人信息</h2><label>姓名<input required></label>'; document.body.prepend(basic);
  const projectProjection: ProjectProjectionResponse = { recordType: 'project', profileRevision: 'fictional', projects: [
    { id: 'first', name: '虚构项目甲', description: '虚构项目甲用于验证独立记录', technologies: [] },
    { id: 'second', name: '虚构项目乙', description: '虚构项目乙使用另一条独立说明', technologies: [] },
  ] };
  const educationFlow = new EducationRecordWorkflow(document, async () => educationSessionProfile);
  const projectFlow = new ProjectRecordWorkflow(document, async () => projectProjection);
  const completed = new Set<string>(); const scans = new WeakMap<AgentObservation, ScanState>(); const requests: unknown[] = [];
  const token = '1'.repeat(64); const origin = `chrome-extension://${'a'.repeat(32)}`;
  const upstream = await listen(createServer((req, res) => { const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); const request = JSON.parse(body.messages[1].content); requests.push(request);
    if (req.headers.authorization !== 'Bearer fictional-agent-key') { res.writeHead(401); res.end(); return; }
    if (replaceAdd) projects.add.replaceWith(projects.add.cloneNode(true));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
      requestId: request.requestId, status: 'act', ref: request.tasks[0].ref, reason: 'available-task' }) } }] }));
  }); }));
  const companion = await listen(createSemanticServer({ token, agentProvider: createAgentProvider({ baseUrl: upstream + '/v1', apiKey: 'fictional-agent-key', model: 'fictional-agent-model' }) }));
  const observe = async (): Promise<AgentObservation> => {
    const scan = scanDocument(); const tasks: AgentObservation['tasks'][number][] = [];
    const fields = basic.querySelector<HTMLInputElement>('input')!.value ? 0 : 1;
    if (fields) tasks.push({ kind: 'fill-visible', count: fields });
    if (!completed.has('education') || verifyRecordPresence(scan, educationSessionProfile).state !== 'all-present') {
      expect(educationFlow.status().canStart).toBe(true); tasks.push({ kind: 'education-records', count: 2 }); }
    if (!completed.has('projects') || verifyRecordPresence(scan, projectProjection).state !== 'all-present') {
      expect(projectFlow.status().canStart).toBe(true); tasks.push({ kind: 'project-records', count: 2 }); }
    const value: AgentObservation = { context: 'fictional-fixed-page-profile', fingerprint: JSON.stringify([fields, ...completed]),
      pending: { fields, records: tasks.filter(task => task.kind !== 'fill-visible').reduce((sum, task) => sum + task.count, 0) + (remainingAward ? 1 : 0), blockers: remainingAward ? 1 : 0 }, tasks };
    scans.set(value, scan); return value;
  };
  const ports: AgentStepPorts = { observe, verify: async value => !!verifyScanObservation(scans.get(value)!),
    decide: async (request, signal) => {
      const response = await fetch(companion + '/v1/next-step', { method: 'POST', signal, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': token }, body: JSON.stringify(request) });
      expect(response.status).toBe(200); return (await response.json()).proposal;
    },
    execute: async (kind, value, signal): Promise<AgentActionResult> => {
      if (kind === 'fill-visible') {
        const scan = scans.get(value)!; const field = scan.result.fields.find(f => f.label === '姓名')!;
        const result = await fillScan(scan, { scanId: scan.result.scanId, items: [{ fieldId: field.id, value: '虚构求职者', confirmed: true }] }, signal);
        return { state: result.some(r => r.status === 'filled') ? 'progress' : 'failed' };
      }
      const flow = kind === 'education-records' ? educationFlow : projectFlow;
      const stop = () => { flow.stop(); }; signal.addEventListener('abort', stop, { once: true });
      try {
        await flow.start();
        for (let poll = 0; poll < 1000; poll++) {
          signal.throwIfAborted(); const state = flow.status();
          if (state.phase === 'complete') { completed.add(kind === 'education-records' ? 'education' : 'projects'); return { state: 'progress' }; }
          if (state.phase === 'review') return { state: 'needs-user' };
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        flow.stop(); return { state: 'failed' };
      } finally { signal.removeEventListener('abort', stop); }
    },
  };
  return { ports, education, projects, requests, basic, projectProjection };
}
it('actual compatible HTTP chooses fields, then two education records and every project through original DOM executors', async () => {
  const s = await setup(); const result = await runAgentSteps(s.ports, new AbortController().signal);
  expect(result).toMatchObject({ state: 'complete', steps: 3 }); expect(s.requests).toHaveLength(3);
  expect(s.basic.querySelector<HTMLInputElement>('input')!.value).toBe('虚构求职者');
  expect(s.education.saved.map(r => r.school)).toEqual([educationSessionProfile.education[1]!.school, educationSessionProfile.education[0]!.school]);
  expect(s.education.saved.map(r => r.degree)).toEqual(['学士学位', '硕士学位']);
  expect(s.projects.saved).toEqual(s.projectProjection.projects.map(r => ({ name: r.name, description: r.description })));
  expect(s.education.counts).toMatchObject({ add: 2, save: 2, submit: 0, remove: 0 }); expect(s.projects.counts).toMatchObject({ add: 2, save: 2, submit: 0, remove: 0 });
  expect(JSON.stringify(s.requests)).not.toContain('虚构求职者'); expect(JSON.stringify(s.requests)).not.toContain('虚构项目'); expect(JSON.stringify(s.requests)).not.toContain('虚构云川');
}, 30000);
it('does not report whole-page completion when awards still need a separate capability', async () => {
  const s = await setup(true); const result = await runAgentSteps(s.ports, new AbortController().signal);
  expect(result).toMatchObject({ state: 'needs-user', steps: 3, pending: { fields: 0, records: 1, blockers: 1 } });
  expect(s.projects.saved).toHaveLength(2); expect(s.education.saved).toHaveLength(2); expect(s.requests).toHaveLength(3);
}, 30000);
it('replacement of an observed Add button while inference runs stops before any field or record action', async () => {
  const s = await setup(false, true); expect((await runAgentSteps(s.ports, new AbortController().signal)).state).toBe('context-changed');
  expect(s.education.counts.add).toBe(0); expect(s.projects.counts.add).toBe(0); expect(s.basic.querySelector<HTMLInputElement>('input')!.value).toBe('');
});
