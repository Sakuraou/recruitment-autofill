import { PUBLICATION_SEMANTIC_PORT, publicationSemanticRequestSchema } from '../ai/publicationPortProtocol';
import { PROJECT_SEMANTIC_PORT, PROJECT_SEMANTIC_DEADLINE_MS, projectSemanticRequestSchema, projectSemanticReplySchema } from '../ai/projectPortProtocol';
import { EDUCATION_SEMANTIC_PORT, educationSemanticRequestSchema } from '../ai/educationPortProtocol';
import { INTERNSHIP_SEMANTIC_PORT, internshipSemanticRequestSchema } from '../ai/internshipPortProtocol';
import { AWARD_SEMANTIC_PORT, awardSemanticRequestSchema } from '../ai/awardPortProtocol';
import { parseSemanticProposal } from '../ai/semanticProtocol';
import type { SemanticProvider } from '../ai/semanticCandidates';

/** Fixed trusted-background channel. No token, API key, endpoint, answer or record index is available here. */
export function createRecordSemanticClient(recordType: 'project' | 'education' | 'internship' | 'award' | 'publication'): SemanticProvider {
  const schema = recordType === 'publication' ? publicationSemanticRequestSchema : recordType === 'award' ? awardSemanticRequestSchema : recordType === 'internship' ? internshipSemanticRequestSchema : recordType === 'education' ? educationSemanticRequestSchema : projectSemanticRequestSchema;
  const name = recordType === 'publication' ? PUBLICATION_SEMANTIC_PORT : recordType === 'award' ? AWARD_SEMANTIC_PORT : recordType === 'internship' ? INTERNSHIP_SEMANTIC_PORT : recordType === 'education' ? EDUCATION_SEMANTIC_PORT : PROJECT_SEMANTIC_PORT;
  const type = recordType === 'publication' ? 'RA_PUBLICATION_SEMANTIC' : recordType === 'award' ? 'RA_AWARD_SEMANTIC' : recordType === 'internship' ? 'RA_INTERNSHIP_SEMANTIC' : recordType === 'education' ? 'RA_EDUCATION_SEMANTIC' : 'RA_PROJECT_SEMANTIC';
  return { propose: (request, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('栏目语义请求已取消')); return; }
    const parsed = schema.safeParse({ type, request });
    if (!parsed.success || JSON.stringify(parsed.data).length > 40_000) { reject(new Error('栏目语义请求无效')); return; }
    let port: chrome.runtime.Port;
    try { port = chrome.runtime.connect({ name }); }
    catch { reject(new Error('栏目语义连接不可用')); return; }
    let finished = false;
    const finish = (proposal?: unknown) => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect);
      try { port.disconnect(); } catch { /* Already disconnected. */ }
      if (proposal === undefined || signal.aborted) reject(new Error('栏目语义请求未完成')); else resolve(proposal);
    };
    const cancel = () => finish();
    const onDisconnect = () => { void chrome.runtime.lastError; finish(); };
    const onMessage = (value: unknown) => {
      const reply = projectSemanticReplySchema.safeParse(value);
      const proposal = reply.success && reply.data.state === 'ready' ? parseSemanticProposal(reply.data.proposal, parsed.data.request) : undefined;
      finish(proposal);
    };
    const timer = setTimeout(cancel, PROJECT_SEMANTIC_DEADLINE_MS + 1_000);
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { finish(); return; }
    try { port.postMessage(parsed.data); } catch { finish(); }
  }) };
}
