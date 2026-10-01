let submits = 0;
document.querySelector('#common-form').addEventListener('submit', event => {
  event.preventDefault(); document.querySelector('#submit-count').textContent = String(++submits);
});
