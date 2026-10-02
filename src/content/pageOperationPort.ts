import { PAGE_OPERATION_DEADLINE_MS, PAGE_OPERATION_PORT, pageOperationSchema, type PageOperation } from '../shared/pageOperationProtocol';
import type { ContentResponse } from '../shared/types';

interface Dependencies {
  extensionId: string;
  extensionUrl(path: string): string;
  /** Reserve the shared page lock; release only after execute actually settles. */
  acquire(): () => void;
  invalidate(): void;
  execute(request: PageOperation, signal: AbortSignal): Promise<unknown>;
}

export function createPageOperationPortHandler(deps: Dependencies): (port: chrome.runtime.Port) => void {
  const connected = new Set<chrome.runtime.Port>();
  return port => {
    if (port.name !== PAGE_OPERATION_PORT) return;
    const senderUrl = port.sender?.url?.split(/[?#]/u)[0];
    if (port.sender?.id !== deps.extensionId || !senderUrl || !['popup.html', 'options.html'].some(path => senderUrl === deps.extensionUrl(path))
      || connected.size >= 8) { port.disconnect(); return; }
    connected.add(port);
    const controller = new AbortController(); let closed = false; let used = false;
    const cleanup = () => {
      if (closed) return; closed = true;
      clearTimeout(timer); controller.abort();
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect);
      connected.delete(port);
    };
    const disconnect = () => { try { port.disconnect(); } catch { /* Already disconnected. */ } };
    const reply = (response: ContentResponse<unknown>) => {
      if (closed) return;
      try { port.postMessage(response); } catch { /* Popup is gone. */ }
      cleanup(); disconnect();
    };
    const cancel = () => { if (!closed && used) deps.invalidate(); cleanup(); };
    const onDisconnect = () => { void chrome.runtime.lastError; cancel(); };
    const timer = setTimeout(() => {
      if (used) deps.invalidate(); reply({ ok: false, error: '填写等待超时，已停止后续字段。请检查网页' });
    }, PAGE_OPERATION_DEADLINE_MS);
    const onMessage = (message: unknown) => {
      if (closed) return;
      if (used) { deps.invalidate(); reply({ ok: false, error: '该填写通道已使用，重复请求已停止' }); return; }
      used = true;
      let request: PageOperation;
      try {
        if (JSON.stringify(message).length > 300_000) throw new Error('oversized');
        request = pageOperationSchema.parse(message);
      } catch { reply({ ok: false, error: '无效的可取消填写请求' }); return; }
      let release: () => void;
      try { release = deps.acquire(); }
      catch { reply({ ok: false, error: '另一个填写任务尚未结束，请先停止该任务' }); return; }
      void (async () => {
        try {
          const data = await deps.execute(request, controller.signal);
          if (!closed && !controller.signal.aborted) reply({ ok: true, data });
        } catch { if (!closed) reply({ ok: false, error: '填写未完成或页面已经变化，请检查网页并重新扫描' }); }
        finally { release(); }
      })();
    };
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
  };
}
