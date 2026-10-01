let submits = 0;
document.querySelector('#facts-form').addEventListener('submit', event => {
  event.preventDefault(); document.querySelector('#submit-count').textContent = String(++submits);
});
document.querySelector('#projects-present').addEventListener('change', event => {
  document.querySelector('#project-details').hidden = event.target.value !== 'opaque-a';
});
