/* global __BUILD_TIME__ */
import { logInitInfo, getNip19, getSimplePool, getNostrTools } from './nostr-compat.js';
import { VERSION } from '../config/version.js';
import { $, $$, showToast } from '../utils/utils.js';
import { SettingsManager } from './settings.js';
import { relayConnect, stopMonitoringRelays, loadRelays } from './relay.js';
import { createState, clearFeed, findEventById } from './state.js';
import { initializeProfileCache } from '../features/profile/profile.js';
import { reactToEvent, repostEvent } from '../features/post/actions.js';
import { setupModalEscClose } from '../ui/modals/modals.js';
import { login, autoLogin, setupAuthUI } from './auth.js';
import { setupComposerScrollBehavior, revealComposer } from '../features/post/composer-scroll.js';
import { setReplyTarget, clearReplyTarget, setupCancelReplyButton, setupEmojiPreview, setupEmojiShortcodeSuggest, openHiddenTagCharModal, setupComposerUI, setQuoteTarget } from '../features/post/composer.js';
import { setupGlobalTabSelector, updateGlobalButtonLabel, showGlobalRelaySelector } from '../features/relay/global-relay.js';
import { setupRelaySettingsUI } from '../features/relay/relay-settings.js';
import { setupMediaLinkHandlers } from '../utils/url-parser.js';
import { setupMediaViewerClose } from '../ui/media-viewer.js';
import { setupProfileModalClose, showProfileModal } from '../features/profile/profile-modal.js';
import { setupJsonModalClose } from '../ui/modals/json-modal.js';
import { setupTabSwipe } from '../ui/tab-swipe.js';
import { setupScrollToTopButton, resetScrollToTopButtonPosition } from '../ui/scroll-to-top.js';
import { setupMuteListUI } from '../features/mute/mute.js';
import { setupTabs as uiSetupTabs, setupDisplaySettings as uiSetupDisplaySettings, bringModalToFront as uiBringModalToFront } from '../ui/ui-setup.js';
import { setupPostLinkUI, updatePostLinkButtonAndModal } from '../features/post/postlink.js';
import { t, detectBrowserLang, initI18n, applyTranslations } from '../utils/i18n.js';
import { getClosestRelays } from '../features/relay/geo-relay-directory.js';
import { setupKeyboardShortcuts } from '../ui/keyboard-shortcuts.js';
import { initFeedRenderer, renderFeed, ensureEventRestored } from '../features/timeline/feed-renderer.js';

import { 
  initFeedManager, 
  restartFeeds, 
  setupGlobalFeed, 
  setupBitchatFeed, 
  ensureFeedUiState, 
  getRenderSettingsWithUiState, 
  resolveGlobalRelays, 
  runMergedGlobalLoadMore, 
  getOmochatRelays, 
  addToFeed,
  buildHomeLoadMoreFiltersForGlobalMerge,
  handleTabChange
} from '../features/timeline/feed-manager.js';

import { consumeShareText } from '../features/post/share-text.js';
import { setupCustomEmojiSubscription, initCustomEmojiSub } from '../features/emoji/custom-emoji-sub.js';
import { setupDelegatedFeedHandlers } from '../ui/feed-delegator.js';
import { setupReloadHandler } from '../ui/reload-handler.js';
import { showOmochatSettingsModal, showReactionModal } from '../ui/modals/modals.js';

// シンプルプールプロバイダー
const SimplePoolProvider = function () {
  try {
    if (typeof getSimplePool === 'function') {
      const sp = getSimplePool();
      if (sp) return sp;
    }
  } catch (e) { }
  try {
    const NT = getNostrTools() || {};
    return NT.SimplePool || null;
  } catch (e) {
    return null;
  }
};

// グローバル状態
let state = null;
let settingsManager = null;
let settings = null;
let nip19 = null;
let cleanupScrollBehavior = null;
let authGuardInterval = null;
let _infiniteScrollObserver = null;

// UIヘルパー呼び出し用ラッパー
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

// 詳細デバッグ出力の制御
try {
  if (typeof window !== 'undefined') {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    let storedDebug = false;
    try { storedDebug = localStorage.getItem('nokakoiDebug') === '1'; } catch (e) { }

    if (typeof window.__nokakoiDebug !== 'boolean') {
      window.__nokakoiDebug = isLocal || storedDebug;
    }

    if (typeof console.debug !== 'function' && typeof console.log === 'function') {
      console.debug = console.log.bind(console);
    }
  }
} catch (e) { }

const BUILD_INFO = {
  version: VERSION,
  buildTime: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
};

function updateBuildInfo() {
  try {
    const infoStr = `v${BUILD_INFO.version} (${BUILD_INFO.buildTime})`;
    window.__buildInfo = infoStr;
    const el = document.getElementById('buildInfo');
    if (el) {
      el.textContent = infoStr;
    }
  } catch (e) { }
}

function applyI18nTitles() {
  try {
    import('../utils/i18n.js').then(m => {
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

function shouldConnectBitchatOnBoot() {
  try {
    if (settingsManager.get('showHomeOmochat') === true) return true;
    const activeTabEl = document.querySelector('.tab.active');
    const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : 'home';
    if (activeTab === 'bitchat') return true;
  } catch (e) { }
  return false;
}

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

export async function initApp() {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiInitDone) return;
    if (typeof window !== 'undefined') window.__nokakoiInitDone = true;
  } catch (e) { }

  logInitInfo();

  state = createState();
  try { state.relays = loadRelays(); } catch (e) { console.warn('[Init] loadRelays の読み込みに失敗', e); }
  settingsManager = new SettingsManager();
  settings = settingsManager.settings;

  if (typeof window !== 'undefined') {
    window.__nostrState = state;
    window.settingsManager = settingsManager;
    window.showProfileModalProxy = showProfileModalProxy;
    window.invokeShowProfileModalProxy = showProfileModalProxy;
    window.setupCustomEmojiSubscription = setupCustomEmojiSubscription;
  }

  initializeProfileCache(state);

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

  nip19 = getNip19();

  try {
    await initI18n();
    await applyTranslations(document);
  } catch (e) {
    console.error('[Main] i18n initialization failed:', e);
  }

  initFeedManager(state, settingsManager);
  initCustomEmojiSub(state, settingsManager);

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

  setupRelaySettingsUI(state, relayConnect, SimplePoolProvider, restartFeeds);
  setupTabs();
  setupCancelReplyButton();
  setupEmojiPreview();
  setupEmojiShortcodeSuggest();

  try {
    const steganographyBtn = document.getElementById('steganographyBtn');
    if (steganographyBtn) {
      steganographyBtn.addEventListener('click', () => {
        openHiddenTagCharModal();
      });
    }
  } catch (e) { console.warn('[Main] steganographyBtn セットアップ失敗', e); }

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

  setupDelegatedFeedHandlers(state, settingsManager, feedsContainer);
  setupReloadHandler(state, settingsManager);

  setupGlobalTabSelector(state, settingsManager, () => {
    clearFeed(state, 'global');
    const el = $('#feed-global');
    if (el) el.innerHTML = '';
    setupGlobalFeed();
  });

  const enableComposerScroll = () => {
    if (cleanupScrollBehavior) cleanupScrollBehavior();
    cleanupScrollBehavior = setupComposerScrollBehavior();
  };

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

  setupComposerUI(state, { getOmochatRelays, consumeShareText });

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

  try {
    if (typeof window !== 'undefined') {
      let lastActiveTab = null;
      // 初期化時に現在のアクティブタブを取得
      setTimeout(() => {
        try {
          const activeTabEl = document.querySelector('.tab.active');
          if (activeTabEl && activeTabEl.dataset) {
            lastActiveTab = activeTabEl.dataset.tab;
          }
        } catch (e) { }
      }, 500);

      window.addEventListener('tab:changed', (e) => {
        try {
          const activeTab = e.detail && e.detail.tab;
          if (activeTab) {
            try {
              const sourceTab = lastActiveTab || (document.querySelector('.tab.active')?.dataset?.tab || null);
              handleTabChange(sourceTab, activeTab);
            } catch (err) {
              console.warn('[Main] handleTabChange failed:', err);
            }
            lastActiveTab = activeTab;
          }
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

  try {
    import('../utils/i18n.js').then(m => { try { if (m && m.applyTranslations) m.applyTranslations(document); } catch (e) { } }).catch(() => { });
  } catch (e) { }

  try { setupMuteListUI(state, SimplePoolProvider, renderFeed, restartFeeds); } catch (e) { console.warn('[Main] setupMuteListUI に失敗', e); }

  autoLogin(
    state,
    settings,
    settingsManager,
    () => login(state, settings, settingsManager, restartFeeds, enableComposerScroll)
  );

  try {
    if (!localStorage.getItem('mentions_last_viewed_at')) {
      localStorage.setItem('mentions_last_viewed_at', String(Math.floor(Date.now() / 1000)));
      localStorage.setItem('mentions_last_viewed_id', '');
    }
  } catch (e) { }

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

  // DOM 準備後に title/tooltips など属性の翻訳を適用
  applyI18nTitles();

  // custom emoji 設定変更を監視してフィードを再描画
  try {
    window.addEventListener('customEmoji:changed', function () {
      try {
        if (typeof window.softReload === 'function') {
          window.softReload();
        } else {
          try { window.dispatchEvent(new Event('softReloadRequest')); } catch (e) { }
        }
      } catch (e) { }
    });
  } catch (e) { }

  // omochat 設定変更時に UI と feed を更新するリスナー
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

  // デバッグモーダルの初期化
  try {
    import('../ui/modals/debug.js').then(m => {
      try { m.setupDebugModal(state, settings); } catch (e) { }
    });
  } catch (e) { }

  // UIモーダル等表示アクションのバインド
  try {
    const globalBtn = document.getElementById('openGlobalRelayModalBtn');
    if (globalBtn) {
      globalBtn.onclick = function() {
        showGlobalRelaySelector(state, settingsManager);
      };
    }
    const omochatSettingsBtn = document.getElementById('openOmochatSettingsModalBtn');
    if (omochatSettingsBtn) {
      omochatSettingsBtn.onclick = function() {
        showOmochatSettingsModal(settingsManager);
      };
    }
    const reactionBtn = document.getElementById('openReactionSettingsModalBtn');
    if (reactionBtn) {
      reactionBtn.onclick = function () {
        showReactionModal(undefined, undefined, settingsManager);
      };
    }
  } catch (e) {}
}
