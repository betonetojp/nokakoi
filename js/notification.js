// ============================================================================
// 通知管理 (PWA in-page notifications)
// ============================================================================

import { t } from './i18n.js';
import { logWarn } from './utils.js';

const NOTIF_MIN_INTERVAL = 10000; // ms
const _lastNotifiedAt = new Map(); // feedId -> timestamp
export const _notifiedEventIds = new Set();

/**
 * 通知本文のサニタイズ（改行排除、文字数制限）
 */
export function sanitizeNotificationBody(raw) {
  try {
    if (!raw) return '';
    let s = String(raw).replace(/\r?\n+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > 120) s = s.slice(0, 117) + '...';
    return s || '';
  } catch (e) {
    logWarn('[Notification] sanitizeNotificationBody 失敗:', e);
    return '';
  }
}

/**
 * 通知権限の確認・要求
 */
export async function ensureNotificationPermission() {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const p = await Notification.requestPermission();
    return p === 'granted';
  } catch (e) {
    logWarn('[Notification] ensureNotificationPermission 失敗:', e);
    return false;
  }
}

/**
 * フィード通知を表示（レートリミットおよび重複防止機能付き）
 */
export function showFeedNotification(title, options, eventId, feedId) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    // アプリがフォアグラウンド（visible）の時のみアプリ内通知を出す
    try { if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return; } catch (e) { }
    const now = Date.now();
    const last = _lastNotifiedAt.get(feedId) || 0;
    if (now - last < NOTIF_MIN_INTERVAL) return; // フィードごとのレートリミット
    if (eventId && _notifiedEventIds.has(eventId)) return; // 重複通知防止

    const notif = new Notification(title, options || {});
    if (eventId) {
      _notifiedEventIds.add(eventId);
      if (_notifiedEventIds.size > 500) {
        const oldest = _notifiedEventIds.values().next().value;
        if (oldest !== undefined) {
          _notifiedEventIds.delete(oldest);
        }
      }
    }
    _lastNotifiedAt.set(feedId, now);

    notif.onclick = function () {
      try {
        if (window && typeof window.focus === 'function') window.focus();
        const tabBtn = document.querySelector('.tab[data-tab="' + feedId + '"]');
        if (tabBtn && typeof tabBtn.click === 'function') tabBtn.click();
      } catch (e) {
        logWarn('[Notification] onclick 処理に失敗:', e);
      }
      try { this.close(); } catch (e) { }
    };
  } catch (e) {
    logWarn('[Notification] showFeedNotification 失敗:', e);
  }
}
