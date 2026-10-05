import { projectWorkflowReason } from './projectRecords';
const reasons: Readonly<Record<string,string>> = {
 'publication-record-invalid':'论文记录格式无效，请检查本地档案。',
 'publication-identity-incomplete':'论文缺少完整题目与DOI，或刊物、完整日期和作者排序，无法可靠核对重复记录。',
 'existing-value-conflict':'网页已有答案与本地论文资料不一致，已保留原值和草稿。',
 'page-preparation-changed':'等待论著列表时，问题、答案或所属栏目发生变化，已停止后续填写。',
 'page-preparation-failed':'网页没有接受专业论著经历的选择，请检查当前问题。',
 'page-preparation-unverified':'选择后未确认到当前栏目中可填写的专业论著列表。',
 'step-aborted':'本轮已停止，请检查网页草稿后重新启动。',
};
export function publicationWorkflowReason(reason?:string):string{
 return reason ? reasons[reason] ?? projectWorkflowReason(reason).replace(/项目/gu,'专业论著') : '';
}
