/** Adapter for the public job.10086.cn campus resume templates (verified 2026-09-07). */
const knownPrompts = new Set([
  '请输入所在学校', '请输入奖项类别', '请输入奖励名称', '请输入姓名', '请输入年龄', '请输入英文名',
  '请选择出生地', '输入证件号码', '字数控制在100个字以内', '请输入身高（CM）', '请输入体重（KG）',
  '请选择生源地', '请选择现居住城市', '户口所在地', '籍贯', '请输入亲属姓名', '输入所在公司部门和职务的名称',
  '输入毕业院校名称', '请输入工作经验', '输入内推码', '50字以内', '请输入技能类别', '请输入手机号码',
  '请输入电子邮箱', '请输入通信地址', '请输入紧急联系人姓名', '请输入紧急联系人电话', '输入学校名称',
  '请输入院系', '请输入专业名称', '请输入研究方向', '请输入专业课程', '请输入专业描述', '请输入亲属工作单位',
  '请输入亲属职位', '请输入亲属所在部门', '请输入联系电话', '现居住地址', '分', '请输入分数等级', '请输入得分',
  '请输入证书名称', '请输入分数', '输入工作单位名称', '请输入企业规模', '请输入所在部门', '请输入职务名称',
  '请输入证明人姓名', '请输入证明人关系', '请输入证明人职务', '请输入证明人单位', '请输入证明人联系方式',
  '请输入活动/实践名称', '请输入活动/实践类型', '输入项目名称', '请输入所在公司名称', '请输入职务',
  '请输入组织团体名称', '请输入担任职务', '请输入干部级别', '请输入职责和成就', '请输入自定义标题',
  '请输入技能名称', '请输入论著名称', '请输入成就/等级', '请输入内容',
  '字数控制在500个字以内', '字数控制在500个汉字以内', '毕业论文请从题目、主题、研究方向等方面描述（500字以内）',
]);
export function isMobileResume(doc: Document): boolean {
  const url = new URL(doc.URL);
  return url.hostname === 'job.10086.cn' && url.pathname === '/personal/resume_campus.html';
}

export function mobileSection(node: Element): string {
  if (!isMobileResume(node.ownerDocument)) return '';
  return node.closest('.resumeCon1 .secon')?.querySelector(':scope > h3.secH > .lf')?.textContent?.trim() ?? '';
}

export function mobileLabel(node: Element): string {
  if (!isMobileResume(node.ownerDocument) || !node.closest('.resumeCon1 .secon')) return '';
  const labels: Record<string, string> = { sltId: '证件类型', certificateNo: '证件号码' };
  if (node.closest('#baseInfo') && labels[node.id]) return labels[node.id]!;
  const dl = node.closest('dl');
  // One definition-list field can contain a select plus its text input (e.g. ID type).
  return dl?.querySelector(':scope > dt')?.textContent?.replace(/\*/gu, '').trim() ?? '';
}

/** Do not globally treat arbitrary default values or text starting with 请 as empty. */
export function mobilePlaceholder(node: HTMLInputElement | HTMLTextAreaElement): string {
  if (!isMobileResume(node.ownerDocument) || !node.matches('.inputxt, textarea.textareaWork')
    || !node.closest('.resumeCon1 .secon')) return '';
  const value = node.defaultValue;
  if (node.value !== value) return '';
  return knownPrompts.has(value) ? value : '';
}

/** The site's save validators enforce some limits that are absent from maxlength. */
export function mobileMaxLength(node: Element): number | undefined {
  if (!isMobileResume(node.ownerDocument) || !node.closest('.resumeCon1 .secon')) return undefined;
  const section = node.closest('.secon')?.id ?? '';
  const limits: Record<string, Record<string, number>> = {
    educationInfo: { educationSchool: 100, college1: 50, college2: 50, specialty1: 50, specialty2: 50,
      researchArea1: 100, researchArea2: 100, course1: 100, course2: 100, specialty1Desc: 100, specialty2Desc: 100 },
    projectInfo: { projectName: 100, projectCompany: 50, projectJob: 50, projectDuty: 500, projectDesc: 500, projectArchievement: 500 },
    contactsInfo: { phone: 20, email: 50, address: 100, emergencyContactPerson: 30, emergencyContactMobile: 20 },
  };
  return limits[section]?.[node.id];
}
