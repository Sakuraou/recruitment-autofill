import { z } from 'zod';
import { isExtensionContext } from '../profile/storage';

export const AI_CONNECTION_KEY = 'recruitment.semantic.connection.v1';
export const connectionFileSchema = z.object({ protocol: z.literal(1), token: z.string().regex(/^[a-f\d]{64}$/u) }).strict();
const settingsSchema = connectionFileSchema.extend({ enabled: z.literal(true) }).strict();
export type AiConnection = z.infer<typeof settingsSchema>;

async function storage() {
  if (!isExtensionContext()) throw new Error('请在已安装扩展的设置中连接 AI 服务。');
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return chrome.storage.local;
}
export async function loadAiConnection(): Promise<AiConnection | undefined> {
  const data = await (await storage()).get(AI_CONNECTION_KEY);
  const parsed = settingsSchema.safeParse(data[AI_CONNECTION_KEY]);
  return parsed.success ? parsed.data : undefined;
}
export async function enableAiConnection(value: unknown): Promise<void> {
  const connection = connectionFileSchema.parse(value);
  await (await storage()).set({ [AI_CONNECTION_KEY]: { ...connection, enabled: true } });
}
export async function disableAiConnection(): Promise<void> {
  await (await storage()).remove(AI_CONNECTION_KEY);
}
