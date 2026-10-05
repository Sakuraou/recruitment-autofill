import { projectWorkflowReason } from './projectRecords';
const reasons: Readonly<Record<string, string>> = {
  'student-work-record-invalid': '校内职务记录格式无效，请检查本地档案。',
  'record-identity-unverified': '校内职务缺少组织、担任职务或完整任期，无法可靠核对重复记录。',
  'identity-insufficient': '网页已有经历缺少可靠的组织、担任职务或任期，无法判断是否重复。',
  'existing-value-conflict': '网页已有答案与本地校内职务资料不一致，已保留原值和草稿。',
  'page-preparation-changed': '等待经历列表时，问题、答案或所属栏目发生变化，已停止后续填写。',
  'page-preparation-failed': '网页没有接受校内职务经历的选择，请检查当前问题。',
  'page-preparation-unverified': '选择后未确认到当前栏目中可填写的校内职务列表。',
  'step-aborted': '本轮已停止，请检查网页草稿后重新启动。',
};
export function studentWorkWorkflowReason(reason?: string): string {
  return reason ? reasons[reason] ?? projectWorkflowReason(reason).replace(/项目/gu, '校内职务') : '';
}
