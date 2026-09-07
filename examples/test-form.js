const form = document.querySelector('#application-form');
const submitCount = document.querySelector('#submit-count');
const status = document.querySelector('#test-status');
const addField = document.querySelector('#add-field');
const dynamicFields = document.querySelector('#dynamic-fields');
let submissions = 0;

document.addEventListener('submit', (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  submissions += 1;
  submitCount.textContent = String(submissions);
  status.textContent = `已阻止第 ${submissions} 次提交事件，表单数据没有发出。若刚才仅执行了扩展填写，请检查触发原因。`;
}, true);

addField.addEventListener('click', () => {
  if (document.querySelector('#dynamic-ethnicity')) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = 'dynamic-ethnicity';
  label.textContent = '民族';
  const input = document.createElement('input');
  input.id = 'dynamic-ethnicity';
  input.name = 'ethnicity';
  const hint = document.createElement('small');
  hint.textContent = '这是扫描后动态加入的普通输入框；请重新扫描。';
  wrapper.append(label, input, hint);
  dynamicFields.append(wrapper);
  addField.disabled = true;
  status.textContent = '已新增“民族”字段。请重新打开扩展扫描页面，再执行填写。';
});

document.querySelector('#reset-form').addEventListener('click', () => {
  form.reset();
  dynamicFields.replaceChildren();
  addField.disabled = false;
  submissions = 0;
  submitCount.textContent = '0';
  status.textContent = '已重置表单和计数。请重新扫描；已有邮箱、只读值与禁用值已恢复。';
});
