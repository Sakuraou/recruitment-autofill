import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadCompanionModel } from './modelConfig';
import { createSemanticServer, SEMANTIC_SERVICE_HOST, SEMANTIC_SERVICE_PORT } from './server';

// This entry runs only after the user explicitly starts the companion command.
// API credentials stay in this process and are never written into the connection file.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--config' || !args[1])) {
  console.error('用法：npm run semantic:serve -- --config 本机模型配置.json');
  process.exit(1);
}
const configPath = args[1] ?? process.env.RA_MODEL_CONFIG ?? resolve(process.cwd(), 'artifacts', 'semantic-model.local.json');
const model = await loadCompanionModel(process.env, configPath, !!args[1] || process.env.RA_MODEL_CONFIG !== undefined)
  .catch(error => { console.error(error instanceof Error ? error.message : '模型配置读取失败。'); process.exit(1); });
const token = randomBytes(32).toString('hex');
const provider = model.provider;
const server = createSemanticServer({ token, provider, agentProvider: model.agentProvider });
server.once('error', () => { console.error('语义服务启动失败，请检查固定本地端口是否被占用。'); process.exitCode = 1; });
server.listen(SEMANTIC_SERVICE_PORT, SEMANTIC_SERVICE_HOST, () => {
  void (async () => {
    const directory = resolve(process.cwd(), 'artifacts'); await mkdir(directory, { recursive: true });
    const path = resolve(directory, 'semantic-connection.local.json');
    await writeFile(path, JSON.stringify({ protocol: 1, token }, null, 2), { encoding: 'utf8', mode: 0o600 });
    console.info(`语义服务已启动：http://${SEMANTIC_SERVICE_HOST}:${SEMANTIC_SERVICE_PORT}`);
    console.info(`本地配对文件：${path}`);
    console.info(provider ? `模型提供方已配置（${model.kind}）；只有认证扩展请求才会调用，实际模型可用性需首次填写核验。`
      : '未配置模型。请填写 artifacts/semantic-model.local.json 后重启；当前不调用模型。');
  })().catch(() => { console.error('无法写入本地配对文件，语义服务已停止。'); server.close(); process.exitCode = 1; });
});
const stop = () => { server.close(); server.closeAllConnections(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
