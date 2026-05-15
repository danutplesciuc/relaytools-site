console.log('Relay Tools Pro website loaded');

function updateLiveTime() {
  const el = document.getElementById('liveTime');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
updateLiveTime();
setInterval(updateLiveTime, 1000);

function scrollToSection(id) {
  const target = document.getElementById(id);
  if (!target) return;

  const header = document.querySelector('.site-header');
  const headerHeight = header ? header.offsetHeight : 0;
  const y = target.getBoundingClientRect().top + window.pageYOffset - headerHeight - 18;

  window.scrollTo({
    top: y,
    behavior: 'smooth'
  });
}

document.addEventListener('click', function (event) {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;

  const id = link.getAttribute('href').replace('#', '').trim();
  if (!id) return;

  const target = document.getElementById(id);
  if (!target) return;

  event.preventDefault();
  scrollToSection(id);
});
