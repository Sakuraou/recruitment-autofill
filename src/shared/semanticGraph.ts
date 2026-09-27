export const SEMANTIC_GRAPH_SCHEMA_VERSION = 2 as const;

export type SemanticSectionRole =
  | 'basic'
  | 'job-intent'
  | 'education'
  | 'student-work'
  | 'internship'
  | 'project'
  | 'award'
  | 'publication'
  | 'language'
  | 'skill'
  | 'family'
  | 'other';

export type SemanticActionKind =
  | 'add-record'
  | 'edit-record'
  | 'save-record'
  | 'cancel-record'
  | 'expand'
  | 'select-tab'
  | 'next-step'
  | 'submit'
  | 'delete-record'
  | 'withdraw'
  | 'upload'
  | 'unknown';

export type SemanticActionRisk = 'inspect' | 'reversible' | 'commit' | 'restricted';

export type SemanticEvidence =
  | 'legend'
  | 'heading'
  | 'aria-name'
  | 'visible-label'
  | 'add-action'
  | 'edit-action'
  | 'editor-actions'
  | 'repeated-structure';

export interface SemanticBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: 'viewport' | 'frame-viewport';
}

export const SEMANTIC_CANONICAL_ACTION_LABELS = {
  'add-record': '添加记录',
  'edit-record': '编辑记录',
  'save-record': '保存记录',
  'cancel-record': '取消编辑',
  expand: '展开或收起',
  'select-tab': '切换标签页',
  'next-step': '进入下一步',
  submit: '最终提交',
  'delete-record': '删除记录',
  withdraw: '撤回申请',
  upload: '上传文件',
  unknown: '未知动作',
} as const satisfies Record<SemanticActionKind, string>;

export type SemanticCanonicalActionLabel = typeof SEMANTIC_CANONICAL_ACTION_LABELS[SemanticActionKind];

export interface SemanticNodeBase {
  id: string;
  parentId: string | null;
  childIds: string[];
  order: number;
  /** Structural only: never include values, page text, URLs, names or other personal data. */
  structuralFingerprint: string;
  evidence: SemanticEvidence[];
  /** Numeric indexes from the top document; never frame names or URLs. */
  framePath?: number[];
  bounds?: SemanticBounds;
}

export interface PageSemanticNode extends SemanticNodeBase {
  kind: 'page';
}

export interface SectionSemanticNode extends SemanticNodeBase {
  kind: 'section';
  heading: string;
  role: SemanticSectionRole;
  confidence: number;
}

export interface RecordListSemanticNode extends SemanticNodeBase {
  kind: 'record-list';
  recordType: SemanticSectionRole;
  /** Exact count of high-confidence summary records observed in the current DOM. */
  existingRecordCount: number;
  editorState: 'closed' | 'creating' | 'editing' | 'unknown';
}

export interface RecordSemanticNode extends SemanticNodeBase {
  kind: 'record';
  /** Summary order; editing reuses its source summary index, while creating/unknown use the summary count. */
  index: number;
  state: 'summary' | 'creating' | 'editing' | 'unknown';
}

export interface FieldSemanticNode extends SemanticNodeBase {
  kind: 'field';
  /** References an existing FieldDescriptor without copying its content. */
  fieldId: string;
}

interface ActionSemanticNodeBase extends SemanticNodeBase {
  kind: 'action';
  risk: SemanticActionRisk;
  disabled: boolean;
  canonicalLabel: SemanticCanonicalActionLabel;
}

export interface TargetedActionSemanticNode extends ActionSemanticNodeBase {
  action: 'add-record' | 'edit-record' | 'save-record' | 'cancel-record' | 'delete-record';
  targetId: string;
}

export interface UntargetedActionSemanticNode extends ActionSemanticNodeBase {
  action: Exclude<SemanticActionKind, TargetedActionSemanticNode['action']>;
  targetId?: string;
}

export type ActionSemanticNode = TargetedActionSemanticNode | UntargetedActionSemanticNode;

export type SemanticNode =
  | PageSemanticNode
  | SectionSemanticNode
  | RecordListSemanticNode
  | RecordSemanticNode
  | FieldSemanticNode
  | ActionSemanticNode;

export interface PageSemanticGraph {
  schemaVersion: typeof SEMANTIC_GRAPH_SCHEMA_VERSION;
  rootId: string;
  nodes: SemanticNode[];
}
