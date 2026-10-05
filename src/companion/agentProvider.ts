import { AGENT_STEP_FORMAT, AGENT_STEP_INSTRUCTIONS, agentStepRequestSchema, parseAgentStepProposal, type AgentStepProposal, type AgentStepRequest } from '../agent/nextStepProtocol';
import { chatCompletionsEndpoint, type ChatCompletionsConfig } from './chatCompletionsProvider';

export type AgentProviderResult = { state: 'ready'; proposal: AgentStepProposal }
  | { state: 'disabled' | 'refused' | 'invalid-output' | 'unavailable' | 'cancelled' | 'timeout' | 'busy'; proposal: null };
export type AgentProvider = (request: AgentStepRequest, signal: AbortSignal) => Promise<AgentProviderResult>;
const empty = (state: Exclude<AgentProviderResult['state'], 'ready'>): AgentProviderResult => ({ state, proposal: null });

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 32_000) { await reader.cancel(); return undefined; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return undefined; }
  finally { reader.releaseLock(); }
}

/** Separate action protocol: field-bindings never grant next-step authority. */
export function createAgentProvider(config: ChatCompletionsConfig): AgentProvider | undefined {
  const endpoint = chatCompletionsEndpoint(config.baseUrl);
  if (!endpoint || !config.apiKey.trim() || config.apiKey.length > 4096 || /[\r\n]/u.test(config.apiKey)
    || !/^[a-z\d_.:/-]{1,200}$/iu.test(config.model)
    || config.outputFormat !== undefined && !['json_object', 'json_schema'].includes(config.outputFormat)
    || config.enableThinking !== undefined && typeof config.enableThinking !== 'boolean') return undefined;
  const fetcher = config.fetcher ?? fetch;
  return async (value, signal) => {
    if (signal.aborted) return empty('cancelled');
    const parsed = agentStepRequestSchema.safeParse(value);
    if (!parsed.success) return empty('invalid-output');
    const request = parsed.data;
    try {
      const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, stream: false, max_tokens: 1000,
          messages: [{ role: 'system', content: AGENT_STEP_INSTRUCTIONS + '\nJSON schema: ' + JSON.stringify(AGENT_STEP_FORMAT.schema) },
            { role: 'user', content: JSON.stringify(request) }],
          response_format: config.outputFormat === 'json_schema'
            ? { type: 'json_schema', json_schema: AGENT_STEP_FORMAT } : { type: 'json_object' },
          ...(config.enableThinking === undefined ? {} : { enable_thinking: config.enableThinking }) }),
      });
      if (!response.ok || response.redirected) return empty('unavailable');
      const output = await readJson(response);
      if (signal.aborted) return empty('cancelled');
      if (!output || typeof output !== 'object' || !('choices' in output) || !Array.isArray(output.choices) || output.choices.length !== 1)
        return empty('invalid-output');
      const choice = output.choices[0]; const message = choice?.message;
      if (choice?.index !== 0 || message?.role !== 'assistant') return empty('invalid-output');
      if (message.refusal || choice.finish_reason === 'content_filter') return empty('refused');
      if (choice.finish_reason !== 'stop' || message.function_call
        || message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)
        || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 4000) return empty('invalid-output');
      let candidate: unknown;
      try { candidate = JSON.parse(message.content); } catch { return empty('invalid-output'); }
      const proposal = parseAgentStepProposal(candidate, request);
      return proposal ? { state: 'ready', proposal } : empty('invalid-output');
    } catch { return empty(signal.aborted ? 'cancelled' : 'unavailable'); }
  };
}
