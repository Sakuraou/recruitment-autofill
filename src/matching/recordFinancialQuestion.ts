/** These concepts are outside the award/paper/campus-position meaning catalogues.
 * Call only after explicit local labels fail: an authored abstract or duties
 * field may legitimately mention money in a placeholder or in its answer.
 */
export function recordFinancialQuestion(clues: readonly string[]): boolean {
  return clues.some(clue => /月薪|工资|薪资|薪酬|金额|币种|收入|补贴|\b(?:salary|wage|currency|compensation|income|amount)\b|\b(?:gross|net|monthly|annual)\s+pay\b/iu.test(clue));
}
