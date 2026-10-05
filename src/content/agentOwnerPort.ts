import { z } from 'zod';
import { AgentPageLease } from '../agent/pageLease';
export const AGENT_OWNER_PORT = 'recruitment.agent-owner.v1';
const beginSchema = z.object({ type: z.literal('begin') }).strict();
interface Dependencies { extensionId: string; extensionUrl(path: string): string; version: string; lease: AgentPageLease; releaseOwnedTasks(): void }
/** The owner connection is the lifetime of this popup Agent intent. It grants no model or DOM tools. */
export function createAgentOwnerPortHandler(deps: Dependencies): (port: chrome.runtime.Port) => void {
  const active = new Set<chrome.runtime.Port>();
  return port => {
    if (port.name !== AGENT_OWNER_PORT) return;
    if (port.sender?.id !== deps.extensionId || port.sender.url?.split(/[?#]/u)[0] !== deps.extensionUrl('popup.html') || active.size >= 8) {
      port.disconnect(); return;
    }
    active.add(port); let token: string | undefined; let closed = false;
    const finish = () => {
      if (closed) return; closed = true; clearTimeout(timer); active.delete(port);
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(finish);
      if (token && deps.lease.end(token)) deps.releaseOwnedTasks();
      try { port.disconnect(); } catch { /* already disconnected */ }
    };
    const onMessage = (message: unknown) => {
      if (closed) return;
      if (token || !beginSchema.safeParse(message).success) { finish(); return; }
      try {
        token = deps.lease.begin(); clearTimeout(timer);
        port.postMessage({ ok: true, data: { token, version: deps.version } });
      } catch {
        try { port.postMessage({ ok: false, error: '另一个填写任务尚未结束，或页面无法启动 Agent' }); } catch { /* lost owner */ }
        finish();
      }
    };
    const timer = setTimeout(finish, 5000);
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(finish);
  };
}
