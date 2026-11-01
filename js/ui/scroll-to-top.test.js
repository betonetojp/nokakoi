// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupScrollToTopButton } from './scroll-to-top.js';

describe('scroll-to-top button', () => {
  let reloadMock = null;
  const originalLocation = window.location;

  beforeEach(() => {
    vi.useFakeTimers();
    reloadMock = vi.fn();
    delete window.location;
    window.location = {
      reload: reloadMock,
      href: 'http://localhost/'
    };
    window.scrollTo = vi.fn();
    window.scrollY = 0;

    document.body.innerHTML = `
      <div class="tabs"></div>
      <div class="feed active"></div>
      <button id="scrollToTopBtn" hidden></button>
    `;
  });

  afterEach(() => {
    window.location = originalLocation;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers full reload when long-pressed (> 750ms)', () => {
    setupScrollToTopButton();
    const button = document.getElementById('scrollToTopBtn');

    // mousedown or touchstart
    const touchStartEvent = new Event('touchstart');
    touchStartEvent.touches = [{ clientX: 50, clientY: 50 }];
    button.dispatchEvent(touchStartEvent);

    // wait for longpress (750ms)
    vi.advanceTimersByTime(800);

    // touchend
    const touchEndEvent = new Event('touchend');
    touchEndEvent.touches = [];
    document.dispatchEvent(touchEndEvent);

    // timers for reload trigger
    vi.advanceTimersByTime(500);

    expect(reloadMock).toHaveBeenCalled();
  });

  it('does NOT trigger full reload on short tap', () => {
    window.softReload = vi.fn();
    setupScrollToTopButton();
    const button = document.getElementById('scrollToTopBtn');

    const touchStartEvent = new Event('touchstart');
    touchStartEvent.touches = [{ clientX: 50, clientY: 50 }];
    button.dispatchEvent(touchStartEvent);

    // short press (150ms)
    vi.advanceTimersByTime(150);

    const touchEndEvent = new Event('touchend');
    touchEndEvent.touches = [];
    document.dispatchEvent(touchEndEvent);

    vi.advanceTimersByTime(500);

    expect(reloadMock).not.toHaveBeenCalled();
  });
});
