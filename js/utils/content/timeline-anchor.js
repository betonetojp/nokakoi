import {
  getScrollAnchor,
  setProgrammaticScroll,
  setScrollAnchor
} from '../../core/app-context.js';

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
    setScrollAnchor(null);
    setProgrammaticScroll(false);
  } catch (e) { }
}

export function applyTimelineAnchorDrift(anchor, container) {
  try {
    if (!anchor || typeof window === 'undefined' || typeof anchor.top !== 'number') return false;
    const anchorEl = findTimelineAnchorElement(anchor, container);
    if (!anchorEl) return false;
    const drift = anchorEl.getBoundingClientRect().top - anchor.top;
    if (Math.abs(drift) <= 1) return false;
    setProgrammaticScroll(true);
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
    setScrollAnchor(anchor);
    setProgrammaticScroll(true);
    // anchor要素やobserverの成否に関係なく、必ずprogrammatic状態を解除する。
    _anchorMaintainTimer = setTimeout(() => {
      clearAnchorMaintenance();
    }, Math.max(0, maintainMs));

    const runApply = () => {
      try { applyTimelineAnchorDrift(anchor, container); } catch (e) { }
    };

    try {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(runApply));
      } else {
        setTimeout(runApply, 0);
      }
    } catch (e) {
      try { setTimeout(runApply, 0); } catch (_e) { }
    }

    if (maintainMs > 0 && typeof ResizeObserver !== 'undefined') {
      try {
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
      } catch (e) {
        if (_anchorMaintainObserver) {
          try { _anchorMaintainObserver.disconnect(); } catch (_e) { }
          _anchorMaintainObserver = null;
        }
      }
    }
  } catch (e) {
    clearAnchorMaintenance();
  }
}

export function followUpTimelineAnchor(container) {
  try {
    const anchor = getScrollAnchor();
    if (!anchor) return;
    applyTimelineAnchorDrift(anchor, container);
  } catch (e) { }
}
