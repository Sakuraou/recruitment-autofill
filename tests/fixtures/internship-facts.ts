import type { Experience } from '../../src/profile/schema';
import type { FieldDescriptor } from '../../src/shared/types';

export const firstInternship: Experience = { id: 'fictional-internship-cloud', organization: '虚构云桥科技',
  department: '平台研发部', role: '软件开发实习生', startDate: '2025-07-01', endDate: '2025-09-30',
  description: '维护课程演示服务，编写接口测试并整理故障排查记录。', achievements: '完成课程演示接口交付。',
  experienceType: '实习经历', workType: '实习', companyProperty: '民营企业', monthlySalary: '1000-2000/月', hasProof: '否' };
export const secondInternship: Experience = { id: 'fictional-internship-library', organization: '虚构星河图书馆',
  department: '信息服务部', role: '信息整理实习生', startDate: '2026-01-10', endDate: '2026-02-20',
  description: '整理图书检索记录，核对数据字段并协助处理读者反馈。', achievements: '完成检索记录核对。',
  experienceType: '社会实践', workType: '兼职', companyProperty: '事业单位', monthlySalary: '2000-3000/月', hasProof: '是' };
export function internshipField(label: string, overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { id: 'fictional-field', kind: 'input', type: 'text', label, placeholder: '', name: '', htmlId: '',
    ariaLabel: '', title: '', parentText: '', previousText: '', tableHeader: '', sectionText: '实习经历', options: [],
    maxLength: null, required: false, hasValue: false, disabled: false, readOnly: false, ...overrides };
}
