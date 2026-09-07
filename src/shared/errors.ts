import { ZodError } from 'zod';

export function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return '档案格式有误：' + error.issues.slice(0, 4).map(issue =>
      `${issue.path.join('.') || '根对象'}：${issue.message}`).join('；');
  }
  if (error instanceof SyntaxError) return 'JSON 格式不正确，请检查逗号、引号和括号。';
  return error instanceof Error ? error.message : '操作未完成，请重试。';
}
