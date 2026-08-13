let observer = null;

export function setupInfiniteScrollObserver() {
  if (observer) return observer;
  if (typeof IntersectionObserver === 'undefined') return null;

  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const target = entry.target;
      if (!target) return;
      const button = target.classList?.contains('load-more-btn')
        ? target
        : target.closest?.('.feed')?.querySelector('.load-more-btn');

      if (button && button.dataset?.autoLoad !== '0' &&
          !button.disabled && typeof button.click === 'function') {
        button.click();
      }
    });
  }, {
    root: null,
    rootMargin: '600px 0px 600px 0px',
    threshold: 0
  });

  return observer;
}

export function getInfiniteScrollObserver() {
  return observer;
}
