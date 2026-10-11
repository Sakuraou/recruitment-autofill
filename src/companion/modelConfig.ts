import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { createAgentProvider, type AgentProvider } from './agentProvider';
import { chatCompletionsEndpoint, createChatCompletionsProvider, createVisualChatCompletionsProvider } from './chatCompletionsProvider';
import type { VisualProvider } from './visualRequest';
import { createResponsesProvider, type CompanionProvider } from './responsesProvider';

const compatibleConfigSchema = z.object({
  provider: z.literal('openai-compatible'),
  baseUrl: z.string().refine(value => !!chatCompletionsEndpoint(value)),
  model: z.string().regex(/^[a-z\d_.:/-]{1,200}$/iu),
  apiKey: z.string().min(1).max(4096).optional(),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z\d_]{0,99}$/u).optional(),
  outputFormat: z.enum(['json_object', 'json_schema']).default('json_object'),
  enableThinking: z.boolean().optional(),
}).strict().refine(value => !!value.apiKey !== !!value.apiKeyEnv);
export type CompatibleModelConfig = z.infer<typeof compatibleConfigSchema>;
type Environment = Readonly<Record<string, string | undefined>>;
export interface CompanionModel { provider?: CompanionProvider; agentProvider?: AgentProvider; visualProvider?: VisualProvider; kind: 'openai-compatible' | 'openai-responses' | 'none' }

/** The file is local configuration, not a profile or extension message. Never include its contents in errors. */
export function resolveCompanionModel(env: Environment, fileConfig?: unknown, fetcher?: typeof fetch): CompanionModel {
  if (fileConfig !== undefined) {
    const parsed = compatibleConfigSchema.safeParse(fileConfig);
    if (!parsed.success) throw new Error('模型配置文件格式不正确，请检查服务地址、模型名和密钥配置。');
    const config = parsed.data;
    const apiKey = config.apiKeyEnv ? env[config.apiKeyEnv] ?? '' : config.apiKey ?? '';
    const provider = createChatCompletionsProvider({ ...config, apiKey, fetcher });
    if (!provider || /^(?:YOUR_|PASTE_|REPLACE_|<)/iu.test(apiKey) || /^(?:YOUR_|REPLACE_|<)/iu.test(config.model))
      throw new Error('模型密钥或模型名尚未正确配置。');
    return { provider, agentProvider: createAgentProvider({ ...config, apiKey, fetcher }),
      visualProvider: createVisualChatCompletionsProvider({ ...config, apiKey, fetcher }), kind: 'openai-compatible' };
  }
  if (env.RA_MODEL_PROVIDER === 'openai-compatible' || env.RA_MODEL_BASE_URL !== undefined) {
    const thinking = env.RA_MODEL_ENABLE_THINKING;
    if (thinking !== undefined && !['true', 'false'].includes(thinking)) throw new Error('模型思考开关必须为 true 或 false。');
    return resolveCompanionModel(env, {
      provider: 'openai-compatible', baseUrl: env.RA_MODEL_BASE_URL ?? '', model: env.RA_MODEL_NAME ?? '',
      apiKeyEnv: 'RA_MODEL_API_KEY', outputFormat: env.RA_MODEL_OUTPUT_FORMAT ?? 'json_object',
      ...(thinking === undefined ? {} : { enableThinking: thinking === 'true' }),
    }, fetcher);
  }
  if (env.RA_MODEL_PROVIDER !== undefined && env.RA_MODEL_PROVIDER !== 'openai-responses')
    throw new Error('未知的模型提供方，请使用 openai-compatible 或 openai-responses。');
  const provider = createResponsesProvider({ apiKey: env.OPENAI_API_KEY ?? '', model: env.RA_OPENAI_MODEL ?? '', fetcher });
  return { provider, kind: provider ? 'openai-responses' : 'none' };
}

export async function loadCompanionModel(env: Environment, path: string, explicitlySelected = false): Promise<CompanionModel> {
  let config: unknown;
  try {
    if ((await stat(path)).size > 16_384) throw new Error('size');
    const data = await readFile(path);
    if (data.byteLength > 16_384) throw new Error('size');
    config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/u, ''));
  } catch (error) {
    if (!explicitlySelected && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return resolveCompanionModel(env);
    throw new Error('无法读取模型配置，请检查文件路径、JSON格式和文件大小。');
  }
  return resolveCompanionModel(env, config);
}
