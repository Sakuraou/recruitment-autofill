export type ProjectWorkflowPhase = 'idle' | 'preparing' | 'running' | 'pausing' | 'paused' | 'review' | 'complete' | 'stopped';
export interface ProjectWorkflowState {
  readonly phase: ProjectWorkflowPhase;
  readonly total: number;
  readonly canStart: boolean;
  readonly reason?: string;
}

const reasons: Readonly<Record<string, string>> = {
  'record-list-unverified': '未识别到唯一的项目列表，暂时无法连续新增。',
  'record-root-unsupported': '项目列表位于 iframe 或 Shadow DOM 内，连续模式暂不支持。',
  'editor-already-open': '网页有未保存的项目编辑器，请先保存或取消。',
  'add-action-unverified': '无法确认唯一的项目添加按钮。',
  'field-semantic-unknown': '有字段的含义尚未识别，请检查当前项目编辑器。',
  'field-semantic-ambiguous': '有字段存在多个可能含义，已保留草稿。',
  'field-options-unresolved': '下拉或单选中没有唯一可确定的答案。',
  'field-unsupported': '当前项目包含尚不支持的控件或保护字段。',
  'profile-value-missing': '当前项目缺少网页要求的信息，请在档案中补齐。',
  'profile-date-precision': '网页要求具体到日，档案只有月份，请补齐日期。',
  'profile-value-invalid': '档案中的日期或格式不符合网页要求。',
  'profile-value-too-long': '项目内容超过网页字数限制，请先调整档案。',
  'profile-projection-unavailable': '无法读取有效的项目档案，请检查档案并重新启动。',
  'profile-changed': '档案在运行中更新，请检查草稿后重新启动。',
  'page-changed': '网页地址已变化，本轮已停止，请回到项目页重新启动。',
  'snapshot-stale': '网页内容在步骤间发生变化，已停止后续填写。',
  'fields-changed-after-verification': '字段核验后网页内容又发生变化，已停止保存并保留草稿。',
  'identity-insufficient': '已有项目缺少可靠的身份信息，无法判断是否重复。',
  'save-result-uncertain': '保存结果无法确定，请检查网页，不能重复添加或保存。',
  'rollback-incomplete': '网页未能恢复部分填写内容，请先检查当前草稿。',
  'action-limit': '本轮未能在预计步骤内完成，已停止，请检查网页。',
  'editor-expansion-limit': '当前项目连续展开的问题超过三轮，已停止保存，请检查新字段和草稿。',
  'run-failed': '本轮操作未完成，请检查网页和当前草稿。',
};
export function projectWorkflowReason(reason?: string): string {
  return reason ? reasons[reason] ?? '当前页面无法继续自动填写，请检查项目列表和草稿。' : '';
}
