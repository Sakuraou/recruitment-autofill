import { VISUAL_LOCATION_DEADLINE_MS, VISUAL_LOCATION_PORT, visualLocationRequestSchema } from '../shared/visualLocationProtocol';
import type { ScanState } from './scanner';
import { verifyScanObservation } from './scanFreshness';
import type { VisualFieldLocator } from './visualFieldLocator';

interface Dependencies {
  extensionId: string; popupUrl: string;
  getScan(): ScanState | undefined;
  available(): boolean;
  install(expected: ScanState, next: ScanState | undefined): boolean;
  create(): Pick<VisualFieldLocator, 'locate'>;
}
/** One trusted popup request per port. Disconnect/Stop cancels before installing
 * a fresh scan; wire messages cannot supply nodes, coordinates or candidates. */
export function createVisualLocationPortHandler(deps: Dependencies): (port: chrome.runtime.Port) => void {
  const connected = new Set<chrome.runtime.Port>();
  return port => {
    if (port.name !== VISUAL_LOCATION_PORT) return;
    if (port.sender?.id !== deps.extensionId || port.sender?.url !== deps.popupUrl || port.sender?.tab || connected.size >= 8) { port.disconnect(); return; }
    connected.add(port);
    const controller = new AbortController(); let closed = false, used = false, original: ScanState | undefined;
    const close = (invalidate: boolean) => {
      if (closed) return; closed = true; clearTimeout(timer); controller.abort();
      if (invalidate && original) deps.install(original, undefined);
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect); connected.delete(port);
      try { port.disconnect(); } catch { /* Document or popup already closed. */ }
    };
    const reply = (response: unknown) => {
      if (closed || controller.signal.aborted) return;
      try { port.postMessage(response); close(false); } catch { close(true); }
    };
    const onDisconnect = () => { void chrome.runtime.lastError; close(true); };
    const timer = setTimeout(() => close(true), VISUAL_LOCATION_DEADLINE_MS);
    const onMessage = (message: unknown) => {
      if (closed) return;
      if (used) { close(true); return; } used = true;
      let parsed;
      try { if (JSON.stringify(message).length > 512) throw Error('size'); parsed = visualLocationRequestSchema.safeParse(message); }
      catch { reply({ ok: false, error: '无效的字段定位请求' }); return; }
      if (!parsed.success) { reply({ ok: false, error: '无效的字段定位请求' }); return; }
      const request = parsed.data;
      original = deps.getScan();
      const respond = (result: unknown) => reply({ ok: true, scanId: request.scanId, originalFieldId: request.fieldId, result });
      if (!original || original.result.scanId !== request.scanId || !deps.available()) { respond({ state: 'manual', reason: 'stale' }); return; }
      const scan = original;
      void (async () => {
        try {
          const result = await deps.create().locate(request.scanId, request.fieldId, controller.signal);
          if (closed || controller.signal.aborted) return;
          if (deps.getScan() !== scan || !deps.available()) { respond({ state: 'manual', reason: 'stale' }); return; }
          if (result.state === 'manual') {
            if (!verifyScanObservation(scan)) deps.install(scan, undefined);
            respond(result); return;
          }
          if (result.scan.document !== scan.document || result.scan.controls.get(result.fieldId)?.node !== scan.controls.get(request.fieldId)?.node
            || (result.moved ? result.scan === scan || result.scan.result.scanId === request.scanId : result.scan !== scan || result.fieldId !== request.fieldId)
            || !verifyScanObservation(result.scan)) { deps.install(scan, undefined); respond({ state: 'manual', reason: 'stale' }); return; }
          if (result.moved && !deps.install(scan, result.scan)) { respond({ state: 'manual', reason: 'stale' }); return; }
          respond({ state: 'located', moved: result.moved, fieldId: result.fieldId, scan: result.scan.result });
        } catch { if (!closed) { deps.install(scan, undefined); respond({ state: 'manual', reason: 'stale' }); } }
      })();
    };
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
  };
}
