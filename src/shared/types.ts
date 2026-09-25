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
  warnings: string[];
}
export interface FillItem { fieldId: string; value: string; confirmed: boolean }
export interface FillRequest { scanId: string; items: FillItem[] }
export interface FillOutcome { fieldId: string; status: 'filled' | 'skipped' | 'error'; reason: string }
export type ContentRequest = { type: 'RA_SCAN' } | { type: 'RA_FILL'; payload: FillRequest } | { type: 'RA_SELECTION' }
  | { type: 'RA_WORKFLOW_START'; payload: import('../workflow/model').WorkflowRequest }
  | { type: 'RA_WORKFLOW_STATUS' | 'RA_WORKFLOW_PAUSE' | 'RA_WORKFLOW_RESUME' | 'RA_WORKFLOW_STOP' };
export type ContentResponse<T> = { ok: true; data: T } | { ok: false; error: string };
