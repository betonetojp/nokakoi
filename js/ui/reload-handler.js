// js/ui/reload-handler.js

import { loadRelays } from '../core/relay.js';
import { initializeProfileCache } from '../features/profile/profile.js';
import { showToast } from '../utils/utils.js';
import { t } from '../utils/i18n.js';
import { setupGlobalTabSelector } from '../features/relay/global-relay.js';
import { clearFeed } from '../core/state.js';
import { restartFeeds, setupGlobalFeed } from '../features/timeline/feed-manager.js';

let state = null;
let settingsManager = null;

function debugLog(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.debug(...args);
    }
  } catch (e) { }
}

/**
 * ソフトリロードおよびリロードに関連するイベントリスナーを登録する
 */
/**
 * 現在アクティブなフィードまたは画面が初期ロード中・取得中かどうかを判定する
 * @returns {boolean}
 */
export function isFeedLoading() {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiSoftReloading) {
      return true;
    }
    if (typeof document === 'undefined') return false;
    const activeFeed = document.querySelector('.feed.active');
    if (!activeFeed) return false;

    // チャンネルポータルタブの場合：チャット表示中か一覧表示中かでスコープを分ける
    if (activeFeed.id === 'feed-channels') {
      const wrapper = activeFeed.querySelector('.channel-portal-wrapper');
      if (wrapper && wrapper.classList.contains('show-chat')) {
        // チャット画面表示中はチャットメッセージ内のローディングのみをチェック（サイドバーの一覧取得状態に影響されない）
        const chatPlaceholder = activeFeed.querySelector('#channelMessages .muted.text-center, #channelMessages .muted.p-12');
        if (chatPlaceholder) {
          const text = (chatPlaceholder.textContent || '').trim();
          if (
            text.includes('読み込み中') ||
            text.includes('取得中') ||
            text.toLowerCase().includes('loading') ||
            text.toLowerCase().includes('fetching')
          ) {
            return true;
          }
        }
        return false;
      }
      // チャット未表示（一覧画面）の場合は一覧ステータスをチェック
      const listStatus = activeFeed.querySelector('.channel-list-status');
      if (listStatus) {
        const text = (listStatus.textContent || '').trim();
        if (
          text.includes('読み込み中') ||
          text.includes('取得中') ||
          text.toLowerCase().includes('loading') ||
          text.toLowerCase().includes('fetching')
        ) {
          return true;
        }
      }
      return false;
    }

    // 通常フィード・ピン留めチャンネル等の読み込み中プレースホルダーが存在するかチェック
    const placeholder = activeFeed.querySelector('.muted.text-center, .muted.p-12');
    if (placeholder) {
      const text = (placeholder.textContent || '').trim();
      if (
        text.includes('読み込み中') ||
        text.includes('取得中') ||
        text.toLowerCase().includes('loading') ||
        text.toLowerCase().includes('fetching')
      ) {
        return true;
      }
    }
  } catch (e) { }
  return false;
}

if (typeof window !== 'undefined') {
  window.isFeedLoading = isFeedLoading;
}

export function setupReloadHandler(appState, appSettingsManager) {
  state = appState;
  settingsManager = appSettingsManager;

  // 1. window.softReload の定義
  try {
    window.softReload = function () {
      // 読み込み中（「読み込み中...」「メッセージを取得中...」表示中）の呼び出しを抑止
      if (isFeedLoading()) {
        debugLog('[softReload] 抑止', { reason: 'feed-loading' });
        return;
      }

      // 連続呼び出し抑止: 短時間の連打を無視して競合を回避
      try {
        const now = Date.now();
        const MIN_INTERVAL = 1000;
        if (typeof window.__nokakoiSoftReloadLast === 'number' && (now - window.__nokakoiSoftReloadLast) < MIN_INTERVAL) {
          try {
            const elapsedMs = now - window.__nokakoiSoftReloadLast;
            debugLog('[softReload] 抑止', { reason: 'cooldown', elapsedMs, minIntervalMs: MIN_INTERVAL });
          } catch (e) { }
          return;
        }
        window.__nokakoiSoftReloadLast = now;
      } catch (e) { }

      // 競合する softReload 呼び出しを防ぐガード
      try {
        if (typeof window.__nokakoiSoftReloading !== 'undefined' && window.__nokakoiSoftReloading) {
          debugLog('[softReload] 抑止', { reason: 'in-progress' });
          return;
        }
        window.__nokakoiSoftReloading = true;
      } catch (e) { }
      try {
        try { state.relays = loadRelays(); } catch (e) { console.warn('[Main] softReload: loadRelays の読み込みに失敗', e); }
        setTimeout(() => {
          try { restartFeeds(true); } catch (e) { console.warn('[Main] softReload: restartFeeds に失敗', e); }
          try { window.dispatchEvent(new CustomEvent('softReloadDone')); } catch (e) { }
          try { window.__nokakoiSoftReloading = false; } catch (e) { }
        }, 240);
      } catch (e) { console.warn('[Main] softReload に失敗', e); try { window.__nokakoiSoftReloading = false; } catch (ee) { } }
    };
  } catch (e) { }

  // 2. softReloadRequest イベントの監視 (フォールバック)
  try {
    window.addEventListener('softReloadRequest', () => {
      try {
        debugLog('[softReloadRequest] 受信');
        if (isFeedLoading()) {
          debugLog('[softReloadRequest] 抑止', { reason: 'feed-loading' });
          return;
        }
        try {
          if (typeof window.__nokakoiSoftReloading !== 'undefined' && window.__nokakoiSoftReloading) {
            debugLog('[softReloadRequest] 抑止', { reason: 'in-progress' });
            return;
          }
          window.__nokakoiSoftReloading = true;
        } catch (e) { }
        try { state.relays = loadRelays(); } catch (e) { console.warn('[Main] softReloadRequest: loadRelays の読み込みに失敗', e); }
        setTimeout(() => {
          try { restartFeeds(true); } catch (e) { console.warn('[Main] softReloadRequest: restartFeeds に失敗', e); }
          try { initializeProfileCache(state); } catch (e) { }
          try { showToast && showToast(t('loading'), { type: 'info', duration: 1200 }); } catch (e) { }
          try { window.dispatchEvent(new CustomEvent('softReloadDone')); } catch (e) { }
          try { window.__nokakoiSoftReloading = false; } catch (e) { }
        }, 240);
      } catch (e) {
        console.warn('[Main] softReloadRequest handler失敗', e);
        try { window.__nokakoiSoftReloading = false; } catch (ee) { }
      }
    });
  } catch (e) { }

  // 3. tabsRebuilt イベント（タブ再構成後の global タブハンドラ再登録）
  try {
    window.addEventListener('tabsRebuilt', () => {
      try {
        setupGlobalTabSelector(state, settingsManager, () => {
          clearFeed(state, 'global');
          const el = document.getElementById('feed-global');
          if (el) el.innerHTML = '';
          setupGlobalFeed();
        });
      } catch (e) { }
    });
  } catch (e) { }
}
