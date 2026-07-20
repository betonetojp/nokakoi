let _anchorMaintainObserver = null;
let _anchorMaintainTimer = null;

export function resolveActiveFeed(container) {
  try {
    if (!container) return null;
    if (container.classList && container.classList.contains('feed') && container.classList.contains('active')) {
      return container;
    }
    if (container.closest && (container.closest('#profileEvents') || container.closest('#eventModal'))) {
      return null;
    }
    return container.closest ? container.closest('.feed.active') : null;
  } catch (e) {
    return null;
  }
}

export function findTimelineAnchorElement(anchor, container) {
  try {
    if (!anchor || !anchor.eventId) return null;
    const feed = resolveActiveFeed(container) || document.querySelector('.feed.active');
    if (!feed) return null;
    return feed.querySelector('.event[data-event-id="' + anchor.eventId + '"]');
  } catch (e) {
    return null;
  }
}

export function clearAnchorMaintenance() {
  try {
    if (_anchorMaintainObserver) {
      _anchorMaintainObserver.disconnect();
      _anchorMaintainObserver = null;
    }
    if (_anchorMaintainTimer) {
      clearTimeout(_anchorMaintainTimer);
      _anchorMaintainTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.__nokakoiScrollAnchor = null;
      window.__nokakoiProgrammaticScroll = false;
    }
  } catch (e) { }
}

export function applyTimelineAnchorDrift(anchor, container) {
  try {
    if (!anchor || typeof window === 'undefined' || typeof anchor.top !== 'number') return false;
    const anchorEl = findTimelineAnchorElement(anchor, container);
    if (!anchorEl) return false;
    const drift = anchorEl.getBoundingClientRect().top - anchor.top;
    if (Math.abs(drift) <= 1) return false;
    window.__nokakoiProgrammaticScroll = true;
    window.scrollTo(0, window.scrollY + drift);
    return true;
  } catch (e) {
    return false;
  }
}

export function captureTimelineAnchor(container) {
  try {
    if (!container || typeof window === 'undefined') return null;
    const feed = resolveActiveFeed(container);
    if (!feed) return null;

    const prevScrollY = window.scrollY || 0;
    if (prevScrollY <= 0) return null;

    const tabsBar = document.querySelector('.tabs');
    const tabsBarHeight = tabsBar ? tabsBar.getBoundingClientRect().height : 0;
    const feedRect = feed.getBoundingClientRect();
    const tabTopPos = Math.max(0, Math.round(feedRect.top + prevScrollY - tabsBarHeight));
    if (prevScrollY <= tabTopPos) return null;

    const events = feed.querySelectorAll('.event[data-event-id]');
    for (const ev of events) {
      const rect = ev.getBoundingClientRect();
      if (rect.bottom > 0) {
        return {
          eventId: ev.dataset.eventId,
          top: rect.top
        };
      }
    }
  } catch (e) { }
  return null;
}

export function restoreTimelineAnchor(anchor, container, options) {
  try {
    if (!anchor || typeof window === 'undefined') return;
    const maintainMs = (options && typeof options.maintainMs === 'number') ? options.maintainMs : 800;

    clearAnchorMaintenance();
    window.__nokakoiScrollAnchor = anchor;
    window.__nokakoiProgrammaticScroll = true;

    const runApply = () => {
      try { applyTimelineAnchorDrift(anchor, container); } catch (e) { }
    };

    requestAnimationFrame(() => requestAnimationFrame(runApply));

    if (maintainMs > 0 && typeof ResizeObserver !== 'undefined') {
      const anchorEl = findTimelineAnchorElement(anchor, container);
      if (anchorEl) {
        _anchorMaintainObserver = new ResizeObserver(() => {
          try { applyTimelineAnchorDrift(anchor, container); } catch (e) { }
        });
        _anchorMaintainObserver.observe(anchorEl);
        const feed = anchorEl.closest('.feed');
        if (feed && feed !== anchorEl) {
          _anchorMaintainObserver.observe(feed);
        }
      }
      _anchorMaintainTimer = setTimeout(() => {
        clearAnchorMaintenance();
      }, maintainMs);
    } else {
      setTimeout(() => {
        try { window.__nokakoiProgrammaticScroll = false; } catch (e) { }
        try { window.__nokakoiScrollAnchor = null; } catch (e) { }
      }, Math.max(maintainMs, 100));
    }
  } catch (e) { }
}

export function followUpTimelineAnchor(container) {
  try {
    const anchor = (typeof window !== 'undefined') ? window.__nokakoiScrollAnchor : null;
    if (!anchor) return;
    applyTimelineAnchorDrift(anchor, container);
  } catch (e) { }
}
