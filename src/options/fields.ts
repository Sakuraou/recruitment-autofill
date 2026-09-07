export interface EditorField {
  key: string;
  label: string;
  kind?: 'textarea' | 'list' | 'date' | 'secret' | 'select';
  options?: string[];
  hint?: string;
}
export interface CollectionSpec {
  path: string;
  title: string;
  fields: EditorField[];
  defaults?: Record<string, unknown>;
}
export const basicFields: EditorField[] = [
  { key: 'name', label: '姓名' }, { key: 'gender', label: '性别' },
  { key: 'birthday', label: '出生日期', kind: 'date' },
  { key: 'phone', label: '手机号' }, { key: 'email', label: '邮箱' },
  { key: 'idType', label: '证件类型' }, { key: 'idNumber', label: '证件号码', kind: 'secret' },
  { key: 'nationality', label: '国籍' }, { key: 'ethnicity', label: '民族' },
  { key: 'politicalStatus', label: '政治面貌' }, { key: 'nativePlace', label: '籍贯' },
  { key: 'sourcePlace', label: '生源地' }, { key: 'hometown', label: '家乡' },
  { key: 'householdLocation', label: '户籍所在地' }, { key: 'address', label: '通讯地址' },
  { key: 'postalCode', label: '邮政编码' },
];
const dates: EditorField[] = [
  { key: 'startDate', label: '开始时间', kind: 'date' }, { key: 'endDate', label: '结束时间', kind: 'date' },
];
const experience: EditorField[] = [
  { key: 'organization', label: '单位 / 组织' }, { key: 'department', label: '部门' },
  { key: 'role', label: '职务' }, ...dates,
  { key: 'description', label: '工作内容', kind: 'textarea' }, { key: 'achievements', label: '实际成果', kind: 'textarea' },
];
export const collections: Record<string, CollectionSpec> = {
  education: { path: 'education', title: '教育经历', fields: [
    { key: 'level', label: '学历', kind: 'select', options: ['专科', '本科', '硕士研究生', '博士研究生', '其他'] },
    { key: 'degree', label: '学位', hint: '例如工学学士、工程硕士，以实际证书为准' },
    { key: 'school', label: '院校名称' }, { key: 'college', label: '学院' },
    { key: 'major', label: '专业名称' }, { key: 'majorCategory', label: '专业类别', hint: '不确定时留空，不根据专业名自动确定' },
    ...dates, { key: 'studyMode', label: '学习形式' }, { key: 'gpa', label: 'GPA / 成绩' },
    { key: 'gpaScale', label: 'GPA 满分' }, { key: 'ranking', label: '成绩排名' },
    { key: 'researchDirection', label: '研究方向', kind: 'textarea' }, { key: 'courses', label: '主修课程', kind: 'textarea' },
  ] },
  projects: { path: 'projects', title: '项目经历', defaults: { technologies: [] }, fields: [
    { key: 'name', label: '项目名称' }, { key: 'role', label: '承担角色' }, ...dates,
    { key: 'description', label: '项目描述', kind: 'textarea' },
    { key: 'responsibilities', label: '本人职责', kind: 'textarea' },
    { key: 'achievements', label: '实际成果', kind: 'textarea' },
    { key: 'technologies', label: '使用技术', kind: 'list', hint: '每行一项' },
  ] },
  internships: { path: 'internships', title: '实习经历', fields: experience },
  studentWork: { path: 'studentWork', title: '学生工作', fields: experience },
  papers: { path: 'research.papers', title: '论文', fields: [
    { key: 'title', label: '论文标题' }, { key: 'authors', label: '作者及顺序' },
    { key: 'venue', label: '期刊 / 会议' }, { key: 'status', label: '当前状态' },
    { key: 'date', label: '发表 / 接收时间', kind: 'date' }, { key: 'doi', label: 'DOI' },
    { key: 'description', label: '本人贡献', kind: 'textarea' },
  ] },
  patents: { path: 'research.patents', title: '专利', fields: [
    { key: 'title', label: '专利名称' }, { key: 'number', label: '申请 / 授权号' },
    { key: 'status', label: '当前状态' }, { key: 'date', label: '时间', kind: 'date' },
    { key: 'inventors', label: '发明人及顺序' },
  ] },
  awards: { path: 'awards', title: '获奖情况', fields: [
    { key: 'name', label: '奖项名称' }, { key: 'level', label: '级别' },
    { key: 'issuer', label: '颁发单位' }, { key: 'date', label: '获奖时间', kind: 'date' },
    { key: 'description', label: '说明', kind: 'textarea' },
  ] },
  certificates: { path: 'certificates', title: '证书', fields: [
    { key: 'name', label: '证书名称' }, { key: 'issuer', label: '颁发单位' },
    { key: 'score', label: '成绩' }, { key: 'date', label: '获得时间', kind: 'date' },
    { key: 'number', label: '证书编号', kind: 'secret' },
  ] },
  family: { path: 'family', title: '家庭成员', fields: [
    { key: 'name', label: '姓名' }, { key: 'relationship', label: '与本人关系' },
    { key: 'birthday', label: '出生日期', kind: 'date' }, { key: 'organization', label: '工作单位' },
    { key: 'role', label: '职务' }, { key: 'phone', label: '联系电话' }, { key: 'politicalStatus', label: '政治面貌' },
  ] },
};
export const answerFields = [
  ['selfEvaluation', '自我评价'], ['personalStrengths', '个人优势'], ['jobFit', '岗位匹配度'],
  ['motivation', '求职动机'], ['careerPlan', '职业规划'], ['researchSummary', '科研介绍'], ['projectSummary', '项目介绍'],
] as const;
export const sections = [
  ['basic', '基础信息', '01'], ['education', '教育经历', '02'], ['projects', '项目经历', '03'],
  ['internships', '实习经历', '04'], ['research', '科研 · 论文 · 专利', '05'],
  ['awards', '奖项与证书', '06'], ['skills', '专业技能', '07'], ['studentWork', '学生工作', '08'],
  ['answers', '常用回答', '09'], ['family', '家庭信息', '10'], ['backup', '导入与备份', '11'],
] as const;
