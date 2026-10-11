import { parseSemanticProposal, semanticRequestSchema, type SemanticRequest, type SemanticProposal } from '../ai/semanticProtocol';

export const VISUAL_SEMANTIC_PORT = 'recruitment.visual-semantic.v1';
const MAX_IMAGE_BYTES = 8_388_608;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface VisualPort {
  name: string;
  sender?: { id?: string; url?: string; frameId?: number; documentLifecycle?: string; documentId?: string; tab?: { id?: number; url?: string } };
  onMessage: { addListener(listener: (message: unknown) => void): void; removeListener?(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void; removeListener?(listener: () => void): void };
  postMessage(message: unknown): void;
  disconnect(): void;
}

export interface VisualSemanticBackgroundDependencies {
  readonly extensionId: string;
  readonly enabled: () => boolean;
  readonly userConfirmed: () => boolean;
  readonly redactRequest: (request: SemanticRequest) => SemanticRequest;
  readonly provider: (request: SemanticRequest, image: Uint8Array, signal: AbortSignal) => Promise<unknown>;
  readonly deadlineMs?: number;
}

type Message = { readonly type: 'infer'; readonly request: unknown; readonly image: { readonly mime: unknown; readonly redacted: unknown; readonly data: unknown } };
type Result = Readonly<{ state: 'ready'; proposal: SemanticProposal }> | Readonly<{ state: 'rejected' | 'disabled' | 'unavailable' | 'cancelled' | 'timeout' }>;
const result = (state: Exclude<Result['state'], 'ready'>): Result => Object.freeze({ state });

function trusted(port: VisualPort, extensionId: string): boolean {
  const sender = port.sender;
  return sender?.id === extensionId && sender.frameId === 0 && sender.documentLifecycle === 'active'
    && typeof sender.documentId === 'string' && sender.documentId.length > 0 && Number.isSafeInteger(sender.tab?.id)
    && sender.tab!.id! > 0 && typeof sender.url === 'string' && /^https?:\/\//u.test(sender.url)
    && sender.tab?.url === sender.url;
}
function decodeImage(value: Message['image']): Uint8Array | undefined {
  if (value.mime !== 'image/png' || value.redacted !== true || typeof value.data !== 'string') return undefined;
  const match = /^data:image\/png;base64,([A-Za-z\d+/]+={0,2})$/u.exec(value.data);
  if (!match || match[1]!.length > 11_184_812) return undefined;
  try {
    const binary = atob(match[1]!); if (binary.length < 16 || binary.length > MAX_IMAGE_BYTES) return undefined;
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) ? bytes : undefined;
  } catch { return undefined; }
}
function normalize(value: unknown, request: SemanticRequest): Result {
  if (!value || typeof value !== 'object') return result('rejected');
  const response = value as { state?: unknown; proposal?: unknown };
  if (response.state !== 'ready') return result(response.state === 'cancelled' ? 'cancelled' : 'unavailable');
  const proposal = parseSemanticProposal(response.proposal, request);
  return proposal ? Object.freeze({ state: 'ready' as const, proposal }) : result('rejected');
}

/** Background boundary for the owner-bound visual request. It accepts no selectors, values, or page HTML. */
export function createVisualSemanticPortHandler(deps: VisualSemanticBackgroundDependencies): (port: VisualPort) => void {
  const active = new Map<number, VisualPort>();
  return port => {
    if (port.name !== VISUAL_SEMANTIC_PORT) return;
    const tabId = port.sender?.tab?.id;
    if (!trusted(port, deps.extensionId) || tabId === undefined || active.has(tabId) || active.size >= 8) { try { port.disconnect(); } catch { /* disconnected */ } return; }
    active.set(tabId, port); let closed = false; let used = false; const controller = new AbortController();
    const cleanup = () => { if (closed) return; closed = true; clearTimeout(timer); controller.abort(); active.delete(tabId); port.onMessage.removeListener?.(onMessage); port.onDisconnect.removeListener?.(onDisconnect); try { port.disconnect(); } catch { /* already closed */ } };
    const reply = (value: Result) => { if (closed) return; try { port.postMessage(value); } catch { cleanup(); } };
    const timer = setTimeout(() => { reply(result('timeout')); cleanup(); }, deps.deadlineMs ?? 15_000);
    const onDisconnect = () => cleanup();
    const onMessage = (value: unknown) => {
      if (closed) return;
      if (used) { reply(result('rejected')); cleanup(); return; }
      used = true;
      const message = value as Partial<Message>;
      if (message.type !== 'infer' || !message.request || !message.image || !deps.enabled() || !deps.userConfirmed()) { reply(result('disabled')); cleanup(); return; }
      const parsed = semanticRequestSchema.safeParse(message.request); const image = decodeImage(message.image);
      if (!parsed.success || !image) { reply(result('rejected')); cleanup(); return; }
      void (async () => {
        try {
          const request = deps.redactRequest(parsed.data);
          if (!semanticRequestSchema.safeParse(request).success) { reply(result('rejected')); return; }
          const response = await deps.provider(request, image, controller.signal);
          if (!closed && !controller.signal.aborted) reply(deps.enabled() && deps.userConfirmed() ? normalize(response, request) : result('disabled'));
        } catch { if (!closed) reply(result(controller.signal.aborted ? 'cancelled' : 'unavailable')); }
        finally { clearTimeout(timer); cleanup(); }
      })();
    };
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
  };
}
