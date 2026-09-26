import { describe, expect, it } from 'vitest';
import { classifySection, type SectionLabelCandidate } from '../src/content/semantic/sectionClassifier';

const heading = (text: string): SectionLabelCandidate[] => [{ text, evidence: 'heading' }];

describe('semantic section classification', () => {
  it.each([
    ['基础信息', 'basic'],
    ['投递意向', 'job-intent'],
    ['三、教育经历（必填）', 'education'],
    ['校内职务', 'student-work'],
    ['实习及工作经历', 'internship'],
    ['项目经历', 'project'],
    ['在校奖励活动', 'award'],
    ['专业论著', 'publication'],
    ['语言证书', 'language'],
    ['计算机技能', 'skill'],
    ['家庭成员', 'family'],
  ] as const)('classifies Chinese heading %s as %s', (text, role) => {
    expect(classifySection(heading(text))).toMatchObject({ role, confidence: 0.95, evidence: ['heading'] });
  });

  it.each([
    ['Personal Information', 'basic'],
    ['Job Preferences', 'job-intent'],
    ['Educational Background', 'education'],
    ['Student Leadership', 'student-work'],
    ['Work Experience', 'internship'],
    ['PROJECT EXPERIENCE', 'project'],
    ['Honors and Awards', 'award'],
    ['Research Publications', 'publication'],
    ['Language Proficiency', 'language'],
    ['Technical Skills', 'skill'],
    ['Family Information', 'family'],
  ] as const)('classifies English heading %s as %s', (text, role) => {
    expect(classifySection(heading(text))).toMatchObject({ role, confidence: 0.95, evidence: ['heading'] });
  });

  it.each([
    '是否有项目经历',
    '暂无教育经历',
    '请填写教育经历',
    '添加实习经历',
    '项目名称',
    '基于深度学习的红外小目标检测方法研究',
    '亚信科技实习生',
    '新生助理辅导员',
    'Do you have work experience?',
    'Please enter education',
    'Add Project Experience',
    '',
  ])('does not treat prompt, action or personal title %s as a section', (text) => {
    expect(classifySection(heading(text))).toEqual({ role: 'other', confidence: 0, evidence: [] });
  });

  it('combines agreeing sources without exposing their text', () => {
    const result = classifySection([
      { text: '项目经历', evidence: 'legend' },
      { text: 'Project Experience', evidence: 'heading' },
      { text: 'Projects', evidence: 'aria-name' },
    ]);
    expect(result).toEqual({ role: 'project', confidence: 1, evidence: ['legend', 'heading', 'aria-name'] });
    expect(JSON.stringify(result)).not.toContain('项目经历');
    expect(JSON.stringify(result)).not.toContain('Project Experience');
  });

  it('prefers a materially stronger legend over a conflicting aria name', () => {
    expect(classifySection([
      { text: '教育经历', evidence: 'legend' },
      { text: 'Projects', evidence: 'aria-name' },
    ])).toMatchObject({ role: 'education', confidence: 0.98, evidence: ['legend'] });
  });

  it('falls back to other when similarly strong candidates conflict', () => {
    expect(classifySection([
      { text: '教育经历', evidence: 'heading' },
      { text: '项目经历', evidence: 'heading' },
    ])).toEqual({ role: 'other', confidence: 0, evidence: [] });
  });
});
