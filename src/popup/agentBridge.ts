import { z } from 'zod';
import { loadProfile } from '../profile/storage';
import { loadAiConnection } from '../ai/connection';
import { createLoopbackProvider } from '../ai/loopbackProvider';
import { createAgentLoopbackProvider } from '../ai/agentLoopbackProvider';
import { inferSemanticCandidates } from '../ai/semanticCandidates';
import { SessionSemanticRecipes } from '../ai/sessionRecipes';
import { agentFieldFingerprint, agentOrdinaryFieldIds, buildAgentPageTasks, type AgentRecordCheck, type AgentRecordKind } from '../agent/pageTasks';
import { runAgentSteps, type AgentObservation, type AgentRunResult, type AgentStepPorts } from '../agent/nextStepWorkflow';
import type { AgentRunStatus } from '../agent/runController';
import { EXTENSION_VERSION } from '../shared/version';
import type { ContentRequest, FillOutcome, ScanResult } from '../shared/types';
import { currentTab, send, scanPage, fillPlan, type PagePlan } from './bridge';
import { openAgentPageOwner, type AgentPageOwner } from './agentOwnerClient';
import { runAiFillWorkflow } from './aiWorkflow';

const stateSchema = z.object({ phase: z.enum(['idle','preparing','running','pausing','paused','review','complete','stopped']),
  total: z.number().int().min(0).max(10_000), canStart: z.boolean(), reason: z.string().max(200).optional() }).strict();
const checkSchema = z.object({ version: z.literal(EXTENSION_VERSION), state: stateSchema,
  presence: z.object({ state: z.enum(['all-present','pending','unverified']), total: z.number().int().min(0).max(10_000),
    matched: z.number().int().min(0).max(10_000) }).strict().refine(value => value.matched <= value.total) }).strict();
const statusSchema = z.object({ version: z.literal(EXTENSION_VERSION), state: stateSchema }).strict();
const kinds = ['education','project','internship','award','publication','student-work'] as const;
const recordKinds = {'education-records':'education','project-records':'project','internship-records':'internship','award-records':'award','publication-records':'publication','student-work-records':'student-work'} as const;
const commands = {
  education: { start: 'RA_EDUCATION_RECORD_START', status: 'RA_EDUCATION_RECORD_STATUS' },
  project: { start: 'RA_PROJECT_RECORD_START', status: 'RA_PROJECT_RECORD_STATUS' },
  internship: { start: 'RA_INTERNSHIP_RECORD_START', status: 'RA_INTERNSHIP_RECORD_STATUS' },
  award: { start: 'RA_AWARD_RECORD_START', status: 'RA_AWARD_RECORD_STATUS' },
  'student-work': { start: 'RA_STUDENT_WORK_RECORD_START', status: 'RA_STUDENT_WORK_RECORD_STATUS' },
  publication: { start: 'RA_PUBLICATION_RECORD_START', status: 'RA_PUBLICATION_RECORD_STATUS' },
} as const;
export interface AgentPageResult { readonly result: AgentRunResult; readonly plan?: PagePlan; readonly outcomes: readonly FillOutcome[] }
export interface AgentBridgePorts {
  scan(signal: AbortSignal, token?: string): Promise<PagePlan>;
  context(): Promise<string>;
  owner(tabId: number, signal: AbortSignal): Promise<AgentPageOwner>;
  check(tabId: number, kind: AgentRecordKind, token: string): Promise<unknown>;
  verify(plan: PagePlan): Promise<boolean>;
  decide: AgentStepPorts['decide'];
  fields(plan: PagePlan, signal: AbortSignal, token: string): Promise<FillOutcome[]>;
  command(tabId: number, request: ContentRequest): Promise<unknown>;
  wait(signal: AbortSignal): Promise<void>;
}
export function agentPollDelay(signal: AbortSignal, ms = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Agent stopped')); return; }
    const abort = () => { clearTimeout(timer); reject(new Error('Agent stopped')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Explicit popup intent. Only the offered guarded executors may write; no arbitrary model clicks. */
export async function runAgentPage(ports: AgentBridgePorts, external: AbortSignal,
  progress?: (value: AgentRunStatus) => void): Promise<AgentPageResult> {
  let owner: AgentPageOwner | undefined; let plan: PagePlan | undefined; const outcomes: FillOutcome[] = [];
  const combined = new AbortController(); const abort = () => combined.abort();
  const observed = new WeakMap<AgentObservation, PagePlan>(); const attempted = new Set<string>(); let steps = 0;
  try {
    external.throwIfAborted(); const originalContext = await ports.context(); external.throwIfAborted();
    plan = await ports.scan(external); external.throwIfAborted();
    const originalTab = plan.tabId; const originalUrl = plan.scan.url; const originalProfile = JSON.stringify(plan.profile);
    owner = await ports.owner(originalTab, external);
    const token = owner.token; const signal = combined.signal;
    external.addEventListener('abort', abort, { once: true }); owner.signal.addEventListener('abort', abort, { once: true });
    if (external.aborted || owner.signal.aborted) combined.abort();
    const current = async () => { signal.throwIfAborted(); const context = await ports.context(); signal.throwIfAborted(); return context === originalContext; };
    const observe = async (): Promise<AgentObservation> => {
      progress?.({ phase: 'observing', steps });
      if (!await current()) throw new Error('Agent context changed');
      const latest = await ports.scan(signal, token); signal.throwIfAborted();
      if (latest.tabId !== originalTab || latest.scan.url !== originalUrl || JSON.stringify(latest.profile) !== originalProfile)
        throw new Error('Agent context changed');
      const results = await Promise.all(kinds.map(async kind => checkSchema.parse(await ports.check(originalTab, kind, token))));
      if (!await current()) throw new Error('Agent context changed');
      const checks: Record<AgentRecordKind, AgentRecordCheck> = { education: results[0]!, project: results[1]!, internship: results[2]!, award:results[3]!, publication:results[4]!, 'student-work':results[5]! };
      const tasks = buildAgentPageTasks(latest.scan, latest.matches, latest.profile, checks, attempted);
      if (!tasks) throw new Error('Agent page observation invalid');
      plan = latest;
      const observation: AgentObservation = { ...tasks, context: originalContext,
        fingerprint: JSON.stringify([agentFieldFingerprint(latest.scan), tasks, results.map(result => ({ state: result.state, presence: result.presence }))]) };
      observed.set(observation, latest); progress?.({ phase: 'observing', steps, pending: { ...observation.pending } }); return observation;
    };
    const result = await runAgentSteps({ observe,
      decide: async (request, active) => { progress?.({ phase: 'thinking', steps, pending: { ...request.pending } }); return ports.decide(request, active); },
      verify: async observation => { const value = observed.get(observation); return !!value && await current() && await ports.verify(value); },
      execute: async (kind, observation) => {
        progress?.({ phase: 'acting', steps: ++steps, pending: { ...observation.pending } });
        const value = observed.get(observation); if (!value || !await current()) return { state: 'failed' };
        if (kind === 'fill-visible') {
          const filled = await ports.fields(value, signal, token); signal.throwIfAborted(); outcomes.push(...filled);
          // Defer an unchanged unknown form and keep processing other offered record collections.
          attempted.add(agentFieldFingerprint(value.scan));
          return { state: filled.some(item => item.status === 'filled') ? 'progress' : 'deferred' };
        }
        const recordKind: AgentRecordKind = recordKinds[kind];
        const started = stateSchema.parse(await ports.command(originalTab, { type: commands[recordKind].start, agentRunToken: token }));
        signal.throwIfAborted(); if (started.phase === 'review' || started.phase === 'paused') return { state: 'needs-user' };
        for (let poll = 0; poll < 1200; poll++) {
          if (!await current()) return { state: 'failed' };
          const status = statusSchema.parse(await ports.command(originalTab, { type: commands[recordKind].status })).state;
          signal.throwIfAborted();
          if (status.phase === 'complete') {
            const checked = checkSchema.parse(await ports.check(originalTab, recordKind, token));
            if (!await current()) return { state: 'failed' };
            const expected = {education:value.profile.education.length,project:value.profile.projects.length,internship:value.profile.internships.length,award:value.profile.awards.length,publication:value.profile.research.papers.length,'student-work':value.profile.studentWork.length}[recordKind];
            return { state: checked.presence.state === 'all-present' && checked.presence.total === expected && checked.presence.matched === expected ? 'progress' : 'needs-user' };
          }
          if (status.phase === 'review' || status.phase === 'paused' || status.phase === 'pausing') return { state: 'needs-user' };
          if (status.phase === 'stopped' || status.phase === 'idle') return { state: 'stopped' };
          await ports.wait(signal);
        }
        return { state: 'needs-user' };
      },
    }, signal);
    progress?.({ phase: result.state, steps: result.steps, ...(result.pending ? { pending: { ...result.pending } } : {}) });
    return { result, plan, outcomes };
  } catch {
    const result: AgentRunResult = { state: external.aborted || owner?.signal.aborted ? 'stopped' : 'unavailable', steps };
    progress?.({ phase: result.state, steps }); return { result, plan, outcomes };
  } finally { external.removeEventListener('abort', abort); owner?.signal.removeEventListener('abort', abort); owner?.close(); }
}

/** Original field inference and value validation, restricted to fields outside repeatable record editors. */
async function fillAgentFields(initial: PagePlan, signal: AbortSignal, token: string,
  connection: NonNullable<Awaited<ReturnType<typeof loadAiConnection>>>): Promise<FillOutcome[]> {
  const provider = createLoopbackProvider({ protocol: 1, token: connection.token });
  const recipes = connection.cacheRevision ? new SessionSemanticRecipes(connection.cacheRevision) : undefined;
  const scope = (value: PagePlan): PagePlan => { const allowed = agentOrdinaryFieldIds(value.scan); return { ...value, matches: value.matches.filter(match => allowed.has(match.fieldId)) }; };
  const result = await runAiFillWorkflow({ scan: async () => initial, scanAfterFill: active => scanPage(true, active, token),
    fillRules: async (value, active) => {
      let next = value; const written: FillOutcome[] = []; let rounds = 0;
      for (; rounds < 4; rounds++) {
        const scoped = scope(next);
        if (!scoped.matches.some(match => match.status === 'auto' && match.value !== undefined && match.confidence >= 0.9 && match.source !== 'llm')) break;
        const filled = await fillPlan(scoped, new Set(), 'auto', active, token); written.push(...filled);
        if (!filled.some(item => item.status === 'filled')) break;
        next = await scanPage(true, active, token);
      }
      return { plan: next, outcomes: written, rounds };
    },
    fillModel: (value, ids, active) => fillPlan(scope(value), ids, 'review', active, token),
    infer: (value, active, excluded) => {
      const allowed = agentOrdinaryFieldIds(value.scan);
      const excludedFieldIds = new Set([...excluded, ...value.scan.fields.filter(field => !allowed.has(field.id)).map(field => field.id)]);
      return inferSemanticCandidates(value.scan, value.profile, provider, { recipes, signal: active, excludedFieldIds,
        currentContext: async () => {
          const [tab, profile, latestConnection] = await Promise.all([currentTab(), loadProfile(), loadAiConnection()]);
          active.throwIfAborted();
          if (tab.id !== value.tabId || tab.url !== value.scan.url || JSON.stringify(latestConnection) !== JSON.stringify(connection)) throw new Error('Agent context changed');
          const scan = await send<ScanResult>(value.tabId, { type: 'RA_VERIFY_SCAN', payload: { scanId: value.scan.scanId } });
          return { scan, profile };
        },
      });
    },
  }, signal);
  return result.outcomes;
}

export async function fillWithAgent(signal: AbortSignal, progress?: (value: AgentRunStatus) => void): Promise<AgentPageResult> {
  signal.throwIfAborted(); const connection = await loadAiConnection();
  if (!connection) throw new Error('请先在“我的档案 → AI 识别连接”配置本地服务，并使用 OpenAI 兼容接口启动。');
  const provider = createAgentLoopbackProvider({ protocol: 1, token: connection.token });
  return runAgentPage({ scan: (active, token) => scanPage(true, active, token), owner: openAgentPageOwner,
    context: async () => { const [tab, profile, currentConnection] = await Promise.all([currentTab(), loadProfile(), loadAiConnection()]);
      return JSON.stringify({ tabId: tab.id, url: tab.url, profile, connection: currentConnection }); },
    check: (tabId, kind, token) => send(tabId, { type: 'RA_AGENT_RECORD_CHECK', payload: { kind, token } }),
    verify: async value => { await send(value.tabId, { type: 'RA_VERIFY_SCAN', payload: { scanId: value.scan.scanId } }); return true; },
    decide: (request, active) => provider.propose(request, active),
    fields: (value, active, token) => fillAgentFields(value, active, token, connection),
    command: send, wait: agentPollDelay,
  }, signal, progress);
}
