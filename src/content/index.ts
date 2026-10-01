import { z } from 'zod';
import type { ContentResponse } from '../shared/types';
import { fillScan } from './autofill';
import { scanDocument, type ScanState } from './scanner';
import { MobileWorkflow } from './mobileWorkflow';
import { workflowRequestSchema } from '../workflow/model';
import { EXTENSION_VERSION } from '../shared/version';
import { REPEATABLE_RECORD_V2_ENABLED } from '../shared/features';
import { RecordV2Gateway } from './recordV2Gateway';
import { createRecordV2FixtureSession } from './recordV2FixtureSession';
import { requestProjectProjection } from './profileProjectionClient';
import { ProjectRecordWorkflow } from './projectRecordWorkflow';

declare global {
  interface Window { __recruitmentAutofillInstalled?: boolean }
}

const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RA_SCAN') }).strict(),
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
  z.object({ type: z.literal('RA_PROJECT_RECORD_START') }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_STATUS') }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_PAUSE') }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_RESUME') }).strict(),
  z.object({ type: z.literal('RA_PROJECT_RECORD_STOP') }).strict(),
  z.object({ type: z.literal('RA_FILL'), payload: z.object({
    scanId: z.string().min(1).max(100),
    items: z.array(z.object({
      fieldId: z.string().min(1).max(150), value: z.string().max(50_000), confirmed: z.boolean(),
    }).strict()).max(500),
  }).strict() }).strict(),
]);

if (!window.__recruitmentAutofillInstalled && window.top === window) {
  window.__recruitmentAutofillInstalled = true;
  let currentScan: ScanState | undefined;
  let filling = false;
  const workflow = new MobileWorkflow(() => { currentScan = undefined; });
  const projectWorkflow = new ProjectRecordWorkflow(document, requestProjectProjection);
  let projectProjection: Awaited<ReturnType<typeof requestProjectProjection>> | undefined;
  let projectProjectionRequest: Promise<Awaited<ReturnType<typeof requestProjectProjection>>> | undefined;
  const recordV2 = new RecordV2Gateway({
    enabled: REPEATABLE_RECORD_V2_ENABLED,
    ...(REPEATABLE_RECORD_V2_ENABLED ? { createSession: () => {
      if (!projectProjection) throw new Error('项目档案投影尚未准备好');
      return createRecordV2FixtureSession(document, projectProjection, requestProjectProjection);
    } } : {}),
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: ContentResponse<unknown>) => void) => {
    const senderUrl = sender.url?.split(/[?#]/u)[0];
    if (sender.id !== chrome.runtime.id || !senderUrl || ![
      chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html'),
    ].includes(senderUrl)) return false;
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) { sendResponse({ ok: false, error: '无效的扩展请求' }); return false; }
    const request = parsed.data;
    if (request.type === 'RA_PROJECT_RECORD_START' || request.type === 'RA_PROJECT_RECORD_STATUS'
      || request.type === 'RA_PROJECT_RECORD_PAUSE' || request.type === 'RA_PROJECT_RECORD_RESUME'
      || request.type === 'RA_PROJECT_RECORD_STOP') {
      try {
        if (request.type === 'RA_PROJECT_RECORD_STATUS') {
          sendResponse({ ok: true, data: { version: EXTENSION_VERSION, state: projectWorkflow.status() } }); return false;
        }
        if (request.type === 'RA_PROJECT_RECORD_STOP' || request.type === 'RA_PROJECT_RECORD_PAUSE') {
          currentScan = undefined;
          sendResponse({ ok: true, data: request.type === 'RA_PROJECT_RECORD_STOP' ? projectWorkflow.stop() : projectWorkflow.pause() }); return false;
        }
        if (filling || ['running', 'paused', 'blocked', 'review'].includes(workflow.status().phase)
          || ['ready', 'running', 'paused'].includes(recordV2.status().state)) {
          throw new Error('另一个填写任务尚未结束，请先停止该任务');
        }
        currentScan = undefined;
        void (request.type === 'RA_PROJECT_RECORD_START' ? projectWorkflow.start() : projectWorkflow.resume())
          .then(data => sendResponse({ ok: true, data }))
          .catch(() => sendResponse({ ok: false, error: '项目任务尚未就绪，请检查网页并停止当前任务后重试' }));
        return true;
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : '项目任务操作失败' }); return false;
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
          && (projectWorkflow.holdsPage() || filling || workflow.isRunning())) throw new Error('另一个填写任务尚未结束');
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
    if (projectWorkflow.holdsPage()) { sendResponse({ ok: false, error: '项目任务尚未结束，请在扩展中暂停或停止；其它填写模式需先停止项目任务' }); return false; }
    if (request.type === 'RA_WORKFLOW_START' || request.type === 'RA_WORKFLOW_RESUME') {
      try { sendResponse({ ok: true, data: request.type === 'RA_WORKFLOW_START' ? workflow.start(request.payload) : workflow.resume() }); }
      catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : '启动连续填写失败' }); }
      return false;
    }
    if (workflow.isRunning()) { sendResponse({ ok: false, error: '连续填写正在运行，可在网页右下角暂停或停止' }); return false; }
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
    filling = true;
    void fillScan(currentScan, request.payload)
      .then((outcomes) => sendResponse({ ok: true, data: outcomes }))
      .catch(() => sendResponse({ ok: false, error: '填写失败，请检查页面并重新扫描' }))
      .finally(() => { filling = false; });
    return true;
  });
}
