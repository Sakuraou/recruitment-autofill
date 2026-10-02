import type { FieldDescriptor } from '../shared/types';
import type { RecordFieldReason } from './recordFieldReason';

/** Saved monthlySalary is a gross monthly range, with no separate currency fact. */
export function internshipSalaryProblem(field: FieldDescriptor, value: string): RecordFieldReason | undefined {
  const direct = [field.label, field.ariaLabel, field.tableHeader, field.title, field.placeholder].join(' ').normalize('NFKC');
  if (/税后|到手|净收入|年薪|日薪|时薪|每年|每天|每小时|美元|人民币|港币|欧元|英镑|日元|元|币种|货币|[$€£¥]|\b(?:net|annual|yearly|daily|hourly|currency|usd|rmb|cny|hkd|eur|gbp|yen)\b/iu.test(direct)) return 'field-unsupported';
  if (!/税前月薪|gross\s+monthly\s+salary/iu.test(direct)) return 'field-semantic-ambiguous';
  if (field.type === 'number' || !['select', 'radio'].includes(field.kind) && !/范围|区间|\brange\b/iu.test(direct)) return 'field-unsupported';
  const range = /^\s*(\d+(?:\.\d+)?)\s*[-–—~～至]\s*(\d+(?:\.\d+)?)\s*(?:\/\s*月)?\s*$/u.exec(value.normalize('NFKC'));
  if (!range || !Number.isFinite(Number(range[1])) || !Number.isFinite(Number(range[2]))
    || Number(range[1]) >= Number(range[2])) return 'profile-value-invalid';
  return undefined;
}
