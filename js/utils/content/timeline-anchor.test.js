import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getScrollAnchor,
  isProgrammaticScroll,
  resetAppContextForTests
} from '../../core/app-context.js';
import { clearAnchorMaintenance, restoreTimelineAnchor } from './timeline-anchor.js';

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
});
