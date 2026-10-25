// ============================================================================
// タイムライン描画・スクロール計測モニター（デバッグモード専用）
// ============================================================================

import { isDebugEnabled } from '../../core/app-context.js';

const MAX_RECENT_ENTRIES = 20;
const MIN_SIGNIFICANT_SHIFT = 0.001;

function createInitialStats() {
  return {
    startedAt: Date.now(),
    renders: {
      diffCount: 0,
      noopCount: 0,
      fullCount: 0,
      totalRenderMs: 0,
      maxRenderMs: 0,
      perFeed: {}
    },
    layoutShift: {
      count: 0,
      clsTotal: 0,
      rawTotal: 0,
      maxShift: 0,
      recent: []
    },
    longTask: {
      count: 0,
      totalMs: 0,
      maxDurationMs: 0,
      recent: []
    }
  };
}

let _stats = createInitialStats();
let _observers = [];
let _initialized = false;

function roundMetric(num, digits = 4) {
  if (typeof num !== 'number' || !Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

function pushBounded(list, item) {
  list.push(item);
  if (list.length > MAX_RECENT_ENTRIES) {
    list.splice(0, list.length - MAX_RECENT_ENTRIES);
  }
}

function getSupportedEntryTypes() {
  try {
    if (typeof PerformanceObserver !== 'undefined' && Array.isArray(PerformanceObserver.supportedEntryTypes)) {
      return PerformanceObserver.supportedEntryTypes;
    }
  } catch (e) { }
  return [];
}

/**
 * content-visibility: auto の有効・無効を切り替える（A/B比較用）
 * @param {boolean} enabled true で有効（既定）、false で body.disable-content-visibility を付与
 * @returns {boolean} 切り替え後の有効状態
 */
export function setTimelineContentVisibility(enabled) {
  const active = enabled !== false;
  try {
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('disable-content-visibility', !active);
    }
  } catch (e) { }
  return isTimelineContentVisibilityEnabled();
}

/**
 * 現在 content-visibility: auto が有効かどうかを返す
 * @returns {boolean}
 */
export function isTimelineContentVisibilityEnabled() {
  try {
    if (typeof document !== 'undefined' && document.body) {
      return !document.body.classList.contains('disable-content-visibility');
    }
  } catch (e) { }
  return true;
}

/**
 * フィード描画1回分の統計を記録する（デバッグモード時のみ動作）
 * @param {Object} entry
 * @param {string} entry.feedId
 * @param {'diff'|'noop'|'full'} entry.mode
 * @param {number} [entry.durationMs=0]
 */
export function recordFeedRender({ feedId = 'unknown', mode = 'diff', durationMs = 0 } = {}) {
  if (!isDebugEnabled()) return;

  const safeDuration = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : 0;

  if (!_stats.renders.perFeed[feedId]) {
    _stats.renders.perFeed[feedId] = { diffCount: 0, noopCount: 0, fullCount: 0 };
  }
  const feedBucket = _stats.renders.perFeed[feedId];

  if (mode === 'full') {
    _stats.renders.fullCount += 1;
    feedBucket.fullCount += 1;
  } else if (mode === 'noop') {
    _stats.renders.noopCount += 1;
    feedBucket.noopCount += 1;
  } else {
    _stats.renders.diffCount += 1;
    feedBucket.diffCount += 1;
  }

  _stats.renders.totalRenderMs += safeDuration;
  if (safeDuration > _stats.renders.maxRenderMs) {
    _stats.renders.maxRenderMs = safeDuration;
  }
}

/**
 * 計測カウンタをリセットする
 */
export function resetTimelinePerfStats() {
  _stats = createInitialStats();
  return getTimelinePerfSnapshot();
}

/**
 * 現在の計測スナップショットを取得する
 */
export function getTimelinePerfSnapshot() {
  const perFeedCopy = {};
  for (const [fid, counts] of Object.entries(_stats.renders.perFeed)) {
    perFeedCopy[fid] = { ...counts };
  }

  return {
    enabled: isDebugEnabled(),
    startedAt: _stats.startedAt,
    elapsedMs: Math.max(0, Date.now() - _stats.startedAt),
    contentVisibilityAuto: isTimelineContentVisibilityEnabled(),
    renders: {
      diffCount: _stats.renders.diffCount,
      noopCount: _stats.renders.noopCount,
      fullCount: _stats.renders.fullCount,
      totalRenderMs: roundMetric(_stats.renders.totalRenderMs, 2),
      maxRenderMs: roundMetric(_stats.renders.maxRenderMs, 2),
      perFeed: perFeedCopy
    },
    layoutShift: {
      count: _stats.layoutShift.count,
      clsTotal: roundMetric(_stats.layoutShift.clsTotal, 5),
      rawTotal: roundMetric(_stats.layoutShift.rawTotal, 5),
      maxShift: roundMetric(_stats.layoutShift.maxShift, 5),
      recent: _stats.layoutShift.recent.slice()
    },
    longTask: {
      count: _stats.longTask.count,
      totalMs: roundMetric(_stats.longTask.totalMs, 2),
      maxDurationMs: roundMetric(_stats.longTask.maxDurationMs, 2),
      recent: _stats.longTask.recent.slice()
    }
  };
}

/**
 * PerformanceObserver（layout-shift / longtask）とコンソール用ヘルパーを初期化する。
 * デバッグモードが無効な場合は何もせずオーバーヘッドをゼロに保つ。
 */
export function initTimelinePerfMonitor() {
  if (!isDebugEnabled()) return false;
  if (_initialized) return true;
  _initialized = true;

  const supported = getSupportedEntryTypes();

  if (typeof PerformanceObserver !== 'undefined') {
    if (supported.length === 0 || supported.includes('layout-shift')) {
      try {
        const lsObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries ? list.getEntries() : [];
          for (const entry of entries) {
            const val = typeof entry.value === 'number' ? entry.value : 0;
            if (val <= 0) continue;
            _stats.layoutShift.count += 1;
            _stats.layoutShift.rawTotal += val;
            if (!entry.hadRecentInput) {
              _stats.layoutShift.clsTotal += val;
            }
            if (val > _stats.layoutShift.maxShift) {
              _stats.layoutShift.maxShift = val;
            }
            if (val >= MIN_SIGNIFICANT_SHIFT) {
              pushBounded(_stats.layoutShift.recent, {
                startTime: roundMetric(entry.startTime || 0, 1),
                value: roundMetric(val, 5),
                hadRecentInput: !!entry.hadRecentInput
              });
            }
          }
        });
        lsObserver.observe({ type: 'layout-shift', buffered: true });
        _observers.push(lsObserver);
      } catch (e) { }
    }

    if (supported.length === 0 || supported.includes('longtask')) {
      try {
        const ltObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries ? list.getEntries() : [];
          for (const entry of entries) {
            const dur = typeof entry.duration === 'number' ? entry.duration : 0;
            if (dur <= 0) continue;
            _stats.longTask.count += 1;
            _stats.longTask.totalMs += dur;
            if (dur > _stats.longTask.maxDurationMs) {
              _stats.longTask.maxDurationMs = dur;
            }
            pushBounded(_stats.longTask.recent, {
              startTime: roundMetric(entry.startTime || 0, 1),
              durationMs: roundMetric(dur, 2)
            });
          }
        });
        ltObserver.observe({ type: 'longtask', buffered: true });
        _observers.push(ltObserver);
      } catch (e) { }
    }
  }

  try {
    if (typeof window !== 'undefined') {
      window.__nokakoiPerf = {
        getSnapshot: getTimelinePerfSnapshot,
        reset: resetTimelinePerfStats,
        setContentVisibility: setTimelineContentVisibility,
        isContentVisibilityEnabled: isTimelineContentVisibilityEnabled
      };
    }
  } catch (e) { }

  return true;
}

/**
 * 監視を停止して状態を初期化する（主にテスト用）
 */
export function teardownTimelinePerfMonitor() {
  for (const obs of _observers) {
    try { obs.disconnect(); } catch (e) { }
  }
  _observers = [];
  _initialized = false;
  _stats = createInitialStats();
  try {
    if (typeof window !== 'undefined' && window.__nokakoiPerf) {
      delete window.__nokakoiPerf;
    }
  } catch (e) { }
}
