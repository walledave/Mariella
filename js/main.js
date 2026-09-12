document.getElementById('year').textContent = new Date().getFullYear();

const btn = document.getElementById('demo-btn');
const out = document.getElementById('demo-out');
let count = 0;

btn.addEventListener('click', () => {
  count += 1;
  out.textContent = `Geklickt: ${count}×`;
});
