// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { computeTabBarScrollLeft, ensureTabBarScroller, setupTabBarScroll } from './tab-bar-scroll.js';

describe('computeTabBarScrollLeft', () => {
  it('scrolls just enough so a middle tab and both neighbors are visible', () => {
    const scrollLeft = computeTabBarScrollLeft({
      containerWidth: 180,
      scrollWidth: 274,
      currentScrollLeft: 0,
      activeLeft: 112,
      activeWidth: 50,
      prevLeft: 56,
      nextRight: 218
    });
    expect(scrollLeft).toBe(38);
  });

  it('does not move when the selected tab and neighbors are already in view', () => {
    const scrollLeft = computeTabBarScrollLeft({
      containerWidth: 180,
      scrollWidth: 274,
      currentScrollLeft: 38,
      activeLeft: 112,
      activeWidth: 50,
      prevLeft: 56,
      nextRight: 218
    });
    expect(scrollLeft).toBe(38);
  });

  it('aligns a leading tab so the whole tab is visible', () => {
    const scrollLeft = computeTabBarScrollLeft({
      containerWidth: 180,
      scrollWidth: 274,
      currentScrollLeft: 40,
      activeLeft: 0,
      activeWidth: 50,
      prevLeft: null,
      nextRight: 106
    });
    expect(scrollLeft).toBe(0);
  });

  it('aligns a trailing tab so the whole tab is visible', () => {
    const scrollLeft = computeTabBarScrollLeft({
      containerWidth: 180,
      scrollWidth: 274,
      currentScrollLeft: 0,
      activeLeft: 224,
      activeWidth: 50,
      prevLeft: 168,
      nextRight: null
    });
    expect(scrollLeft).toBe(94);
  });

  it('prefers showing the whole selected tab when neighbors do not fit', () => {
    const scrollLeft = computeTabBarScrollLeft({
      containerWidth: 150,
      scrollWidth: 280,
      currentScrollLeft: 0,
      activeLeft: 80,
      activeWidth: 120,
      prevLeft: 0,
      nextRight: 280
    });
    expect(scrollLeft).toBe(50);
  });

  it('clamps to the scrollable range', () => {
    expect(computeTabBarScrollLeft({
      containerWidth: 200,
      scrollWidth: 180,
      currentScrollLeft: 0,
      activeLeft: 0,
      activeWidth: 50,
      prevLeft: null,
      nextRight: 110
    })).toBe(0);
  });

  it('returns the current offset when the container has no width', () => {
    expect(computeTabBarScrollLeft({
      containerWidth: 0,
      scrollWidth: 300,
      currentScrollLeft: 12,
      activeLeft: 80,
      activeWidth: 40
    })).toBe(12);
  });
});

describe('ensureTabBarScroller', () => {
  it('creates a scroller and removes leftover direct tab children', () => {
    document.body.innerHTML = '<div class="tabs"><button class="tab">old</button></div>';
    const tabs = document.querySelector('.tabs');
    const scroller = ensureTabBarScroller(tabs);
    expect(scroller.className).toBe('tabs-scroller');
    expect(tabs.querySelector(':scope > .tab')).toBeNull();
    expect(tabs.querySelector(':scope > .tabs-scroller')).toBe(scroller);
  });
});

describe('setupTabBarScroll', () => {
  it('drags with a pointer and suppresses the following click', () => {
    document.body.innerHTML = '<div class="tabs"><div class="tabs-scroller"><button class="tab">home</button></div></div>';
    const scroller = document.querySelector('.tabs-scroller');
    Object.defineProperty(scroller, 'scrollLeft', { writable: true, value: 0 });
    setupTabBarScroll(scroller);

    scroller.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 80 }));
    scroller.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: 40 }));
    expect(scroller.scrollLeft).toBe(40);
    expect(scroller.classList.contains('is-dragging')).toBe(true);

    scroller.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: 40 }));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    const prevented = !scroller.dispatchEvent(click);
    expect(prevented).toBe(true);
  });
});
