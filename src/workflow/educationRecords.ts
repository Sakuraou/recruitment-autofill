import { projectWorkflowReason } from './projectRecords';
const reasons: Readonly<Record<string, string>> = {
  'education-stage-unknown': '档案存在未知教育阶段，请补齐学历后重新启动。',
  'education-record-invalid': '教育档案中的记录格式或身份无效，请检查后重新启动。',
  'education-identity-incomplete': '教育档案缺少学校名称，无法核对重复记录。',
};
export function educationWorkflowReason(reason?: string): string {
  return reason ? reasons[reason] ?? projectWorkflowReason(reason).replace(/项目/gu, '教育经历') : '';
}
