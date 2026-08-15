/* global __BUILD_TIME__ */
import { logInitInfo, getNip19, getSimplePool, getNostrTools } from './nostr-compat.js';
import { VERSION } from '../config/version.js';
import { $, $$, showToast } from '../utils/utils.js';
import { SettingsManager } from './settings.js';
import { relayConnect, stopMonitoringRelays, loadRelays, defaultIntlRelayUrl, defaultJaRelayUrl, getDefaultGlobalRelayByLang } from './relay.js';
import { createState, clearFeed, findEventById } from './state.js';
import { initializeProfileCache } from '../features/profile/profile.js';
import { reactToEvent, repostEvent } from '../features/post/actions.js';
import { setupModalEscClose } from '../ui/modals/modals.js';
import { login, autoLogin, setupAuthUI } from './auth.js';
import {
  revealComposer,
  setupComposerScrollBehavior,
  setupComposerScrollLifecycle
} from '../features/post/composer-scroll.js';
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
import { setupEhagakiPublicChatsPicker } from '../ui/ehagaki-public-chats-picker.js';
import { t, detectBrowserLang, initI18n, applyTranslations } from '../utils/i18n.js';
import { setupKeyboardShortcuts } from '../ui/keyboard-shortcuts.js';
import { initFeedRenderer, renderFeed, ensureEventRestored } from '../features/timeline/feed-renderer.js';
import { shouldConnectOmochatOnBoot } from '../features/timeline/omochat-lifecycle.js';
import { getInfiniteScrollObserver, setupInfiniteScrollObserver } from '../boot/infinite-scroll.js';
import {
  refreshOmochatRelaysOnBoot,
  setupOmochatSettingsListener,
  setupOmochatTabListener
} from '../boot/omochat.js';
import {
  configureAppContext,
  installDeprecatedWindowBridges,
  setBuildInfo,
  setDebugEnabled
} from './app-context.js';
import { initializeMentionLastViewed } from '../utils/mention-last-viewed.js';

import { 
  initFeedManager, 
  restartFeeds, 
  setupGlobalFeed, 
  setupBitchatFeed,
  scheduleBitchatFeedSetup,
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
import { openDeepLink, setupDeepLinkUrlCleanup } from '../features/deep-link.js';
import { showEventModal } from '../ui/modals/event-modal.js';
import { setupCustomEmojiSubscription, scheduleCustomEmojiSubscription, initCustomEmojiSub } from '../features/emoji/custom-emoji-sub.js';
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

// Deprecated window properties remain available only as an explicit migration bridge.
installDeprecatedWindowBridges();

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

    setDebugEnabled(isLocal || storedDebug);

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
    setBuildInfo(infoStr);
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
  configureAppContext({
    state,
    settingsManager,
    customEmojis: state.customEmojis
  });

  if (typeof window !== 'undefined') {
    window.showProfileModalProxy = showProfileModalProxy;
    window.invokeShowProfileModalProxy = showProfileModalProxy;
    window.setupCustomEmojiSubscription = setupCustomEmojiSubscription;
    window.scheduleCustomEmojiSubscription = scheduleCustomEmojiSubscription;
  }

  initializeProfileCache(state);

  try {
    const storedLang = localStorage.getItem('lang');
    if (!storedLang) {
      const detected = detectBrowserLang();
      try { localStorage.setItem('lang', detected); } catch (e) { }
    }
    if (!settingsManager.hasRaw('globalRelay')) {
      settingsManager.set('globalRelay', getDefaultGlobalRelayByLang());
    }
  } catch (e) { }

  nip19 = getNip19();

  try {
    await initI18n();
    await applyTranslations(document);
  } catch (e) {
    console.error('[Main] i18n の初期化に失敗しました:', e);
  }

  initFeedManager(state, settingsManager);
  initCustomEmojiSub(state, settingsManager);

  try {
    initFeedRenderer(state, {
      ensureFeedUiState,
      getRenderSettingsWithUiState,
      findEventById,
      setupInfiniteScrollObserver,
      getInfiniteScrollObserver,
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
  try { setupEhagakiPublicChatsPicker(); } catch (e) { console.warn('[Main] setupEhagakiPublicChatsPicker に失敗', e); }

  setupMediaViewerClose();
  setupProfileModalClose();
  setupDeepLinkUrlCleanup();
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
  setupComposerScrollLifecycle();

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

  try {
    openDeepLink(state, {
      nip19,
      showProfileModal: showProfileModalProxy,
      showEventModal: (event) => {
        showEventModal(
          event,
          state,
          nip19,
          (ev, sym) => reactToEvent(state, ev, sym),
          (ev) => {
            const modal = document.getElementById('eventModal');
            if (modal) modal.hidden = true;
            setReplyTarget(state, ev, nip19);
          },
          (ev) => repostEvent(state, ev),
          settings,
          settingsManager
        );
      }
    }).catch((e) => {
      console.warn('[Main] openDeepLink に失敗', e);
    });
  } catch (e) {
    console.warn('[Main] openDeepLink に失敗', e);
  }

  refreshOmochatRelaysOnBoot(settingsManager, setupBitchatFeed);

  // 未ログイン時のタブ制限処理
  function updateTabVisibility(isLoggedIn) {
    try {
      const tabs = document.querySelectorAll('.tabs .tab');
      tabs.forEach(tab => {
        const tabName = tab.dataset ? tab.dataset.tab : null;
        if (tabName === 'global') {
          tab.style.display = '';
        } else {
          tab.style.display = isLoggedIn ? '' : 'none';
        }
      });
      if (!isLoggedIn) {
        const tabs = document.querySelectorAll('.tabs .tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset && t.dataset.tab === 'global'));
        const feeds = document.querySelectorAll('.feed');
        feeds.forEach(f => f.classList.toggle('active', f.id === 'feed-global'));
      }
    } catch (e) { }
  }
  configureAppContext({ updateTabVisibility });

  try {
    const pubkey = localStorage.getItem('pubkey');
    updateTabVisibility(!!pubkey);
    if (!pubkey) {
      setupGlobalFeed();
      try {
        if (shouldConnectOmochatOnBoot(settingsManager)) {
          scheduleBitchatFeedSetup(1500);
        }
      } catch (e) { }
    }
  } catch (e) { }

  try {
    setupOmochatTabListener(state, { handleTabChange, setupBitchatFeed });
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
    initializeMentionLastViewed(localStorage.getItem('pubkey'));
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
        scheduleCustomEmojiSubscription(0);
        ['home', 'global', 'mentions', 'me', 'bitchat'].forEach((feedId) => {
          try { renderFeed(feedId, true); } catch (e) { }
        });
      } catch (e) { }
    });
  } catch (e) { }

  try {
    setupOmochatSettingsListener({
      state,
      settingsManager,
      setupTabs,
      setupGlobalTabSelector,
      clearGlobalFeed: () => {
        clearFeed(state, 'global');
        const el = $('#feed-global');
        if (el) el.innerHTML = '';
        setupGlobalFeed();
      },
      updateGlobalButtonLabel,
      showToast,
      t,
      setupBitchatFeed
    });
  } catch (e) { }

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

    // ログインユーザー名タップでアカウント管理モーダルを開く（ヘッダー & 投稿窓）
    const handleOpenAccountModal = () => {
      if (!state.pubkey && !localStorage.getItem('pubkey')) return;
      import('../ui/modals/account-modal.js').then(mod => {
        if (mod && typeof mod.openAccountModal === 'function') {
          mod.openAccountModal(state, settings, settingsManager, {
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
        }
      }).catch(err => {
        console.warn('[Bootstrap] アカウント管理モーダルの読み込み失敗:', err);
      });
    };

    ['userInfo', 'composerAccountInfo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.onclick = handleOpenAccountModal;
        el.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpenAccountModal();
          }
        };
      }
    });

    // フォローリスト編集ボタン (設定パネル & クイック設定モーダル)
    ['openFollowEditModalBtn', 'openFollowEditModalQuickBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.onclick = () => {
          if (!state.pubkey && !localStorage.getItem('pubkey')) return;
          import('../features/profile/follow-editor.js').then(mod => {
            if (mod && typeof mod.openFollowEditor === 'function') {
              // クイック設定モーダルが開いている場合は一旦閉じる
              const quickModal = document.getElementById('homeDisplayQuickModal');
              if (quickModal) quickModal.hidden = true;

              mod.openFollowEditor(state);
            }
          }).catch(err => {
            console.warn('[Bootstrap] フォローリスト編集モーダルの読み込み失敗:', err);
          });
        };
      }
    });

    // ミュートリスト編集ボタン (設定パネル & クイック設定モーダル)
    ['openMuteEditModalBtn', 'openMuteEditModalQuickBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.onclick = () => {
          if (!state.pubkey && !localStorage.getItem('pubkey')) return;
          import('../features/mute/mute-editor.js').then(mod => {
            if (mod && typeof mod.openMuteEditor === 'function') {
              const quickModal = document.getElementById('homeDisplayQuickModal');
              if (quickModal) quickModal.hidden = true;

              mod.openMuteEditor(state);
            }
          }).catch(err => {
            console.warn('[Bootstrap] ミュートリスト編集モーダルの読み込み失敗:', err);
          });
        };
      }
    });

    // 「ミュートを適用」チェックボックスの相互同期
    const displayMuteCheck = document.getElementById('displayMuteCheck');
    const quickMuteCheck = document.getElementById('homeDisplayQuickMuteCheck');
    if (displayMuteCheck && quickMuteCheck) {
      displayMuteCheck.onchange = () => {
        quickMuteCheck.checked = displayMuteCheck.checked;
      };
      quickMuteCheck.onchange = () => {
        displayMuteCheck.checked = quickMuteCheck.checked;
      };
    }
  } catch (e) {}
}
