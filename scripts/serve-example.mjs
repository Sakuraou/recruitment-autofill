import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 4173;
const examplesRoot = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../examples'));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function isInsideExamples(path) {
  const within = relative(examplesRoot, path);
  return within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within);
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (request.headers.host !== `${host}:${port}`) {
    response.writeHead(403).end('Forbidden host');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    response.writeHead(405).end('Method not allowed');
    return;
  }
  try {
    const encodedPath = (request.url ?? '/').split('?')[0];
    const decodedPath = decodeURIComponent(encodedPath);
    if (!decodedPath.startsWith('/') || decodedPath.includes('\0') || decodedPath.includes('\\') || decodedPath.includes(':')) {
      response.writeHead(400).end('Invalid path');
      return;
    }
    const requestedPath = decodedPath === '/' ? 'test-form.html' : decodedPath.slice(1);
    const target = resolve(examplesRoot, requestedPath);
    if (!isInsideExamples(target)) {
      response.writeHead(403).end('Forbidden path');
      return;
    }
    const canonicalTarget = await realpath(target);
    if (!isInsideExamples(canonicalTarget)) {
      response.writeHead(403).end('Forbidden path');
      return;
    }
    const info = await stat(canonicalTarget);
    const mimeType = mimeTypes[extname(canonicalTarget)];
    if (!info.isFile() || !mimeType) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.setHeader('Content-Type', mimeType);
    if (request.method === 'HEAD') {
      response.writeHead(200).end();
      return;
    }
    response.writeHead(200).end(await readFile(canonicalTarget));
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const statusCode = error instanceof URIError ? 400 : code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 500;
    response.writeHead(statusCode).end(statusCode === 500 ? 'Server error' : 'Not found or invalid path');
  }
});

server.on('error', (error) => {
  console.error(`本地测试页启动失败：${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.info(`本地测试表单：http://${host}:${port}/test-form.html`);
  console.info('仅提供 examples 目录中的静态文件；按 Ctrl+C 停止。');
});
