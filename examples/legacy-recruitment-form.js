const form = document.querySelector('#legacy-application');
const submitCount = document.querySelector('#legacy-submit-count');
const shadowHost = document.querySelector('#legacy-shadow-host');
const certificateType = document.querySelector('#RecruitmentPortalPersonProfile_CertificateType');
const certificateNumberRow = document.querySelector('#legacy-certificate-number-row');
let submissions = 0;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  submissions += 1;
  submitCount.textContent = String(submissions);
}, true);

certificateType.addEventListener('change', () => {
  certificateNumberRow.hidden = certificateType.value === '';
});

const shadow = shadowHost.attachShadow({ mode: 'open' });
const wrapper = document.createElement('div');
const label = document.createElement('label');
const input = document.createElement('input');
label.htmlFor = 'LegacyShadowPoliticalStatus';
label.textContent = '政治面貌';
input.id = 'LegacyShadowPoliticalStatus';
input.name = 'LegacyShadowPoliticalStatus';
wrapper.append(label, input);
shadow.append(wrapper);
