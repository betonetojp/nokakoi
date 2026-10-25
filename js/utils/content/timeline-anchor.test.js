import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getScrollAnchor,
  isProgrammaticScroll,
  resetAppContextForTests,
  setUserScrolling
} from '../../core/app-context.js';
import {
  clearAnchorMaintenance,
  replaceElementPreservingAnchor,
  restoreTimelineAnchor
} from './timeline-anchor.js';

describe('timeline anchor maintenance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAppContextForTests();
    vi.stubGlobal('window', { scrollY: 100, scrollTo: vi.fn() });
    vi.stubGlobal('document', { querySelector: vi.fn(() => null) });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => callback()));
  });

  afterEach(() => {
    clearAnchorMaintenance();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears programmatic state when the anchor element is missing', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });

    restoreTimelineAnchor({ eventId: 'missing', top: 10 }, null, { maintainMs: 50 });
    expect(isProgrammaticScroll()).toBe(true);
    expect(getScrollAnchor()).toEqual({ eventId: 'missing', top: 10 });

    vi.advanceTimersByTime(50);
    expect(isProgrammaticScroll()).toBe(false);
    expect(getScrollAnchor()).toBeNull();
  });

  it.each([
    ['without ResizeObserver', undefined],
    ['when ResizeObserver throws', class {
      constructor() { throw new Error('observer failed'); }
    }]
  ])('clears programmatic state %s', (_label, Observer) => {
    vi.stubGlobal('ResizeObserver', Observer);
    restoreTimelineAnchor({ eventId: 'missing', top: 10 }, null, { maintainMs: 25 });

    vi.advanceTimersByTime(25);
    expect(isProgrammaticScroll()).toBe(false);
    expect(getScrollAnchor()).toBeNull();
  });

  it('does not lock programmatic scroll or yank scrollTo when replacing elements during active user scrolling', () => {
    setUserScrolling(true);
    const oldEl = { parentNode: null };
    const newEl = {};
    const parent = {
      replaceChild: vi.fn()
    };
    oldEl.parentNode = parent;
    const feedContainer = {
      classList: {
        contains: (cls) => cls === 'feed' || cls === 'active',
        add: vi.fn(),
        remove: vi.fn()
      },
      getBoundingClientRect: () => ({ top: 0 })
    };

    const ok = replaceElementPreservingAnchor(oldEl, newEl, feedContainer);
    expect(ok).toBe(true);
    expect(parent.replaceChild).toHaveBeenCalledWith(newEl, oldEl);
    expect(isProgrammaticScroll()).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
