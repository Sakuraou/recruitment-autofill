import { VISUAL_LOCATION_PORT, VISUAL_LOCATION_DEADLINE_MS, visualLocationReplySchema, visualLocationRequestSchema, type VisualLocationResult } from '../shared/visualLocationProtocol';
import { isValidSemanticGraph } from '../shared/semanticGraphValidation';

export function locateVisualField(tabId: number, scanId: string, fieldId: string, signal: AbortSignal): Promise<VisualLocationResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(Error('定位已停止')); return; }
    const request = visualLocationRequestSchema.safeParse({ type: 'locate', scanId, fieldId });
    if (!request.success) { reject(Error('定位引用无效')); return; }
    let port: chrome.runtime.Port;
    try { port = chrome.tabs.connect(tabId, { name: VISUAL_LOCATION_PORT, frameId: 0 }); }
    catch { reject(Error('无法连接字段定位通道，请刷新网页')); return; }
    let done = false;
    const finish = (result?: VisualLocationResult) => {
      if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect);
      try { port.disconnect(); } catch { /* gone */ }
      if (!result || signal.aborted) reject(Error(signal.aborted ? '定位已停止' : '定位连接中断或结果无法核验，请重新扫描')); else resolve(result);
    };
    const cancel = () => finish(), onDisconnect = () => { void chrome.runtime.lastError; finish(); };
    const onMessage = (message: unknown) => {
      try {
        if (JSON.stringify(message).length > 2_000_000) { finish(); return; }
        const parsed = visualLocationReplySchema.safeParse(message);
        if (!parsed.success || !parsed.data.ok || parsed.data.scanId !== scanId || parsed.data.originalFieldId !== fieldId) { finish(); return; }
        const result = parsed.data.result;
        if (result.state === 'located') {
          const { fields, semanticGraph } = result.scan;
          if (!semanticGraph || !isValidSemanticGraph(semanticGraph, fields.map(field => field.id)) || new Set(fields.map(field => field.id)).size !== fields.length
            || !fields.some(field => field.id === result.fieldId) || (result.moved ? result.scan.scanId === scanId : result.scan.scanId !== scanId || result.fieldId !== fieldId)) { finish(); return; }
        }
        // Validate without rebuilding property order of the original scan.
        finish((message as Extract<import('zod').infer<typeof visualLocationReplySchema>, { ok: true }>).result);
      } catch { finish(); }
    };
    const timer = setTimeout(cancel, VISUAL_LOCATION_DEADLINE_MS + 1000);
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect); signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    try { port.postMessage(request.data); } catch { finish(); }
  });
}
