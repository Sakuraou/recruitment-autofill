import { RecordControls, type RecordControlsConfig } from './RecordControls';
import { projectWorkflowReason } from '../workflow/projectRecords';
const config: RecordControlsConfig = {
  messages: { status: 'RA_PROJECT_RECORD_STATUS', start: 'RA_PROJECT_RECORD_START', pause: 'RA_PROJECT_RECORD_PAUSE', resume: 'RA_PROJECT_RECORD_RESUME', stop: 'RA_PROJECT_RECORD_STOP' },
  section: '通用项目连续填写', title: '项目 · 连续填写（试用）', noun: '项目', unit: '个档案项目', startLabel: '连续填写全部项目',
  description: '按档案顺序逐条检查项目，跳过已有项，添加、填写并核验每条保存结果。已连接 AI 时会识别当前编辑器的陌生字段，答案从本地当前项目读取。', reason: projectWorkflowReason,
};
export function ProjectRecordControls() { return <RecordControls config={config} />; }
