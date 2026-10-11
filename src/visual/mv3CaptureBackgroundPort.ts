import { z } from 'zod';

export const MV3_CAPTURE_PORT = 'recruitment.capture.v1';
const requestIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/u);
const targetSchema = z.object({ tabId: z.number().int().nonnegative().safe(), windowId: z.number().int().nonnegative().safe(), url: z.string().max(4096).regex(/^https?:\/\//u) }).strict();
const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('capture'), requestId: requestIdSchema, target: targetSchema }).strict(),
  z.object({ type: z.literal('stop'), requestId: requestIdSchema }).strict(),
]);
export interface CapturePort {
  name: string;
  sender?: { id?: string; url?: string; frameId?: number; documentLifecycle?: string; tab?: { id?: number; windowId?: number; url?: string } };
  onMessage: { addListener(listener: (message: unknown) => void): void; removeListener?(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void; removeListener?(listener: () => void): void };
  postMessage(message: unknown): void; disconnect(): void;
}
export interface ActiveCaptureTab { tabId: number; windowId: number; url: string; revision: number }
export interface CaptureBackgroundDependencies {
  extensionId: string; popupUrl: string;
  captureVisibleTab(windowId: number, options: { format: 'png' }, callback: (dataUrl: string) => void): void;
  getActiveTabContext(): Promise<ActiveCaptureTab | undefined>;
  deadlineMs?: number;
}
export interface CaptureBackgroundHandler { (port: CapturePort): void; dispose(): void }
function trusted(port: CapturePort, deps: CaptureBackgroundDependencies): boolean {
  const sender = port.sender;
  return sender?.id === deps.extensionId && sender.url?.split(/[?#]/u)[0] === deps.popupUrl
    && (sender.frameId === undefined || sender.frameId === 0)
    && (sender.documentLifecycle === undefined || sender.documentLifecycle === 'active') && sender.tab === undefined;
}
function sameTab(actual: ActiveCaptureTab | undefined, target: z.infer<typeof targetSchema>): actual is ActiveCaptureTab {
  return !!actual && actual.tabId === target.tabId && actual.windowId === target.windowId && actual.url === target.url && Number.isSafeInteger(actual.revision);
}
/** Popup senders have no tab. Resolve the requested target against the actual active tab before and after capture. */
export function createMv3CaptureBackgroundPortHandler(deps: CaptureBackgroundDependencies): CaptureBackgroundHandler {
  const connected = new Map<CapturePort, () => void>(); let disposed = false;
  const handler = (port: CapturePort) => {
    // This listener shares runtime.onConnect with record semantics; unrelated names belong to other handlers.
    if (port.name !== MV3_CAPTURE_PORT) return;
    if (disposed || !trusted(port, deps) || connected.size >= 2) { try { port.disconnect(); } catch { /* disconnected */ } return; }
    let closed = false; let active: { requestId: string; cancelled: boolean; timer: ReturnType<typeof setTimeout> } | undefined;
    const used = new Set<string>();
    const cleanup = () => {
      if (closed) return; closed = true;
      if (active) { active.cancelled = true; clearTimeout(active.timer); } active = undefined;
      connected.delete(port); port.onMessage.removeListener?.(onMessage); port.onDisconnect.removeListener?.(cleanup);
    };
    const close = () => { cleanup(); try { port.disconnect(); } catch { /* disconnected */ } };
    const reply = (message: unknown) => { if (!closed) try { port.postMessage(message); } catch { close(); } };
    const onMessage = (message: unknown) => {
      if (closed) return;
      const parsed = requestSchema.safeParse(message);
      if (!parsed.success) { reply({ ok: false, error: 'capture-request-invalid' }); close(); return; }
      const request = parsed.data;
      if (request.type === 'stop') {
        if (active?.requestId === request.requestId) { active.cancelled = true; clearTimeout(active.timer); active = undefined; }
        reply({ ok: true, data: { state: 'stopped', requestId: request.requestId } }); return;
      }
      if (active) { reply({ ok: false, requestId: request.requestId, error: 'capture-request-busy' }); return; }
      if (used.has(request.requestId) || used.size >= 4) { reply({ ok: false, requestId: request.requestId, error: 'capture-request-invalid' }); return; }
      used.add(request.requestId);
      const pending = { requestId: request.requestId, cancelled: false, timer: setTimeout(() => {
        if (active !== pending || closed) return; pending.cancelled = true; active = undefined;
        reply({ ok: false, requestId: request.requestId, error: 'capture-request-timeout' });
      }, deps.deadlineMs ?? 10_000) };
      active = pending;
      const live = () => !closed && !pending.cancelled && active === pending;
      const finish = (data: unknown) => { if (!live()) return; clearTimeout(pending.timer); active = undefined; reply(data); };
      void (async () => {
        try {
          const before = await deps.getActiveTabContext(); if (!live()) return;
          if (!sameTab(before, request.target)) { finish({ ok: false, requestId: request.requestId, error: 'capture-context-invalid' }); return; }
          const revision = before.revision;
          deps.captureVisibleTab(before.windowId, { format: 'png' }, dataUrl => {
            if (!live()) return;
            void (async () => {
              const after = await deps.getActiveTabContext(); if (!live()) return;
              if (!sameTab(after, request.target) || after.revision !== revision || typeof dataUrl !== 'string'
                || dataUrl.length > 24_000_000 || !/^data:image\/png;base64,[A-Za-z\d+/]+={0,2}$/u.test(dataUrl)) {
                finish({ ok: false, requestId: request.requestId, error: 'capture-context-invalid' }); return;
              }
              finish({ ok: true, data: { requestId: request.requestId, dataUrl } });
            })().catch(() => finish({ ok: false, requestId: request.requestId, error: 'capture-context-invalid' }));
          });
        } catch { finish({ ok: false, requestId: request.requestId, error: 'capture-context-invalid' }); }
      })();
    };
    connected.set(port, close); port.onMessage.addListener(onMessage); port.onDisconnect.addListener(cleanup);
  };
  return Object.assign(handler, { dispose: () => { disposed = true; for (const close of [...connected.values()]) close(); } });
}
