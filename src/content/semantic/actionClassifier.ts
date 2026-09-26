import type {
  SemanticActionKind, SemanticActionRisk, SemanticCanonicalActionLabel, SemanticSectionRole,
} from '../../shared/semanticGraph';
import { SEMANTIC_CANONICAL_ACTION_LABELS } from '../../shared/semanticGraph';

export interface ActionCandidate {
  accessibleName: string;
  tagName?: string;
  role?: string;
  inputType?: string;
  disabled?: boolean;
  href?: string;
  target?: string;
  ariaExpanded?: boolean;
  sectionRole?: SemanticSectionRole;
  recordContext?: boolean;
}

export interface ClassifiedAction {
  action: SemanticActionKind;
  risk: SemanticActionRisk;
  canonicalLabel: SemanticCanonicalActionLabel;
  disabled: boolean;
}

const normalize = (value: string | undefined): string => (value ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();

const submission = /(?:提交|投递|报名|申请职位|apply|submit)/iu;
const withdrawal = /(?:撤回|撤销申请|取消申请|取消投递|取消报名|withdraw)/iu;
const deletion = /(?:删除|移除|清除记录|delete|remove)/iu;
const cancellation = /(?:取消|关闭编辑|放弃修改|cancel|discard)/iu;
const saving = /(?:保存|暂存|保存草稿|save)/iu;
const advancing = /(?:(?:保存并)?(?:下一步|继续)|next|continue)/iu;
const editing = /(?:编辑|修改|edit|modify)/iu;
const expanding = /(?:展开|收起|更多|查看详情|expand|collapse|show\s*more)/iu;
const safeSave = /^(?:保存|暂存|保存草稿|save|save\s+draft)$/iu;
const safeAdvance = /^(?:下一步|继续|保存并下一步|next|continue|save\s+and\s+next)$/iu;
const safeAdd = /^(?:(?:新增|添加|新建|填写)(?:(?:教育|项目|实习|工作|校园|校内职务|学生工作|奖励|论文|论著|证书|语言|技能|家庭成员)(?:经历|记录)?|经历|记录)|(?:add|new|create)\s+(?:record|education|project|experience|internship|award|publication|certificate|skill))$/iu;
const safeEdit = /^(?:(?:编辑|修改)(?:教育经历|项目经历|实习经历|校内职务|奖励|论文|论著|证书|语言|技能|家庭成员|经历|记录)?|(?:edit|modify)(?:\s+(?:record|education|project|experience|internship|award|publication|certificate|skill))?)$/iu;

function kindFor(candidate: ActionCandidate): SemanticActionKind {
  const name = normalize(candidate.accessibleName);
  const role = normalize(candidate.role);
  const tag = normalize(candidate.tagName);
  const inputType = normalize(candidate.inputType);

  if (withdrawal.test(name)) return 'withdraw';
  if (inputType === 'file' || /(?:上传|选择文件|upload|attach(?:ment)?)/iu.test(name)) return 'upload';
  if (inputType === 'submit' || inputType === 'image') return 'submit';
  if (submission.test(name)) return 'submit';
  if (deletion.test(name)) return 'delete-record';
  if (cancellation.test(name)) return 'cancel-record';
  if (advancing.test(name)) return 'next-step';
  if (saving.test(name)) return 'save-record';
  if (/(?:新增|添加|新建|填写).{0,10}(?:经历|教育|项目|实习|职务|奖励|论文|论著|证书|语言|技能|家庭|成员|记录)|(?:add|new|create).{0,12}(?:record|education|project|experience|internship|award|publication|certificate|skill)/iu.test(name)) return 'add-record';
  if (candidate.recordContext && /^(?:\+|新增|添加|新建|add|new)$/iu.test(name)) return 'add-record';
  if (editing.test(name)) return 'edit-record';
  if (role === 'tab') return 'select-tab';
  if (expanding.test(name)) return 'expand';
  if (inputType === 'submit' || (tag === 'button' && /(?:提交|submit)/iu.test(name))) return 'submit';
  return 'unknown';
}

function navigates(candidate: ActionCandidate): boolean {
  const href = normalize(candidate.href);
  if (normalize(candidate.target) && normalize(candidate.target) !== '_self') return true;
  if (candidate.href === undefined) return false;
  if (href === '') return true;
  return href !== '#' && !/^javascript:\s*(?:;|void\s*\(\s*0\s*\)\s*;?)?$/iu.test(href);
}

function riskFor(action: SemanticActionKind, candidate: ActionCandidate): SemanticActionRisk {
  const name = normalize(candidate.accessibleName);
  const inputType = normalize(candidate.inputType);
  if (submission.test(name) || withdrawal.test(name) || deletion.test(name) || cancellation.test(name)
    || inputType === 'submit' || inputType === 'image' || inputType === 'file' || navigates(candidate)) return 'restricted';
  if (normalize(candidate.tagName) === 'button' && inputType === '') return 'restricted';
  if (safeSave.test(name) || safeAdvance.test(name)) return 'commit';
  if (safeAdd.test(name) || safeEdit.test(name)
    || (candidate.recordContext && /^(?:\+|新增|添加|新建|add|new)$/iu.test(name))) return 'reversible';
  if (action === 'select-tab' || (action === 'expand' && candidate.ariaExpanded !== undefined)) return 'inspect';
  return 'restricted';
}

export function classifyAction(candidate: ActionCandidate): ClassifiedAction {
  const action = kindFor(candidate);
  return {
    action,
    risk: riskFor(action, candidate),
    canonicalLabel: SEMANTIC_CANONICAL_ACTION_LABELS[action],
    disabled: Boolean(candidate.disabled),
  };
}
