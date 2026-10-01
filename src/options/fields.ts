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
  { key: 'englishName', label: '英文姓名', hint: '填写实际使用的完整英文姓名；不自动转拼音或拆分名和姓' },
  { key: 'healthStatus', label: '健康状况' }, { key: 'maritalStatus', label: '婚姻状况' },
  { key: 'heightCm', label: '身高（厘米）' }, { key: 'weightKg', label: '体重（千克）' },
  { key: 'birthday', label: '出生日期', kind: 'date' },
  { key: 'phone', label: '手机号' }, { key: 'email', label: '邮箱' },
  { key: 'idType', label: '证件类型' }, { key: 'idNumber', label: '证件号码', kind: 'secret' },
  { key: 'nationality', label: '国籍' }, { key: 'ethnicity', label: '民族' },
  { key: 'politicalStatus', label: '政治面貌' }, { key: 'nativePlace', label: '籍贯' },
  { key: 'sourcePlace', label: '生源地' }, { key: 'hometown', label: '家乡' },
  { key: 'householdLocation', label: '户籍所在地' }, { key: 'address', label: '通讯地址' },
  { key: 'postalCode', label: '邮政编码' },
  { key: 'interests', label: '兴趣爱好', kind: 'textarea' },
  { key: 'studentCadre', label: '是否学生干部', kind: 'select', options: ['是', '否'] },
  { key: 'studentCadreDescription', label: '学生干部描述', kind: 'textarea' },
];
const dates: EditorField[] = [
  { key: 'startDate', label: '开始时间', kind: 'date' }, { key: 'endDate', label: '结束时间', kind: 'date' },
];
const experience: EditorField[] = [
  { key: 'organization', label: '单位 / 组织' }, { key: 'department', label: '部门' },
  { key: 'role', label: '职务' }, ...dates,
  { key: 'description', label: '工作内容', kind: 'textarea' }, { key: 'achievements', label: '实际成果', kind: 'textarea' },
  { key: 'shortDuties', label: '校内职务职责与成就（50字内）' }, { key: 'cadreLevel', label: '干部级别（如适用）' },
  { key: 'experienceType', label: '活动经历类型', kind: 'select', options: ['实习经历', '校内经历', '社会实践'] },
  { key: 'workType', label: '工作类型', kind: 'select', options: ['实习', '全职', '兼职'] },
  { key: 'companyProperty', label: '企业性质' }, { key: 'monthlySalary', label: '税前月薪范围', hint: '使用网站选项，例如1000-2000/月；未知时留空' },
  { key: 'hasProof', label: '是否有证明', kind: 'select', options: ['是', '否'] },
  { key: 'certifierName', label: '证明人姓名' }, { key: 'certifierRelation', label: '与证明人关系' },
  { key: 'certifierDuty', label: '证明人职务' }, { key: 'certifierCompany', label: '证明人单位' }, { key: 'certifierContact', label: '证明人电话', kind: 'secret' },
];
export const collections: Record<string, CollectionSpec> = {
  education: { path: 'education', title: '教育经历', fields: [
    { key: 'level', label: '学历', kind: 'select', options: ['专科', '本科', '硕士研究生', '博士研究生', '其他'] },
    { key: 'degree', label: '学位', hint: '例如工学学士、工程硕士，以实际证书为准' },
    { key: 'school', label: '院校名称' }, { key: 'college', label: '学院' },
    { key: 'major', label: '专业名称' }, { key: 'majorCategory', label: '专业类别', hint: '不确定时留空，不根据专业名自动确定' },
    ...dates, { key: 'studyMode', label: '学习形式' }, { key: 'gpa', label: 'GPA / 成绩' },
    { key: 'educationType', label: '教育类型', hint: '例如统招、非定向，按真实资料填写' },
    { key: 'schoolProperty', label: '院校性质', hint: '例如211、985、国内普通院校' },
    { key: 'country', label: '院校所属国家/地区' }, { key: 'durationYears', label: '学制（年）' },
    { key: 'gpaScale', label: 'GPA 满分' }, { key: 'ranking', label: '成绩排名' },
    { key: 'researchDirection', label: '研究方向', kind: 'textarea' }, { key: 'courses', label: '主修课程', kind: 'textarea' },
  ] },
  projects: { path: 'projects', title: '项目经历', defaults: { technologies: [] }, fields: [
    { key: 'name', label: '项目名称' }, { key: 'organization', label: '项目所在单位', hint: '学校、公司或个人项目，按实际所属填写' }, { key: 'role', label: '承担角色' }, ...dates,
    { key: 'url', label: '项目作品 / 仓库链接', hint: '完整 http/https 地址，仅用于这一个项目，不用个人主页代替' },
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
    { key: 'shortTitle', label: '网申论文简称（50字内）' }, { key: 'abstract', label: '网申内容摘要（50字内）' },
    { key: 'authorOrder', label: '实际作者排序', kind: 'select', options: ['第一作者', '第二作者', '其他'] },
    { key: 'publicationSituation', label: '发表情况（50字内）' }, { key: 'coauthors', label: '合独著说明（50字内）' },
  ] },
  patents: { path: 'research.patents', title: '专利', fields: [
    { key: 'title', label: '专利名称' }, { key: 'number', label: '申请 / 授权号' },
    { key: 'status', label: '当前状态' }, { key: 'date', label: '时间', kind: 'date' },
    { key: 'inventors', label: '发明人及顺序' },
  ] },
  awards: { path: 'awards', title: '获奖情况', fields: [
    { key: 'name', label: '奖项名称' }, { key: 'level', label: '级别' },
    { key: 'shortName', label: '网申用奖项简称', hint: '中国移动奖励名称最多50字；留空时使用完整名称' },
    { key: 'school', label: '获奖时所在学校' }, { key: 'category', label: '奖项类别' },
    { key: 'scholarshipLevel', label: '奖学金等级', hint: '仅奖学金填写，例如二等奖' },
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
  ['preferences', '求职意向与作品', '12'],
  ['ai', 'AI 识别连接', '13'],
] as const;
