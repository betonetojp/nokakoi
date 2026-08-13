const DRAG_THRESHOLD_PX = 5;

/**
 * Compute the scrollLeft that keeps the active tab (and neighbors when they
 * fit) inside the tab bar viewport with the smallest possible movement.
 */
export function computeTabBarScrollLeft({
  containerWidth,
  scrollWidth,
  currentScrollLeft = 0,
  activeLeft,
  activeWidth,
  prevLeft = null,
  nextRight = null
} = {}) {
  if (!containerWidth || containerWidth <= 0) return currentScrollLeft || 0;

  const maxScroll = Math.max(0, (scrollWidth || 0) - containerWidth);
  const activeRight = activeLeft + activeWidth;
  const rangeLeft = prevLeft != null ? prevLeft : activeLeft;
  const rangeRight = nextRight != null ? nextRight : activeRight;
  const rangeWidth = rangeRight - rangeLeft;

  let targetLeft = activeLeft;
  let targetRight = activeRight;
  if (rangeWidth <= containerWidth) {
    targetLeft = rangeLeft;
    targetRight = rangeRight;
  }

  let scrollLeft = currentScrollLeft;
  if (targetLeft < scrollLeft) {
    scrollLeft = targetLeft;
  } else if (targetRight > scrollLeft + containerWidth) {
    scrollLeft = targetRight - containerWidth;
  }

  return Math.min(maxScroll, Math.max(0, scrollLeft));
}

export function ensureTabBarScroller(tabsContainer) {
  if (!tabsContainer) return null;
  let scroller = tabsContainer.querySelector(':scope > .tabs-scroller');
  if (!scroller) {
    scroller = document.createElement('div');
    scroller.className = 'tabs-scroller';
    tabsContainer.appendChild(scroller);
  }
  Array.from(tabsContainer.children).forEach((child) => {
    if (child !== scroller) child.remove();
  });
  return scroller;
}

function visibleTabs(scroller) {
  return Array.from(scroller.querySelectorAll('.tab')).filter((tab) => tab.style.display !== 'none');
}

export function scrollActiveTabIntoView(tabsContainer = document.querySelector('.tabs')) {
  if (!tabsContainer) return;
  const scroller = tabsContainer.querySelector(':scope > .tabs-scroller') || tabsContainer;
  const tabs = visibleTabs(scroller);
  const active = tabs.find((tab) => tab.classList.contains('active'));
  if (!active) return;

  const index = tabs.indexOf(active);
  const prev = tabs[index - 1];
  const next = tabs[index + 1];
  const target = computeTabBarScrollLeft({
    containerWidth: scroller.clientWidth,
    scrollWidth: scroller.scrollWidth,
    currentScrollLeft: scroller.scrollLeft,
    activeLeft: active.offsetLeft,
    activeWidth: active.offsetWidth,
    prevLeft: prev ? prev.offsetLeft : null,
    nextRight: next ? next.offsetLeft + next.offsetWidth : null
  });

  if (target === scroller.scrollLeft) return;
  if (typeof scroller.scrollTo === 'function') {
    try {
      scroller.scrollTo({ left: target, behavior: 'smooth' });
      return;
    } catch (e) { }
  }
  scroller.scrollLeft = target;
}

export function scheduleActiveTabAlign(tabsContainer = document.querySelector('.tabs')) {
  if (typeof requestAnimationFrame !== 'function') {
    scrollActiveTabIntoView(tabsContainer);
    return;
  }
  requestAnimationFrame(() => scrollActiveTabIntoView(tabsContainer));
}

function setupTabBarDrag(scroller) {
  if (!scroller || scroller.dataset.tabBarDragReady === 'true') return;
  scroller.dataset.tabBarDragReady = 'true';

  let pointerId = null;
  let startX = 0;
  let startScroll = 0;
  let dragging = false;
  let didDrag = false;

  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startScroll = scroller.scrollLeft;
    dragging = true;
    didDrag = false;
  });

  scroller.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!didDrag && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    if (!didDrag) {
      didDrag = true;
      try { scroller.setPointerCapture(e.pointerId); } catch (err) { }
      scroller.classList.add('is-dragging');
    }
    scroller.scrollLeft = startScroll - dx;
  });

  const endDrag = (e) => {
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    dragging = false;
    pointerId = null;
    scroller.classList.remove('is-dragging');
  };

  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);

  scroller.addEventListener('click', (e) => {
    if (!didDrag) return;
    e.preventDefault();
    e.stopPropagation();
    didDrag = false;
  }, true);
}

let resizeBound = false;

function setupTabBarResize() {
  if (resizeBound || typeof window === 'undefined') return;
  resizeBound = true;
  window.addEventListener('resize', () => {
    scrollActiveTabIntoView();
  });
}

export function setupTabBarScroll(scroller) {
  setupTabBarDrag(scroller);
  setupTabBarResize();
}
