import type { PageSemanticGraph } from './semanticGraph';

export type FieldKind = 'input' | 'textarea' | 'select' | 'radio' | 'checkbox';
export interface FieldOption { value: string; label: string; disabled: boolean }
export interface FieldDescriptor {
  id: string;
  kind: FieldKind;
  type: string;
  label: string;
  placeholder: string;
  name: string;
  htmlId: string;
  ariaLabel: string;
  title: string;
  parentText: string;
  previousText: string;
  tableHeader: string;
  sectionText: string;
  groupId?: string;
  options: FieldOption[];
  maxLength: number | null;
  required: boolean;
  hasValue: boolean;
  disabled: boolean;
  readOnly: boolean;
  blockedReason?: string;
}
export type MatchSource = 'rule' | 'alias' | 'fuzzy' | 'llm';
export type MatchStatus = 'auto' | 'review' | 'missing' | 'blocked' | 'existing';
export interface MatchResult {
  fieldId: string;
  fieldName: string;
  matchedProfileKey?: string;
  value?: string;
  confidence: number;
  source: MatchSource;
  status: MatchStatus;
  reason: string;
  sensitive: boolean;
}
export interface ScanResult {
  contentVersion?: string;
  scanId: string;
  url: string;
  title: string;
  fields: FieldDescriptor[];
  /** Optional during migration; old content scripts and reports remain compatible. */
  semanticGraph?: PageSemanticGraph;
  warnings: string[];
}
export interface FillItem { fieldId: string; value: string; confirmed: boolean }
export interface FillRequest { scanId: string; items: FillItem[] }
export interface FillOutcome { fieldId: string; status: 'filled' | 'skipped' | 'error'; reason: string }
export type ContentRequest = { type: 'RA_SCAN' } | { type: 'RA_FILL'; payload: FillRequest } | { type: 'RA_SELECTION' }
  | { type: 'RA_SCAN_SETTLED' }
  | { type: 'RA_AGENT_RECORD_CHECK'; payload: { token: string; kind: 'education' | 'project' | 'internship' } }
  | { type: 'RA_VERIFY_SCAN'; payload: { scanId: string } }
  | { type: 'RA_WORKFLOW_START'; payload: import('../workflow/model').WorkflowRequest }
  | { type: 'RA_WORKFLOW_STATUS' | 'RA_WORKFLOW_PAUSE' | 'RA_WORKFLOW_RESUME' | 'RA_WORKFLOW_STOP' }
  | { type: 'RA_RECORD_V2_START' | 'RA_RECORD_V2_ADVANCE' | 'RA_RECORD_V2_STATUS'
    | 'RA_RECORD_V2_PAUSE' | 'RA_RECORD_V2_RESUME' | 'RA_RECORD_V2_STOP' }
  | { type: 'RA_PROJECT_RECORD_START' | 'RA_PROJECT_RECORD_STATUS' | 'RA_PROJECT_RECORD_PAUSE'
    | 'RA_PROJECT_RECORD_RESUME' | 'RA_PROJECT_RECORD_STOP'
    | 'RA_EDUCATION_RECORD_START' | 'RA_EDUCATION_RECORD_STATUS' | 'RA_EDUCATION_RECORD_PAUSE'
    | 'RA_EDUCATION_RECORD_RESUME' | 'RA_EDUCATION_RECORD_STOP'
    | 'RA_INTERNSHIP_RECORD_START' | 'RA_INTERNSHIP_RECORD_STATUS' | 'RA_INTERNSHIP_RECORD_PAUSE'
    | 'RA_INTERNSHIP_RECORD_RESUME' | 'RA_INTERNSHIP_RECORD_STOP'; agentRunToken?: string };
export type ContentResponse<T> = { ok: true; data: T } | { ok: false; error: string };
