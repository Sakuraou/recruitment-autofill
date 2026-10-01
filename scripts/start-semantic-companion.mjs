import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
const output = resolve(artifacts, 'semantic-companion.mjs');
await build({ entryPoints: [resolve(root, 'src/companion/start.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const child = spawn(process.execPath, [output], { cwd: root, stdio: 'inherit', windowsHide: true });
child.once('error', () => { console.error('无法启动语义服务进程。'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
process.once('SIGINT', () => child.kill('SIGINT')); process.once('SIGTERM', () => child.kill('SIGTERM'));
