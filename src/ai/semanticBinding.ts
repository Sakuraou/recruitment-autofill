import { SEMANTIC_BINDING_PATHS, semanticProposalSchema, semanticRequestSchema, semanticPathAllowed, type SemanticBindingPath } from './semanticProtocol';
export { SEMANTIC_BINDING_PATHS, SEMANTIC_BINDING_FORMAT, SEMANTIC_BINDING_INSTRUCTIONS, type SemanticBindingPath } from './semanticProtocol';
import { matchField, UNKNOWN_FIELD_REASON } from '../matching/ruleMatcher';
import type { UserProfile } from '../profile/schema';
import type { SemanticNode, SemanticSectionRole } from '../shared/semanticGraph';
import { isValidSemanticGraph } from '../shared/semanticGraphValidation';
import type { FieldDescriptor, ScanResult } from '../shared/types';
import { semanticRedactor } from './semanticPrivacy';

interface PublicField {
  readonly ref: string; readonly fingerprint: string;
  readonly kind: FieldDescriptor['kind']; readonly type: string;
  readonly section: SemanticSectionRole; readonly record: 'none' | 'creating';
  readonly label: string; readonly ariaLabel: string; readonly tableHeader: string;
  readonly title: string; readonly placeholder: string;
  readonly options: readonly Readonly<{ ref: string; label: string }>[];
}
export interface SemanticBindingSession {
  readonly request: Readonly<{ protocol: 1; requestId: string; allowedPaths: readonly SemanticBindingPath[]; fields: readonly PublicField[] }>;
}
interface LocalField { fieldId: string; fingerprint: string; role: SemanticSectionRole; record: 'none' | 'creating' }
interface LocalSession { snapshot: string; issuedAt: number; fields: ReadonlyMap<string, LocalField> }
const sessions = new WeakMap<SemanticBindingSession, LocalSession>();
const accepted = new WeakMap<object, Readonly<{ snapshot: string; issuedAt: number }>>();
type CreateResult = { ok: true; session: SemanticBindingSession } | { ok: false; reason: 'invalid-graph' | 'no-candidates' | 'request-too-large' };
export type BindingValidation = { ok: true; bindings: ReadonlyArray<Readonly<{ fieldId: string; path: SemanticBindingPath }>> }
  | { ok: false; reason: 'invalid-session' | 'stale-context' | 'invalid-response' | 'invalid-reference' | 'ownership-conflict' | 'unresolved' | 'uncertain' };

function validGraph(scan: ScanResult): boolean {
  return !!scan.semanticGraph && scan.fields.length <= 500 && new Set(scan.fields.map(f => f.id)).size === scan.fields.length
    && isValidSemanticGraph(scan.semanticGraph, scan.fields.map(f => f.id));
}
function snapshot(scan: ScanResult, profile: UserProfile): string {
  // Private memory only; never expose a hash or serialization of personal values in the request.
  return JSON.stringify({ scanId: scan.scanId, url: scan.url, graph: scan.semanticGraph, fields: scan.fields, profile });
}

/** A JSON-shaped success object is not proof; only the original locally-issued result is accepted. */
export function semanticBindingsCurrent(result: BindingValidation, scan: ScanResult, profile: UserProfile): boolean {
  const receipt = accepted.get(result);
  if (!receipt || !result.ok) return false;
  try {
    const age = Date.now() - receipt.issuedAt;
    return age >= 0 && age <= 120_000 && validGraph(scan) && snapshot(scan, profile) === receipt.snapshot;
  } catch { return false; }
}
function owner(node: SemanticNode, nodes: ReadonlyMap<string, SemanticNode>): { role: SemanticSectionRole; record: 'none' | 'creating'; allowed: boolean } {
  let role: SemanticSectionRole = 'other'; let record: 'none' | 'creating' = 'none'; let allowed = true;
  let current: SemanticNode | undefined = node;
  while (current) {
    if (current.kind === 'record') { if (current.state !== 'creating') allowed = false; else record = 'creating'; }
    if (current.kind === 'record-list' && current.recordType !== 'project') allowed = false;
    if (current.kind === 'section') role = current.role;
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  if (!['basic', 'job-intent', 'project', 'skill', 'other'].includes(role)) allowed = false;
  if (role === 'project' && record !== 'creating') allowed = false;
  return { role, record, allowed };
}
function pathAllowed(path: SemanticBindingPath, field: LocalField): boolean {
  return semanticPathAllowed(path, field.role, field.record);
}

/** Read-only proposal preparation. No model invocation or execution capability is granted. */
export function createSemanticBindingSession(scan: ScanResult, profile: UserProfile): CreateResult {
  try {
    if (!validGraph(scan)) return { ok: false, reason: 'invalid-graph' };
    const graph = scan.semanticGraph!;
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const descriptors = new Map(scan.fields.map(field => [field.id, field]));
    const redact = semanticRedactor(profile);
    const fields: PublicField[] = []; const local = new Map<string, LocalField>();
    for (const node of graph.nodes) {
      if (node.kind !== 'field' || fields.length >= 30) continue;
      const field = descriptors.get(node.fieldId)!; const ownership = owner(node, nodes);
      if (!ownership.allowed || field.blockedReason || field.disabled || field.readOnly || field.hasValue || field.kind === 'checkbox') continue;
      if (field.kind === 'input' && !['text', 'search', 'email', 'tel', 'url', 'number', 'date', 'month'].includes(field.type)) continue;
      const match = matchField(field, profile);
      // A known label with a missing answer, ambiguous owner or a protective explanation is not a semantic gap.
      if (match.status !== 'missing' || match.matchedProfileKey || match.reason !== UNKNOWN_FIELD_REASON) continue;
      const clues = { label: redact(field.label), ariaLabel: redact(field.ariaLabel), tableHeader: redact(field.tableHeader),
        title: redact(field.title), placeholder: redact(field.placeholder) };
      if (!Object.values(clues).some(value => /[\p{L}]/u.test(value.replace(/\[redacted\]/gu, '')))
        || Object.values(clues).some(value => value.length > 180)) continue;
      const ref = `field-${fields.length}`;
      const options = field.options.length <= 40 ? field.options.filter(option => !option.disabled)
        .map((option, index) => Object.freeze({ ref: `option-${index}`, label: redact(option.label) })) : [];
      if (options.some(option => option.label.length > 80)) continue;
      fields.push(Object.freeze({ ref, fingerprint: node.structuralFingerprint, kind: field.kind, type: field.kind === 'input' ? field.type : field.kind,
        section: ownership.role, record: ownership.record, ...clues, options: Object.freeze(options) }));
      local.set(ref, { fieldId: field.id, fingerprint: node.structuralFingerprint, role: ownership.role, record: ownership.record });
    }
    if (!fields.length) return { ok: false, reason: 'no-candidates' };
    const request = Object.freeze({ protocol: 1 as const, requestId: crypto.randomUUID(),
      allowedPaths: Object.freeze([...SEMANTIC_BINDING_PATHS]), fields: Object.freeze(fields) });
    if (JSON.stringify(request).length > 40_000) return { ok: false, reason: 'request-too-large' };
    if (!semanticRequestSchema.safeParse(request).success) return { ok: false, reason: 'invalid-graph' };
    const session = Object.freeze({ request });
    sessions.set(session, { issuedAt: Date.now(), snapshot: snapshot(scan, profile), fields: local });
    return { ok: true, session };
  } catch { return { ok: false, reason: 'invalid-graph' }; }
}

/** Consumes one locally-issued proposal session. Success is semantic binding only, never permission to write. */
export function validateSemanticBindings(session: SemanticBindingSession, response: unknown,
  current: ScanResult, profile: UserProfile): BindingValidation {
  const local = sessions.get(session);
  if (!local) return { ok: false, reason: 'invalid-session' };
  sessions.delete(session);
  try {
    const age = Date.now() - local.issuedAt;
    if (age < 0 || age > 120_000 || !validGraph(current) || snapshot(current, profile) !== local.snapshot) return { ok: false, reason: 'stale-context' };
    const encoded = typeof response === 'string' ? response : JSON.stringify(response);
    if (typeof encoded !== 'string' || encoded.length > 64_000) return { ok: false, reason: 'invalid-response' };
    const parsed = semanticProposalSchema.safeParse(JSON.parse(encoded));
    if (!parsed.success) return { ok: false, reason: 'invalid-response' };
    const proposal = parsed.data;
    if (proposal.requestId !== session.request.requestId) return { ok: false, reason: 'invalid-reference' };
    if (proposal.status !== 'mapped') return { ok: false, reason: proposal.bindings.length ? 'invalid-response' : 'unresolved' };
    if (!proposal.bindings.length) return { ok: false, reason: 'invalid-response' };
    const seen = new Set<string>(); const bindings: Array<{ fieldId: string; path: SemanticBindingPath }> = [];
    for (const binding of proposal.bindings) {
      const target = local.fields.get(binding.ref);
      if (!target || seen.has(binding.ref) || binding.fingerprint !== target.fingerprint) return { ok: false, reason: 'invalid-reference' };
      if (!pathAllowed(binding.path, target)) return { ok: false, reason: 'ownership-conflict' };
      if (binding.certainty !== 'certain') return { ok: false, reason: 'uncertain' };
      seen.add(binding.ref); bindings.push(Object.freeze({ fieldId: target.fieldId, path: binding.path }));
    }
    const result = Object.freeze({ ok: true as const, bindings: Object.freeze(bindings) });
    accepted.set(result, { snapshot: local.snapshot, issuedAt: local.issuedAt });
    return result;
  } catch { return { ok: false, reason: 'invalid-response' }; }
}
