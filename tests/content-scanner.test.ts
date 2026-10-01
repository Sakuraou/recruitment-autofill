import { beforeEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';

beforeEach(() => { document.body.innerHTML = ''; });
const scan = (html: string) => { document.body.innerHTML = html; return scanDocument(document); };

describe('表单扫描与文本归属', () => {
  it('不同 Shadow 根中的同名单选题独立分组', () => {
    for (let index = 0; index < 2; index++) {
      const host = document.createElement('div');
      document.body.append(host);
      host.attachShadow({ mode: 'open' }).innerHTML = '<label>是<input type="radio" name="answer" value="yes"></label><label>否<input type="radio" name="answer" value="no"></label>';
    }
    const state = scanDocument(document);
    expect(state.result.fields).toHaveLength(2);
    for (const control of state.controls.values()) {
      expect(control.adapter).toBe('radio-group');
      if (control.adapter === 'radio-group') expect(control.members).toHaveLength(2);
    }
  });
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

  it('验证码、密码、上传、隐藏、禁用、只读和 checkbox 受保护，普通 radio 交给语义层判断', () => {
    const { result } = scan('<label>验证码<input></label><input autocomplete="one-time-code"><input type="password"><input type="file"><input type="hidden"><fieldset disabled><input></fieldset><input readonly><input type="radio"><input type="checkbox"><select multiple></select><div hidden><input></div><div style="display:none"><textarea></textarea></div><div role="combobox"><input></div>');
    expect(result.fields).toHaveLength(13);
    expect(result.fields.filter((field) => field.kind !== 'radio').every((field) => Boolean(field.blockedReason))).toBe(true);
    expect(result.fields.find((field) => field.kind === 'radio')?.blockedReason).toBeUndefined();
  });

  it('身份证号码是本地普通字段，不能误当作身份认证验证码', () => {
    const { result } = scan('<label>身份证号<input></label>');
    expect(result.fields[0]?.blockedReason).toBeUndefined();
  });

  it('空选项值但已有明确选择文字时仍保护现有答案', () => {
    const { result } = scan('<select><option value="">硕士</option><option value="b">本科</option></select>');
    expect(result.fields[0]?.hasValue).toBe(true);
  });

  it('把未显式选择的首项“无”视为站点默认值，把明确 selected 的“无”保留为已有答案', () => {
    const { result } = scan('<select><option>无</option><option>硕士学位</option></select><select><option selected>无</option><option>有</option></select>');
    expect(result.fields[0]?.hasValue).toBe(false);
    expect(result.fields[1]?.hasValue).toBe(true);
  });

  it('提取嵌套传统表格和 grid 表单项的可见字段名', () => {
    const { result } = scan('<table><tr><td><span>证件号码</span></td><td><div><input id="RecruitmentPortalPersonProfile_CertificateNumber"></div></td></tr></table><div class="form-item"><div class="field-label">出生日期</div><div class="control"><input name="RecruitmentPortalPersonProfile_Birthday"></div></div>');
    expect(result.fields[0]?.tableHeader).toBe('证件号码');
    expect(result.fields[1]?.tableHeader).toBe('出生日期');
  });

  it('允许空的只读日期文本框，同时继续阻止其他只读输入', () => {
    const { result } = scan('<label>出生日期<input readonly name="Birthday"></label><label>姓名<input readonly></label>');
    expect(result.fields[0]).toMatchObject({ readOnly: false, blockedReason: undefined });
    expect(result.fields[1]?.blockedReason).toMatch(/只读/u);
  });

  it('把同 name 的普通 radio 扫描为一个带可见选项的逻辑字段', () => {
    const { result, controls } = scan('<div><span>性别</span><label><input type="radio" name="gender" value="M">男</label><label><input type="radio" name="gender" value="F">女</label></div>');
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({ kind: 'radio', label: '性别', hasValue: false,
      options: [{ value: '__radio_option_0', label: '男', disabled: false }, { value: '__radio_option_1', label: '女', disabled: false }] });
    expect([...controls.values()][0]?.adapter).toBe('radio-group');
  });

  it('只扫描带唯一显式 listbox 绑定的 ARIA combobox', () => {
    const { result, controls } = scan('<label id="degree-label">最高学历</label><input role="combobox" aria-labelledby="degree-label" aria-controls="degree-list" aria-expanded="false"><div id="degree-list" role="listbox" hidden><div role="option">本科</div><div role="option">硕士研究生</div></div><input role="combobox" aria-label="无绑定控件">');
    const aria = result.fields.find(field => field.type === 'aria-combobox');
    expect(aria).toMatchObject({ kind: 'select', label: '最高学历', hasValue: false,
      options: [{ value: '本科', label: '本科' }, { value: '硕士研究生', label: '硕士研究生' }] });
    expect(controls.get(aria!.id)?.adapter).toBe('aria-combobox');
    expect(result.fields.find(field => field.ariaLabel === '无绑定控件')?.blockedReason).toMatch(/自定义选择器/u);
  });

  it('扫描普通 ARIA radiogroup，并阻止协议语义的单选组', () => {
    const { result, controls } = scan('<span id="gender-label">性别</span><div role="radiogroup" aria-labelledby="gender-label"><div role="radio" aria-checked="false">男</div><div role="radio" aria-checked="false">女</div></div><div role="radiogroup" aria-label="隐私协议"><div role="radio" aria-checked="false">同意</div><div role="radio" aria-checked="false">不同意</div></div>');
    const groups = result.fields.filter(field => field.kind === 'radio');
    expect(groups[0]).toMatchObject({ label: '性别', options: [{ value: '男' }, { value: '女' }] });
    expect(controls.get(groups[0]!.id)?.adapter).toBe('aria-radio-group');
    expect(groups[1]?.blockedReason).toMatch(/协议|授权/u);
  });

  it('扫描普通 ARIA checkbox，并阻止协议语义的复选框', () => {
    const { result, controls } = scan('<span id="remote-label">有远程实习经历</span><div id="remote" role="checkbox" aria-labelledby="remote-label" aria-checked="false"></div><span id="consent-label">我同意隐私协议</span><div id="consent" role="checkbox" aria-labelledby="consent-label" aria-checked="false"></div><div id="unknown" role="checkbox" aria-label="有未知经历"></div>');
    const remote = result.fields.find(field => field.htmlId === 'remote');
    const consent = result.fields.find(field => field.htmlId === 'consent');
    expect(remote).toMatchObject({ kind: 'checkbox', type: 'aria-checkbox', options: [{ value: 'true' }, { value: 'false' }] });
    expect(remote?.blockedReason).toBeUndefined();
    expect(controls.get(remote!.id)?.adapter).toBe('aria-checkbox');
    expect(consent?.blockedReason).toMatch(/协议/u);
    expect(result.fields.find(field => field.htmlId === 'unknown')?.blockedReason).toMatch(/不明确/u);
  });

  it('开放带明确事实标签的原生复选框，阻止无标签和协议复选框', () => {
    const { result } = scan('<label>是否学生干部<input id="cadre" type="checkbox"></label><label>我同意隐私协议<input id="consent" type="checkbox"></label><input id="unknown" type="checkbox">');
    expect(result.fields.find(field => field.htmlId === 'cadre')?.blockedReason).toBeUndefined();
    expect(result.fields.find(field => field.htmlId === 'cadre')?.options).toEqual([{ value: 'true', label: '是', disabled: false }, { value: 'false', label: '否', disabled: false }]);
    expect(result.fields.find(field => field.htmlId === 'consent')?.blockedReason).toMatch(/协议/u);
    expect(result.fields.find(field => field.htmlId === 'unknown')?.blockedReason).toMatch(/标签/u);
  });

  it('扫描同源 iframe 与开放 Shadow DOM', () => {
    document.body.innerHTML = '<iframe></iframe><div id="host"></div>';
    const frame = document.querySelector('iframe')!;
    frame.contentDocument!.body.innerHTML = '<label>邮箱<input></label>';
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<label>手机号<input></label>';
    const { result } = scanDocument(document);
    expect(result.fields.map((field) => field.label)).toEqual(expect.arrayContaining(['邮箱', '手机号']));
    expect(result.warnings.join(' ')).toMatch(/同源 iframe.*开放 Shadow DOM/u);
  });
});
