// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppContextForTests, setDebugEnabled } from '../../core/app-context.js';
import {
  getTimelinePerfSnapshot,
  initTimelinePerfMonitor,
  isTimelineContentVisibilityEnabled,
  recordFeedRender,
  resetTimelinePerfStats,
  setTimelineContentVisibility,
  teardownTimelinePerfMonitor
} from './perf-monitor.js';

describe('timeline perf-monitor', () => {
  beforeEach(() => {
    document.body.className = '';
    teardownTimelinePerfMonitor();
    resetAppContextForTests();
  });

  afterEach(() => {
    teardownTimelinePerfMonitor();
    resetAppContextForTests();
    vi.unstubAllGlobals();
  });

  it('does nothing when debug mode is disabled', () => {
    setDebugEnabled(false);

    const started = initTimelinePerfMonitor();
    expect(started).toBe(false);
    expect(window.__nokakoiPerf).toBeUndefined();

    recordFeedRender({ feedId: 'global', mode: 'full', durationMs: 12.5 });
    const snap = getTimelinePerfSnapshot();
    expect(snap.enabled).toBe(false);
    expect(snap.renders.fullCount).toBe(0);
    expect(snap.renders.diffCount).toBe(0);
  });

  it('records diff, noop, and full render counts per feed in debug mode', () => {
    setDebugEnabled(true);

    recordFeedRender({ feedId: 'global', mode: 'diff', durationMs: 3.2 });
    recordFeedRender({ feedId: 'global', mode: 'noop', durationMs: 0.4 });
    recordFeedRender({ feedId: 'home', mode: 'full', durationMs: 18.75 });

    const snap = getTimelinePerfSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.renders.diffCount).toBe(1);
    expect(snap.renders.noopCount).toBe(1);
    expect(snap.renders.fullCount).toBe(1);
    expect(snap.renders.maxRenderMs).toBe(18.75);
    expect(snap.renders.perFeed.global).toEqual({ diffCount: 1, noopCount: 1, fullCount: 0 });
    expect(snap.renders.perFeed.home).toEqual({ diffCount: 0, noopCount: 0, fullCount: 1 });

    resetTimelinePerfStats();
    const afterReset = getTimelinePerfSnapshot();
    expect(afterReset.renders.diffCount).toBe(0);
    expect(afterReset.renders.fullCount).toBe(0);
  });

  it('collects layout-shift and longtask entries via PerformanceObserver', () => {
    setDebugEnabled(true);

    const callbacks = new Map();
    class MockPerformanceObserver {
      static supportedEntryTypes = ['layout-shift', 'longtask'];
      constructor(cb) {
        this._cb = cb;
        this.disconnect = vi.fn();
      }
      observe(opts) {
        callbacks.set(opts.type, this._cb);
      }
    }
    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);

    expect(initTimelinePerfMonitor()).toBe(true);
    expect(window.__nokakoiPerf).toBeDefined();

    const lsCb = callbacks.get('layout-shift');
    const ltCb = callbacks.get('longtask');
    expect(lsCb).toBeTypeOf('function');
    expect(ltCb).toBeTypeOf('function');

    lsCb({
      getEntries: () => [
        { value: 0.025, hadRecentInput: false, startTime: 120 },
        { value: 0.01, hadRecentInput: true, startTime: 250 }
      ]
    });
    ltCb({
      getEntries: () => [
        { duration: 64.5, startTime: 300 },
        { duration: 82.25, startTime: 500 }
      ]
    });

    const snap = window.__nokakoiPerf.getSnapshot();
    expect(snap.layoutShift.count).toBe(2);
    expect(snap.layoutShift.clsTotal).toBe(0.025);
    expect(snap.layoutShift.rawTotal).toBe(0.035);
    expect(snap.layoutShift.maxShift).toBe(0.025);
    expect(snap.layoutShift.recent).toHaveLength(2);

    expect(snap.longTask.count).toBe(2);
    expect(snap.longTask.totalMs).toBe(146.75);
    expect(snap.longTask.maxDurationMs).toBe(82.25);
    expect(snap.longTask.recent).toHaveLength(2);
  });

  it('toggles body.disable-content-visibility for A/B comparison', () => {
    expect(isTimelineContentVisibilityEnabled()).toBe(true);

    expect(setTimelineContentVisibility(false)).toBe(false);
    expect(document.body.classList.contains('disable-content-visibility')).toBe(true);

    expect(setTimelineContentVisibility(true)).toBe(true);
    expect(document.body.classList.contains('disable-content-visibility')).toBe(false);
  });
});
