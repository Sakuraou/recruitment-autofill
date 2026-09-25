// Independent fictional templates mirroring the public site's tabs, gates and saved-card shapes.
(() => {
  const fixture = window.fixture;
  const { el, textField, selectField, dateField, radios, makeSection } = fixture.controls;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const visible = node => !node.closest('[style*="display: none"]');
  const read = node => node.matches('input,textarea') ? node.value : $(':scope > span', node)?.textContent || '';
  const empty = value => !value || /^(请选择|请输入|字数控制|输入工作单位)/u.test(value) || value === '分';
  const period = (dd, record, keys) => {
    const p = el('p', { class: 'p33' }); p.append(el('span', { class: 'circle' }));
    p.append(keys.map(key => record[key]).filter(value => value && !empty(value)).join(' - ').replaceAll('-', '.'));
    dd.append(p);
  };
  const heading = (dd, text, bold = true) => { const p = el('p', { class: 'p33' }); if (bold) p.append(el('b', {}, text)); else p.textContent = text; dd.append(p); };
  const create = (id, title, radio, saveName, build, render) => {
    fixture.adds[id] = fixture.saves[id] = 0; fixture.records[id] = [];
    const item = makeSection(id, title);
    const { section, edit, inputs, empty: blank, saved } = item;
    if (radio) {
      const state = el('div', { class: 'secS' }); radios(state, radio, '是否有' + title, true, 'N');
      $('.secH', section).after(state); blank.style.display = 'none'; $('.secH a', section).style.display = 'none';
      $$('input', state).forEach(input => input.addEventListener('change', () => setTimeout(() => {
        const show = $(`input[name=${radio}][data-code=Y]`, state).checked;
        blank.style.display = show ? 'block' : 'none'; $('.secH a', section).style.display = show ? 'block' : 'none';
      }, 100)));
    }
    build(inputs, edit);
    let editingRecord;
    const renderCard = data => {
      const dl = el('dl', { class: 'secC_dl' }); const dd = el('dd', { class: 'dd3' });
      render(dd, data);
      const editLink = el('a', { class: 'edit', 'data-code': String(fixture.records[id].indexOf(data) + 1) }, '编辑');
      editLink.addEventListener('click', event => {
        event.preventDefault(); editingRecord = data;
        $$('input[id],textarea[id]', edit).forEach(node => { if (data[node.id] !== undefined) node.value = data[node.id]; });
        $$('.slt[id],.dateSlt[id]', edit).forEach(node => { if (data[node.id] !== undefined) $(':scope > span', node).textContent = data[node.id]; });
        if (data.activityName) $$('.tabP_lan > a', edit)[1]?.click();
        else if (data.skillCertificate) $$('.tabP_lan > a', edit)[1]?.click();
        blank.style.display = saved.style.display = 'none'; edit.style.display = 'block';
      });
      dl.append(dd, editLink); saved.append(dl);
    };
    const buttons = el('p', { class: 'btnP' });
    const save = el('a', { class: 'save', href: 'javascript:' + saveName + '();' }, '保存');
    save.addEventListener('click', event => {
      event.preventDefault(); fixture.saves[id]++;
      for (const dl of $$('dl', edit).filter(visible)) {
        if (!$('dt .red', dl)) continue;
        if ($$('input:not([type=radio]),textarea,.slt,.dateSlt', dl).filter(visible).some(node => empty(read(node)))) {
          $('.inputTip', dl).textContent = '请补齐'; return;
        }
      }
      if (fixture.config.saveFailure === id) return;
      const data = {};
      $$('input[id],textarea[id],.slt[id],.dateSlt[id]', edit).filter(visible).forEach(node => { data[node.id] = read(node); });
      $$('input[type=radio]:checked', edit).filter(visible).forEach(node => { data[node.name] = node.dataset.code; });
      setTimeout(() => {
        if (editingRecord) fixture.records[id].splice(fixture.records[id].indexOf(editingRecord), 1, data);
        else fixture.records[id].push(data);
        editingRecord = undefined; fixture.sequence.push({ section: id, ...data }); saved.replaceChildren(); fixture.records[id].forEach(renderCard);
        blank.style.display = edit.style.display = 'none'; saved.style.display = 'block';
      }, fixture.config.saveDelay);
    });
    const cancel = el('a', { href: 'javascript:;', class: 'cancel' }, '取消');
    cancel.addEventListener('click', event => { event.preventDefault(); edit.style.display = 'none'; blank.style.display = 'block'; });
    buttons.append(save, cancel); edit.append(buttons);
    return item;
  };
  const tabs = (root, edit, names) => {
    const bar = el('p', { class: 'tabP_lan' }); edit.prepend(bar); const panes = [];
    names.forEach((name, index) => {
      const button = el('a', { href: 'javascript:;', class: index ? '' : 'active' }, name);
      const pane = el('div', { class: 'tabPCon_lan', style: index ? 'display: none;' : 'display: block;' });
      bar.append(button); root.append(pane); panes.push(pane);
      button.addEventListener('click', event => { event.preventDefault(); $$('a', bar).forEach(node => node.classList.remove('active')); button.classList.add('active'); panes.forEach((node, i) => { node.style.display = i === index ? 'block' : 'none'; }); });
    }); return panes;
  };
  const school = create('schoolPostInfo', '校内职务', undefined, 'saveSchoolPostInfo', root => {
    dateField(root, 'schoolPost_startTime', '时间'); dateField(root, 'schoolPost_endTime', '结束时间');
    textField(root, 'organizationName', '组织团体名称', '请输入组织团体名称', 50, false);
    textField(root, 'schoolJob', '担任职务', '请输入担任职务', 50, false);
    textField(root, 'cadreLevel', '干部级别', '请输入干部级别', 50, false);
    textField(root, 'dutyAchievement', '职责和成就', '请输入职责和成就', 50, false);
  }, (dd, data) => {
    period(dd, data, ['schoolPost_startTime', 'schoolPost_endTime']);
    heading(dd, '组织名称：' + data.organizationName, false);
    heading(dd, '担任职务：' + data.schoolJob, false);
    if (data.dutyAchievement) heading(dd, '职责和成就：' + data.dutyAchievement, false);
  });
  // Public campus school-post dates are optional.
  $$('.dateSlt', school.edit).forEach(node => $('dt .red', node.closest('dl')).remove());
  create('workInfo', '实习经历', 'isHasPractiseInfo', 'saveWorkInfo', (root, edit) => {
    const [work, social] = tabs(root, edit, ['实习经历', '校内活动/社会实践']);
    textField(social, 'activityName', '活动名称', '请输入活动/实践名称', 50);
    textField(social, 'activityType', '活动类型', '请输入活动/实践类型', 50);
    dateField(social, 'startTime', '开始时间'); dateField(social, 'endTime', '结束时间');
    textField(social, 'activityDesc', '活动描述', '字数控制在500个字以内', 500, true, true);
    selectField(work, 'experienceType', '活动经历类型', ['实习经历', '校内经历', '社会实践']);
    textField(work, 'companyName', '工作单位', '输入工作单位名称', 50);
    selectField(work, 'companyProperty', '企业性质', ['民营企业', '国有企业'], false);
    textField(work, 'department', '所在部门', '请输入所在部门', 50, false);
    dateField(work, 'workTime', '入职时间'); dateField(work, 'workTime_t', '离职时间');
    textField(work, 'job', '职务', '请输入职务名称', 50);
    selectField(work, 'workType', '工作类型', ['实习', '全职', '兼职']);
    selectField(work, 'workPay', '税前月薪', ['1000以下/月', '1000-2000/月', '2001-4000/月', '面议']);
    textField(work, 'workDescription', '工作描述', '字数控制在500个字以内', 500, true, true);
    const proof = radios(work, 'isHasCertifier', '是否有证明', false, 'N');
    const details = el('div', { class: 'certifier', style: 'display: none;' }); work.append(details);
    ['certifierName', 'certifierRelation', 'certifierDuty', 'certifierCompany', 'certifierContact'].forEach(key => textField(details, key, key, '', 50));
    $$('input', proof).forEach(node => node.addEventListener('change', () => setTimeout(() => { details.style.display = $('input[data-code=Y]', proof).checked ? 'block' : 'none'; }, 100)));
  }, (dd, data) => {
    period(dd, data, data.activityName ? ['startTime', 'endTime'] : ['workTime', 'workTime_t']);
    if (data.activityName) {
      heading(dd, data.activityName);
      heading(dd, data.activityType);
      if (data.activityDesc) heading(dd, '工作描述：' + data.activityDesc, false);
    } else {
      heading(dd, data.companyName);
      heading(dd, [data.job, data.department, data.experienceType, data.workType, data.workPay].filter(Boolean).join(' | '), false);
      if (data.workDescription) heading(dd, '工作描述：' + data.workDescription, false);
    }
  });
  create('languageInfo', '语言证书', 'isHasLanguageInfo', 'saveLanguageInfo', (root, edit) => {
    const [english, certificate] = tabs(root, edit, ['英语等级', '英语证书', '其他语种']);
    selectField(english, 'englishLevel', '英语等级', ['CET4', 'TEM4', 'CET6', 'TEM8', '未参加']);
    dateField(english, 'englishObtainTime', '获得时间', true); $('dt', $('#englishObtainTime').closest('dl')).append(el('font', { class: 'red' }, '*'));
    textField(english, 'englishScore', '成绩', '分', 10);
    textField(certificate, 'hiddenScore', '隐藏标签页不能填写', '', 10);
  }, (dd, data) => { period(dd, data, ['englishObtainTime']); heading(dd, data.englishLevel); heading(dd, data.englishScore + '分'); });
  create('skillInfo', '技能特长', 'isHasSkillInfo', 'saveSkillInfo', (root, edit) => {
    const [skills, certificates] = tabs(root, edit, ['技能', '证书']);
    textField(skills, 'otherSkill', '技能名称', '请输入技能名称', 100);
    textField(certificates, 'skillCertificate', '证书名称', '请输入证书名称', 100);
    dateField(certificates, 'skillObtainTime', '获得时间', true); $('dt', $('#skillObtainTime').closest('dl')).append(el('font', { class: 'red' }, '*'));
    textField(certificates, 'skillScore', '成绩', '请输入分数', 10, false);
    textField(certificates, 'certificateDesc', '证书简述', '字数控制在500个字以内', 500, false, true);
  }, (dd, data) => { period(dd, data, ['skillObtainTime']); heading(dd, data.skillCertificate); });
  create('computerSkillInfo', '计算机技能', 'isHasComputerSkillInfo', 'saveComputerSkillInfo', root => {
    textField(root, 'computerSkillType', '技能类别', '请输入技能类别', 100, false);
    dateField(root, 'computerSkillUseTime', '使用时间'); $('dt .red', $('#computerSkillUseTime').closest('dl')).remove();
    selectField(root, 'computerSkillLevel', '掌握程度', ['一般', '良好', '熟练', '精通'], false);
  }, (dd, data) => { period(dd, data, []); heading(dd, data.computerSkillType); });
  create('treatiseInfo', '专业论著', 'isHasTreatiseInfo', 'saveTreatiseInfo', root => {
    ['treatiseName', 'treatiseSynopsis', 'treatiseArchievement', 'treatiseSituation', 'treatiseCoauther'].forEach(key => textField(root, key, key, '请输入内容', 50));
    dateField(root, 'treatisePublishTime', '日期'); selectField(root, 'authorSort', '作者排序', ['第一作者', '第二作者', '其他']);
  }, (dd, data) => {
    period(dd, data, ['treatisePublishTime']); heading(dd, data.treatiseName); heading(dd, data.authorSort);
    if (data.treatiseSynopsis) heading(dd, '内容摘要：' + data.treatiseSynopsis, false);
    if (data.treatiseArchievement) heading(dd, '成就/等级：' + data.treatiseArchievement, false);
    if (data.treatiseSituation) heading(dd, '发表情况：' + data.treatiseSituation, false);
    if (data.treatiseCoauther) heading(dd, '合独著说明：' + data.treatiseCoauther, false);
  });
  makeSection('familyInfo', '家庭成员');
})();
