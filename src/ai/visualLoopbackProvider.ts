import { connectionFileSchema } from './connection';
import { parseSemanticProposal, semanticRequestSchema, type SemanticProposal, type SemanticRequest } from './semanticProtocol';
import type { LocalRedactedPng } from './visualSemanticPort';

const SERVICE = 'http://127.0.0.1:43127/v1/visual-bindings';
type VisualProviderResult = Readonly<{ state: 'ready'; proposal: SemanticProposal }> | Readonly<{ state: 'unavailable' | 'cancelled' | 'invalid-output'; proposal: null }>;
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
      // The compatible local service uses 503 for fixed non-ready states too.
      // Such an envelope can explain a failure, but can never grant a binding.
      if (response.redirected || signal.aborted || (!response.ok && response.status!==503)) return { state: signal.aborted ? 'cancelled' : 'unavailable', proposal: null };
      const envelope = await response.json() as { state?: unknown; proposal?: unknown };
      if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).length!==2||!Object.hasOwn(envelope,'state')||!Object.hasOwn(envelope,'proposal'))return {state:response.ok?'invalid-output':'unavailable',proposal:null};
      if(envelope.state==='cancelled'&&envelope.proposal===null)return {state:'cancelled',proposal:null};
      // Here "disabled" is the service's image provider, not local user consent.
      if(envelope.state==='disabled'&&envelope.proposal===null)return {state:'unavailable',proposal:null};
      if(['unavailable','timeout','busy'].includes(String(envelope.state))&&envelope.proposal===null)return {state:'unavailable',proposal:null};
      if(!response.ok)return {state:['invalid-output','refused'].includes(String(envelope.state))&&envelope.proposal===null?'invalid-output':'unavailable',proposal:null};
      const proposal = envelope.state === 'ready' ? parseSemanticProposal(envelope.proposal, request) : undefined;
      return proposal ? { state: 'ready', proposal } : { state: 'invalid-output', proposal: null };
    } catch { return { state: signal.aborted ? 'cancelled' : 'unavailable', proposal: null }; }
  };
}
