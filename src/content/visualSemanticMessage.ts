import { z } from 'zod';
import type { ContentResponse } from '../shared/types';
import { AgentPageLease } from '../agent/pageLease';
import { semanticRequestSchema } from '../ai/semanticProtocol';
import { requestVisualSemanticFromContent, type LocalRedactedPngData, type VisualContentPort } from './visualSemanticClient';

export const VISUAL_SEMANTIC_MESSAGE = 'RA_VISUAL_SEMANTIC_INFER';
const requestSchema = z.object({
  type: z.literal(VISUAL_SEMANTIC_MESSAGE),
  token: z.uuid(), userConfirmed: z.literal(true), request: semanticRequestSchema,
  image: z.object({ mime: z.literal('image/png'), redacted: z.literal(true), data: z.string().max(11_184_812) }).strict(),
}).strict();

interface Dependencies {
  readonly extensionId: string;
  readonly popupUrl: string;
  readonly lease: AgentPageLease;
  readonly connect?: (name: string) => VisualContentPort;
}

/** Popup-to-content adapter. It performs no DOM write and accepts only the owner token plus a local redacted PNG. */
export function createVisualSemanticMessageHandler(deps: Dependencies): (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: ContentResponse<unknown>) => void) => boolean {
  return (message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== VISUAL_SEMANTIC_MESSAGE) return false;
    const senderUrl = sender.url?.split(/[?#]/u)[0];
    if (sender.id !== deps.extensionId || senderUrl !== deps.popupUrl || sender.frameId !== 0) return false;
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success || !deps.lease.mayWrite(parsed.data.token)) { sendResponse({ ok: false, error: 'Agent 所有权已结束或请求无效' }); return false; }
    void requestVisualSemanticFromContent({ lease: deps.lease, token: parsed.data.token, request: parsed.data.request, image: parsed.data.image as LocalRedactedPngData, userConfirmed: true, connect: deps.connect })
      .then(data => sendResponse({ ok: true, data }))
      .catch(() => sendResponse({ ok: false, error: '视觉语义请求未完成，请重新扫描页面' }));
    return true;
  };
}
