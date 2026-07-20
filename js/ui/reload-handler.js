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
export function setupReloadHandler(appState, appSettingsManager) {
  state = appState;
  settingsManager = appSettingsManager;

  // 1. window.softReload の定義
  try {
    window.softReload = function () {
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
