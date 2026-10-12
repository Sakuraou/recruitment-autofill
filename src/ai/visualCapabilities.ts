import { z } from 'zod';
import { connectionFileSchema } from './connection';
const capabilitySchema = z.object({ protocol: z.literal(1), visualBindings: z.boolean() }).strict();
export type VisualCapability = 'available' | 'unsupported' | 'unknown';
async function readCapability(response: Response, signal: AbortSignal): Promise<VisualCapability> {
  if (!response.ok || response.redirected || !response.body || signal.aborted) return 'unknown';
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const part = await reader.read();
      if (signal.aborted) return 'unknown';
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) { cancel(); return 'unknown'; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = capabilitySchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    return parsed.success ? parsed.data.visualBindings ? 'available' : 'unsupported' : 'unknown';
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
/** Authenticated local interface discovery only; never calls a model or accepts a remote URL. */
export async function checkVisualCapability(connection: unknown, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<VisualCapability> {
  const config = connectionFileSchema.safeParse(connection);
  if (!config.success || signal.aborted) return 'unknown';
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
  let resolveStopped: (value: VisualCapability) => void = () => {};
  const stopped = new Promise<VisualCapability>(resolve => { resolveStopped = resolve; });
  const finish = () => resolveStopped('unknown');
  controller.signal.addEventListener('abort', finish, { once: true });
  const timer = setTimeout(abort, 5000);
  try {
    const operation = Promise.resolve().then(() => fetcher('http://127.0.0.1:43127/v1/capabilities', {
      method: 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'X-Resume-Semantic-Token': config.data.token },
    })).then(response => readCapability(response, controller.signal)).catch((): VisualCapability => 'unknown');
    const result = await Promise.race([operation, stopped]);
    return controller.signal.aborted ? 'unknown' : result;
  } catch { return 'unknown'; }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', finish); }
}
