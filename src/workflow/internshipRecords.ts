import { projectWorkflowReason } from './projectRecords';
const reasons: Readonly<Record<string, string>> = {
  'internship-record-invalid': '实习记录格式或身份无效，请检查本地档案。',
  'internship-identity-incomplete': '实习缺少公司、岗位或完整时间，无法可靠核对重复记录。',
  'existing-value-conflict': '网页已选择没有实习经历，与档案中的实习记录不一致。请检查网页上的选择。',
  'page-preparation-changed': '等待实习列表时，问题、答案或所属栏目发生变化，已停止后续填写。',
  'page-preparation-failed': '网页没有接受实习经历的选择，请检查当前问题。',
  'page-preparation-unverified': '选择后未确认到当前栏目中可填写的实习列表，请检查网页展开的内容。',
  'step-aborted': '本轮准备已停止，请检查网页后重新启动。',
};
export function internshipWorkflowReason(reason?: string): string {
  return reason ? reasons[reason] ?? projectWorkflowReason(reason).replace(/项目/gu, '实习经历') : '';
}
