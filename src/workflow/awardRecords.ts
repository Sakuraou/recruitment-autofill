import {projectWorkflowReason} from './projectRecords';
const reasons:Readonly<Record<string,string>>={
 'award-record-invalid':'奖励记录格式无效，请检查本地档案。',
 'award-identity-incomplete':'奖励缺少名称、完整日期或辅助事实，无法可靠核对重复记录。',
 'existing-value-conflict':'网页已有答案与本地奖励资料不一致，已保留原值和草稿。',
 'page-preparation-changed':'等待奖励列表时，问题、答案或所属栏目发生变化，已停止后续填写。',
 'page-preparation-failed':'网页没有接受奖励经历的选择，请检查当前问题。',
 'page-preparation-unverified':'选择后未确认到当前栏目中可填写的奖励列表。',
 'step-aborted':'本轮已停止，请检查网页草稿后重新启动。',
};
export function awardWorkflowReason(reason?:string):string{
 return reason?reasons[reason]??projectWorkflowReason(reason).replace(/项目/gu,'奖励'):'';
}
