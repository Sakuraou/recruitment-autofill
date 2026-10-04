import { RecordControls, type RecordControlsConfig } from './RecordControls';
import { internshipWorkflowReason } from '../workflow/internshipRecords';
const config: RecordControlsConfig = {
  messages: { status: 'RA_INTERNSHIP_RECORD_STATUS', start: 'RA_INTERNSHIP_RECORD_START', pause: 'RA_INTERNSHIP_RECORD_PAUSE', resume: 'RA_INTERNSHIP_RECORD_RESUME', stop: 'RA_INTERNSHIP_RECORD_STOP' },
  section: '通用实习连续填写', title: '实习 · 连续填写（试用）', noun: '实习', unit: '条实习经历', startLabel: '连续填写全部实习经历',
  preparingLabel: '正在读取实习档案，并等待网页展开实习列表…',
  description: '按档案顺序逐条检查，跳过已核对记录，新增、填写并核验保存。每条使用自己的公司、岗位、日期和描述；选择后出现的新问题也会核验。缺少事实或陌生字段会保留草稿并说明原因。', reason: internshipWorkflowReason,
};
export function InternshipRecordControls() { return <RecordControls config={config} />; }
