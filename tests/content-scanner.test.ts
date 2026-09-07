import { beforeEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';

beforeEach(() => { document.body.innerHTML = ''; });
const scan = (html: string) => { document.body.innerHTML = html; return scanDocument(document); };

describe('表单扫描与文本归属', () => {
  it('读取 label、ARIA、placeholder、附近文字和单个字段父容器', () => {
    const { result } = scan('<div><label for="name">姓名</label><input id="name" name="applicant"></div><div><span id="phone-label">手机号</span><input aria-labelledby="phone-label"></div><div>专业类别<input></div><textarea placeholder="研究方向" title="学术研究"></textarea>');
    expect(result.fields[0]).toMatchObject({ label: '姓名', htmlId: 'name', name: 'applicant', parentText: '姓名' });
    expect(result.fields[1]).toMatchObject({ ariaLabel: '手机号', previousText: '手机号' });
    expect(result.fields[2]).toMatchObject({ parentText: '专业类别' });
    expect(result.fields[3]).toMatchObject({ kind: 'textarea', placeholder: '研究方向', title: '学术研究' });
  });

  it('相邻字段和已有文本值不污染父上下文', () => {
    const { result } = scan('<form><div><label>姓名<input value="私密姓名"></label></div><div><label>手机号<input></label></div><div><textarea>私密经历</textarea></div></form>');
    expect(result.fields[1]?.parentText).toBe('手机号');
    expect(result.fields[1]?.previousText).not.toContain('姓名');
    expect(JSON.stringify(result)).not.toMatch(/私密姓名|私密经历/u);
    expect(result.fields[2]?.parentText).toBe('');
  });

  it('使用所属 fieldset 最近 legend 及表格行标签、列标题', () => {
    const { result } = scan('<fieldset><legend>本科经历</legend><fieldset><legend>硕士经历</legend><table><tr><td>学校</td><td><input></td></tr></table></fieldset></fieldset><table><tr><th>专业</th><th>学位</th></tr><tr><td><input></td><td><input></td></tr></table>');
    expect(result.fields[0]).toMatchObject({ sectionText: '硕士经历', tableHeader: '学校' });
    expect(result.fields[1]?.tableHeader).toBe('专业');
    expect(result.fields[2]?.tableHeader).toBe('学位');
  });

  it('扫描结果不保存 DOM 对象，重新扫描生成新注册表', () => {
    const state = scan('<input value="已有信息"><input type="submit">');
    expect(state.result.fields).toHaveLength(1);
    expect(state.result.fields[0]?.hasValue).toBe(true);
    expect(JSON.stringify(state.result)).not.toContain('已有信息');
    expect(scanDocument().result.scanId).not.toBe(state.result.scanId);
    expect(state.controls.size).toBe(1);
  });
});

describe('扫描安全边界', () => {
  it('仅将真实下拉答案视为已填，处理非空占位值和禁用分组', () => {
    const { result } = scan('<select><option value="-1">-- 请选择学历 --</option><option value="master">硕士研究生</option></select><select><option value="0">硕士</option></select><select><optgroup disabled><option value="x">选项</option></optgroup></select>');
    expect(result.fields[0]?.hasValue).toBe(false);
    expect(result.fields[1]?.hasValue).toBe(true);
    expect(result.fields[2]?.options[0]?.disabled).toBe(true);
  });

  it('验证码、密码、上传、隐藏、禁用、只读、radio 和 checkbox 均禁止填写', () => {
    const { result } = scan('<label>验证码<input></label><input autocomplete="one-time-code"><input type="password"><input type="file"><input type="hidden"><fieldset disabled><input></fieldset><input readonly><input type="radio"><input type="checkbox"><select multiple></select><div hidden><input></div><div style="display:none"><textarea></textarea></div><div role="combobox"><input></div>');
    expect(result.fields).toHaveLength(13);
    expect(result.fields.every((field) => Boolean(field.blockedReason))).toBe(true);
  });

  it('身份证号码是本地普通字段，不能误当作身份认证验证码', () => {
    const { result } = scan('<label>身份证号<input></label>');
    expect(result.fields[0]?.blockedReason).toBeUndefined();
  });

  it('空选项值但已有明确选择文字时仍保护现有答案', () => {
    const { result } = scan('<select><option value="">硕士</option><option value="b">本科</option></select>');
    expect(result.fields[0]?.hasValue).toBe(true);
  });
});
