function setVhCssVar() {
  try {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  } catch {
    // Keep the CSS fallback when viewport APIs are unavailable.
  }
}

window.addEventListener('load', setVhCssVar);
window.addEventListener('resize', setVhCssVar);
window.addEventListener('orientationchange', setVhCssVar);
if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
  window.visualViewport.addEventListener('resize', setVhCssVar);
}

function toggleScrollToTopBtnForModal() {
  const button = document.getElementById('scrollToTopBtn');
  const modals = document.querySelectorAll('.modal');
  const anyOpen = Array.from(modals).some(
    (modal) => !modal.hasAttribute('hidden') && modal.style.display !== 'none'
  );
  if (button) button.style.display = anyOpen ? 'none' : '';
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal').forEach((modal) => {
    const observer = new MutationObserver(toggleScrollToTopBtnForModal);
    observer.observe(modal, { attributes: true, attributeFilter: ['hidden', 'style'] });
  });
  toggleScrollToTopBtnForModal();
});
