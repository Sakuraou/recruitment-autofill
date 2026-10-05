import { z } from 'zod';
import { AGENT_OWNER_PORT } from '../content/agentOwnerPort';
import { EXTENSION_VERSION } from '../shared/version';
const replySchema = z.object({ ok: z.literal(true), data: z.object({ token: z.uuid(), version: z.literal(EXTENSION_VERSION) }).strict() }).strict();
export interface AgentPageOwner { readonly token: string; readonly signal: AbortSignal; close(): void }
/** Keep the owner port alive until completion; popup destruction releases page ownership and stops its tasks. */
export function openAgentPageOwner(tabId: number, signal: AbortSignal): Promise<AgentPageOwner> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Agent 已停止')); return; }
    const stopped = new AbortController(); let port: chrome.runtime.Port;
    try { port = chrome.tabs.connect(tabId, { name: AGENT_OWNER_PORT, frameId: 0 }); }
    catch { reject(new Error('无法连接 Agent，请更新扩展后刷新网页')); return; }
    let settled = false; let closed = false;
    const close = () => {
      if (closed) return; closed = true; clearTimeout(timer); stopped.abort();
      signal.removeEventListener('abort', close); port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect);
      try { port.disconnect(); } catch { /* gone */ }
      if (!settled) { settled = true; reject(new Error(signal.aborted ? 'Agent 已停止' : 'Agent 连接中断或旧版网页尚未更新')); }
    };
    const onDisconnect = () => { void chrome.runtime.lastError; close(); };
    const onMessage = (value: unknown) => {
      if (settled) { close(); return; }
      const parsed = replySchema.safeParse(value);
      if (!parsed.success) { close(); return; }
      settled = true; clearTimeout(timer); resolve({ token: parsed.data.data.token, signal: stopped.signal, close });
    };
    const timer = setTimeout(close, 6000);
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
    signal.addEventListener('abort', close, { once: true });
    if (signal.aborted) { close(); return; }
    try { port.postMessage({ type: 'begin' }); } catch { close(); }
  });
}
