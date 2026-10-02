import { expect, it } from 'vitest';
import { SEMANTIC_BINDING_PATHS, semanticRequestSchema, parseSemanticProposal } from '../src/ai/semanticProtocol';

const educationPaths = ['education.school', 'education.college', 'education.major', 'education.majorCategory', 'education.level',
  'education.degree', 'education.startDate', 'education.endDate', 'education.studyMode', 'education.gpa', 'education.gpaScale',
  'education.ranking', 'education.researchDirection', 'education.courses', 'education.educationType', 'education.schoolProperty',
  'education.country', 'education.durationYears'];
function request() {
  return { protocol: 2, requestId: crypto.randomUUID(), allowedPaths: [...educationPaths], fields: [{ ref: 'field-0',
    fingerprint: '0123456789abcdef', kind: 'input', type: 'text', section: 'education', record: 'creating',
    label: '这一阶段在哪里学习', ariaLabel: '', tableHeader: '', title: '', placeholder: '', options: [] }] };
}
it('教育专用协议只接受固定事实目录和当前新增教育字段', () => {
  expect(semanticRequestSchema.safeParse(request()).success).toBe(true);
  expect(SEMANTIC_BINDING_PATHS.some(path => path.startsWith('education.'))).toBe(false);
});
it('原普通/项目协议和目录继续有效，不含新教育路径', () => {
  const old = request(); old.protocol = 1; old.allowedPaths = [...SEMANTIC_BINDING_PATHS]; old.fields[0]!.section = 'project';
  expect(semanticRequestSchema.safeParse(old).success).toBe(true);
});
it.each(['version', 'directory', 'order', 'index', 'highest', 'section', 'summary', 'value', 'selector'])('拒绝教育请求中的%s', mode => {
  const value = request();
  if (mode === 'version') value.protocol = 1;
  if (mode === 'directory') value.allowedPaths = [...SEMANTIC_BINDING_PATHS];
  if (mode === 'order') value.allowedPaths.reverse();
  if (mode === 'index') value.allowedPaths[0] = 'education.0.school';
  if (mode === 'highest') value.allowedPaths[0] = 'education.isHighestDegree';
  if (mode === 'section') value.fields[0]!.section = 'project';
  if (mode === 'summary') value.fields[0]!.record = 'none';
  const supplied = mode === 'value' ? { ...value, value: '虚构学校' } : mode === 'selector' ? { ...value, selector: '#school' } : value;
  expect(semanticRequestSchema.safeParse(supplied).success).toBe(false);
});
it.each(['education.school', 'education.degree', 'education.gpa'])('教育响应允许原请求目录中的%s', path => {
  const parsed = semanticRequestSchema.safeParse(request()); expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const field = parsed.data.fields[0]!;
  expect(parseSemanticProposal({ requestId: parsed.data.requestId, status: 'mapped', bindings: [{ ref: field.ref,
    fingerprint: field.fingerprint, path, certainty: 'certain', evidence: 'label' }] }, parsed.data)).toBeDefined();
});
it.each(['projects.name', 'basic.name', 'education.0.school', 'education.isHighestDegree'])('教育响应不能用%s越过当前目录', path => {
  const parsed = semanticRequestSchema.safeParse(request()); expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const field = parsed.data.fields[0]!;
  expect(parseSemanticProposal({ requestId: parsed.data.requestId, status: 'mapped', bindings: [{ ref: field.ref,
    fingerprint: field.fingerprint, path, certainty: 'certain', evidence: 'label' }] }, parsed.data)).toBeUndefined();
});
