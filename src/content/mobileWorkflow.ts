import { buildWorkflowRecords, idleWorkflow, workflowRequestSchema, type WorkflowRecord, type WorkflowRequest, type WorkflowState } from '../workflow/model';
import { canonical, controlValue, emptyValue, fillWorkflowField, normalized, requiredIssues, until, visible, type FlowIO } from './workflowControls';
import { sectionConfig } from '../workflow/sections';
import { auditResume } from './resumeAudit';

export function isMobileWorkflowPage(url: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'job.10086.cn' && parsed.pathname === '/personal/resume_campus.html'; }
  catch { return false; }
}
const panes = (section: HTMLElement): HTMLElement[] => [...section.querySelectorAll<HTMLElement>(':scope > .secC')];
const cards = (section: HTMLElement): HTMLElement[] => [...section.querySelectorAll<HTMLElement>(':scope > .secC > .secC_dl')];
const datesIn = (card: HTMLElement): string[] => card.closest('#languageInfo, #skillInfo, #treatiseInfo, #workInfo, #schoolPostInfo')
  ? (card.querySelector('.circle')?.parentElement?.textContent?.match(/\d{4}[.-]\d{2}(?:[.-]\d{2})?/gu) ?? []).map(value => value.replace(/\./gu, '-'))
  : card.closest('#awardInfo')
  ? [...card.querySelectorAll('p.p25')].map(item => normalized(item.textContent)).filter(text => /^\d{4}[.-]\d{2}$/u.test(text)).map(text => text.replace('.', '-'))
  : (card.textContent?.match(/\d{4}[.-]\d{2}[.-]\d{2}/gu) ?? []).map(value => value.replace(/\./gu, '-'));
const recordName = (value: string): string => normalized(value).normalize('NFKC').replace(/\s+/gu, '');
const projectNameKey = (value: string): string => recordName(value).replace(/\(个人项目\/AI协作开发\)$/u, '');
function identityMatches(card: HTMLElement, record: WorkflowRecord): boolean {
  if (!record.identity) return false;
  const tokens = [...card.querySelectorAll('p')].flatMap(item => {
    const text = normalized(item.textContent).replace(/^(组织名称|担任职务)\s*[:：]\s*/u, '');
    return [text, ...text.split(/\s*\|\s*/u), ...[...item.querySelectorAll('b')].map(b => normalized(b.textContent))];
  }).map(recordName);
  return record.identity.every(value => !!value && tokens.includes(recordName(value)));
}
function hasExpectedContent(card: HTMLElement, record: WorkflowRecord, acceptedTargets: ReadonlySet<string> = new Set()): boolean {
  const text = normalized(card.textContent);
  return (record.verifyTargets ?? []).every(target => {
    if (acceptedTargets.has(target)) return true;
    const value = record.fields.find(field => field.target === target)?.value;
    return !value || text.includes(normalized(value));
  });
}
const containsInternalCopy = (card: HTMLElement): boolean => /主档案|待补|未确认|不认领|AI生成|AI产物|AI协作开发|真实账号|项目快照|尚未全量|未接入LLM|不是初始立项负责人|模型不是自主Agent|不作为|不代表本人|具体起止月份未确认|不计入该周期|尚不是商业成品|合著（本人|实习证明记载|证书编号|证书已核验|公示名单核验/u.test(card.textContent ?? '');
const saveFunction = (record: WorkflowRecord) => sectionConfig[record.section].save;
const cadreCard = (section: HTMLElement) => cards(section).find(card => /是否学生干部\s*[:：]/u.test(card.textContent ?? ''));
const cadreValue = (section: HTMLElement) => /是否学生干部\s*[:：]\s*【([是否])】/u.exec(cadreCard(section)?.textContent ?? '')?.[1];
export function matchingCards(section: HTMLElement, record: WorkflowRecord): HTMLElement[] {
  return cards(section).filter(card => {
    if (record.identity) {
      if (!identityMatches(card, record)) return false;
      // Only read dates from the heading; descriptions can contain unrelated dates.
      const period = card.querySelector('.circle')?.parentElement?.textContent ?? '';
      const dates = (period.match(/\d{4}[.-]\d{2}(?:[.-]\d{2})?/gu) ?? []).map(value => value.replace(/\./gu, '-'));
      return (!record.startDate || !!dates[0]?.startsWith(record.startDate)) && (!record.endDate || !!dates[1]?.startsWith(record.endDate));
    }
    if (record.section === 'awardInfo') {
      const label = card.querySelector('.circle')?.parentElement;
      const level = record.fields.find(field => field.target === 'awardLevel')?.value;
      return !!card.querySelector('a.edit[data-code]') && recordName(label?.textContent ?? '') === recordName(record.name)
        && (!level || [...card.querySelectorAll('p.p25')].some(item => normalized(item.textContent) === level))
        && (!record.startDate || datesIn(card)[0] === record.startDate);
    }
    const name = record.section === 'projectInfo'
      ? [...card.querySelectorAll('p')].some(item => {
        const label = /^项目名称\s*[:：]\s*(.+)$/u.exec(normalized(item.textContent));
        if (!label) return false;
        const actual = projectNameKey(label[1]!); const requested = projectNameKey(record.name);
        if (actual === requested) return true;
        // A shortened name is only accepted with exact dates, substantive duties, role and company.
        if (Math.min(actual.length, requested.length) < 6 || !actual.startsWith(requested) && !requested.startsWith(actual)) return false;
        const dates = datesIn(card);
        if (!record.startDate || !record.endDate || dates[0] !== record.startDate || dates[1] !== record.endDate) return false;
        const value = (target: string) => recordName(record.fields.find(field => field.target === target)?.value ?? '');
        const duty = [...card.querySelectorAll('p')].map(row => /^项目职责\s*[:：]\s*(.+)$/u.exec(normalized(row.textContent)))
          .find(match => match)?.[1];
        const headings = [...card.querySelectorAll('p.p33 b')].map(row => recordName(row.textContent ?? ''));
        return value('projectDuty').length >= 20 && recordName(duty ?? '') === value('projectDuty')
          && !!value('projectCompany') && headings[0] === value('projectCompany') && !!value('projectJob') && headings[1] === value('projectJob');
      })
      : [...card.querySelectorAll('p b')].some(item => {
        const text = normalized(item.textContent);
        return text.startsWith(`${normalized(record.name)} `) && canonical(text.split(' ').at(-1) ?? '') === canonical(record.stage ?? '');
      });
    const dates = datesIn(card);
    // Missing profile dates must never turn an existing same-name project into a new record.
    return name && dates.length >= 2 && (!record.startDate || dates[0]?.startsWith(record.startDate))
      && (!record.endDate || dates[1]?.startsWith(record.endDate));
  });
}
function editorHasDraft(editor: HTMLElement): boolean {
  return [...editor.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="hidden"]),textarea,.slt,.dateSlt')]
    .some(item => visible(item) && !emptyValue(controlValue(item)));
}
class Suspended extends Error {}
class RecordIssues extends Error { constructor(readonly issues: string[]) { super(issues.join('；')); } }
export class MobileWorkflow {
  private state = idleWorkflow();
  private records: WorkflowRecord[] = [];
  private runner?: Promise<void>;
  private generation = 0;
  private owned?: { editor: HTMLElement; id: string; removeListener: () => void };
  private duplicateCount = 0;
  private uncertainSaves = new Set<string>();
  private drafts = new Map<string, { editor: HTMLElement; id: string; removeListener: () => void }>();
  private manualByRecord = new Map<string, Map<string, string>>();
  private deferred: WorkflowRecord[] = [];
  private deferredIssues: string[] = [];
  private wholeResume = false;
  private attempted = new Set<string>();
  private manual = new Map<string, string>();
  private panel?: ShadowRoot;
  private description = '教育与项目';
  constructor(private readonly onChange: () => void = () => {}, private readonly saveTimeout = 15000) {}
  status(): WorkflowState { return { ...this.state, issues: [...this.state.issues] }; }
  isRunning(): boolean { return this.state.phase === 'running'; }
  private publish(update: Partial<WorkflowState>): void {
    this.state = { ...this.state, ...update }; this.onChange(); this.render();
  }
  start(payload: WorkflowRequest): WorkflowState {
    if (!isMobileWorkflowPage(location.href)) throw new Error('连续填写目前适用于中国移动校招「我的简历」页面');
    if (this.runner || ['running', 'paused', 'blocked'].includes(this.state.phase)) throw new Error('已有填写任务，请继续或停止当前任务');
    const request = workflowRequestSchema.parse(payload);
    const records = buildWorkflowRecords(request);
    if (!records.length) throw new Error('档案中没有所选类别的经历，请先保存档案');
    if (new Set(records.map(item => item.id)).size !== records.length) throw new Error('档案经历 ID 重复，请在我的档案修正后再开始');
    if (!request.wholeResume && records.some(record => !record.name)) throw new Error('请先补齐档案中的学校、项目或奖励名称');
    this.wholeResume = request.wholeResume === true;
    this.description = records.every(record => record.section === 'awardInfo') ? '在校奖励' : records.some(record => record.section === 'awardInfo') ? '教育、项目与奖励' : '教育与项目';
    if (this.wholeResume) this.description = '整页补全';
    for (const draft of this.drafts.values()) draft.removeListener();
    this.drafts.clear(); this.manualByRecord.clear(); this.deferred = []; this.deferredIssues = [];
    this.owned?.removeListener(); this.duplicateCount = 0;
    this.records = records; this.generation++; this.owned = undefined; this.uncertainSaves.clear(); this.manual.clear(); this.attempted.clear();
    this.state = { ...idleWorkflow(), total: records.length, phase: 'running', message: `准备连续填写${this.description}` };
    this.launch(); return this.status();
  }
  pause(): WorkflowState { if (this.isRunning()) { this.generation++; this.publish({ phase: 'paused', message: '已暂停，当前内容保留在网页中' }); } return this.status(); }
  resume(): WorkflowState {
    if (!['paused', 'blocked', 'review'].includes(this.state.phase)) return this.status();
    if (this.state.phase === 'review') {
      this.records = this.deferred; this.deferred = []; this.deferredIssues = [];
      this.publish({ index: 0, total: this.records.length });
    }
    this.publish({ phase: 'running', issues: [], message: '继续填写；先检查当前记录是否已保存' });
    // A paused runner may still be returning from an awaited DOM operation.
    if (this.runner) void this.runner.then(() => { if (this.isRunning()) this.launch(); });
    else this.launch();
    return this.status();
  }
  stop(): WorkflowState {
    this.generation++;
    this.owned?.removeListener();
    for (const draft of this.drafts.values()) draft.removeListener();
    this.publish({ phase: 'stopped', message: '已停止；网页中已填写和已保存的内容保留', issues: [] });
    return this.status();
  }
  private launch(): void {
    if (this.runner || !this.isRunning()) return;
    this.runner = this.run(this.generation).finally(() => { this.runner = undefined; });
  }
  private rememberSave(editor: HTMLElement, record: WorkflowRecord): void {
    const config = sectionConfig[record.section];
    const identityTargets = record.identityTargets ?? config.identity;
    const dateTargets = record.dateTargets ?? config.dates;
    const targets = [identityTargets[0]!, ...dateTargets];
    const values = targets.map(id => { const node = editor.querySelector(`#${id}`); return node ? controlValue(node) : ''; });
    if (values[0] && !emptyValue(values[0])) record.name = values[0];
    if (/^\d{4}-\d{2}-\d{2}$/u.test(values[1] ?? '')) record.startDate = values[1];
    if (/^\d{4}-\d{2}$/u.test(values[1] ?? '')) record.startDate = values[1];
    if (/^\d{4}-\d{2}-\d{2}$/u.test(values[2] ?? '')) record.endDate = values[2];
    const degree = editor.querySelector('#education');
    if (record.section === 'educationInfo' && degree && !emptyValue(controlValue(degree))) record.stage = controlValue(degree);
    if (record.identity) record.identity = identityTargets.map(id => { const node = editor.querySelector(`#${id}`); return node ? controlValue(node) : ''; });
    this.attempted.add(record.id); this.uncertainSaves.add(record.id);
  }
  private ownEditor(editor: HTMLElement, record: WorkflowRecord): void {
    if (this.owned?.editor === editor && this.owned.id === record.id) return;
    const prior = this.drafts.get(record.id);
    if (prior?.editor === editor) { this.owned = prior; return; }
    prior?.removeListener();
    for (const [id, draft] of this.drafts) if (id !== record.id && draft.editor === editor) { draft.removeListener(); this.drafts.delete(id); }
    const capture = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest('a.save');
      if (!target || target !== editor.querySelector(`:scope > .btnP > a.save[href="javascript:${saveFunction(record)}();"]`)) return;
      // Observe the user's own Save too, before the site's handler hides/resets the editor.
      this.rememberSave(editor, record);
    };
    editor.addEventListener('click', capture, true);
    const manualProof = (event: Event) => {
      const target = event.target;
      if (event.isTrusted && target instanceof HTMLInputElement && target.name === 'isHasCertifier' && target.checked) {
        const field = record.fields.find(item => item.target === 'isHasCertifier');
        if (field && !field.value) field.value = target.dataset.code;
      }
    };
    editor.addEventListener('click', manualProof);
    this.owned = { editor, id: record.id, removeListener: () => { editor.removeEventListener('click', capture, true); editor.removeEventListener('click', manualProof); } };
    this.drafts.set(record.id, this.owned);
  }
  private async reconcileCadre(section: HTMLElement, record: WorkflowRecord, io: FlowIO): Promise<void> {
    const field = record.fields.find(item => item.target === 'isCadres')!;
    if (!field.value) throw new Error('请在我的档案补充是否学生干部；不会把网站默认“否”当成你的回答');
    const expected = field.value === 'Y' ? '是' : '否';
    if (!cadreCard(section) || cadreValue(section) === expected) return;
    const editor = panes(section)[1]!;
    if (panes(section).some((pane, index) => index === 1 && visible(pane))) throw new Error('已保存的学生干部选项与档案不符，请先保存或取消当前草稿后继续');
    const edit = cadreCard(section)?.querySelector<HTMLElement>('a.edit:not([data-code]), a.edit[data-code=""]') ?? null;
    if (!visible(edit)) throw new Error('未找到学生干部记录的编辑按钮');
    io.check(); edit.click();
    if (!await until(() => visible(editor) && visible(editor.querySelector('input[name="isCadres"]')), io)) throw new Error('学生干部编辑区未打开');
    await fillWorkflowField(editor, field, io);
    await fillWorkflowField(editor, record.fields.find(item => item.target === 'cadresDesc')!, io);
    const issues = requiredIssues(editor);
    if (issues.length) throw new Error(issues.join('；'));
    const save = editor.querySelector<HTMLElement>(':scope > .btnP > a.save[href="javascript:saveAwardInfo();"]');
    if (!visible(save) || visible(editor.querySelector('#awardName'))) throw new Error('学生干部编辑区结构变化，已暂停');
    io.check(); save.click();
    if (!await until(() => cadreValue(section) === expected && !visible(editor), io, this.saveTimeout)) throw new Error('学生干部选择的保存结果未确认，请核对网页后继续');
    await io.wait(500);
  }
  private async run(generation: number): Promise<void> {
    const io: FlowIO = {
      check: () => { if (!this.isRunning() || this.generation !== generation) throw new Suspended(); },
      wait: async ms => { await new Promise(resolve => setTimeout(resolve, ms)); io.check(); },
    };
    try {
      while (this.state.index < this.records.length) {
        io.check();
        const record = this.records[this.state.index]!;
        this.manual = this.manualByRecord.get(record.id) ?? new Map<string, string>();
        this.manualByRecord.set(record.id, this.manual);
        this.owned = this.drafts.get(record.id);
        try {
        this.publish({ current: record.title, message: '检查已有记录', issues: [] });
        const section = await until(() => document.getElementById(record.section) ?? undefined, io);
        if (!section || panes(section).length !== 3) throw new Error('没有找到中国移动标准编辑区域，请等待页面加载完成');
        const editor = panes(section)[1]!;
        let editingExisting = false;
        let replacingExisting = false;
        section.scrollIntoView({ behavior: 'instant', block: 'start' });
        if (record.section === 'awardInfo') await this.reconcileCadre(section, record, io);
        let existing = matchingCards(section, record);
        if (!existing.length && this.uncertainSaves.has(record.id)) {
          const activeEditor = panes(section)[1]!;
          const errors = [...activeEditor.querySelectorAll('.inputTip')].filter(visible).map(item => normalized(item.textContent)).filter(text => text && text !== '上传成功');
          if (errors.length) this.uncertainSaves.delete(record.id);
          else {
            existing = await until(() => { const found = matchingCards(section, record); return found.length ? found : undefined; }, io, this.saveTimeout) ?? [];
            if (!existing.length) throw new Error('上次保存结果尚未确认。请刷新网页核对记录后重新启动；为避免重复添加，当前任务不会再次点击保存');
          }
        }
        if (existing.length > 1 && new Set(existing.map(card => datesIn(card).slice(0, 2).join('/'))).size > 1) throw new Error('同名经历对应多个不同时间段，请补齐档案日期后重新启动；不会再新增同名记录');
        const related = record.identity ? cards(section).filter(card => identityMatches(card, record)) : [];
        const missingExpected = existing.length === 1 && !hasExpectedContent(existing[0]!, record);
        const staleExisting = missingExpected && existing.length === 1 && containsInternalCopy(existing[0]!);
        if ((missingExpected && (!!record.identity || staleExisting)) || (!existing.length && related.length === 1 && !!record.identity)) {
          const card = existing[0] ?? related[0]!;
          const edit = card.querySelector<HTMLElement>('a.edit[data-code]');
          if (!edit) throw new Error('已有对应记录缺少内容，但未找到编辑按钮');
          if (!visible(edit)) throw new Error('已有对应记录缺少内容，但编辑入口当前不可见');
          io.check(); edit.click();
          if (!await until(() => visible(editor) && editor, io, 5000)) throw new Error('已有对应记录的编辑区没有打开');
          editingExisting = true; replacingExisting = staleExisting && !!record.replaceTargets?.length; existing = []; this.ownEditor(editor, record);
        } else if (!existing.length && related.length > 1) {
          throw new Error('网站有多条相同单位和职务的记录，无法确定应更新哪一条');
        }
        if (existing.length) {
          if (record.section === 'awardInfo') {
            const expectedCadre = record.fields.find(field => field.target === 'isCadres')?.value === 'Y' ? '是' : '否';
            if (!await until(() => cadreValue(section) === expectedCadre && !visible(panes(section)[1]!), io, this.saveTimeout)) throw new Error('奖励已保存，但学生干部记录尚未确认。请核对网页中的干部记录后继续；不会重复新增本奖励');
          }
          this.duplicateCount += Math.max(0, existing.length - 1);
          existing[0]!.scrollIntoView({ behavior: 'instant', block: 'center' });
          this.publish({ index: this.state.index + 1, saved: this.state.saved + (this.attempted.has(record.id) ? 1 : 0), existing: this.state.existing + (this.attempted.has(record.id) ? 0 : 1) });
          this.owned?.removeListener(); this.drafts.delete(record.id); this.owned = undefined; this.manual.clear(); this.uncertainSaves.delete(record.id);
          continue;
        }
        if (!record.name) throw new Error('档案缺少本条经历的单位或名称，请补充后重新开始');
        if (['educationInfo', 'projectInfo', 'schoolPostInfo', 'workInfo'].includes(record.section) && (!record.startDate || !record.endDate) && cards(section).some(card => normalized(card.textContent).includes(record.name))) {
          throw new Error('网站已有同名经历，但档案日期不完整，无法判断是否重复。请先补齐档案日期后重新启动');
        }
        if (this.uncertainSaves.has(record.id)) throw new Error('上次保存结果尚未确认。请刷新网页核对记录后重新启动；为避免重复添加，当前任务不会再次点击保存');
        if (visible(editor) && !editingExisting && (!this.owned || this.owned.id !== record.id || this.owned.editor !== editor) && editorHasDraft(editor)) {
          throw new Error('当前编辑区已有未保存内容，请先在网页保存或取消该草稿，再点击继续');
        }
        if (!visible(editor)) {
          const config = sectionConfig[record.section];
          if (config.max && cards(section).length >= config.max) throw new Error(`中国移动${config.label}最多保存 ${config.max} 条，当前已满`);
          if (config.radio) {
            const radioName = config.radio;
            const yes = section.querySelector<HTMLInputElement>(`:scope > .secS input[name="${radioName}"][data-code="Y"]`);
            if (yes && !yes.checked) { io.check(); yes.click(); await io.wait(300); }
          }
          const add = [...section.querySelectorAll<HTMLElement>(':scope > .secH > a, :scope > .secC > .fill > a')]
            .find(item => visible(item) && item.getAttribute('href') === 'javascript:;');
          if (!add) throw new Error('未找到可用的添加按钮，请检查本区域是否启用');
          io.check(); add.click();
          if (!await until(() => visible(editor) && editor, io, 5000)) throw new Error('网站没有打开新增表单；请先完善基础信息，或处理网站提示');
          this.manual.clear();
        }
        this.ownEditor(editor, record);
        if (record.tab) {
          const tab = [...editor.querySelectorAll<HTMLElement>('.tabP > a, .tabP_lan > a')].find(item => normalized(item.textContent) === record.tab);
          if (!visible(tab ?? null)) throw new Error(`未找到“${record.tab}”标签页，已保留当前内容`);
          // Existing records can reopen with a stale active class while their pane is still hidden.
          if (editingExisting || !tab!.classList.contains('active')) { io.check(); tab!.click(); await io.wait(200); }
        }
        const requiredIds = record.section === 'educationInfo'
          ? ['educationSchool', 'education', 'educationType', 'schoolProperty', 'degree1', 'college1', 'specialty1', 'country', 'rank', 'lengthOfSchooling', 'sltTime', 'sltTime_t']
          : record.section === 'awardInfo' ? ['awardName', 'awardLevel', 'awardSummary', 'awardObtainTime', 'awardSchool', 'awardType', 'scholarshipLevel']
          : record.section === 'projectInfo' ? ['projectName', 'projectCompany', 'projectJob', 'projectDuty', 'projectDesc', 'projectTime', 'projectTime_t']
          : [...(record.identityTargets ?? sectionConfig[record.section].identity), ...(record.dateTargets ?? sectionConfig[record.section].dates)];
        if (requiredIds.some(id => !editor.querySelector(`#${id}`))) throw new Error('网站表单结构与适配版本不同，已暂停，请保留页面供检查');
        this.publish({ message: '正在填写本条经历' });
        const issues: string[] = [];
        const expected = new Map<Element, string>();
        for (const field of record.fields) {
          io.check();
          const control = editor.querySelector(`#${field.target}`);
          if (replacingExisting && record.replaceTargets?.includes(field.target) && field.value?.trim()
            && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)
            && controlValue(control) !== normalized(field.value)) {
            const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, '');
            control.dispatchEvent(new Event('input', { bubbles: true }));
            control.dispatchEvent(new Event('change', { bubbles: true }));
          }
          // Continue accepts a user's correction of a field that previously failed.
          const previous = this.manual.get(field.target);
          if (previous !== undefined && control && !emptyValue(controlValue(control)) && (field.kind !== 'school' || controlValue(control) !== previous)) { expected.set(control, controlValue(control)); continue; }
          try {
            await fillWorkflowField(editor, field, io); this.manual.delete(field.target);
            if (control && visible(control) && !emptyValue(controlValue(control))) expected.set(control, controlValue(control));
          }
          catch (error) {
            if (error instanceof Suspended) throw error;
            this.manual.set(field.target, control ? controlValue(control) : '');
            issues.push(`${field.label}：${error instanceof Error ? error.message : '未完成'}`);
          }
        }
        await io.wait(200);
        for (const [element, value] of expected) {
          if (!visible(element) || controlValue(element) !== value) issues.push(`${normalized(element.closest('dl')?.querySelector('dt')?.textContent) || element.id}：网站联动改动了刚填入的内容，请检查后继续`);
        }
        issues.push(...requiredIssues(editor));
        if (record.section === 'workInfo' && record.tab === '实习经历' && !record.fields.find(field => field.target === 'isHasCertifier')?.value) issues.push('是否有证明：档案尚未确认，不能把网站默认“否”当成你的回答');
        if (issues.length) {
          editor.scrollIntoView({ behavior: 'instant', block: 'start' });
          if (this.wholeResume) throw new RecordIssues([...new Set(issues)]);
          this.publish({ phase: 'blocked', message: '本条可填内容已填好。请在网页补齐以下项目，再点继续', issues: [...new Set(issues)] }); return;
        }
        const save = editor.querySelector<HTMLElement>(`:scope > .btnP > a.save[href="javascript:${saveFunction(record)}();"]`);
        if (!visible(save)) throw new Error('未找到本条经历的保存按钮，请检查网页结构');
        // When missing dates were completed on the page, use those exact values to verify the saved card.
        this.rememberSave(editor, record);
        io.check(); save.scrollIntoView({ behavior: 'instant', block: 'center' });
        this.publish({ message: '保存本条经历，等待网站返回记录' });
        this.attempted.add(record.id); this.uncertainSaves.add(record.id);
        save.click();
        const validation = [...editor.querySelectorAll('.inputTip')].filter(visible).map(item => normalized(item.textContent)).filter(text => text && text !== '上传成功');
        if (validation.length) {
          this.uncertainSaves.delete(record.id);
          for (const field of record.fields) { const node = editor.querySelector(`#${field.target}`); if (node) this.manual.set(field.target, controlValue(node)); }
          if (this.wholeResume) throw new RecordIssues([...new Set(validation)]);
          this.publish({ phase: 'blocked', message: '网站校验未通过，请在网页修正后继续', issues: [...new Set(validation)] }); return;
        }
        const saved = await until(() => {
          const found = matchingCards(section, record);
          return !visible(editor) && found.some(card => visible(card) && hasExpectedContent(card, record, new Set(this.manual.keys())));
        }, io, this.saveTimeout);
        if (!saved) throw new Error('尚未看到保存后的记录，请检查网站校验、附件或登录状态。不会自动重复点击保存');
        if (record.section === 'awardInfo') {
          const expectedCadre = record.fields.find(field => field.target === 'isCadres')?.value === 'Y' ? '是' : '否';
          if (!await until(() => cadreValue(section) === expectedCadre && !visible(editor) && matchingCards(section, record).length > 0, io, this.saveTimeout)) throw new Error('奖励或学生干部保存尚未完成，请核对网页后继续');
          // The site saves cadre and award data with separate requests that both redraw this section.
          await io.wait(500);
        }
        // The next iteration reconciles the saved card and advances exactly once.
        } catch (error) {
          if (error instanceof Suspended || !this.wholeResume) throw error;
          this.deferred.push(record);
          const details = error instanceof RecordIssues ? error.issues.join('；') : error instanceof Error ? error.message : '未完成';
          this.deferredIssues.push(`${sectionConfig[record.section].label} · ${record.title}：${details}`);
          this.publish({ index: this.state.index + 1, message: '本条保留待补充，继续检查其他栏目' });
        }
      }
      const audit = auditResume(document);
      const issues = [...this.deferredIssues, ...audit];
      this.publish({ phase: this.wholeResume && issues.length ? 'review' : 'completed', current: '', message: `${this.description}本轮结束：保存 ${this.state.saved} 条，已有 ${this.state.existing} 条。${issues.length ? `仍有未完成或待核对项目，详见下方；不代表整份简历已填完。` : '请核对网页，最终投递由你完成。'}${this.duplicateCount ? `另发现 ${this.duplicateCount} 条网站重复记录，已保留。` : ''}`, issues });
      this.records = []; this.manual.clear();
    } catch (error) {
      if (error instanceof Suspended || generation !== this.generation) return;
      this.publish({ phase: 'blocked', message: error instanceof Error ? error.message : '填写暂停，请检查网页', issues: [] });
    }
  }
  private render(): void {
    if (!this.panel) {
      const host = document.createElement('div'); host.id = 'ra-mobile-workflow';
      host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647';
      this.panel = host.attachShadow({ mode: 'closed' }); document.documentElement.append(host);
    }
    const root = this.panel; root.replaceChildren();
    const style = document.createElement('style'); style.textContent = ':host{font:14px/1.6 system-ui;color:#203d30}section{width:320px;max-height:55vh;overflow:auto;padding:18px;background:#f8fbf6;border:1px solid #b4cbbb;border-radius:14px;box-shadow:0 6px 30px #0002}p{margin:8px 0}button{cursor:pointer;margin:8px 8px 0 0;border:1px solid #afc2b2;border-radius:6px;background:white;padding:6px 12px;color:#203d30}ul{padding-left:20px}strong{font-size:16px}';
    const box = document.createElement('section'); const title = document.createElement('strong');
    title.textContent = `网申助手 · ${Math.min(this.state.index + (this.state.phase === 'completed' ? 0 : 1), this.state.total)}/${this.state.total}`;
    box.append(title);
    for (const content of [this.state.current, this.state.message]) { const p = document.createElement('p'); p.textContent = content; box.append(p); }
    if (this.state.issues.length) { const list = document.createElement('ul'); for (const issue of this.state.issues) { const li = document.createElement('li'); li.textContent = issue; list.append(li); } box.append(list); }
    const action = (text: string, callback: () => void) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = callback; box.append(button); };
    if (this.isRunning()) action('暂停', () => { this.pause(); });
    if (['paused', 'blocked', 'review'].includes(this.state.phase)) action(this.state.phase === 'review' ? '重新检查待补充项' : '继续', () => { this.resume(); });
    if (['running', 'paused', 'blocked', 'review'].includes(this.state.phase)) action('停止', () => { this.stop(); });
    else action('收起', () => { const host = root.host; host.remove(); this.panel = undefined; });
    root.append(style, box);
  }
}
