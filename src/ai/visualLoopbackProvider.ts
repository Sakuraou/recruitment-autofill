import { connectionFileSchema } from './connection';
import { parseSemanticProposal, semanticRequestSchema, type SemanticProposal, type SemanticRequest } from './semanticProtocol';
import type { LocalRedactedPng } from './visualSemanticPort';

const SERVICE = 'http://127.0.0.1:43127/v1/visual-bindings';
type VisualProviderResult = Readonly<{ state: 'ready'; proposal: SemanticProposal }> | Readonly<{ state: 'unavailable' | 'cancelled'; proposal: null }>;
const toBase64 = (bytes: Uint8Array): string => { let binary = ''; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(binary); };

/** Fixed loopback visual transport. API credentials never enter the extension; only the paired token does. */
export function createVisualLoopbackProvider(connection: unknown, fetcher: typeof fetch = fetch): (request: SemanticRequest, image: LocalRedactedPng, signal: AbortSignal) => Promise<VisualProviderResult> {
  const config = connectionFileSchema.parse(connection);
  return async (request, image, signal) => {
    if (signal.aborted || !semanticRequestSchema.safeParse(request).success || image.redacted !== true || image.mime !== 'image/png') return { state: 'cancelled', proposal: null };
    try {
      const response = await fetcher(SERVICE, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', 'X-Resume-Semantic-Token': config.token },
        body: JSON.stringify({ request, image: { mime: 'image/png', redacted: true, data: `data:image/png;base64,${toBase64(image.bytes)}` } }) });
      if (!response.ok || response.redirected || signal.aborted) return { state: signal.aborted ? 'cancelled' : 'unavailable', proposal: null };
      const envelope = await response.json() as { state?: unknown; proposal?: unknown };
      const proposal = envelope.state === 'ready' ? parseSemanticProposal(envelope.proposal, request) : undefined;
      return proposal ? { state: 'ready', proposal } : { state: 'unavailable', proposal: null };
    } catch { return { state: signal.aborted ? 'cancelled' : 'unavailable', proposal: null }; }
  };
}
