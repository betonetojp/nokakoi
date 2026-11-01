// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPullToRefresh } from './pull-to-refresh.js';

describe('pull-to-refresh', () => {
  let cleanup = null;
  let reloadMock = null;
  const originalLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    reloadMock = vi.fn();
    delete window.location;
    window.location = {
      reload: reloadMock,
      href: 'http://localhost/'
    };
    window.scrollY = 0;
  });

  afterEach(() => {
    if (typeof cleanup === 'function') {
      cleanup();
      cleanup = null;
    }
    window.location = originalLocation;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates ptrIndicator element on setup', () => {
    cleanup = setupPullToRefresh();
    const indicator = document.getElementById('ptrIndicator');
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains('ptr-indicator')).toBe(true);
  });

  it('activates pull indicator and triggers reload when pulled past threshold', () => {
    cleanup = setupPullToRefresh();
    const indicator = document.getElementById('ptrIndicator');
    expect(indicator).not.toBeNull();

    // touchstart at top
    window.scrollY = 0;
    const touchStartEvent = new Event('touchstart');
    touchStartEvent.touches = [{ clientX: 100, clientY: 50 }];
    window.dispatchEvent(touchStartEvent);

    // touchmove downwards 200px (past threshold)
    const touchMoveEvent = new Event('touchmove', { cancelable: true });
    touchMoveEvent.touches = [{ clientX: 100, clientY: 250 }];
    window.dispatchEvent(touchMoveEvent);

    expect(indicator.classList.contains('ptr-pulling')).toBe(true);
    expect(indicator.classList.contains('ptr-ready')).toBe(true);

    // touchend
    const touchEndEvent = new Event('touchend');
    touchEndEvent.touches = [];
    window.dispatchEvent(touchEndEvent);

    expect(indicator.classList.contains('ptr-refreshing')).toBe(true);

    // advance timers for reload
    vi.advanceTimersByTime(400);
    expect(reloadMock).toHaveBeenCalled();
  });

  it('resets indicator and does NOT reload if released before threshold', () => {
    cleanup = setupPullToRefresh();
    const indicator = document.getElementById('ptrIndicator');

    // touchstart at top
    window.scrollY = 0;
    const touchStartEvent = new Event('touchstart');
    touchStartEvent.touches = [{ clientX: 100, clientY: 50 }];
    window.dispatchEvent(touchStartEvent);

    // touchmove small distance (below threshold)
    const touchMoveEvent = new Event('touchmove', { cancelable: true });
    touchMoveEvent.touches = [{ clientX: 100, clientY: 80 }];
    window.dispatchEvent(touchMoveEvent);

    expect(indicator.classList.contains('ptr-ready')).toBe(false);

    // touchend
    const touchEndEvent = new Event('touchend');
    touchEndEvent.touches = [];
    window.dispatchEvent(touchEndEvent);

    expect(indicator.classList.contains('ptr-refreshing')).toBe(false);

    vi.advanceTimersByTime(500);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('does NOT track pull when scrollY > 2 (not at top)', () => {
    cleanup = setupPullToRefresh();
    const indicator = document.getElementById('ptrIndicator');

    // scrolled down
    window.scrollY = 100;
    const touchStartEvent = new Event('touchstart');
    touchStartEvent.touches = [{ clientX: 100, clientY: 50 }];
    window.dispatchEvent(touchStartEvent);

    const touchMoveEvent = new Event('touchmove', { cancelable: true });
    touchMoveEvent.touches = [{ clientX: 100, clientY: 250 }];
    window.dispatchEvent(touchMoveEvent);

    expect(indicator.classList.contains('ptr-pulling')).toBe(false);
  });

  it('cancels tracking when horizontal swipe is detected', () => {
    cleanup = setupPullToRefresh();
    const indicator = document.getElementById('ptrIndicator');

    window.scrollY = 0;
    const touchStartEvent = new Event('touchstart');
    touchStartEvent.touches = [{ clientX: 100, clientY: 50 }];
    window.dispatchEvent(touchStartEvent);

    // predominantly horizontal move
    const touchMoveEvent = new Event('touchmove', { cancelable: true });
    touchMoveEvent.touches = [{ clientX: 300, clientY: 80 }];
    window.dispatchEvent(touchMoveEvent);

    expect(indicator.classList.contains('ptr-pulling')).toBe(false);
  });

  it('prevents default on touchmove when pulling downwards from the top to suppress browser native reload', () => {
    cleanup = setupPullToRefresh();

    window.scrollY = 0;
    const touchStartEvent = new Event('touchstart');
    touchStartEvent.touches = [{ clientX: 100, clientY: 50 }];
    window.dispatchEvent(touchStartEvent);

    const touchMoveEvent = new Event('touchmove', { cancelable: true });
    touchMoveEvent.touches = [{ clientX: 100, clientY: 60 }];
    const preventDefaultSpy = vi.spyOn(touchMoveEvent, 'preventDefault');
    window.dispatchEvent(touchMoveEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('cleans up indicator element when cleanup function is invoked', () => {
    cleanup = setupPullToRefresh();
    expect(document.getElementById('ptrIndicator')).not.toBeNull();

    cleanup();
    cleanup = null;
    expect(document.getElementById('ptrIndicator')).toBeNull();
  });
});
