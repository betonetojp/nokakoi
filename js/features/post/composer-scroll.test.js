import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetAppContextForTests,
  setProgrammaticScroll
} from '../../core/app-context.js';
import {
  cleanupComposerScrollLifecycle,
  ensureComposerScrollBehavior,
  resetComposerScrollBehaviorForTests,
  setupComposerScrollLifecycle,
  setupComposerScrollBehavior
} from './composer-scroll.js';

describe('composer scroll controller', () => {
  let windowListeners;
  let rafQueue;
  let composer;
  let textarea;
  let feed;
  let cleanup;
  let mutationCallback;
  let mutationObserve;
  let mutationDisconnect;

  beforeEach(() => {
    vi.useFakeTimers();
    resetAppContextForTests();
    windowListeners = new Map();
    rafQueue = [];
    mutationCallback = null;
    mutationObserve = vi.fn();
    mutationDisconnect = vi.fn();
    textarea = { tagName: 'TEXTAREA' };
    feed = { id: 'feed' };
    composer = {
      hidden: false,
      style: {},
      dataset: {},
      contains: vi.fn((target) => target === textarea || target === composer),
      querySelectorAll: vi.fn(() => [])
    };
    globalThis.window = {
      scrollY: 200,
      innerHeight: 800,
      visualViewport: null,
      requestAnimationFrame: vi.fn((callback) => { rafQueue.push(callback); }),
      addEventListener: vi.fn((name, callback) => windowListeners.set(name, callback)),
      removeEventListener: vi.fn((name) => windowListeners.delete(name))
    };
    globalThis.document = {
      hidden: false,
      activeElement: null,
      getElementById: vi.fn((id) => id === 'composer' ? composer : null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    globalThis.MutationObserver = vi.fn((callback) => {
      mutationCallback = callback;
      return {
        observe: mutationObserve,
        disconnect: mutationDisconnect
      };
    });
  });

  afterEach(() => {
    if (cleanup) cleanup();
    resetComposerScrollBehaviorForTests();
    cleanup = null;
    vi.useRealTimers();
  });

  function dispatch(type, target = feed, extras = {}) {
    windowListeners.get(type)({ target, ...extras });
  }

  function scrollTo(y) {
    window.scrollY = y;
    windowListeners.get('scroll')();
    rafQueue.shift()();
  }

  function setComposerHidden(hidden) {
    composer.hidden = hidden;
    if (mutationCallback) mutationCallback([{ attributeName: 'hidden', target: composer }]);
  }

  it('uses external wheel/touch intent during programmatic anchor scrolling', () => {
    cleanup = setupComposerScrollBehavior();
    setProgrammaticScroll(true);

    dispatch('wheel');
    scrollTo(220);
    expect(composer.style.transform).toBe('translateY(100%)');

    dispatch('touchmove');
    scrollTo(179);
    expect(composer.style.transform).toBe('translateY(0)');
  });

  it('ignores code-driven scroll correction without recent user intent', () => {
    cleanup = setupComposerScrollBehavior();
    setProgrammaticScroll(true);

    scrollTo(220);
    expect(composer.style.transform).not.toBe('translateY(100%)');
  });

  it('does not hide while composer input keeps focus, even after an external gesture', () => {
    document.activeElement = textarea;
    cleanup = setupComposerScrollBehavior();
    setProgrammaticScroll(true);

    dispatch('wheel', textarea);
    scrollTo(220);
    expect(composer.style.transform).not.toBe('translateY(100%)');

    dispatch('touchstart', feed);
    scrollTo(240);
    expect(composer.style.transform).not.toBe('translateY(100%)');
  });

  it('initializes once after a composer hidden during initial setup becomes visible', () => {
    composer.hidden = true;
    expect(setupComposerScrollBehavior()).toBeUndefined();
    expect(windowListeners.has('scroll')).toBe(false);

    composer.hidden = false;
    cleanup = ensureComposerScrollBehavior();
    dispatch('wheel');
    scrollTo(220);
    expect(composer.style.transform).toBe('translateY(100%)');
  });

  it('keeps the existing controller across channel list hide and selected-channel reveal', () => {
    cleanup = setupComposerScrollBehavior();
    const initialAddCount = window.addEventListener.mock.calls.length;

    composer.hidden = true;
    composer.hidden = false;
    expect(ensureComposerScrollBehavior()).toBe(cleanup);
    expect(setupComposerScrollBehavior()).toBe(cleanup);
    expect(window.addEventListener).toHaveBeenCalledTimes(initialAddCount);
    expect(window.removeEventListener).not.toHaveBeenCalled();

    dispatch('wheel');
    scrollTo(220);
    expect(composer.style.transform).toBe('translateY(100%)');
  });

  it('removes every user-intent listener during cleanup', () => {
    cleanup = setupComposerScrollBehavior();
    cleanup();
    cleanup = null;

    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown', 'scroll']) {
      expect(windowListeners.has(type)).toBe(false);
    }
  });

  it('registers lifecycle once and immediately initializes an already visible composer', () => {
    const observer = setupComposerScrollLifecycle();
    cleanup = ensureComposerScrollBehavior();
    const initialAddCount = window.addEventListener.mock.calls.length;

    expect(observer).toBeTruthy();
    expect(MutationObserver).toHaveBeenCalledTimes(1);
    expect(mutationObserve).toHaveBeenCalledWith(composer, {
      attributes: true,
      attributeFilter: ['hidden']
    });
    expect(windowListeners.has('scroll')).toBe(true);
    expect(setupComposerScrollLifecycle()).toBe(observer);
    expect(MutationObserver).toHaveBeenCalledTimes(1);
    expect(window.addEventListener).toHaveBeenCalledTimes(initialAddCount);
  });

  it('initializes initial home scrolling when hidden is removed, without a tab event', () => {
    composer.hidden = true;
    setupComposerScrollLifecycle();
    expect(windowListeners.has('scroll')).toBe(false);

    setComposerHidden(false);
    expect(windowListeners.has('scroll')).toBe(true);
    dispatch('wheel');
    scrollTo(220);
    expect(composer.style.transform).toBe('translateY(100%)');
  });

  it('keeps one listener set across repeated hidden and visible transitions', () => {
    composer.hidden = true;
    setupComposerScrollLifecycle();
    setComposerHidden(false);
    expect(windowListeners.has('scroll')).toBe(true);
    const initialAddCount = window.addEventListener.mock.calls.length;

    setComposerHidden(true);
    setComposerHidden(false);
    setComposerHidden(true);
    setComposerHidden(false);

    expect(window.addEventListener).toHaveBeenCalledTimes(initialAddCount);
    cleanupComposerScrollLifecycle();
    expect(mutationDisconnect).toHaveBeenCalledOnce();
  });
});
