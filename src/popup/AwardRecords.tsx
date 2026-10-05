import {RecordControls,type RecordControlsConfig} from './RecordControls';
import {awardWorkflowReason} from '../workflow/awardRecords';
const config:RecordControlsConfig={
 messages:{status:'RA_AWARD_RECORD_STATUS',start:'RA_AWARD_RECORD_START',pause:'RA_AWARD_RECORD_PAUSE',resume:'RA_AWARD_RECORD_RESUME',stop:'RA_AWARD_RECORD_STOP'},
 section:'通用奖励连续填写',title:'奖励 · 连续填写（试用）',noun:'奖励',unit:'条奖励经历',startLabel:'连续填写全部奖励',
 preparingLabel:'正在读取奖励档案，并等待网页展开奖励列表…',
 description:'逐条添加奖学金和竞赛，保留各自的日期、学校和描述，并核验保存结果。明确的学生干部选择和联动描述从本地资料填写；缺少资料或陌生字段会保留草稿。',reason:awardWorkflowReason,
};
export function AwardRecordControls(){return <RecordControls config={config}/>;}
