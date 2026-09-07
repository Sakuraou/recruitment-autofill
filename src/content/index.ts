import { z } from 'zod';
import type { ContentResponse } from '../shared/types';
import { fillScan } from './autofill';
import { scanDocument, type ScanState } from './scanner';

declare global {
  interface Window { __recruitmentAutofillInstalled?: boolean }
}

const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RA_SCAN') }).strict(),
  z.object({ type: z.literal('RA_SELECTION') }).strict(),
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
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: ContentResponse<unknown>) => void) => {
    const senderUrl = sender.url?.split(/[?#]/u)[0];
    if (sender.id !== chrome.runtime.id || !senderUrl || ![
      chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html'),
    ].includes(senderUrl)) return false;
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) { sendResponse({ ok: false, error: '无效的扩展请求' }); return false; }
    const request = parsed.data;
    if (request.type === 'RA_SELECTION') {
      sendResponse({ ok: true, data: window.getSelection()?.toString().trim().slice(0, 20_000) ?? '' });
      return false;
    }
    if (filling) { sendResponse({ ok: false, error: '正在填写，请等待完成后再操作' }); return false; }
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
