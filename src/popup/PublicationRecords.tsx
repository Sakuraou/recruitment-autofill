import { RecordControls, type RecordControlsConfig } from './RecordControls';
import { publicationWorkflowReason } from '../workflow/publicationRecords';
const config: RecordControlsConfig = {
 messages:{status:'RA_PUBLICATION_RECORD_STATUS',start:'RA_PUBLICATION_RECORD_START',pause:'RA_PUBLICATION_RECORD_PAUSE',resume:'RA_PUBLICATION_RECORD_RESUME',stop:'RA_PUBLICATION_RECORD_STOP'},
 section:'通用专业论著连续填写',title:'专业论著 · 连续填写（试用）',noun:'专业论著',unit:'篇论著',startLabel:'连续填写全部专业论著',
 preparingLabel:'正在读取论文档案，并等待网页展开专业论著列表…',
 description:'逐篇添加并核验题目、摘要、发表状态、作者排序和日期。不同论文分别取值；缺少资料或陌生字段会保留草稿。',reason:publicationWorkflowReason,
};
export function PublicationRecordControls(){return <RecordControls config={config}/>;}
