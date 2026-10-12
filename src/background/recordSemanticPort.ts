import { PUBLICATION_SEMANTIC_PORT, publicationSemanticRequestSchema } from '../ai/publicationPortProtocol';
import { loadProfile } from '../profile/storage';
import { loadAiConnection, type AiConnection } from '../ai/connection';
import { createLoopbackProvider } from '../ai/loopbackProvider';
import { PROJECT_SEMANTIC_PORT, PROJECT_SEMANTIC_DEADLINE_MS, projectSemanticRequestSchema } from '../ai/projectPortProtocol';
import { EDUCATION_SEMANTIC_PORT, educationSemanticRequestSchema } from '../ai/educationPortProtocol';
import { INTERNSHIP_SEMANTIC_PORT, internshipSemanticRequestSchema } from '../ai/internshipPortProtocol';
import { AWARD_SEMANTIC_PORT, awardSemanticRequestSchema } from '../ai/awardPortProtocol';
import { parseSemanticProposal, semanticRequestSchema } from '../ai/semanticProtocol';
import { semanticRedactor } from '../ai/semanticPrivacy';
import type { UserProfile } from '../profile/schema';
import type { SemanticProvider } from '../ai/semanticCandidates';

export interface RecordSemanticPortDependencies {
  extensionId: string;
  connection(): Promise<AiConnection | undefined>;
  profile(): Promise<UserProfile>;
  tab(id: number): Promise<chrome.tabs.Tab>;
  provider(connection: AiConnection): SemanticProvider;
}

/** Trusted background only. One bounded request per real top-frame port; no credentials or values are returned. */
export function createRecordSemanticPortHandler(dependencies?: RecordSemanticPortDependencies, only?: 'project' | 'education' | 'internship' | 'award' | 'publication'): (port: chrome.runtime.Port) => void {
  const deps: RecordSemanticPortDependencies = dependencies ?? { extensionId: chrome.runtime.id, connection: loadAiConnection, profile: loadProfile,
    tab: id => chrome.tabs.get(id), provider: connection => createLoopbackProvider({ protocol: 1, token: connection.token }) };
  const active = new Map<number, chrome.runtime.Port>();
  return port => {
    const recordType = port.name === PROJECT_SEMANTIC_PORT ? 'project' : port.name === EDUCATION_SEMANTIC_PORT ? 'education' : port.name === INTERNSHIP_SEMANTIC_PORT ? 'internship' : port.name === AWARD_SEMANTIC_PORT ? 'award' : port.name === PUBLICATION_SEMANTIC_PORT ? 'publication' : undefined;
    if (!recordType || only && only !== recordType) return;
    const requestSchema = recordType === 'publication' ? publicationSemanticRequestSchema : recordType === 'award' ? awardSemanticRequestSchema : recordType === 'internship' ? internshipSemanticRequestSchema : recordType === 'education' ? educationSemanticRequestSchema : projectSemanticRequestSchema;
    const sender = port.sender;
    const tabId = sender?.tab?.id; const url = sender?.url;
    if (sender?.id !== deps.extensionId || !Number.isSafeInteger(tabId) || tabId! < 0 || sender.frameId !== 0
      || sender.documentLifecycle !== 'active' || !sender.documentId || !url || !/^https?:\/\//u.test(url)
      || sender.tab?.url !== url || active.has(tabId!) || active.size >= 8) { port.disconnect(); return; }
    active.set(tabId!, port);
    const controller = new AbortController(); let finished = false; let used = false;
    const cleanup = () => {
      finished = true; clearTimeout(timer); controller.abort();
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect);
      if (active.get(tabId!) === port) active.delete(tabId!);
    };
    const respond = (value: unknown) => {
      if (finished) return;
      try { port.postMessage(value); } catch { /* Disconnected ports cannot receive a result. */ }
      cleanup();
    };
    const onDisconnect = () => { if (!finished) cleanup(); };
    const timer = setTimeout(() => respond({ state: 'timeout' }), PROJECT_SEMANTIC_DEADLINE_MS);
    const onMessage = (message: unknown) => {
      if (finished) return;
      if (used) { respond({ state: 'rejected' }); return; }
      used = true;
      void (async () => {
        const encoded = JSON.stringify(message);
        if (!encoded || encoded.length > 40_000) { respond({ state: 'rejected' }); return; }
        const parsed = requestSchema.safeParse(message);
        if (!parsed.success) { respond({ state: 'rejected' }); return; }
        const [connection, profile, tab] = await Promise.all([deps.connection(), deps.profile(), deps.tab(tabId!)]);
        if (finished) return;
        if (!connection) { respond({ state: 'disabled' }); return; }
        if (tab.url !== url || tab.pendingUrl && tab.pendingUrl !== url) { respond({ state: 'rejected' }); return; }
        const redact = semanticRedactor(profile);
        const request = semanticRequestSchema.parse({ ...parsed.data.request, fields: parsed.data.request.fields.map(field => ({ ...field,
          label: redact(field.label), ariaLabel: redact(field.ariaLabel), tableHeader: redact(field.tableHeader),
          title: redact(field.title), placeholder: redact(field.placeholder),
          options: field.options.map(option => ({ ...option, label: redact(option.label) })) })) });
        const initialConnection = JSON.stringify(connection); const initialProfile = JSON.stringify(profile);
        const result = await deps.provider(connection).propose(request, controller.signal);
        if (finished) return;
        const [latestConnection, latestProfile, latestTab] = await Promise.all([deps.connection(), deps.profile(), deps.tab(tabId!)]);
        if (finished) return;
        if (JSON.stringify(latestConnection) !== initialConnection || JSON.stringify(latestProfile) !== initialProfile
          || latestTab.url !== url || latestTab.pendingUrl && latestTab.pendingUrl !== url) { respond({ state: 'rejected' }); return; }
        const proposal = parseSemanticProposal(result, request);
        respond(proposal ? { state: 'ready', proposal } : { state: 'rejected' });
      })().catch(() => respond({ state: 'unavailable' }));
    };
    port.onDisconnect.addListener(onDisconnect); port.onMessage.addListener(onMessage);
  };
}
