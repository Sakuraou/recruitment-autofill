import { RecordControls, type RecordControlsConfig } from './RecordControls';
import { studentWorkWorkflowReason } from '../workflow/studentWorkRecords';
const config: RecordControlsConfig = {
  messages: { status: 'RA_STUDENT_WORK_RECORD_STATUS', start: 'RA_STUDENT_WORK_RECORD_START', pause: 'RA_STUDENT_WORK_RECORD_PAUSE', resume: 'RA_STUDENT_WORK_RECORD_RESUME', stop: 'RA_STUDENT_WORK_RECORD_STOP' },
  section: '通用校内职务连续填写', title: '校内职务 · 连续填写（试用）', noun: '校内职务', unit: '段经历', startLabel: '连续填写全部校内职务',
  preparingLabel: '正在读取校内职务档案，并等待网页展开经历列表…',
  description: '逐条添加并核验组织、担任职务和任期。同一组织的不同职务或任期分别填写；缺少资料或陌生字段会保留草稿。',
  reason: studentWorkWorkflowReason,
};
export function StudentWorkRecordControls() { return <RecordControls config={config} />; }
