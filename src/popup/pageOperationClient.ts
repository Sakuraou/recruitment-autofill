import { PAGE_OPERATION_DEADLINE_MS, PAGE_OPERATION_PORT, fillReplySchema, pageOperationSchema, scanReplySchema, type PageOperation } from '../shared/pageOperationProtocol';
import type { ContentResponse, FillOutcome, FillRequest, ScanResult } from '../shared/types';
import { isValidSemanticGraph } from '../shared/semanticGraphValidation';

/** Disconnect is cancellation, never a retry through the old message channel. */
function operate<T>(tabId: number, operation: PageOperation, signal: AbortSignal,
  parseReply: (message: unknown) => ContentResponse<T> | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('填写已停止')); return; }
    const request = pageOperationSchema.safeParse(operation);
    if (!request.success || JSON.stringify(request.data).length > 300_000) { reject(new Error('填写请求无效或过长')); return; }
    let port: chrome.runtime.Port;
    try { port = chrome.tabs.connect(tabId, { name: PAGE_OPERATION_PORT, frameId: 0 }); }
    catch { reject(new Error('无法连接可取消的填写通道，请刷新网页后重新扫描')); return; }
    let finished = false;
    const finish = (data?: T, error = '填写连接中断，部分内容可能已填入。请检查网页并重新扫描，不要重复填写。') => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect);
      try { port.disconnect(); } catch { /* The document may already have disconnected. */ }
      if (signal.aborted || data === undefined) reject(new Error(signal.aborted ? '填写已停止' : error)); else resolve(data);
    };
    const cancel = () => finish(undefined, '填写已停止');
    const onDisconnect = () => { void chrome.runtime.lastError; finish(); };
    const onMessage = (message: unknown) => {
      let reply: ContentResponse<T> | undefined;
      try { if (JSON.stringify(message).length <= 2_000_000) reply = parseReply(message); } catch { /* Malformed result. */ }
      if (!reply) { finish(undefined, '填写结果未通过核验，请检查网页'); return; }
      if (!reply.ok) { finish(undefined, reply.error); return; }
      finish(reply.data);
    };
    const timer = setTimeout(() => finish(undefined, '填写等待超时，已停止后续字段。请检查网页'), PAGE_OPERATION_DEADLINE_MS + 1000);
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    try { port.postMessage(request.data); } catch { finish(); }
  });
}

export function fillPageCancelable(tabId: number, payload: FillRequest, signal: AbortSignal): Promise<FillOutcome[]> {
  return operate(tabId, { type: 'RA_FILL', payload }, signal, message => {
    const parsed = fillReplySchema.safeParse(message);
    if (!parsed.success) return undefined;
    if (parsed.data.ok && (parsed.data.data.length !== payload.items.length
      || parsed.data.data.some((item, index) => item.fieldId !== payload.items[index]?.fieldId))) return undefined;
    return parsed.data;
  });
}

export function scanPageCancelable(tabId: number, signal: AbortSignal): Promise<ScanResult> {
  return operate(tabId, { type: 'RA_SCAN_SETTLED' }, signal, message => {
    const parsed = scanReplySchema.safeParse(message);
    if (!parsed.success) return undefined;
    if (parsed.data.ok) {
      const { fields, semanticGraph } = parsed.data.data;
      if (new Set(fields.map(field => field.id)).size !== fields.length
        || semanticGraph && !isValidSemanticGraph(semanticGraph, fields.map(field => field.id))) return undefined;
    }
    // Validate without rebuilding the transport observation: semantic sessions
    // compare its original serialization with RA_VERIFY_SCAN before binding.
    return message as ContentResponse<ScanResult>;
  });
}
