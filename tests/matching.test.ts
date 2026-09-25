import { describe, expect, it } from 'vitest';
import { createEmptyProfile, type UserProfile } from '../src/profile/schema';
import { matchField, matchFields } from '../src/matching/ruleMatcher';
import type { FieldDescriptor } from '../src/shared/types';

function field(label: string, overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { id: `f-${label}`, kind: 'input', type: 'text', label, placeholder: '', name: '', htmlId: '',
    ariaLabel: '', title: '', parentText: '', previousText: '', tableHeader: '', sectionText: '', options: [],
    maxLength: null, required: false, hasValue: false, disabled: false, readOnly: false, ...overrides };
}

function profile(): UserProfile {
  const value = createEmptyProfile();
  value.basic = { name: '测试申请人', phone: '00000000000', email: 'student@example.invalid', birthday: '2000-02-03',
    gender: '男', idNumber: 'TEST-ID-NOT-VALID', address: '示例市示例路 1 号', nativePlace: '示例省', sourcePlace: '示例市' };
  value.education = [
    { id: 'bachelor', level: '本科', school: '示例理工大学', major: '计算机科学与技术', degree: '工学学士', startDate: '2019-09', endDate: '2023-06' },
    { id: 'master', level: '硕士研究生', school: '示例科技大学', college: '计算机学院', major: '软件工程', degree: '电子信息硕士',
      startDate: '2024-09', endDate: '2027-06', gpa: '3.8', researchDirection: '计算机视觉', courses: '机器学习；软件体系结构' },
  ];
  value.skills = { programmingLanguages: ['TypeScript', 'Python'], frameworks: ['React'], tools: ['Git'], other: [] };
  value.commonAnswers.selfEvaluation = { short: '短版原文。', medium: '这是较完整的自我评价原文。', long: '这是用户保存的最长版本自我评价原文，保留所有事实。', byLimit: { '10': '十字版原文。' } };
  return value;
}

describe('local rule and Chinese alias matcher', () => {
  it.each([
    ['姓名', 'basic.name', '测试申请人'], ['真实姓名', 'basic.name', '测试申请人'],
    ['Applicant Name', 'basic.name', '测试申请人'], ['手机号', 'basic.phone', '00000000000'],
    ['联系电话（手机）', 'basic.phone', '00000000000'], ['Mobile', 'basic.phone', '00000000000'],
    ['电子邮箱', 'basic.email', 'student@example.invalid'], ['E-mail', 'basic.email', 'student@example.invalid'],
    ['出生日期', 'basic.birthday', '2000-02-03'], ['籍贯', 'basic.nativePlace', '示例省'],
    ['生源地', 'basic.sourcePlace', '示例市'], ['家庭住址', 'basic.address', '示例市示例路 1 号'],
  ])('%s uses actual %s', (label, key, expected) => {
    expect(matchField(field(label), profile())).toMatchObject({ status: 'auto', matchedProfileKey: key, value: expected });
  });

  it.each(['姓名', '手机号', '邮箱', '出生日期', '身份证号', '家庭地址'])('%s is marked sensitive', (label) => {
    expect(matchField(field(label), profile()).sensitive).toBe(true);
  });

  it('reads labels before broad nearby text or generic IDs', () => {
    const result = matchField(field('电子邮箱', { name: 'name', parentText: '姓名 手机 电子邮箱 家庭成员 政治面貌' }), profile());
    expect(result).toMatchObject({ status: 'auto', matchedProfileKey: 'basic.email' });
  });

  it('ranks an exact visible row label above a conflicting framework resource key', () => {
    expect(matchField(field('RecruitmentPortalPersonProfile_CertificateNumber', {
      tableHeader: '证件号码', name: 'RecruitmentPortalPersonProfile_CertificateNumber',
    }), profile())).toMatchObject({ status: 'auto', matchedProfileKey: 'basic.idNumber', value: 'TEST-ID-NOT-VALID' });
  });

  it('never substitutes a professional certificate number for a missing identity number', () => {
    const data = profile();
    delete data.basic.idNumber;
    data.certificates = [{ id: 'cert', name: '测试证书', number: 'CERT-DO-NOT-USE' }];
    expect(matchField(field('RecruitmentPortalPersonProfile_CertificateNumber', {
      tableHeader: '证件号码', name: 'RecruitmentPortalPersonProfile_CertificateNumber',
    }), data)).toMatchObject({ status: 'missing', matchedProfileKey: 'basic.idNumber', value: undefined });
  });

  it('tokenizes a camel-case profile resource key when no visible label is available', () => {
    expect(matchField(field('', { name: 'RecruitmentPortalPersonProfile_Birthday' }), profile()))
      .toMatchObject({ status: 'auto', matchedProfileKey: 'basic.birthday', value: '2000-02-03', confidence: 0.94 });
  });

  it.each([
    { ariaLabel: '姓名' }, { placeholder: '请填写手机号码' }, { title: '邮箱' },
    { tableHeader: '姓名' }, { previousText: '姓名' }, { parentText: '姓名' }, { name: 'applicantName' },
  ])('supports associated context %j', (overrides) => {
    expect(matchField(field('', overrides), profile()).status).toBe('auto');
  });

  it('does not use a broad, mixed parent container as high-confidence evidence', () => {
    expect(matchField(field('', { parentText: '姓名 手机号码 电子邮箱 籍贯' }), profile()).status).toBe('review');
  });

  it('does not confuse English substrings with full field names', () => {
    expect(matchField(field('Username'), profile()).status).toBe('missing');
  });

  it('returns missing for unknown facts and unrecognized fields', () => {
    expect(matchField(field('政治面貌'), profile())).toMatchObject({ status: 'missing', value: undefined });
    expect(matchField(field('未定义问题'), profile())).toMatchObject({ status: 'missing', value: undefined });
    expect(matchField(field('论文', { kind: 'textarea' }), profile())).toMatchObject({ status: 'missing', value: undefined });
    expect(matchField(field('获奖情况'), profile())).toMatchObject({ status: 'missing', value: undefined });
  });
});

describe('education and list ownership', () => {
  it.each([
    ['本科院校', 'education.0.school', '示例理工大学'], ['硕士院校', 'education.1.school', '示例科技大学'],
    ['研究生专业', 'education.1.major', '软件工程'], ['最高学历', 'education.1.level', '硕士研究生'],
    ['最高学历专业', 'education.1.major', '软件工程'],
    ['最高学位', 'education.1.degree', '电子信息硕士'], ['硕士学院', 'education.1.college', '计算机学院'],
    ['硕士入学时间', 'education.1.startDate', '2024-09'], ['硕士毕业时间', 'education.1.endDate', '2027-06'],
    ['硕士GPA', 'education.1.gpa', '3.8'], ['硕士研究方向', 'education.1.researchDirection', '计算机视觉'],
    ['硕士主修课程', 'education.1.courses', '机器学习；软件体系结构'],
  ])('%s resolves to %s', (label, key, expected) => {
    expect(matchField(field(label), profile())).toMatchObject({ status: 'auto', matchedProfileKey: key, value: expected });
  });

  it('uses a section title for generic education labels', () => {
    expect(matchField(field('学校', { sectionText: '本科教育经历' }), profile())).toMatchObject({ status: 'auto', value: '示例理工大学' });
    expect(matchField(field('开始时间', { sectionText: '硕士教育经历' }), profile())).toMatchObject({ status: 'auto', value: '2024-09' });
  });

  it('prioritizes direct educational stage over a different surrounding stage', () => {
    expect(matchField(field('本科院校', { sectionText: '硕士教育经历' }), profile())).toMatchObject({ status: 'auto', value: '示例理工大学' });
  });

  it('does not default to the first education record', () => {
    expect(matchField(field('学校'), profile())).toMatchObject({ status: 'review', value: undefined });
    expect(matchField(field('专业'), profile())).toMatchObject({ status: 'review', value: undefined });
  });

  it('uses a shared value across every education record without asking which record', () => {
    const data = profile();
    data.education[0]!.studyMode = '全日制';
    data.education[1]!.studyMode = '全日制';
    expect(matchField(field('', { name: 'RecruitmentPortalPersonProfile_EducationStudyMode' }), data))
      .toMatchObject({ status: 'auto', matchedProfileKey: 'education.*.studyMode', value: '全日制' });
  });

  it('uses the highest education for flat personal-profile education summary fields', () => {
    const data = profile();
    data.education[0]!.ranking = '前30%';
    data.education[1]!.ranking = '前80%';
    expect(matchField(field('', { name: 'RecruitmentPortalPersonProfile_ProfessionalRanking' }), data))
      .toMatchObject({ status: 'auto', matchedProfileKey: 'education.1.ranking', value: '前80%' });
    expect(matchField(field('', { name: 'RecruitmentPortalPersonProfile_MajorCourse' }), data))
      .toMatchObject({ status: 'auto', matchedProfileKey: 'education.1.courses', value: '机器学习；软件体系结构' });
  });

  it('does not default to the first record within the same education stage', () => {
    const data = profile();
    data.education.push({ id: 'master-2', level: '硕士研究生', school: '第二示例大学', degree: '工学硕士' });
    expect(matchField(field('硕士院校'), data)).toMatchObject({ status: 'review', value: undefined });
    expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'review', value: undefined });
    expect(matchField(field('最高学历'), data)).toMatchObject({ status: 'auto', value: '硕士研究生' });
  });

  it('does not infer a missing degree from education level', () => {
    const data = profile();
    delete data.education[1]!.degree;
    expect(matchField(field('最高学位'), data)).toMatchObject({ status: 'missing', value: undefined });
    expect(matchField(field('最高学历'), data)).toMatchObject({ status: 'auto', value: '硕士研究生' });
  });

  it('requires review for a combined education/degree field', () => {
    expect(matchField(field('学历学位'), profile())).toMatchObject({ status: 'review', value: undefined });
  });

  it('does not fill an unavailable education stage from other stages', () => {
    expect(matchField(field('博士院校'), profile())).toMatchObject({ status: 'missing', value: undefined });
  });

  it('cannot disambiguate graduate school between masters and doctorate', () => {
    const data = profile();
    data.education.push({ id: 'doctor', level: '博士研究生', school: '示例研究大学' });
    expect(matchField(field('研究生院校'), data)).toMatchObject({ status: 'review', value: undefined });
  });

  it('does not auto-fill the same school into multiple repeated fields', () => {
    const results = matchFields([field('硕士院校', { id: 's1' }), field('硕士院校', { id: 's2' })], profile());
    expect(results.map((result) => result.status)).toEqual(['review', 'review']);
  });

  it('uses the global research direction when there are no educational records', () => {
    const data = createEmptyProfile();
    data.research.researchDirection = '图像分割';
    expect(matchField(field('研究方向'), data)).toMatchObject({ status: 'auto', value: '图像分割', matchedProfileKey: 'research.researchDirection' });
  });

  it('suggests software-engineering major category at 0.78 with the true source key', () => {
    expect(matchField(field('硕士专业类别'), profile())).toMatchObject({ status: 'review', confidence: 0.78,
      value: '计算机类', source: 'fuzzy', matchedProfileKey: 'education.1.major' });
  });

  it('uses an explicitly saved major category without inference', () => {
    const data = profile();
    data.education[1]!.majorCategory = '电子信息类';
    expect(matchField(field('硕士专业类别'), data)).toMatchObject({ status: 'auto', value: '电子信息类', matchedProfileKey: 'education.1.majorCategory' });
  });

  it('uses unique project records and does not duplicate them automatically', () => {
    const data = profile();
    data.projects = [{ id: 'p1', name: '真实项目甲', role: '开发成员', description: '开发了原型', technologies: ['TypeScript'] }];
    expect(matchField(field('项目名称'), data)).toMatchObject({ status: 'auto', value: '真实项目甲' });
    expect(matchFields([field('项目名称', { id: 'a' }), field('项目名称', { id: 'b' })], data).every((result) => result.status === 'review')).toBe(true);
    data.projects.push({ id: 'p2', name: '真实项目乙', description: '分析了数据', technologies: [] });
    expect(matchField(field('项目名称'), data)).toMatchObject({ status: 'review', value: undefined });
    expect(matchField(field('项目描述', { sectionText: '真实项目乙' }), data)).toMatchObject({ status: 'auto', value: '分析了数据' });
  });

  it('resolves generic labels only within an owning experience section', () => {
    const data = profile();
    data.internships = [{ id: 'i', organization: '示例公司', role: '研发实习生', department: '技术部' }];
    data.studentWork = [{ id: 's', organization: '示例社团', role: '成员' }];
    expect(matchField(field('职务'), data).status).toBe('missing');
    expect(matchField(field('职务', { sectionText: '实习经历' }), data)).toMatchObject({ status: 'auto', value: '研发实习生' });
    expect(matchField(field('部门', { sectionText: '实习经历' }), data)).toMatchObject({ status: 'auto', value: '技术部' });
    expect(matchField(field('职务', { sectionText: '学生工作' }), data)).toMatchObject({ status: 'auto', value: '成员' });
  });

  it('reads explicit awards and certificates only', () => {
    const data = profile();
    data.awards = [{ id: 'a', name: '真实奖项', level: '校级' }];
    data.certificates = [{ id: 'c', name: '真实证书', number: 'CERT-001', score: '500' }];
    expect(matchField(field('奖项名称'), data)).toMatchObject({ status: 'auto', value: '真实奖项' });
    expect(matchField(field('证书编号'), data)).toMatchObject({ status: 'auto', value: 'CERT-001', sensitive: true });
  });
});

describe('native select and candidate confirmation', () => {
  function selection(label: string, options: string[]) {
    return field(label, { kind: 'select', options: options.map((text, index) => ({ label: text, value: `option-${index}`, disabled: false })) });
  }

  it('uses unique exact label matches and returns the actual option value', () => {
    expect(matchField(selection('最高学历', ['本科', '硕士研究生']), profile())).toMatchObject({ status: 'auto', value: 'option-1' });
  });

  it.each(['硕士', 'Master'])('uses the unambiguous masters alias %s at 0.95', (label) => {
    expect(matchField(selection('最高学历', ['本科', label]), profile())).toMatchObject({ status: 'auto', value: 'option-1', confidence: 0.95, source: 'alias' });
  });

  it('never automatically chooses the ambiguous standalone graduate option', () => {
    expect(matchField(selection('最高学历', ['本科', '研究生']), profile())).toMatchObject({ status: 'review', value: 'option-1', source: 'fuzzy', confidence: 0.78 });
  });

  it('does not pick the first of duplicate labels', () => {
    expect(matchField(selection('最高学历', ['硕士研究生', '硕士研究生']), profile())).toMatchObject({ status: 'review', value: undefined });
  });

  it('does not pick the first of multiple equivalent aliases', () => {
    expect(matchField(selection('最高学历', ['硕士', 'Master']), profile())).toMatchObject({ status: 'review', value: undefined });
  });

  it('excludes disabled options', () => {
    const target = selection('最高学历', ['本科', '硕士研究生']);
    target.options[1]!.disabled = true;
    expect(matchField(target, profile())).toMatchObject({ status: 'review', value: undefined });
  });

  it('does not auto-fill a category suggestion despite an exact option', () => {
    expect(matchField(selection('硕士专业类别', ['计算机类', '电子信息类', '其他']), profile())).toMatchObject({ status: 'review', value: 'option-0', confidence: 0.78, source: 'fuzzy' });
  });

  it('does not match arbitrary numeric option values to text', () => {
    const data = profile();
    data.basic.gender = '1';
    expect(matchField(field('性别', { kind: 'radio', options: [{ label: '男', value: '1', disabled: false }] }), data)).toMatchObject({ status: 'review', value: undefined });
  });

  it('uses visible labels even if the option value looks like a conflicting alias', () => {
    expect(matchField(field('性别', { kind: 'radio', options: [{ label: '女', value: 'male', disabled: false }] }), profile()))
      .toMatchObject({ status: 'review', value: undefined });
  });
});

describe('text variants and original facts', () => {
  it('selects the fullest saved original within maxlength', () => {
    const data = profile();
    const result = matchField(field('自我评价', { kind: 'textarea', maxLength: 15 }), data);
    expect(result).toMatchObject({ status: 'auto', value: data.commonAnswers.selfEvaluation!.medium, matchedProfileKey: 'commonAnswers.selfEvaluation.medium' });
  });

  it('reads character limits from the question and respects the stricter limit', () => {
    const data = profile();
    const result = matchField(field('请填写自我评价，10字以内', { kind: 'textarea', maxLength: 200 }), data);
    expect(result).toMatchObject({ status: 'auto', value: '十字版原文。', matchedProfileKey: 'commonAnswers.selfEvaluation.byLimit.10' });
  });

  it('does not trust byLimit keys without checking actual text length', () => {
    const data = profile();
    data.commonAnswers.careerPlan = { byLimit: { '5': '这段原文显然超过五个字' } };
    expect(matchField(field('职业规划', { kind: 'textarea', maxLength: 5 }), data)).toMatchObject({ status: 'review', value: undefined });
  });

  it('does not truncate when all versions exceed a limit', () => {
    expect(matchField(field('自我评价', { kind: 'textarea', maxLength: 2 }), profile())).toMatchObject({ status: 'review', value: undefined });
  });

  it('does not truncate scalar facts either', () => {
    expect(matchField(field('姓名', { maxLength: 2 }), profile())).toMatchObject({ status: 'review', value: undefined });
  });

  it('handles absent answers as missing', () => {
    expect(matchField(field('职业规划', { kind: 'textarea' }), profile())).toMatchObject({ status: 'missing', value: undefined });
  });

  it('aggregates only explicitly recorded skills', () => {
    expect(matchField(field('专业技能', { kind: 'textarea' }), profile())).toMatchObject({ status: 'auto', value: 'TypeScript；Python；React；Git' });
  });

  it('aggregates every saved award, paper, patent and social activity for flat textareas', () => {
    const data = profile();
    data.awards = [
      { id: 'a1', name: '校二等奖学金', level: '校级', date: '2023-11' },
      { id: 'a2', name: '程序设计竞赛二等奖', level: '省级', date: '2022-06' },
    ];
    data.research.papers = [
      { id: 'p1', title: '论文甲', venue: '期刊甲', status: '已发表' },
      { id: 'p2', title: '论文乙', venue: '会议乙', status: '在投' },
    ];
    data.research.patents = [{ id: 't1', title: '专利甲', number: 'CN-TEST', status: '已受理' }];
    data.studentWork = [
      { id: 's1', organization: '就业办', role: '助理', description: '协助整理就业材料。' },
      { id: 's2', organization: '学院', role: '辅导员助理', description: '协助新生事务。' },
    ];
    expect(matchField(field('获得荣誉', { kind: 'textarea' }), data).value).toContain('校二等奖学金');
    expect(matchField(field('获得荣誉', { kind: 'textarea' }), data).value).toContain('程序设计竞赛二等奖');
    expect(matchField(field('学术专著', { kind: 'textarea' }), data)).toMatchObject({ status: 'auto', matchedProfileKey: 'research.papers' });
    expect(matchField(field('专利成果', { kind: 'textarea' }), data)).toMatchObject({ status: 'auto', matchedProfileKey: 'research.patents' });
    const social = matchField(field('社会活动', { kind: 'textarea' }), data);
    expect(social).toMatchObject({ status: 'auto', matchedProfileKey: 'studentWork' });
    expect(social.value).toContain('就业办');
    expect(social.value).toContain('学院');
  });

  it('does not invent a day when only month precision is stored', () => {
    expect(matchField(field('硕士入学时间', { type: 'date' }), profile())).toMatchObject({ status: 'review', value: undefined });
    expect(matchField(field('出生日期', { type: 'month' }), profile())).toMatchObject({ status: 'auto', value: '2000-02' });
  });

  it('summarizes actual paper fields deterministically with no invented metadata', () => {
    const data = profile();
    data.research.papers = [{ id: 'paper', title: '真实论文标题', status: '投稿中' }];
    const result = matchField(field('论文', { kind: 'textarea' }), data);
    expect(result).toMatchObject({ status: 'auto', value: '真实论文标题（投稿中）' });
    expect(result.value).not.toContain('发表');
  });
});

describe('gates before matching', () => {
  it.each(['短信验证码', '邮箱验证码', '手机验证码', '一次性密码', '验证码', '同意隐私协议'])('blocks %s', (label) => {
    expect(matchField(field(label), profile())).toMatchObject({ status: 'blocked', value: undefined });
  });

  it.each(['紧急联系人姓名', '紧急联系人手机', '推荐人邮箱', '父亲姓名', '母亲手机号', '家庭成员姓名'])('does not substitute applicant facts into %s', (label) => {
    expect(matchField(field(label), profile())).toMatchObject({ status: 'blocked', value: undefined, sensitive: true });
  });

  it('blocks generic identity labels inside family sections', () => {
    expect(matchField(field('姓名', { sectionText: '家庭成员' }), profile())).toMatchObject({ status: 'blocked', value: undefined });
    expect(matchField(field('手机', { sectionText: '紧急联系人' }), profile())).toMatchObject({ status: 'blocked', value: undefined });
  });

  it('does not infer applicant ownership inside a company section', () => {
    expect(matchField(field('电话', { sectionText: '实习公司' }), profile()).status).not.toBe('auto');
    expect(matchField(field('联系电话', { sectionText: '实习公司' }), profile())).toMatchObject({ status: 'review', value: undefined });
  });

  it('preserves existing field content', () => {
    expect(matchField(field('姓名', { hasValue: true }), profile())).toMatchObject({ status: 'existing', value: undefined });
  });

  it.each([{ disabled: true }, { readOnly: true }, { blockedReason: '身份认证请手动完成' }])('honors scanner gates %j', (override) => {
    expect(matchField(field('姓名', override), profile())).toMatchObject({ status: 'blocked', value: undefined });
  });

  it.each(['password', 'file', 'hidden', 'submit'])('does not handle %s controls', (type) => {
    expect(matchField(field('姓名', { type }), profile())).toMatchObject({ status: 'blocked', value: undefined });
  });
});
