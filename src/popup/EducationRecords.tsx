import { RecordControls, type RecordControlsConfig } from './RecordControls';
import { educationWorkflowReason } from '../workflow/educationRecords';
const config: RecordControlsConfig = {
  messages: { status: 'RA_EDUCATION_RECORD_STATUS', start: 'RA_EDUCATION_RECORD_START', pause: 'RA_EDUCATION_RECORD_PAUSE', resume: 'RA_EDUCATION_RECORD_RESUME', stop: 'RA_EDUCATION_RECORD_STOP' },
  section: '通用教育连续填写', title: '教育 · 连续填写（试用）', noun: '教育', unit: '段教育经历', startLabel: '连续填写全部教育经历',
  description: '按教育阶段逐条检查，本科在硕士之前。跳过已核对的记录，新增、填写并核验每条保存结果。开启 AI 识别后可识别陌生字段，答案仍取自当前教育经历。缺少事实或不支持的字段会保留草稿并说明原因。', reason: educationWorkflowReason,
};
export function EducationRecordControls() { return <RecordControls config={config} />; }
