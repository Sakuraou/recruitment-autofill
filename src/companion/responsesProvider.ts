import { SEMANTIC_BINDING_FORMAT, EDUCATION_SEMANTIC_BINDING_FORMAT, INTERNSHIP_SEMANTIC_BINDING_FORMAT, AWARD_SEMANTIC_BINDING_FORMAT, AWARD_SEMANTIC_BINDING_INSTRUCTIONS, INTERNSHIP_SEMANTIC_BINDING_INSTRUCTIONS, SEMANTIC_BINDING_INSTRUCTIONS, parseSemanticProposal,
  semanticRequestSchema, type SemanticProposal, type SemanticRequest } from '../ai/semanticProtocol';

export type CompanionResult = { state: 'ready'; proposal: SemanticProposal }
  | { state: 'disabled' | 'refused' | 'invalid-output' | 'unavailable' | 'cancelled' | 'timeout' | 'busy'; proposal: null };
export type CompanionProvider = (request: SemanticRequest, signal: AbortSignal) => Promise<CompanionResult>;
interface ProviderConfig { apiKey: string; model: string; fetcher?: typeof fetch }

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 256_000) { await reader.cancel(); return undefined; }
      chunks.push(next.value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
    catch { return undefined; }
  } finally { reader.releaseLock(); }
}
function extractProposal(value: unknown, request: SemanticRequest): CompanionResult {
  const failed = (): CompanionResult => ({ state: 'invalid-output', proposal: null });
  if (typeof value !== 'object' || value === null) return failed();
  const response = value as Record<string, unknown>;
  if (response.status !== 'completed' || !Array.isArray(response.output)) return failed();
  const messages = response.output.filter(item => typeof item === 'object' && item !== null && item.type === 'message');
  if (messages.length !== 1) return failed();
  const message = messages[0] as Record<string, unknown>;
  if (message.status !== 'completed' || message.role !== 'assistant' || !Array.isArray(message.content)) return failed();
  if (message.content.some(item => typeof item === 'object' && item !== null && item.type === 'refusal')) return { state: 'refused', proposal: null };
  if (message.content.length !== 1) return failed();
  const content = message.content[0] as Record<string, unknown> | undefined;
  if (!content || content.type !== 'output_text' || typeof content.text !== 'string' || content.text.length > 64_000) return failed();
  try {
    const proposal = parseSemanticProposal(JSON.parse(content.text), request);
    return proposal ? { state: 'ready', proposal } : failed();
  } catch { return failed(); }
}

/** Credentials are injected only by the local server process. No environment, logs or dynamic URLs here. */
export function createResponsesProvider(config: ProviderConfig): CompanionProvider | undefined {
  if (!config.apiKey.trim() || !config.model.trim() || config.model.length > 100 || !/^[a-z\d_.:-]+$/iu.test(config.model)) return undefined;
  const fetcher = config.fetcher ?? fetch;
  return async (request, signal) => {
    if (signal.aborted) return { state: 'cancelled', proposal: null };
    if (!semanticRequestSchema.safeParse(request).success) return { state: 'invalid-output', proposal: null };
    try {
      const response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, store: false, max_output_tokens: 8000,
          instructions: request.protocol === 4 ? AWARD_SEMANTIC_BINDING_INSTRUCTIONS : request.protocol === 3 ? INTERNSHIP_SEMANTIC_BINDING_INSTRUCTIONS : SEMANTIC_BINDING_INSTRUCTIONS, input: [{ role: 'user', content: JSON.stringify(request) }],
          text: { format: request.protocol === 4 ? AWARD_SEMANTIC_BINDING_FORMAT : request.protocol === 3 ? INTERNSHIP_SEMANTIC_BINDING_FORMAT : request.protocol === 2 ? EDUCATION_SEMANTIC_BINDING_FORMAT : SEMANTIC_BINDING_FORMAT } }),
      });
      if (!response.ok || response.redirected) return { state: 'unavailable', proposal: null };
      const output = await readBoundedJson(response);
      if (signal.aborted) return { state: 'cancelled', proposal: null };
      return extractProposal(output, request);
    } catch { return { state: signal.aborted ? 'cancelled' : 'unavailable', proposal: null }; }
  };
}
