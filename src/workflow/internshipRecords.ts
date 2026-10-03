import { projectWorkflowReason } from './projectRecords';
const reasons: Readonly<Record<string, string>> = {
  'internship-record-invalid': '实习记录格式或身份无效，请检查本地档案。',
  'internship-identity-incomplete': '实习缺少公司、岗位或完整时间，无法可靠核对重复记录。',
};
export function internshipWorkflowReason(reason?: string): string {
  return reason ? reasons[reason] ?? projectWorkflowReason(reason).replace(/项目/gu, '实习经历') : '';
}
