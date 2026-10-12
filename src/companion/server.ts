import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { parseSemanticProposal, semanticRequestSchema, type SemanticRequest } from '../ai/semanticProtocol';
import type { CompanionProvider, CompanionResult } from './responsesProvider';
import { agentStepRequestSchema, parseAgentStepProposal } from '../agent/nextStepProtocol';
import type { AgentProvider, AgentProviderResult } from './agentProvider';
import { MAX_VISUAL_BODY_BYTES, visualRequestSchema, type VisualProvider } from './visualRequest';

export const SEMANTIC_SERVICE_HOST = '127.0.0.1';
export const SEMANTIC_SERVICE_PORT = 43127;
interface ServerConfig { token: string; provider?: CompanionProvider; agentProvider?: AgentProvider; visualProvider?: VisualProvider; deadlineMs?: number }
const MAX_BODY_BYTES = 128_000;
function readBody(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let bytes = 0; let complete = false; const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      if (complete) return;
      bytes += chunk.byteLength;
      if (bytes > limit) { complete = true; chunks.length = 0; reject(new Error('size')); }
      else chunks.push(chunk);
    });
    request.on('end', () => { if (!complete) { complete = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    request.on('error', () => { if (!complete) { complete = true; reject(new Error('read')); } });
    request.on('aborted', () => { if (!complete) { complete = true; reject(new Error('read')); } });
  });
}
function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
const empty = (state: Exclude<CompanionResult['state'], 'ready'>): CompanionResult => ({ state, proposal: null });
function normalizedResult(value: CompanionResult, request: SemanticRequest): CompanionResult {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'state') || !Object.hasOwn(value, 'proposal')) return empty('invalid-output');
  if (value.state === 'ready') {
    const proposal = parseSemanticProposal(value.proposal, request);
    return proposal ? { state: 'ready', proposal } : empty('invalid-output');
  }
  const allowed = ['disabled', 'refused', 'invalid-output', 'unavailable', 'cancelled', 'timeout', 'busy'];
  return allowed.includes(value.state) && value.proposal === null ? { state: value.state, proposal: null } : empty('invalid-output');
}

function normalizedAgentResult(value: AgentProviderResult | CompanionResult, request: ReturnType<typeof agentStepRequestSchema.parse>): AgentProviderResult {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'state') || !Object.hasOwn(value, 'proposal')) return { state: 'invalid-output', proposal: null };
  if (value.state === 'ready') {
    const proposal = parseAgentStepProposal(value.proposal, request);
    return proposal ? { state: 'ready', proposal } : { state: 'invalid-output', proposal: null };
  }
  const allowed = ['disabled', 'refused', 'invalid-output', 'unavailable', 'cancelled', 'timeout', 'busy'];
  return allowed.includes(value.state) && value.proposal === null ? { state: value.state, proposal: null } : { state: 'invalid-output', proposal: null };
}

/** No profile storage or request logging. The startup wrapper always binds the fixed loopback address. */
export function createSemanticServer(config: ServerConfig) {
  if (!/^[a-f\d]{64}$/u.test(config.token)) throw new Error('配对令牌必须为 32 字节随机十六进制值');
  const expectedToken = Buffer.from(config.token, 'hex');
  const deadline = Number.isFinite(config.deadlineMs) ? Math.max(100, Math.min(config.deadlineMs!, 30_000)) : 15_000;
  let busy = false;
  const server = createServer((request, response) => {
    const handle = async () => {
      const origin = request.headers.origin;
      if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(request.socket.remoteAddress ?? '')
        || !/^127\.0\.0\.1(?::\d{1,5})?$/u.test(request.headers.host ?? '')
        || typeof origin !== 'string' || !/^chrome-extension:\/\/[a-p]{32}$/u.test(origin)) {
        reply(response, 403, empty('unavailable')); return;
      }
      const path = request.url;
      if (path !== '/v1/bindings' && path !== '/v1/next-step' && path !== '/v1/health' && path !== '/v1/visual-bindings' && path !== '/v1/capabilities') { reply(response, 404, empty('unavailable')); return; }
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const requestedHeaders = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(header => header.trim()).filter(Boolean);
        if (method !== (path === '/v1/health' || path === '/v1/capabilities' ? 'GET' : 'POST')
          || requestedHeaders.some(header => !['content-type', 'x-resume-semantic-token'].includes(header))) {
          reply(response, 403, empty('unavailable')); return;
        }
        response.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': String(method),
          'Access-Control-Allow-Headers': 'content-type,x-resume-semantic-token', Vary: 'Origin', 'Cache-Control': 'no-store' });
        response.end(); return;
      }
      response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
      const providedToken = request.headers['x-resume-semantic-token'];
      if (typeof providedToken !== 'string' || !/^[a-f\d]{64}$/u.test(providedToken)
        || !timingSafeEqual(expectedToken, Buffer.from(providedToken, 'hex'))) { reply(response, 401, empty('unavailable')); return; }
      if (request.method !== (path === '/v1/health' || path === '/v1/capabilities' ? 'GET' : 'POST')) { reply(response, 405, empty('unavailable')); return; }
      if (path === '/v1/capabilities') { reply(response, 200, { protocol: 1, visualBindings: !!config.visualProvider }); return; }
      if (path === '/v1/health') { reply(response, 200, { protocol: 1, ready: !!config.provider }); return; }
      if (!/^application\/json(?:\s*;.*)?$/iu.test(request.headers['content-type'] ?? '')) { reply(response, 415, empty('unavailable')); return; }
      const isVisual = path === '/v1/visual-bindings';
      const bodyLimit = isVisual ? MAX_VISUAL_BODY_BYTES : MAX_BODY_BYTES;
      const declaredLength = Number(request.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) { request.resume(); reply(response, 413, empty('unavailable')); return; }
      const isAgent = path === '/v1/next-step';
      let input: unknown;
      try { input = JSON.parse(await readBody(request, bodyLimit)); }
      catch (error) { reply(response, error instanceof Error && error.message === 'size' ? 413 : 400, empty('unavailable')); return; }
      const parsed = isVisual ? visualRequestSchema.safeParse(input) : isAgent ? agentStepRequestSchema.safeParse(input) : semanticRequestSchema.safeParse(input);
      if (!parsed.success) { reply(response, 400, empty('unavailable')); return; }
      if (isVisual ? !config.visualProvider : isAgent ? !config.agentProvider : !config.provider) { reply(response, 503, empty('disabled')); return; }
      if (busy) { reply(response, 429, empty('busy')); return; }
      busy = true;
      const controller = new AbortController(); let finish: (result: CompanionResult | AgentProviderResult) => void = () => {};
      const stopped = new Promise<CompanionResult | AgentProviderResult>(resolve => { finish = resolve; });
      const timer = setTimeout(() => { finish(empty('timeout')); controller.abort(); }, deadline);
      const disconnected = () => { if (!response.writableEnded) { finish(empty('cancelled')); controller.abort(); } };
      response.on('close', disconnected);
      const operation = Promise.resolve().then<CompanionResult | AgentProviderResult>(() => isVisual
        ? config.visualProvider!(visualRequestSchema.parse(parsed.data), controller.signal)
        : isAgent
        ? config.agentProvider!(agentStepRequestSchema.parse(parsed.data), controller.signal)
        : config.provider!(semanticRequestSchema.parse(parsed.data), controller.signal)).catch(() => empty('unavailable'));
      try {
        const output = await Promise.race([operation, stopped]);
        const result = isAgent ? normalizedAgentResult(output, agentStepRequestSchema.parse(parsed.data))
          : normalizedResult(output as CompanionResult, semanticRequestSchema.parse(isVisual ? visualRequestSchema.parse(parsed.data).request : parsed.data));
        reply(response, result.state === 'ready' || result.state === 'refused' ? 200 : 503, result);
      } finally { busy = false; clearTimeout(timer); response.removeListener('close', disconnected); }
    };
    void handle().catch(() => reply(response, 500, empty('unavailable')));
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000;
  server.maxConnections = 10;
  return server;
}


