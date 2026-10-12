import { studentWorkSemanticFieldIds, studentWorkSemanticUnknownField, type StudentWorkSemanticContext } from './studentWorkSemanticContext';
import { publicationSemanticFieldIds, publicationSemanticUnknownField, type PublicationSemanticContext } from './publicationSemanticContext';
import { qualifyScalarWeakMeaning } from '../matching/scalarWeakMeaning';
import { SEMANTIC_BINDING_PATHS, EDUCATION_SEMANTIC_BINDING_PATHS, INTERNSHIP_SEMANTIC_BINDING_PATHS, AWARD_SEMANTIC_BINDING_PATHS, PUBLICATION_SEMANTIC_BINDING_PATHS, STUDENT_WORK_SEMANTIC_BINDING_PATHS, semanticProposalSchema, semanticRequestSchema, semanticPathAllowed, type SemanticBindingPath } from './semanticProtocol';
export { SEMANTIC_BINDING_PATHS, SEMANTIC_BINDING_FORMAT, SEMANTIC_BINDING_INSTRUCTIONS, type SemanticBindingPath } from './semanticProtocol';
import { matchField, UNKNOWN_FIELD_REASON } from '../matching/ruleMatcher';
import type { UserProfile } from '../profile/schema';
import type { SemanticNode, SemanticSectionRole } from '../shared/semanticGraph';
import { isValidSemanticGraph } from '../shared/semanticGraphValidation';
import type { FieldDescriptor, ScanResult } from '../shared/types';
import { semanticRedactor } from './semanticPrivacy';
import { educationSemanticFieldIds, educationSemanticUnknownField, educationSemanticWeakPath, type EducationSemanticContext } from './educationSemanticContext';
import { internshipSemanticFieldIds, internshipSemanticUnknownField, internshipSemanticWeakPath, type InternshipSemanticContext } from './internshipSemanticContext';

import { projectSemanticFieldIds, projectSemanticUnknownField, projectSemanticWeakPath, type ProjectSemanticContext } from './projectSemanticContext';
import { awardSemanticFieldIds, awardSemanticUnknownField, type AwardSemanticContext } from './awardSemanticContext';

interface PublicField {
  readonly ref: string; readonly fingerprint: string;
  readonly kind: FieldDescriptor['kind']; readonly type: string;
  readonly section: SemanticSectionRole; readonly record: 'none' | 'creating';
  readonly label: string; readonly ariaLabel: string; readonly tableHeader: string;
  readonly title: string; readonly placeholder: string;
  readonly options: readonly Readonly<{ ref: string; label: string }>[];
}
export interface SemanticBindingSession {
  readonly request: Readonly<{ protocol: 1 | 2 | 3 | 4 | 5 | 6; requestId: string; allowedPaths: readonly SemanticBindingPath[]; fields: readonly PublicField[] }>;
}
interface LocalField { fieldId: string; fingerprint: string; role: SemanticSectionRole; record: 'none' | 'creating'; expectedPath?: string }
interface LocalSession { snapshot: string; issuedAt: number; fields: ReadonlyMap<string, LocalField> }
const sessions = new WeakMap<SemanticBindingSession, LocalSession>();
export interface VerifiedSemanticRecipeEntry {
  readonly field: SemanticBindingSession['request']['fields'][number];
  readonly path: SemanticBindingPath;
  readonly evidence: 'label' | 'context' | 'options';
  readonly observation?: string;
}
const accepted = new WeakMap<object, Readonly<{ snapshot: string; issuedAt: number; recipes: readonly VerifiedSemanticRecipeEntry[] }>>();
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

/** Read-only guards for recipe reuse; copies of either capability carry no provenance. */
export function semanticSessionCurrent(session: SemanticBindingSession, scan: ScanResult, profile: UserProfile): boolean {
  const local = sessions.get(session);
  if (!local) return false;
  try {
    const age = Date.now() - local.issuedAt;
    return age >= 0 && age <= 120_000 && validGraph(scan) && snapshot(scan, profile) === local.snapshot;
  } catch { return false; }
}
export function verifiedSemanticRecipes(result: BindingValidation, scan: ScanResult, profile: UserProfile): readonly VerifiedSemanticRecipeEntry[] | undefined {
  return semanticBindingsCurrent(result, scan, profile) ? accepted.get(result)?.recipes : undefined;
}
function recipeObservation(field: FieldDescriptor, redact: (value: string) => string): string | undefined {
  if (field.options.length > 40) return undefined;
  const options = field.options.map(option => ({ label: redact(option.label), disabled: option.disabled }));
  if (options.some(option => option.label.length > 80)) return undefined;
  return JSON.stringify({ kind: field.kind, type: field.type, maxLength: field.maxLength, required: field.required,
    disabled: field.disabled, readOnly: field.readOnly, options });
}
export function semanticSessionObservations(session: SemanticBindingSession, scan: ScanResult, profile: UserProfile): ReadonlyMap<string, string | undefined> | undefined {
  if (!semanticSessionCurrent(session, scan, profile)) return undefined;
  const redact = semanticRedactor(profile); const descriptors = new Map(scan.fields.map(field => [field.id, field]));
  return new Map([...sessions.get(session)!.fields].map(([ref, field]) => [ref, recipeObservation(descriptors.get(field.fieldId)!, redact)]));
}
function owner(node: SemanticNode, nodes: ReadonlyMap<string, SemanticNode>, recordType: 'project' | 'education' | 'internship' | 'award' | 'publication' | 'student-work' = 'project'): { role: SemanticSectionRole; record: 'none' | 'creating'; allowed: boolean } {
  let role: SemanticSectionRole = 'other'; let record: 'none' | 'creating' = 'none'; let allowed = true;
  let current: SemanticNode | undefined = node;
  while (current) {
    if (current.kind === 'record') { if (current.state !== 'creating') allowed = false; else record = 'creating'; }
    if (current.kind === 'record-list' && current.recordType !== recordType) allowed = false;
    if (current.kind === 'section') role = current.role;
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  if (!(recordType === 'student-work' ? ['student-work'] : recordType === 'publication' ? ['publication'] : recordType === 'award' ? ['award'] : recordType === 'internship' ? ['internship'] : recordType === 'education' ? ['education'] : ['basic', 'job-intent', 'project', 'skill', 'other']).includes(role)) allowed = false;
  if (['project', 'education', 'internship', 'award', 'publication', 'student-work'].includes(role) && record !== 'creating') allowed = false;
  return { role, record, allowed };
}
function pathAllowed(path: SemanticBindingPath, field: LocalField): boolean {
  return semanticPathAllowed(path, field.role, field.record);
}

/** Read-only proposal preparation. No model invocation or execution capability is granted. */
export function createSemanticBindingSession(scan: ScanResult, profile: UserProfile, excludedFieldIds?: ReadonlySet<string>,
  educationContext?: EducationSemanticContext, internshipContext?: InternshipSemanticContext, projectContext?: ProjectSemanticContext, awardContext?: AwardSemanticContext, publicationContext?: PublicationSemanticContext, studentWorkContext?: StudentWorkSemanticContext): CreateResult {
  try {
    if (!validGraph(scan) || [educationContext,internshipContext,projectContext,awardContext,publicationContext,studentWorkContext].filter(Boolean).length>1) return { ok: false, reason: 'invalid-graph' };
    const studentWorkFields=studentWorkContext?studentWorkSemanticFieldIds(studentWorkContext,scan,profile):undefined;
    if(studentWorkContext&&!studentWorkFields)return {ok:false,reason:'invalid-graph'};
    const publicationFields=publicationContext?publicationSemanticFieldIds(publicationContext,scan,profile):undefined;
    if(publicationContext&&!publicationFields)return {ok:false,reason:'invalid-graph'};
    const awardFields = awardContext ? awardSemanticFieldIds(awardContext,scan,profile) : undefined;
    if (awardContext && !awardFields) return {ok:false,reason:'invalid-graph'};
    const internshipFields = internshipContext ? internshipSemanticFieldIds(internshipContext, scan, profile) : undefined;
    if (internshipContext && !internshipFields) return { ok: false, reason: 'invalid-graph' };
    const educationFields = educationContext ? educationSemanticFieldIds(educationContext, scan, profile) : undefined;
    if (educationContext && !educationFields) return { ok: false, reason: 'invalid-graph' };
    const projectFields=projectContext?projectSemanticFieldIds(projectContext,scan,profile):undefined;
    if(projectContext && !projectFields)return {ok:false,reason:'invalid-graph'};
    const ownedFields = studentWorkFields ?? publicationFields ?? awardFields ?? internshipFields ?? educationFields ?? projectFields;
    const owned = ownedFields ? new Set(ownedFields) : undefined;
    const graph = scan.semanticGraph!;
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const descriptors = new Map(scan.fields.map(field => [field.id, field]));
    const redact = semanticRedactor(profile);
    const fields: PublicField[] = []; const local = new Map<string, LocalField>();
    for (const node of graph.nodes) {
      if (node.kind !== 'field' || fields.length >= 30) continue;
      const field = descriptors.get(node.fieldId)!; const ownership = owner(node, nodes, studentWorkContext ? 'student-work' : publicationContext ? 'publication' : awardContext ? 'award' : internshipContext ? 'internship' : educationContext ? 'education' : 'project');
      if (excludedFieldIds?.has(field.id)) continue;
      if (owned && !owned.has(field.id)) continue;
      if (!ownership.allowed || field.blockedReason || field.disabled || field.readOnly || field.hasValue || field.kind === 'checkbox') continue;
      if (field.kind === 'input' && !['text', 'search', 'email', 'tel', 'url', 'number', 'date', 'month'].includes(field.type)) continue;
      const weakEducation=educationContext && educationSemanticWeakPath(educationContext,scan,profile,field.id);
      const weakProject=projectContext && projectSemanticWeakPath(projectContext,scan,profile,field.id);
      if(educationContext && !weakEducation && !educationSemanticUnknownField(educationContext,scan,profile,field.id))continue;
      if(projectContext && !weakProject && !projectSemanticUnknownField(projectContext,scan,profile,field.id))continue;
      const weakInternship = internshipContext && internshipSemanticWeakPath(internshipContext,scan,profile,field.id);
      if (internshipContext && !weakInternship && !internshipSemanticUnknownField(internshipContext, scan, profile, field.id)) continue;
      if(studentWorkContext&&!studentWorkSemanticUnknownField(studentWorkContext,scan,profile,field.id))continue;
      if(publicationContext&&!publicationSemanticUnknownField(publicationContext,scan,profile,field.id))continue;
      if (awardContext && !awardSemanticUnknownField(awardContext,scan,profile,field.id)) continue;
      const scalarQualification = !educationContext && !internshipContext && !projectContext && !awardContext && !publicationContext && !studentWorkContext && ownership.record === 'none'
        && ['basic','other'].includes(ownership.role) ? qualifyScalarWeakMeaning(field,profile) : undefined;
      const weakScalar = scalarQualification?.status === 'confirm' ? scalarQualification.path : undefined;
      const expectedPath=weakInternship || weakEducation || weakProject || weakScalar;
      const match = matchField(field, profile);
      // A known label with a missing answer, ambiguous owner or a protective explanation is not a semantic gap.
      if (!studentWorkContext && !publicationContext && !expectedPath && (match.status !== 'missing' || match.matchedProfileKey || match.reason !== UNKNOWN_FIELD_REASON)) continue;
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
      local.set(ref, { fieldId: field.id, fingerprint: node.structuralFingerprint, role: ownership.role, record: ownership.record, ...(expectedPath ? { expectedPath } : {}) });
    }
    if (!fields.length) return { ok: false, reason: 'no-candidates' };
    const request = Object.freeze({ protocol: studentWorkContext ? 6 as const : publicationContext ? 5 as const : awardContext ? 4 as const : internshipContext ? 3 as const : educationContext ? 2 as const : 1 as const, requestId: crypto.randomUUID(),
      allowedPaths: Object.freeze(studentWorkContext ? [...STUDENT_WORK_SEMANTIC_BINDING_PATHS] : publicationContext ? [...PUBLICATION_SEMANTIC_BINDING_PATHS] : awardContext ? [...AWARD_SEMANTIC_BINDING_PATHS] : internshipContext ? [...INTERNSHIP_SEMANTIC_BINDING_PATHS] : educationContext ? [...EDUCATION_SEMANTIC_BINDING_PATHS] : [...SEMANTIC_BINDING_PATHS]), fields: Object.freeze(fields) });
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
      if (target.expectedPath && target.expectedPath !== binding.path || !new Set<string>(session.request.allowedPaths).has(binding.path) || !pathAllowed(binding.path, target)) return { ok: false, reason: 'ownership-conflict' };
      if (binding.certainty !== 'certain') return { ok: false, reason: 'uncertain' };
      seen.add(binding.ref); bindings.push(Object.freeze({ fieldId: target.fieldId, path: binding.path }));
    }
    const result = Object.freeze({ ok: true as const, bindings: Object.freeze(bindings) });
    const redact = semanticRedactor(profile); const descriptors = new Map(current.fields.map(field => [field.id, field]));
    const recipes = Object.freeze(proposal.bindings.map(binding => Object.freeze({
      field: session.request.fields.find(field => field.ref === binding.ref)!, path: binding.path, evidence: binding.evidence,
      observation: recipeObservation(descriptors.get(local.fields.get(binding.ref)!.fieldId)!, redact),
    })));
    accepted.set(result, { snapshot: local.snapshot, issuedAt: local.issuedAt, recipes });
    return result;
  } catch { return { ok: false, reason: 'invalid-response' }; }
}
