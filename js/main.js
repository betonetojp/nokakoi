// js/main.js

import { logInitInfo, getNip19, getSimplePool, getNip04, getNip44, getNostrTools } from './core/nostr-compat.js';
import { $, $$, getReactionContent, setStatus, showToast } from './utils/utils.js';
import { SettingsManager } from './core/settings.js';
import { defaultRelays, saveRelays, relayConnect, subOnce, unsubscribeAll, getReadRelays, getWriteRelays, stopMonitoringRelays, loadRelays } from './core/relay.js';
import { createState, insertEventSorted, clearFeed, findEventById } from './core/state.js';
import { loadProfile, initializeProfileCache, updateNameDom, updateUserStatusDom } from './features/profile/profile.js';
import { renderEvent, applyReactionToButton } from './ui/renderer.js';
import { publishNote, reactToEvent, replyToEvent, repostEvent } from './features/post/actions.js';
import { setupModalEscClose } from './ui/modals/modals.js';
import { login, autoLogin, updateHeaderName, setupAuthUI } from './core/auth.js';
import { setupComposerScrollBehavior, revealComposer, syncComposerViewport } from './features/post/composer-scroll.js';
import { pickChannelRootId, prefetchChannelMetadata } from './features/channel/channel.js';
import { addCustomEmojiVariant, clearTextShortcodeRegistry } from './features/emoji/custom-emoji-store.js';
import { setReplyTarget, clearReplyTarget, getReplyTarget, setupCancelReplyButton, getGeohashTarget, setupEmojiPreview, setupEmojiShortcodeSuggest, openHiddenTagCharModal, setupComposerUI } from './features/post/composer.js';
import { setQuoteTarget, getQuoteMode } from './features/post/composer.js';
import { setupGlobalTabSelector, updateGlobalButtonLabel, showGlobalRelaySelector } from './features/relay/global-relay.js';
import { setupRelaySettingsUI } from './features/relay/relay-settings.js';
import { setupMediaLinkHandlers, captureTimelineAnchor, restoreTimelineAnchor } from './utils/url-parser.js';
import { setupMediaViewerClose } from './ui/media-viewer.js';
import { setupProfileModalClose, showProfileModal } from './features/profile/profile-modal.js';
import { setupJsonModalClose } from './ui/modals/json-modal.js';
import { setupTabSwipe } from './ui/tab-swipe.js';
import { setupScrollToTopButton, resetScrollToTopButtonPosition } from './ui/scroll-to-top.js';
import { isWebAuthnSupported, authenticateWithPasskey, decryptNsecWithPasskey } from './core/webauthn.js';
import { decryptNsec } from './core/crypto.js';
import { setupMuteListUI } from './features/mute/mute.js';
import { setupTabs as uiSetupTabs, setupDisplaySettings as uiSetupDisplaySettings, setMentionBlink as uiSetMentionBlink, checkMentionBlink as uiCheckMentionBlink, bringModalToFront as uiBringModalToFront } from './ui/ui-setup.js';
import { setupPostLinkUI, updatePostLinkButtonAndModal } from './features/post/postlink.js';
import { t, detectBrowserLang, initI18n, applyTranslations } from './utils/i18n.js';
import { EVENTS_TIMEOUT, EVENTS_FETCH_LIMIT, EVENTS_MAX, DEFAULT_OMOCHAT_RELAYS } from './config/constants.js';
import { setupFeedFetcher, fetchMore } from './features/timeline/feed-fetcher.js';
import { showOmochatSettingsModal, showReactionModal } from './ui/modals/modals.js';
import { showFeedNotification, sanitizeNotificationBody, ensureNotificationPermission, shouldShowBrowserNotification, normalizeMentionNotificationMode, _notifiedEventIds } from './utils/notification.js';
import { getClosestRelays } from './features/relay/geo-relay-directory.js';
import { setupKeyboardShortcuts, getSelectedEventEl, setSelectedEventEl } from './ui/keyboard-shortcuts.js';
import { initFeedRenderer, renderFeed, scheduleRender, applyStoredReactionToNode, captureFeedUiStateFromDom, feedLoadState, userKind7Memory, ensureEventRestored } from './features/timeline/feed-renderer.js';

import { 
  initFeedManager, 
  restartFeeds, 
  setupGlobalFeed, 
  setupBitchatFeed, 
  setupAuthedFeeds, 
  ensureFeedUiState, 
  getRenderSettingsWithUiState, 
  resolveGlobalRelays, 
  runMergedGlobalLoadMore, 
  getOmochatRelays, 
  addToFeed,
  buildHomeLoadMoreFiltersForGlobalMerge
} from './features/timeline/feed-manager.js';

import { consumeShareText } from './features/post/share-text.js';
import { setupCustomEmojiSubscription, initCustomEmojiSub } from './features/emoji/custom-emoji-sub.js';
import { setupDelegatedFeedHandlers } from './ui/feed-delegator.js';
import { setupReloadHandler } from './ui/reload-handler.js';

// シンプルプールプロバイダーの定義
const SimplePoolProvider = function () {
  try {
    if (typeof getSimplePool === 'function') {
      try {
        const sp = getSimplePool();
        if (sp) return sp;
      } catch (e) {
        // エラーを無視してフォールバック
      }
    }
  } catch (e) { }
  try {
    const NT = getNostrTools() || {};
    return NT.SimplePool || null;
  } catch (e) {
    return null;
  }
};

// UIヘルパー呼び出し用のローカルラッパー
function setMentionBlink(active) { return uiSetMentionBlink(active); }
function checkMentionBlink() { return uiCheckMentionBlink(); }
function setupTabs(preserve) { return uiSetupTabs(settingsManager, preserve); }
function setupDisplaySettings() {
  let updatePostLinkFn = null;
  try {
    if (typeof updatePostLinkButtonAndModal === 'function') updatePostLinkFn = updatePostLinkButtonAndModal;
  } catch (e) { }
  try {
    if (!updatePostLinkFn && typeof window !== 'undefined' && typeof window.updatePostLinkButtonAndModal === 'function') {
      updatePostLinkFn = window.updatePostLinkButtonAndModal;
    }
  } catch (e) { }
  return uiSetupDisplaySettings(settingsManager, restartFeeds, resetScrollToTopButtonPosition, updatePostLinkFn);
}
function bringModalToFront(modal) { return uiBringModalToFront(modal); }

// 詳細デバッグ出力の制御（index.html 側の共通ポリシーに準拠）
try {
  if (typeof window !== 'undefined') {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    let storedDebug = false;
    try { storedDebug = localStorage.getItem('nokakoiDebug') === '1'; } catch (e) { }

    if (typeof window.__nokakoiDebug !== 'boolean') {
      try { window.__nokakoiDebug = isLocal || storedDebug; } catch (e) { }
    }

    if (typeof console.debug !== 'function' && typeof console.log === 'function') {
      console.debug = console.log.bind(console);
    }
  }
} catch (e) { }

function debugLog(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.debug(...args);
    }
  } catch (e) { }
}

logInitInfo();

// グローバル状態と設定の初期化
const state = createState();
try { state.relays = loadRelays(); } catch (e) { console.warn('[Init] loadRelays の読み込みに失敗', e); }
const settingsManager = new SettingsManager();
let settings = settingsManager.settings;

// Nostr URI ハンドラから参照できるよう state をグローバル公開
window.__nostrState = state;
try { window.settingsManager = settingsManager; } catch (e) { }

// プロフィールキャッシュ初期化
initializeProfileCache(state);

// 未保存時の言語とグローバルリレー初期値の自動設定
try {
  const storedLang = localStorage.getItem('lang');
  if (!storedLang) {
    const detected = detectBrowserLang();
    try { localStorage.setItem('lang', detected); } catch (e) { }
  }
  if (!settingsManager.hasRaw('globalRelay')) {
    const lang = storedLang || detectBrowserLang();
    if (lang === 'ja') settingsManager.set('globalRelay', ['wss://yabu.me']);
    else settingsManager.set('globalRelay', ['wss://relay.damus.io']);
  }
} catch (e) { }

const nip19 = getNip19();

// スクロール関連のクリーンアップ関数と認証ガード用インターバル
let cleanupScrollBehavior = null;
var authGuardInterval = null;

// ============================================================================
// ビルド情報
// ============================================================================
const BUILD_INFO = {
  version: "1.99.5",
  buildTime: "2026-07-20T13:33:52+09:00"
};

function updateBuildInfo() {
  try {
    const el = document.getElementById('buildInfo');
    if (el) {
      el.textContent = `v${BUILD_INFO.version} (${BUILD_INFO.buildTime})`;
    }
  } catch (e) { }
}

// ============================================================================
// 初期化処理
// ============================================================================

/**
 * アプリ初期化処理
 */
async function init() {
  // 二重初期化を防止
  try {
    if (typeof window !== 'undefined' && window.__nokakoiInitDone) return;
    if (typeof window !== 'undefined') window.__nokakoiInitDone = true;
  } catch (e) { }

  // i18n データのロード完了を待ち合わせ
  try {
    await initI18n();
    await applyTranslations(document);
  } catch (e) {
    console.error('[Main] i18n initialization failed:', e);
  }

  // 各機能マネージャーの初期化
  initFeedManager(state, settingsManager);
  initCustomEmojiSub(state, settingsManager);

  // 描画管理モジュールの初期化
  try {
    initFeedRenderer(state, {
      ensureFeedUiState,
      getRenderSettingsWithUiState,
      findEventById,
      setupInfiniteScrollObserver,
      getInfiniteScrollObserver: () => _infiniteScrollObserver,
      resolveGlobalRelays,
      buildHomeLoadMoreFiltersForGlobalMerge,
      runMergedGlobalLoadMore,
      getOmochatRelays,
      addToFeed,
      settingsManager,
      nip19
    });
  } catch (e) {
    console.warn('[Main] initFeedRenderer に失敗', e);
  }

  // 各 UI コンポーネントおよびハンドラの接続
  setupRelaySettingsUI(state, relayConnect, SimplePoolProvider, restartFeeds);
  setupTabs();
  setupCancelReplyButton();
  setupEmojiPreview();
  setupEmojiShortcodeSuggest();

  // 隠し文字埋め込みボタン
  try {
    const steganographyBtn = document.getElementById('steganographyBtn');
    if (steganographyBtn) {
      steganographyBtn.addEventListener('click', () => {
        openHiddenTagCharModal();
      });
    }
  } catch (e) { console.warn('[Main] steganographyBtn セットアップ失敗', e); }

  // ジェスチャーやスクロールボタンの有効化
  setupTabSwipe();
  setupScrollToTopButton();
  setupDisplaySettings();
  
  try { setupPostLinkUI(settingsManager); } catch (e) { console.warn('[Main] setupPostLinkUI に失敗', e); }

  setupMediaViewerClose();
  setupProfileModalClose();
  setupJsonModalClose();
  setupModalEscClose();

  const feedsContainer = $('#feeds');
  if (feedsContainer) {
    setupMediaLinkHandlers(feedsContainer);
  }

  // タイムライン要素（リアクション・返信等）に対するイベント委譲処理を有効化
  setupDelegatedFeedHandlers(state, settingsManager, feedsContainer);

  // ソフトリロードおよびリロードハンドラをセットアップ
  setupReloadHandler(state, settingsManager);

  // グローバルリレーセレクタ
  setupGlobalTabSelector(state, settingsManager, () => {
    clearFeed(state, 'global');
    const el = $('#feed-global');
    if (el) el.innerHTML = '';
    setupGlobalFeed();
  });

  // スクロール動作セットアップ
  const enableComposerScroll = () => {
    if (cleanupScrollBehavior) cleanupScrollBehavior();
    cleanupScrollBehavior = setupComposerScrollBehavior();
  };

  // ログイン・ログアウトUIのイベントバインド
  setupAuthUI(state, settings, settingsManager, {
    restartFeeds,
    enableComposerScroll,
    onLogout: () => {
      if (cleanupScrollBehavior) {
        cleanupScrollBehavior();
        cleanupScrollBehavior = null;
      }
      stopMonitoringRelays(state);
      if (authGuardInterval) {
        clearInterval(authGuardInterval);
        authGuardInterval = null;
      }
    }
  });

  // 投稿UIのイベントバインド
  setupComposerUI(state, { getOmochatRelays, consumeShareText });

  // 認証保留中は投稿UIを無効化するガード
  function updateAuthPendingUI() {
    try {
      const pending = !!(window && window.__nokakoiAuthPending);
      const pubBtn = $('#publishBtn');
      const nInput = $('#noteInput');
      const resultEl = $('#publishResult');
      if (pubBtn) pubBtn.disabled = pending;
      if (nInput) nInput.disabled = pending;
      if (resultEl) {
        if (pending) resultEl.textContent = t('auth.pending');
        else if (resultEl.textContent === t('auth.pending')) resultEl.textContent = '';
      }
    } catch (e) { }
  }
  updateAuthPendingUI();
  if (!authGuardInterval) authGuardInterval = setInterval(updateAuthPendingUI, 300);

  const SimplePool = SimplePoolProvider();
  relayConnect(state, SimplePool, restartFeeds);

  // 位置情報リレーの初期計算・キャッシュ更新
  if (settingsManager.get('omochatAutoRelays') !== false) {
    const originalRelaysStr = JSON.stringify(settingsManager.get('omochatComputedRelays') || []);
    refreshClosestOmochatRelays().then(updated => {
      if (updated) {
        const newRelaysStr = JSON.stringify(settingsManager.get('omochatComputedRelays') || []);
        if (originalRelaysStr !== newRelaysStr) {
          console.log('[Main] Omochat relays updated on boot, reloading feed...');
          if (typeof window.softReload === 'function') window.softReload();
        }
      }
    });
  }

  // 未ログイン時でもグローバルの履歴/ライブ購読を自動開始
  try {
    const pubkey = localStorage.getItem('pubkey');
    if (!pubkey) {
      setupGlobalFeed();
      try {
        if (shouldConnectBitchatOnBoot()) {
          setupBitchatFeed();
        }
      } catch (e) { }
    }
  } catch (e) { }

  // タブ切り替え時の bitchat (omochat) オンデマンドフェッチ処理
  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('tab:changed', (e) => {
        try {
          const activeTab = e.detail && e.detail.tab;
          if (activeTab === 'bitchat') {
            if (!state._bitchatFetcher) {
              console.log('[Main] Activating bitchat tab, setting up feed...');
              setupBitchatFeed();
            }
          }
        } catch (err) {
          console.warn('[Main] tab:changed event handling failed:', err);
        }
      });
    }
  } catch (e) { }

  updateBuildInfo();

  // UI 初期化後に翻訳を適用
  try {
    import('./utils/i18n.js').then(m => { try { if (m && m.applyTranslations) m.applyTranslations(document); } catch (e) { } }).catch(() => { });
  } catch (e) { }

  // ミュートリストをセットアップ
  try { setupMuteListUI(state, SimplePoolProvider, renderFeed, restartFeeds); } catch (e) { console.warn('[Main] setupMuteListUI に失敗', e); }

  // 自動ログインを実行
  autoLogin(
    state,
    settings,
    settingsManager,
    () => login(state, settings, settingsManager, restartFeeds, enableComposerScroll)
  );

  // 初回ロード時に mentions_last_viewed を設定し、履歴 mention で再読込後に点滅しないようにする
  try {
    if (!localStorage.getItem('mentions_last_viewed_at')) {
      localStorage.setItem('mentions_last_viewed_at', String(Math.floor(Date.now() / 1000)));
      localStorage.setItem('mentions_last_viewed_id', '');
    }
  } catch (e) { }

  // キーボードショートカットの初期化
  try {
    setupKeyboardShortcuts(state, {
      nip19,
      reactToEvent,
      repostEvent,
      setReplyTarget,
      clearReplyTarget,
      findEventById,
      revealComposer,
      setQuoteTarget,
      showProfileModalProxy,
      bringModalToFront: uiBringModalToFront,
      $,
      $$,
      getNip19,
      settings,
      settingsManager,
      ensureEventRestored
    });
  } catch (e) {
    console.warn('[Main] setupKeyboardShortcuts に失敗', e);
  }
}

// DOM 準備完了時に init を実行
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// DOM 準備後に title/tooltips など属性の翻訳を適用
import('./utils/i18n.js').then(m => { try { if (m && m.applyTranslations) m.applyTranslations(); } catch (e) { } }).catch(() => { });

// data-i18n-title を title 属性へも反映
function applyI18nTitles() {
  try {
    import('./utils/i18n.js').then(m => {
      if (!m || typeof m.t !== 'function') return;
      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        try {
          const key = el.getAttribute('data-i18n-title');
          if (!key) return;
          const txt = m.t(key);
          el.setAttribute('title', txt);
        } catch (e) { }
      });
    }).catch(() => { });
  } catch (e) { }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', applyI18nTitles);
} else {
  applyI18nTitles();
}

// custom emoji 設定変更を監視してフィードを再描画
try {
  window.addEventListener('customEmoji:changed', function () {
    try {
      try {
        if (typeof window.softReload === 'function') {
          window.softReload();
        } else {
          try { window.dispatchEvent(new Event('softReloadRequest')); } catch (e) { }
        }
      } catch (e) {
        try { ['home', 'global', 'mentions', 'me'].forEach(id => { try { renderFeed(id, true); } catch (ee) { } }); } catch (ee) { }
      }
    } catch (e) { }
  });
} catch (e) { }

/**
 * プロファイルモーダル表示用ラッパー
 */
function showProfileModalProxy(pubkey) {
  try {
    showProfileModal(
      state,
      pubkey,
      nip19,
      settings,
      settingsManager,
      (ev, sym) => reactToEvent(state, ev, sym),
      (ev) => {
        const modal = document.getElementById('profileModal');
        if (modal) modal.hidden = true;
        setReplyTarget(state, ev, nip19);
      },
      (ev) => repostEvent(state, ev)
    );
    const modal = document.getElementById('profileModal');
    if (modal) {
      modal.hidden = false;
      try { bringModalToFront(modal); } catch (e) { console.warn('[Main] bringModalToFront に失敗', e); }
    }
  } catch (e) {
    console.warn('[Main] showProfileModalProxy に失敗', e);
  }
}

try { window.showProfileModalProxy = showProfileModalProxy; } catch (e) { }
try { window.invokeShowProfileModalProxy = showProfileModalProxy; } catch (e) { }

// デバッグモジュールを import してセットアップ
import { setupDebugModal } from './ui/modals/debug.js';
try { setupDebugModal(state, settings); } catch (e) { console.warn('[Main] setupDebugModal に失敗', e); }

// omochat 設定変更時に UI と feed を更新するリスナーを追加
try {
  window.addEventListener('omochatSettingsSaved', async () => {
    try {
      setupTabs(true);
      setupGlobalTabSelector(state, settingsManager, () => {
        clearFeed(state, 'global');
        const el = $('#feed-global');
        if (el) el.innerHTML = '';
        setupGlobalFeed();
      });
      try { updateGlobalButtonLabel(settingsManager); } catch (e) { }

      const isAuto = settingsManager.get('omochatAutoRelays') !== false;
      if (isAuto) {
        showToast(t('omochat.relays.updating') || '位置情報リレーを更新中...', { type: 'info' });
        const originalRelaysStr = JSON.stringify(settingsManager.get('omochatComputedRelays') || []);
        const updated = await refreshClosestOmochatRelays();
        if (updated) {
          const newRelaysStr = JSON.stringify(settingsManager.get('omochatComputedRelays') || []);
          if (originalRelaysStr !== newRelaysStr) {
            showToast(t('omochat.relays.updated') || '位置情報リレーを更新しました', { type: 'success' });
          }
        }
      }
      if (typeof window.softReload === 'function') window.softReload();
      else window.dispatchEvent(new Event('softReloadRequest'));
    } catch(e) { }
  });
} catch(e) { }

// 無限スクロール用 IntersectionObserver 設定
let _infiniteScrollObserver = null;

function setupInfiniteScrollObserver() {
  if (_infiniteScrollObserver) return;
  if (typeof IntersectionObserver === 'undefined') return;

  _infiniteScrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = entry.target;
        if (target && typeof target.click === 'function') {
          try { _infiniteScrollObserver.unobserve(target); } catch (e) { }
          target.click();
        }
      }
    });
  }, {
    root: null,
    rootMargin: '200px',
    threshold: 0.1
  });
}

// UIモーダル等表示アクションのバインド
try {
  if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
      const btn = document.getElementById('openGlobalRelayModalBtn');
      if (btn) {
        btn.onclick = function() {
          showGlobalRelaySelector(state, settingsManager);
        };
      }
      const omochatBtn = document.getElementById('openOmochatSettingsModalBtn');
      if (omochatBtn) {
        omochatBtn.onclick = function() {
          showOmochatSettingsModal(settingsManager);
        };
      }
      const reactionBtn = document.getElementById('openReactionSettingsModalBtn');
      if (reactionBtn) {
        reactionBtn.onclick = function () {
          showReactionModal(undefined, undefined, settingsManager);
        };
      }
    });
  }
} catch (e) {}

// NIP-30 関連の関数をグローバルに一部公開（他ファイル互換性のため）
try { window.setupCustomEmojiSubscription = setupCustomEmojiSubscription; } catch(e){}

// Omochat 起動時判定のヘルパー
function shouldConnectBitchatOnBoot() {
  try {
    if (settingsManager.get('showHomeOmochat') === true) return true;
    const activeTabEl = document.querySelector('.tab.active');
    const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : 'home';
    if (activeTab === 'bitchat') return true;
  } catch (e) { }
  return false;
}

// Omochat リレー更新ヘルパー（main.js 内）
async function refreshClosestOmochatRelays(geohash) {
  const isAuto = settingsManager.get('omochatAutoRelays') !== false;
  if (!isAuto) return false;
  const targetGeohash = geohash || settingsManager.get('omochatGeohash') || 'xn';
  try {
    const algo = settingsManager.get('omochatAutoRelayAlgo') || 'merged';
    const mergeParent = settingsManager.get('omochatMergeParent') === true;
    const relays = await getClosestRelays(targetGeohash, 5, algo, mergeParent);
    if (Array.isArray(relays) && relays.length > 0) {
      settingsManager.set('omochatComputedRelays', relays);
      return true;
    }
  } catch (e) {
    console.error('[Main] refreshClosestOmochatRelays failed:', e);
  }
  return false;
}
