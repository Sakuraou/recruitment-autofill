import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProfile } from '../src/profile/schema';
import { scanDocument } from '../src/content/scanner';
import { matchFields } from '../src/matching/ruleMatcher';

const profile = createEmptyProfile();
profile.basic = { name: '本人测试', phone: '00000000000' };
profile.education = [{ id: 'master', level: '硕士研究生', school: '测试学校', major: '软件工程' }];
profile.education[0]!.gpa = '3.04';
describe('independent review regressions', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it.each(['加权平均分', '平均成绩', '学业成绩', 'Average score'])('does not use GPA for %s even with a misleading ID', label => {
    document.body.innerHTML = `<label>${label}<input name="gpa"></label>`;
    expect(matchFields(scanDocument().result.fields, profile)[0]).toMatchObject({ status: 'missing', value: undefined });
  });
  it.each(['姓名拼音', '学校所在城市', '专业代码', '学校地址', '联系电话区号'])('does not mistake a composite label for its substring: %s', label => {
    document.body.innerHTML = `<label>${label}<input></label>`;
    const result = matchFields(scanDocument().result.fields, profile)[0];
    expect(result?.status).not.toBe('auto');
  });
  it('uses visible select labels instead of contradictory value aliases', () => {
    document.body.innerHTML = '<label>最高学历<select><option value="">请选择</option><option value="master">硕博连读</option></select></label>';
    expect(matchFields(scanDocument().result.fields, profile)[0]?.status).not.toBe('auto');
  });
  it('preserves nearby contact ownership even with a generic associated label', () => {
    document.body.innerHTML = '<div><span>紧急联系人</span><label>姓名<input></label></div>';
    const scan = scanDocument();
    expect(scan.result.fields[0]?.previousText).toContain('紧急联系人');
    expect(matchFields(scan.result.fields, profile)[0]).toMatchObject({ status: 'blocked', value: undefined });
  });
});
