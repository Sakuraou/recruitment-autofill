// @vitest-environment-options {"url":"https://job.10086.cn/personal/resume_campus.html?isComplete=no"}
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { fillScan } from '../src/content/autofill';
import { matchFields } from '../src/matching/ruleMatcher';
import { createEmptyProfile } from '../src/profile/schema';
import { effectiveMaxLength } from '../src/matching/profileResolver';
import { matchOption } from '../src/matching/optionMatcher';

const fixture = readFileSync('tests/fixtures/mobile-resume.html', 'utf8');
const profile = createEmptyProfile();
profile.basic = { name: '测试同学', phone: '00000000000', email: 'test@example.invalid', address: '虚构测试地址', ethnicity: '汉族', politicalStatus: '共青团员', idType: '居民身份证', idNumber: 'TEST-ID', birthday: '2000-02-29' };
beforeEach(() => { vi.restoreAllMocks(); document.documentElement.innerHTML = fixture; });
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
function plan() { const state = scanDocument(); return { state, matches: matchFields(state.result.fields, profile) }; }
function fillById(id: string, value: string, state = scanDocument()) {
  const field = state.result.fields.find(item => item.htmlId === id)!;
  return fillScan(state, { scanId: state.result.scanId, items: [{ fieldId: field.id, value, confirmed: true }] });
}

describe('中国移动网站回归', () => {
  it('恢复默认提示语、dt 标签和所属区域识别，普通字段可以匹配', () => {
    const { state, matches } = plan();
    for (const id of ['name', 'phone', 'email', 'address']) {
      const field = state.result.fields.find(item => item.htmlId === id)!;
      expect(field.hasValue).toBe(false);
      expect(matches.find(item => item.fieldId === field.id)?.status).toBe('auto');
    }
    expect(state.result.fields.find(item => item.htmlId === 'name')).toMatchObject({ label: '姓名', sectionText: '基础信息', placeholder: '请输入姓名' });
  });
  it('不向英文名或紧急联系人填入本人中文姓名', () => {
    const { state, matches } = plan();
    for (const id of ['englishName', 'emergencyContactPerson']) {
      const field = state.result.fields.find(item => item.htmlId === id)!;
      expect(matches.find(item => item.fieldId === field.id)?.value).toBeUndefined();
    }
  });
  it('确认后填写提示语控件，触发 input/change，保存按钮保持未触发', async () => {
    const events: string[] = [];
    for (const name of ['input', 'change', 'click', 'submit']) document.querySelector('form')!.addEventListener(name, () => events.push(name));
    expect((await fillById('name', profile.basic.name!))[0]?.status).toBe('filled');
    expect(input('name').value).toBe('测试同学');
    expect(events).toEqual(['input', 'change']);
  });
  it('保护真实值，包括初始默认值和扫描后的用户输入', async () => {
    expect((await fillById('existingEmail', 'new@example.invalid'))[0]?.status).toBe('skipped');
    const state = scanDocument(); input('name').value = '已填写的姓名';
    expect((await fillById('name', '测试同学', state))[0]?.status).toBe('skipped');
    expect(input('name').value).toBe('已填写的姓名');
  });
  it('只在精确移动页面和模板内识别提示语，不放宽其他网站默认值保护', async () => {
    vi.spyOn(document, 'URL', 'get').mockReturnValue('https://other.example/personal/resume_campus.html');
    expect((await fillById('name', '测试同学'))[0]?.status).toBe('skipped');
    expect(scanDocument().result.fields.some(item => item.type === 'mobile-select')).toBe(false);
  });
  it('隐藏表单、城市只读控件及日期选择器仍有明确人工处理原因', async () => {
    const state = scanDocument();
    for (const id of ['projectName', 'studentSourceRegion', 'sltBirth']) {
      expect(state.result.fields.find(item => item.htmlId === id)?.blockedReason).toBeTruthy();
      expect((await fillById(id, '测试', state))[0]?.status).toBe('skipped');
    }
  });
  it('textarea 提示语也为空，并保留 500 汉字限制', () => {
    const field = scanDocument().result.fields.find(item => item.htmlId === 'projectDuty')!;
    expect(field.hasValue).toBe(false);
    expect(effectiveMaxLength(field)).toBe(500);
  });
  it('区分同一证件号码区域中的证件类型与号码，按选项文字匹配', () => {
    const { state, matches } = plan();
    const select = state.result.fields.find(item => item.htmlId === 'sltId')!;
    const number = state.result.fields.find(item => item.htmlId === 'certificateNo')!;
    expect(select.label).toBe('证件类型');
    expect(matches.find(item => item.fieldId === select.id)).toMatchObject({ status: 'blocked', value: undefined });
    expect(matches.find(item => item.fieldId === number.id)).toMatchObject({ value: 'TEST-ID', matchedProfileKey: 'basic.idNumber' });
  });
  it('通过页面选项事件完成下拉选择，并验证页面保留结果', async () => {
    const option = document.querySelector<HTMLElement>('#sltNation li')!;
    const selected = document.querySelector('#sltNation > span')!;
    const handler = vi.fn(() => { selected.textContent = option.textContent; });
    option.addEventListener('click', handler);
    expect((await fillById('sltNation', '01'))[0]?.status).toBe('filled');
    expect(handler).toHaveBeenCalledOnce(); expect(selected.textContent).toBe('汉族');
  });
  it('下拉选项改变、重复值、已有选择及禁用选项均不触发点击', async () => {
    const click = vi.fn(); document.addEventListener('click', click, { once: true });
    const state = scanDocument(); document.querySelector('#sltNation li')!.textContent = '已改变';
    expect((await fillById('sltNation', '01', state))[0]?.status).toBe('skipped');
    document.querySelector('#sltNation ul')!.insertAdjacentHTML('beforeend', '<li data-code="01">重复</li>');
    expect((await fillById('sltNation', '01'))[0]?.status).toBe('error');
    expect((await fillById('nationality', 'CN'))[0]?.status).toBe('skipped');
    document.querySelector('#sltPolicy li')!.setAttribute('aria-disabled', 'true');
    expect((await fillById('sltPolicy', '03'))[0]?.status).toBe('error');
    expect(click).not.toHaveBeenCalled(); document.removeEventListener('click', click);
  });
  it('证件类型的危险联动事件不触发，保持已有出生日期和性别', async () => {
    const handler = vi.fn(() => { document.querySelector('#sltBirth > span')!.textContent = '2000-01-01'; });
    document.querySelector('#sltId li')!.addEventListener('click', handler);
    expect((await fillById('sltId', '01'))[0]?.status).toBe('skipped');
    expect(handler).not.toHaveBeenCalled();
    expect(document.querySelector('#sltBirth > span')!.textContent).toBe('请选择');
    expect(document.querySelector<HTMLInputElement>('[name="gender"]')!.checked).toBe(true);
  });
  it('适配器也保护祖先禁用和单独隐藏的选项', async () => {
    document.querySelector('#sltNation')!.parentElement!.setAttribute('aria-disabled', 'true');
    expect((await fillById('sltNation', '01'))[0]?.status).toBe('skipped');
    document.querySelector('#sltPolicy li')!.setAttribute('hidden', '');
    expect((await fillById('sltPolicy', '03'))[0]?.status).toBe('error');
  });
  it('待选择学校目录不能只写文本后误报完成', async () => {
    input('name').classList.add('inputStudy');
    expect((await fillById('name', '测试大学'))[0]?.reason).toContain('学校代码');
  });
  it('超出500汉字的实际请求也被执行器拒绝', async () => {
    document.querySelector<HTMLElement>('#projectInfo .secC')!.style.display = '';
    expect((await fillById('projectDuty', '字'.repeat(501)))[0]?.status).toBe('skipped');
    expect((document.getElementById('projectDuty') as HTMLTextAreaElement).value).toBe('字数控制在500个汉字以内');
  });
  it.each([['前5.0%', '前50%'], ['前1.0%', '前10%'], ['1.5', '15']])('数值选项 %s 不得被误认为 %s', (value, label) => {
    const field = scanDocument().result.fields.find(item => item.htmlId === 'sltNation')!;
    field.options = [{ value: 'wrong', label, disabled: false }];
    const result = matchOption(field, { fieldId: field.id, fieldName: '排名', value, confidence: 1, source: 'rule', status: 'auto', reason: '已核实', sensitive: false });
    expect(result.status).not.toBe('auto');
    expect(result.value).toBeUndefined();
  });
  it('没有明确阶段的教育研究方向不默认填入全局硕士研究方向', () => {
    const field = scanDocument().result.fields.find(item => item.htmlId === 'name')!;
    const educationField = { ...field, label: '研究方向', placeholder: '', htmlId: 'researchArea1', sectionText: '教育经历' };
    const candidate = structuredClone(profile);
    candidate.education = [{ id: 'b', level: '本科' }, { id: 'm', level: '硕士研究生', researchDirection: '硕士方向' }];
    candidate.research.researchDirection = '硕士方向';
    expect(matchFields([educationField], candidate)[0]).toMatchObject({ status: 'review', value: undefined });
    expect(matchFields([{ ...educationField, sectionText: '科研方向' }], candidate)[0]).toMatchObject({ status: 'auto', value: '硕士方向' });
  });
  it('原生属性没有声明的移动专业字段上限也参与执行校验', async () => {
    document.querySelector('.resumeCon1')!.insertAdjacentHTML('beforeend', '<div class="secon" id="educationInfo"><h3 class="secH"><span class="lf">教育经历</span></h3><dl><dt>专业名称</dt><dd><input id="specialty1" class="inputxt" value="请输入专业名称"></dd></dl></div>');
    expect(scanDocument().result.fields.find(item => item.htmlId === 'specialty1')?.maxLength).toBe(50);
    expect((await fillById('specialty1', '字'.repeat(51)))[0]?.status).toBe('skipped');
  });
  it('不把其他以请输入开头的真实文本默认为占位提示', async () => {
    input('name').defaultValue = '请输入是我的测试项目名称';
    expect((await fillById('name', '新文字'))[0]?.status).toBe('skipped');
  });
});
