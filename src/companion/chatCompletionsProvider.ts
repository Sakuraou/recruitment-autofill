import {
  SEMANTIC_BINDING_FORMAT, EDUCATION_SEMANTIC_BINDING_FORMAT, INTERNSHIP_SEMANTIC_BINDING_FORMAT,
  SEMANTIC_BINDING_INSTRUCTIONS, INTERNSHIP_SEMANTIC_BINDING_INSTRUCTIONS,
  parseSemanticProposal, semanticRequestSchema, type SemanticRequest,
} from '../ai/semanticProtocol';
import type { CompanionProvider, CompanionResult } from './responsesProvider';

export interface ChatCompletionsConfig {
  apiKey: string; model: string; baseUrl: string;
  outputFormat?: 'json_object' | 'json_schema';
  enableThinking?: boolean;
  fetcher?: typeof fetch;
}

/** Endpoint comes only from the local operator, never from a page or a model. */
export function chatCompletionsEndpoint(baseUrl: string): string | undefined {
  try {
    if (!baseUrl.trim() || baseUrl.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(baseUrl)) return undefined;
    const url = new URL(baseUrl.trim());
    if (url.username || url.password || url.search || url.hash) return undefined;
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined;
    const path = url.pathname.replace(/\/+$/u, '');
    url.pathname = path.endsWith('/chat/completions') ? path : path + '/chat/completions';
    return url.href;
  } catch { return undefined; }
}

async function readOutput(response: Response): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 256_000) { await reader.cancel(); return undefined; }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return undefined; }
  } finally { reader.releaseLock(); }
}

function parseOutput(value: unknown, request: SemanticRequest): CompanionResult {
  const invalid = (): CompanionResult => ({ state: 'invalid-output', proposal: null });
  if (!value || typeof value !== 'object') return invalid();
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.choices) || body.choices.length !== 1) return invalid();
  const choice = body.choices[0];
  if (!choice || typeof choice !== 'object' || choice.index !== 0) return invalid();
  const message = choice.message;
  if (!message || typeof message !== 'object' || message.role !== 'assistant') return invalid();
  if (message.refusal || choice.finish_reason === 'content_filter') return { state: 'refused', proposal: null };
  if (choice.finish_reason !== 'stop' || message.function_call
    || message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) return invalid();
  if (typeof message.content !== 'string' || !message.content.trim() || message.content.length > 64_000) return invalid();
  try {
    const proposal = parseSemanticProposal(JSON.parse(message.content), request);
    return proposal ? { state: 'ready', proposal } : invalid();
  } catch { return invalid(); }
}

/** Compatible JSON output is revalidated locally; JSON mode alone is not a schema guarantee. */
export function createChatCompletionsProvider(config: ChatCompletionsConfig): CompanionProvider | undefined {
  const endpoint = chatCompletionsEndpoint(config.baseUrl);
  if (!endpoint || !config.apiKey.trim() || config.apiKey.length > 4096 || /[\r\n]/u.test(config.apiKey)
    || !/^[a-z\d_.:/-]{1,200}$/iu.test(config.model)
    || config.outputFormat !== undefined && !['json_object', 'json_schema'].includes(config.outputFormat)
    || config.enableThinking !== undefined && typeof config.enableThinking !== 'boolean') return undefined;
  const fetcher = config.fetcher ?? fetch;
  return async (request, signal) => {
    if (signal.aborted) return { state: 'cancelled', proposal: null };
    if (!semanticRequestSchema.safeParse(request).success) return { state: 'invalid-output', proposal: null };
    const format = request.protocol === 3 ? INTERNSHIP_SEMANTIC_BINDING_FORMAT
      : request.protocol === 2 ? EDUCATION_SEMANTIC_BINDING_FORMAT : SEMANTIC_BINDING_FORMAT;
    const instructions = request.protocol === 3 ? INTERNSHIP_SEMANTIC_BINDING_INSTRUCTIONS : SEMANTIC_BINDING_INSTRUCTIONS;
    try {
      const response = await fetcher(endpoint, {
        method: 'POST', redirect: 'error', credentials: 'omit', signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, stream: false, max_tokens: 8000,
          messages: [{ role: 'system', content: instructions + '\nReturn JSON conforming to this schema: ' + JSON.stringify(format.schema) },
            { role: 'user', content: JSON.stringify(request) }],
          response_format: config.outputFormat === 'json_schema'
            ? { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } }
            : { type: 'json_object' },
          ...(config.enableThinking === undefined ? {} : { enable_thinking: config.enableThinking }),
        }),
      });
      if (!response.ok || response.redirected) return { state: 'unavailable', proposal: null };
      const output = await readOutput(response);
      if (signal.aborted) return { state: 'cancelled', proposal: null };
      return parseOutput(output, request);
    } catch { return { state: signal.aborted ? 'cancelled' : 'unavailable', proposal: null }; }
  };
}
