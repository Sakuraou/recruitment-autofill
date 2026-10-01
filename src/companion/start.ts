import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createResponsesProvider } from './responsesProvider';
import { createSemanticServer, SEMANTIC_SERVICE_HOST, SEMANTIC_SERVICE_PORT } from './server';

// This entry runs only after the user explicitly starts the companion command.
// API credentials stay in this process and are never written into the connection file.
const token = randomBytes(32).toString('hex');
const provider = createResponsesProvider({ apiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.RA_OPENAI_MODEL ?? '' });
const server = createSemanticServer({ token, provider });
server.once('error', () => { console.error('语义服务启动失败，请检查固定本地端口是否被占用。'); process.exitCode = 1; });
server.listen(SEMANTIC_SERVICE_PORT, SEMANTIC_SERVICE_HOST, () => {
  void (async () => {
    const directory = resolve(process.cwd(), 'artifacts'); await mkdir(directory, { recursive: true });
    const path = resolve(directory, 'semantic-connection.local.json');
    await writeFile(path, JSON.stringify({ protocol: 1, token }, null, 2), { encoding: 'utf8', mode: 0o600 });
    console.info(`语义服务已启动：http://${SEMANTIC_SERVICE_HOST}:${SEMANTIC_SERVICE_PORT}`);
    console.info(`本地配对文件：${path}`);
    console.info(provider ? '模型提供方已配置；只有认证扩展请求才会调用。' : '未配置 OPENAI_API_KEY / RA_OPENAI_MODEL，当前只提供连接检查，不调用模型。');
  })().catch(() => { console.error('无法写入本地配对文件，语义服务已停止。'); server.close(); process.exitCode = 1; });
});
const stop = () => { server.close(); server.closeAllConnections(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
