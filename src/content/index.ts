import { z } from 'zod';
import { AgentPageLease } from '../agent/pageLease';
import { verifyRecordPresence } from '../agent/recordCompletion';
import { createAgentOwnerPortHandler } from './agentOwnerPort';
import type { ContentResponse } from '../shared/types';
import { fillScan } from './autofill';
import { scanDocument, type ScanState } from './scanner';
import { verifyScanObservation } from './scanFreshness';
import { waitForDomStability } from './domStability';
import { MobileWorkflow } from './mobileWorkflow';
import { workflowRequestSchema } from '../workflow/model';
import { EXTENSION_VERSION } from '../shared/version';
import { REPEATABLE_RECORD_V2_ENABLED } from '../shared/features';
import { RecordV2Gateway } from './recordV2Gateway';
import { createRecordV2FixtureSession } from './recordV2FixtureSession';
import { requestEducationProjection, requestProjectProjection, requestInternshipProjection, requestAwardProjection } from './profileProjectionClient';
import { AwardRecordWorkflow } from './awardRecordWorkflow';
import { EducationRecordWorkflow } from './educationRecordWorkflow';
import { InternshipRecordWorkflow } from './internshipRecordWorkflow';
import { createInternshipRecordSession } from './internshipRecordSession';
import { createInternshipSemanticClient } from './internshipSemanticClient';
import { ProjectRecordWorkflow } from './projectRecordWorkflow';
import { createProjectRecordSession } from './projectRecordSession';
import { createProjectSemanticClient } from './projectSemanticClient';
import { createEducationRecordSession } from './educationRecordSession';
import { createEducationSemanticClient } from './educationSemanticClient';
import { createPageOperationPortHandler } from './pageOperationPort';
import { fillRequestSchema } from '../shared/pageOperationProtocol';

declare global {
  interface Window { __recruitmentAutofillInstalled?: boolean }
}

const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RA_AGENT_RECORD_CHECK'), payload: z.object({ token: z.uuid(), kind: z.enum(['education','project','internship','award']) }).strict() }).strict(),
  z.object({ type: z.literal('RA_SCAN') }).strict(),
  z.object({ type: z.literal('RA_SCAN_SETTLED') }).strict(),
  z.object({ type: z.literal('RA_VERIFY_SCAN'), payload: z.object({ scanId: z.string().min(1).max(100) }).strict() }).strict(),
  z.object({ type: z.literal('RA_SELECTION') }).strict(),
  z.object({ type: z.literal('RA_WORKFLOW_START'), payload: workflowRequestSchema }).strict(),
  z.object({ type: z.literal('RA_WORKFLOW_STATUS') }).strict(),
  z.object({ type: z.literal('RA_WORKFLOW_PAUSE') }).strict(),
  z.object({ type: z.literal('RA_WORKFLOW_RESUME') }).strict(),
  z.object({ type: z.literal('RA_WORKFLOW_STOP') }).strict(),
  z.object({ type: z.literal('RA_RECORD_V2_START') }).strict(),
  z.object({ type: z.literal('RA_RECORD_V2_ADVANCE') }).strict(),
  z.object({ type: z.literal('RA_RECORD_V2_STATUS') }).strict(),
  z.object({ type: z.literal('RA_RECORD_V2_PAUSE') }).strict(),
  z.object({ type: z.literal('RA_RECORD_V2_RESUME') }).strict(),
  z.object({ type: z.literal('RA_RECORD_V2_STOP') }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_START'), agentRunToken: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_STATUS') }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_PAUSE') }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_RESUME'), agentRunToken: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_STOP') }).strict(),
  z.object({ type: z.literal('RA_EDUCATION_RECORD_START'), agentRunToken: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('RA_EDUCATION_RECORD_STATUS') }).strict(),
  z.object({ type: z.literal('RA_EDUCATION_RECORD_PAUSE') }).strict(),
  z.object({ type: z.literal('RA_EDUCATION_RECORD_RESUME'), agentRunToken: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('RA_EDUCATION_RECORD_STOP') }).strict(),
  z.object({ type: z.literal('RA_INTERNSHIP_RECORD_START'), agentRunToken: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('RA_INTERNSHIP_RECORD_STATUS') }).strict(),
  z.object({ type: z.literal('RA_INTERNSHIP_RECORD_PAUSE') }).strict(),
  z.object({ type: z.literal('RA_INTERNSHIP_RECORD_RESUME'), agentRunToken: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('RA_INTERNSHIP_RECORD_STOP') }).strict(),
  z.object({ type: z.literal('RA_AWARD_RECORD_START'), agentRunToken: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('RA_AWARD_RECORD_STATUS') }).strict(),
  z.object({ type: z.literal('RA_AWARD_RECORD_PAUSE') }).strict(),
  z.object({ type: z.literal('RA_AWARD_RECORD_RESUME'), agentRunToken: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('RA_AWARD_RECORD_STOP') }).strict(),
  z.object({ type: z.literal('RA_FILL'), payload: fillRequestSchema }).strict(),
]);

if (!window.__recruitmentAutofillInstalled && window.top === window) {
  window.__recruitmentAutofillInstalled = true;
  let currentScan: ScanState | undefined;
  let filling = false;
  const workflow = new MobileWorkflow(() => { currentScan = undefined; });
  const awardWorkflow = new AwardRecordWorkflow(document, requestAwardProjection);
  const internshipWorkflow = new InternshipRecordWorkflow(document, requestInternshipProjection,
    (doc, projection, refresh) => createInternshipRecordSession(doc, projection, refresh, undefined, createInternshipSemanticClient()));
  const educationWorkflow = new EducationRecordWorkflow(document, requestEducationProjection,
    (doc, projection, refresh) => createEducationRecordSession(doc, projection, refresh, undefined, createEducationSemanticClient()));
  const projectWorkflow = new ProjectRecordWorkflow(document, requestProjectProjection,
    (doc, projection, refresh) => createProjectRecordSession(doc, projection, refresh, undefined, createProjectSemanticClient()));
  let projectProjection: Awaited<ReturnType<typeof requestProjectProjection>> | undefined;
  let projectProjectionRequest: Promise<Awaited<ReturnType<typeof requestProjectProjection>>> | undefined;
  const recordV2 = new RecordV2Gateway({
    enabled: REPEATABLE_RECORD_V2_ENABLED,
    ...(REPEATABLE_RECORD_V2_ENABLED ? { createSession: () => {
      if (!projectProjection) throw new Error('项目档案投影尚未准备好');
      return createRecordV2FixtureSession(document, projectProjection, requestProjectProjection);
    } } : {}),
  });
  const agentLease = new AgentPageLease(() => document.URL, () => filling || educationWorkflow.holdsPage() || projectWorkflow.holdsPage()
    || internshipWorkflow.holdsPage() || awardWorkflow.holdsPage() || ['running', 'paused', 'blocked', 'review'].includes(workflow.status().phase)
    || ['ready', 'running', 'paused'].includes(recordV2.status().state));
  const ownedAgentWorkflows = new Set<{ holdsPage(): boolean; stop(): unknown }>();
  chrome.runtime.onConnect.addListener(createAgentOwnerPortHandler({ extensionId: chrome.runtime.id,
    extensionUrl: path => chrome.runtime.getURL(path), version: EXTENSION_VERSION, lease: agentLease,
    releaseOwnedTasks: () => { for (const flow of ownedAgentWorkflows) if (flow.holdsPage()) flow.stop(); ownedAgentWorkflows.clear(); } }));
  chrome.runtime.onConnect.addListener(createPageOperationPortHandler({
    extensionId: chrome.runtime.id, extensionUrl: path => chrome.runtime.getURL(path),
    authorize: request => agentLease.mayWrite(request.agentRunToken),
    acquire: () => {
      if (filling || educationWorkflow.holdsPage() || projectWorkflow.holdsPage() || internshipWorkflow.holdsPage() || awardWorkflow.holdsPage() || workflow.isRunning() || ['ready', 'running', 'paused'].includes(recordV2.status().state))
        throw new Error('page occupied');
      filling = true;
      return () => { filling = false; };
    },
    invalidate: () => { currentScan = undefined; },
    execute: async (request, signal) => {
      signal.throwIfAborted();
      if (request.type === 'RA_FILL') {
        if (!currentScan) throw new Error('scan missing');
        return fillScan(currentScan, request.payload, signal);
      }
      const originalUrl = document.URL; currentScan = undefined;
      const result = await waitForDomStability({ root: document.documentElement, quietWindowMs: 750, timeoutMs: 3000,
        signal, observe: { characterData: true }, predicate: () => document.URL === originalUrl && !document.querySelector('[aria-busy="true"]') });
      signal.throwIfAborted();
      if (result.status !== 'stable' || document.URL !== originalUrl) throw new Error('page unsettled');
      currentScan = scanDocument(); return currentScan.result;
    },
  }));
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: ContentResponse<unknown>) => void) => {
    const senderUrl = sender.url?.split(/[?#]/u)[0];
    if (sender.id !== chrome.runtime.id || !senderUrl || ![
      chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html'),
    ].includes(senderUrl)) return false;
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) { sendResponse({ ok: false, error: '无效的扩展请求' }); return false; }
    const request = parsed.data;
    if (request.type === 'RA_AGENT_RECORD_CHECK') {
      if (!agentLease.mayWrite(request.payload.token)) { sendResponse({ ok: false, error: 'Agent 任务已失效' }); return false; }
      const kind = request.payload.kind;
      const flow = {education:educationWorkflow,project:projectWorkflow,internship:internshipWorkflow,award:awardWorkflow}[kind];
      const load = {education:requestEducationProjection,project:requestProjectProjection,internship:requestInternshipProjection,award:requestAwardProjection}[kind];
      void load().then(projection => {
        if (!agentLease.mayWrite(request.payload.token)) throw new Error('stopped');
        const presence = verifyRecordPresence(scanDocument(), projection);
        sendResponse({ ok: true, data: { version: EXTENSION_VERSION, state: flow.status(), presence } });
      }).catch(() => sendResponse({ ok: false, error: '无法核验当前栏目或 Agent 已停止' }));
      return true;
    }
    if (request.type === 'RA_PROJECT_RECORD_START' || request.type === 'RA_PROJECT_RECORD_STATUS'
      || request.type === 'RA_PROJECT_RECORD_PAUSE' || request.type === 'RA_PROJECT_RECORD_RESUME' || request.type === 'RA_PROJECT_RECORD_STOP'
      || request.type === 'RA_EDUCATION_RECORD_START' || request.type === 'RA_EDUCATION_RECORD_STATUS'
      || request.type === 'RA_EDUCATION_RECORD_PAUSE' || request.type === 'RA_EDUCATION_RECORD_RESUME' || request.type === 'RA_EDUCATION_RECORD_STOP'
      || request.type === 'RA_INTERNSHIP_RECORD_START' || request.type === 'RA_INTERNSHIP_RECORD_STATUS'
      || request.type === 'RA_INTERNSHIP_RECORD_PAUSE' || request.type === 'RA_INTERNSHIP_RECORD_RESUME' || request.type === 'RA_INTERNSHIP_RECORD_STOP'
      || request.type === 'RA_AWARD_RECORD_START' || request.type === 'RA_AWARD_RECORD_STATUS'
      || request.type === 'RA_AWARD_RECORD_PAUSE' || request.type === 'RA_AWARD_RECORD_RESUME' || request.type === 'RA_AWARD_RECORD_STOP') {
      const targetWorkflow = request.type.startsWith('RA_EDUCATION_') ? educationWorkflow
        : request.type.startsWith('RA_INTERNSHIP_') ? internshipWorkflow : request.type.startsWith('RA_AWARD_') ? awardWorkflow : projectWorkflow;
      const otherWorkflows = [educationWorkflow, projectWorkflow, internshipWorkflow, awardWorkflow].filter(flow => flow !== targetWorkflow);
      const operation = request.type.slice(request.type.lastIndexOf('_') + 1);
      try {
        if (operation === 'STATUS') {
          sendResponse({ ok: true, data: { version: EXTENSION_VERSION, state: targetWorkflow.status() } }); return false;
        }
        if (operation === 'STOP' || operation === 'PAUSE') {
          currentScan = undefined;
          sendResponse({ ok: true, data: operation === 'STOP' ? targetWorkflow.stop() : targetWorkflow.pause() }); return false;
        }
        if (!['START', 'RESUME'].includes(operation)) throw new Error('无效的栏目操作');
        const agentRunToken = 'agentRunToken' in request ? request.agentRunToken : undefined;
        if (!agentLease.mayWrite(agentRunToken)) throw new Error('Agent 正在处理本页，已阻止其他填写任务');
        if (agentRunToken) ownedAgentWorkflows.add(targetWorkflow);
        if (filling || otherWorkflows.some(flow => flow.holdsPage()) || ['running', 'paused', 'blocked', 'review'].includes(workflow.status().phase)
          || ['ready', 'running', 'paused'].includes(recordV2.status().state)) {
          throw new Error('另一个填写任务尚未结束，请先停止该任务');
        }
        currentScan = undefined;
        void (operation === 'START' ? targetWorkflow.start() : targetWorkflow.resume())
          .then(data => sendResponse({ ok: true, data }))
          .catch(() => sendResponse({ ok: false, error: '栏目任务尚未就绪，请检查网页并停止当前任务后重试' }));
        return true;
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : '栏目任务操作失败' }); return false;
      }
    }
    if (request.type === 'RA_RECORD_V2_STATUS'
      || request.type === 'RA_RECORD_V2_START'
      || request.type === 'RA_RECORD_V2_ADVANCE'
      || request.type === 'RA_RECORD_V2_PAUSE'
      || request.type === 'RA_RECORD_V2_RESUME'
      || request.type === 'RA_RECORD_V2_STOP') {
      try {
        if (request.type !== 'RA_RECORD_V2_STATUS' && request.type !== 'RA_RECORD_V2_STOP'
          && (agentLease.holdsPage() || educationWorkflow.holdsPage() || projectWorkflow.holdsPage() || internshipWorkflow.holdsPage() || awardWorkflow.holdsPage() || filling || workflow.isRunning())) throw new Error('另一个填写任务尚未结束');
        if (request.type === 'RA_RECORD_V2_STATUS') {
          sendResponse({ ok: true, data: { version: EXTENSION_VERSION, state: recordV2.status() } }); return false;
        }
        if (request.type === 'RA_RECORD_V2_START') {
          if (!REPEATABLE_RECORD_V2_ENABLED) { sendResponse({ ok: true, data: recordV2.start() }); return false; }
          projectProjectionRequest ??= requestProjectProjection();
          void projectProjectionRequest
            .then(projection => { projectProjection = projection; sendResponse({ ok: true, data: recordV2.start() }); })
            .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : '无法读取项目档案投影' }))
            .finally(() => { projectProjectionRequest = undefined; });
          return true;
        }
        if (request.type === 'RA_RECORD_V2_PAUSE') {
          sendResponse({ ok: true, data: recordV2.pause() }); return false;
        }
        if (request.type === 'RA_RECORD_V2_RESUME') {
          sendResponse({ ok: true, data: recordV2.resume() }); return false;
        }
        if (request.type === 'RA_RECORD_V2_STOP') {
          sendResponse({ ok: true, data: recordV2.stop() }); return false;
        }
        void recordV2.advance()
          .then(data => sendResponse({ ok: true, data }))
          .catch(error => sendResponse({ ok: false,
            error: error instanceof Error ? error.message : '通用多记录填写推进失败' }));
        return true;
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : '通用多记录填写请求失败' });
        return false;
      }
    }
    if (request.type === 'RA_WORKFLOW_STATUS') {
      sendResponse({ ok: true, data: { version: EXTENSION_VERSION, state: workflow.status() } }); return false;
    }
    if (request.type === 'RA_WORKFLOW_PAUSE' || request.type === 'RA_WORKFLOW_STOP') {
      sendResponse({ ok: true, data: request.type === 'RA_WORKFLOW_PAUSE' ? workflow.pause() : workflow.stop() }); return false;
    }
    if (request.type === 'RA_SELECTION') {
      sendResponse({ ok: true, data: window.getSelection()?.toString().trim().slice(0, 20_000) ?? '' });
      return false;
    }
    if (filling) { sendResponse({ ok: false, error: '正在填写，请等待完成后再操作' }); return false; }
    if (internshipWorkflow.holdsPage()) { sendResponse({ ok: false, error: '实习任务尚未结束，请先停止该任务再使用其他填写模式' }); return false; }
    if (awardWorkflow.holdsPage()) { sendResponse({ok:false,error:'奖励任务尚未结束，请先停止该任务再使用其他填写模式'}); return false; }
    if (educationWorkflow.holdsPage()) { sendResponse({ ok: false, error: '教育任务尚未结束，请先停止该任务再使用其他填写模式' }); return false; }
    if (projectWorkflow.holdsPage()) { sendResponse({ ok: false, error: '项目任务尚未结束，请在扩展中暂停或停止；其它填写模式需先停止项目任务' }); return false; }
    if (request.type === 'RA_WORKFLOW_START' || request.type === 'RA_WORKFLOW_RESUME') {
      if (!agentLease.mayWrite()) { sendResponse({ ok: false, error: 'Agent 正在处理本页，请先停止' }); return false; }
      try { sendResponse({ ok: true, data: request.type === 'RA_WORKFLOW_START' ? workflow.start(request.payload) : workflow.resume() }); }
      catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : '启动连续填写失败' }); }
      return false;
    }
    if (workflow.isRunning()) { sendResponse({ ok: false, error: '连续填写正在运行，可在网页右下角暂停或停止' }); return false; }
    if (request.type === 'RA_SCAN_SETTLED') {
      filling = true; currentScan = undefined;
      void waitForDomStability({ root: document.documentElement, quietWindowMs: 750, timeoutMs: 3000,
        observe: { characterData: true }, predicate: () => !document.querySelector('[aria-busy="true"]') })
        .then(result => {
          if (result.status !== 'stable') throw new Error('网页仍在变化，请稍后重新扫描。');
          currentScan = scanDocument(); sendResponse({ ok: true, data: currentScan.result });
        }).catch(() => sendResponse({ ok: false, error: '网页尚未稳定或已经跳转，已停止后续填写。' }))
        .finally(() => { filling = false; });
      return true;
    }
    if (request.type === 'RA_SCAN') {
      try {
        currentScan = scanDocument();
        sendResponse({ ok: true, data: currentScan.result });
      } catch {
        currentScan = undefined;
        sendResponse({ ok: false, error: '扫描失败，请刷新页面后重试' });
      }
      return false;
    }
    if (!currentScan) { sendResponse({ ok: false, error: '请先扫描当前页面' }); return false; }
    if (request.type === 'RA_VERIFY_SCAN') {
      const valid = currentScan.result.scanId === request.payload.scanId && verifyScanObservation(currentScan);
      sendResponse(valid ? { ok: true, data: valid } : { ok: false, error: '网页内容已变化，已丢弃旧的 AI 结果。请重新扫描。' });
      return false;
    }
    if (!agentLease.mayWrite()) { sendResponse({ ok: false, error: 'Agent 正在处理本页，请先停止' }); return false; }
    filling = true;
    void fillScan(currentScan, request.payload)
      .then((outcomes) => sendResponse({ ok: true, data: outcomes }))
      .catch(() => sendResponse({ ok: false, error: '填写失败，请检查页面并重新扫描' }))
      .finally(() => { filling = false; });
    return true;
  });
}
