import { logInitInfo, getNip19, getSimplePool, getNip04, getNip44, getNostrTools } from './nostr-compat.js';
import { $, $$, getReactionContent, setStatus, showToast } from './utils.js';
import { SettingsManager } from './settings.js';
import { defaultRelays, saveRelays, relayConnect, subOnce, unsubscribeAll, getReadRelays, getWriteRelays, stopMonitoringRelays, loadRelays } from './relay.js';
import { createState, insertEventSorted, clearFeed, findEventById } from './state.js';
import { loadProfile, initializeProfileCache, updateNameDom, updateUserStatusDom } from './profile.js';
import { renderEvent, applyReactionToButton } from './renderer.js';
import { publishNote, reactToEvent, replyToEvent, repostEvent } from './actions.js';
import { setupModalEscClose } from './modals.js';
import { login, autoLogin, updateHeaderName, setupAuthUI } from './auth.js';
import { setupComposerScrollBehavior, revealComposer, syncComposerViewport } from './composer-scroll.js';
import { pickChannelRootId, prefetchChannelMetadata } from './channel.js';
import { addCustomEmojiVariant, clearTextShortcodeRegistry } from './custom-emoji-store.js';
import { setReplyTarget, clearReplyTarget, getReplyTarget, setupCancelReplyButton, getGeohashTarget, setupEmojiPreview, setupEmojiShortcodeSuggest, openHiddenTagCharModal, setupComposerUI } from './composer.js';
import { setQuoteTarget, getQuoteMode } from './composer.js';
import { setupGlobalTabSelector, updateGlobalButtonLabel, showGlobalRelaySelector } from './global-relay.js';
import { setupRelaySettingsUI } from './relay-settings.js';
import { setupMediaLinkHandlers, captureTimelineAnchor, restoreTimelineAnchor } from './url-parser.js';
import { setupMediaViewerClose } from './media-viewer.js';
import { setupProfileModalClose } from './profile-modal.js';
import { setupJsonModalClose } from './json-modal.js';
import { setupTabSwipe } from './tab-swipe.js';
import { setupScrollToTopButton, resetScrollToTopButtonPosition } from './scroll-to-top.js';
import { showProfileModal } from './profile-modal.js';
import { isWebAuthnSupported, authenticateWithPasskey, decryptNsecWithPasskey } from './webauthn.js';
import { decryptNsec } from './crypto.js';
import { setupMuteListUI } from './mute.js';
import { setupTabs as uiSetupTabs, setupDisplaySettings as uiSetupDisplaySettings, setMentionBlink as uiSetMentionBlink, checkMentionBlink as uiCheckMentionBlink, bringModalToFront as uiBringModalToFront } from './ui-setup.js';
import { setupPostLinkUI, updatePostLinkButtonAndModal } from './postlink.js';
import { t, detectBrowserLang, initI18n, applyTranslations } from './i18n.js';
import { EVENTS_TIMEOUT, EVENTS_FETCH_LIMIT, EVENTS_MAX, DEFAULT_OMOCHAT_RELAYS } from './constants.js';
import { setupFeedFetcher, fetchMore } from './feed-fetcher.js';
import { showOmochatSettingsModal } from './modals.js';
import { showReactionModal } from './modals.js';
import { showFeedNotification, sanitizeNotificationBody, ensureNotificationPermission, shouldShowBrowserNotification, normalizeMentionNotificationMode, _notifiedEventIds } from './notification.js';
import { getClosestRelays } from './geo-relay-directory.js';



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

const SHARE_TEXT_PARAM_KEYS = ['text', 'content'];
const SHARE_TEXT_STORAGE_KEY = 'pendingShareText';
const SHARE_TEXT_MAX_LENGTH = 2000;
let shareTextCacheInitialized = false;
let shareTextCache = null;

import { setupKeyboardShortcuts, getSelectedEventEl, setSelectedEventEl } from './keyboard-shortcuts.js';
import { initFeedRenderer, renderFeed, scheduleRender, applyStoredReactionToNode, captureFeedUiStateFromDom, feedLoadState, userKind7Memory } from './feed-renderer.js';
const _feedUiStateById = new Map();
let _infiniteScrollObserver = null;

function ensureFeedUiState(feedId) {
  if (!_feedUiStateById.has(feedId)) {
    _feedUiStateById.set(feedId, {
      selectedEventId: null,
      expandedMutedEventIds: new Set(),
      expandedCwEventIds: new Set()
    });
  }
  return _feedUiStateById.get(feedId);
}

function markFeedEventExpanded(feedId, eventId, type, expanded) {
  try {
    if (!feedId || !eventId) return;
    const uiState = ensureFeedUiState(feedId);
    const setRef = type === 'cw' ? uiState.expandedCwEventIds : uiState.expandedMutedEventIds;
    if (expanded) setRef.add(eventId);
    else setRef.delete(eventId);
  } catch (e) { }
}



function getRenderSettingsWithUiState(feedId) {
  const uiState = ensureFeedUiState(feedId);
  return {
    ...(settings || {}),
    __timelineUiState: uiState,
    __timelineMarkMutedExpanded: (eventId, expanded) => markFeedEventExpanded(feedId, eventId, 'muted', expanded),
    __timelineMarkCwExpanded: (eventId, expanded) => markFeedEventExpanded(feedId, eventId, 'cw', expanded)
  };
}

function sanitizeShareTextCandidate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let normalized = raw.replace(/\+/g, ' ');
  try { normalized = decodeURIComponent(normalized); } catch (e) { }
  // eslint-disable-next-line no-control-regex
  normalized = normalized.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!normalized) return null;
  if (normalized.length > SHARE_TEXT_MAX_LENGTH) normalized = normalized.slice(0, SHARE_TEXT_MAX_LENGTH);
  return normalized;
}

function extractShareTextFromQuery() {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search || '');
    for (const key of SHARE_TEXT_PARAM_KEYS) {
      const value = params.get(key);
      if (!value) continue;
      const sanitized = sanitizeShareTextCandidate(value);
      if (sanitized) return sanitized;
    }
  } catch (e) { }
  return null;
}

function scrubShareTextParamsFromUrl() {
  if (typeof window === 'undefined' || !window.history || !window.location) return;
  try {
    const url = new URL(window.location.href);
    let touched = false;
    SHARE_TEXT_PARAM_KEYS.forEach(key => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        touched = true;
      }
    });
    if (touched) {
      const search = url.searchParams.toString();
      const next = url.pathname + (search ? '?' + search : '') + url.hash;
      window.history.replaceState({}, document.title, next);
    }
  } catch (e) { }
}

function ensureShareTextCache() {
  if (shareTextCacheInitialized) return;
  shareTextCacheInitialized = true;
  const fromQuery = extractShareTextFromQuery();
  if (fromQuery) {
    shareTextCache = fromQuery;
    try { localStorage.setItem(SHARE_TEXT_STORAGE_KEY, fromQuery); } catch (e) { }
    scrubShareTextParamsFromUrl();
    return;
  }
  try {
    const stored = localStorage.getItem(SHARE_TEXT_STORAGE_KEY);
    shareTextCache = stored ? sanitizeShareTextCandidate(stored) : null;
  } catch (e) {
    shareTextCache = null;
  }
}

function consumeShareText() {
  ensureShareTextCache();
  const text = shareTextCache;
  shareTextCache = null;
  try { localStorage.removeItem(SHARE_TEXT_STORAGE_KEY); } catch (e) { }
  return text;
}

// UIヘルパー呼び出し用のローカルラッパー
function setMentionBlink(active) { return uiSetMentionBlink(active); }
function checkMentionBlink() { return uiCheckMentionBlink(); }
function setupTabs(preserve) { return uiSetupTabs(settingsManager, preserve); }
function setupDisplaySettings() {
  // ビルドによっては updatePostLinkButtonAndModal の定義位置が異なるため安全確認
  let updatePostLinkFn = null;
  try {
    if (typeof updatePostLinkButtonAndModal === 'function') updatePostLinkFn = updatePostLinkButtonAndModal;
  } catch (e) {
    // エラーを無視
  }
  try {
    if (!updatePostLinkFn && typeof window !== 'undefined' && typeof window.updatePostLinkButtonAndModal === 'function') updatePostLinkFn = window.updatePostLinkButtonAndModal;
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

    // 先に設定済みならそれを尊重し、未設定時のみ既定値を適用
    if (typeof window.__nokakoiDebug !== 'boolean') {
      try { window.__nokakoiDebug = isLocal || storedDebug; } catch (e) { }
    }

    // console.debug 未対応環境のみフォールバック
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

// 補足: リロード前に console から localStorage で切替可能
// localStorage.setItem('nokakoiDebug','1'); location.reload();
// 無効化:
// localStorage.removeItem('nokakoiDebug'); location.reload();

logInitInfo();

// グローバル状態と設定
const state = createState();
// 起動時にストレージ由来リレーを正規化し、末尾スラッシュ差異などの重複を回避
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
  // globalRelay キー未保存時のみ言語に応じた既定値を設定（明示的 null=全リレーは上書きしない）
  if (!settingsManager.hasRaw('globalRelay')) {
    const lang = storedLang || detectBrowserLang();
    if (lang === 'ja') settingsManager.set('globalRelay', ['wss://yabu.me']);
    else settingsManager.set('globalRelay', ['wss://relay.damus.io']);
  }
} catch (e) { }

// Nostrツール参照
const nip19 = getNip19();

// 位置情報に基づくomochatリレーを非同期で更新・計算する
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

// ユーザー設定の omochat リレーを返し、未設定時は DEFAULT_OMOCHAT_RELAYS へフォールバック
function getOmochatRelays() {
  const isAuto = settingsManager.get('omochatAutoRelays') !== false;
  if (isAuto) {
    const computed = settingsManager.get('omochatComputedRelays');
    if (Array.isArray(computed) && computed.length > 0) {
      return computed.slice();
    }
  }
  const saved = settingsManager.get('omochatRelays');
  return Array.isArray(saved) && saved.length > 0 ? saved.slice() : DEFAULT_OMOCHAT_RELAYS.slice();
}

// スクロール関連のクリーンアップ関数と認証ガード用インターバル
let cleanupScrollBehavior = null;
var authGuardInterval = null; // UI guard interval (var to avoid TDZ in some environments)

// 注: Android ではネイティブ pull-to-refresh を許可。アプリ内PTR UIは導入しない。
// （以前はネイティブPTRを抑止するスタブが存在した）

// ============================================================================
// ビルド情報
// ============================================================================

/**
 * ビルド情報をフッターに表示
 */
async function updateBuildInfo() {
  try {
    const el = document.getElementById('buildInfo');
    if (!el) return;
    const scripts = Array.from(document.scripts || []);
    const getPathname = (src) => {
      try {
        return new URL(src, location.href).pathname;
      } catch {
        return '';
      }
    };
    const appScript = scripts.find(sc => getPathname(sc.src).endsWith('/main.js'));
    const toolsScript = scripts.find(sc => /nostr\.bundle\.min\.js/.test(sc.src));

    let appVer = '';
    if (appScript) {
      const u = new URL(appScript.src, location.href);
      appVer = u.searchParams.get('v') || '';
    }

    let toolsVerStr = '';
    if (toolsScript) {
      try {
        const u2 = new URL(toolsScript.src, location.href);
        const m = u2.pathname.match(/nostr-tools@([^/]+)/);
        toolsVerStr = m ? m[1] : '';
      } catch { }
    }

    const NT = getNostrTools();
    const runtimeToolsVer = (NT && NT.version) ? NT.version : '';

    let textParts = [];
    if (appVer) textParts.push('app ' + appVer);
    if (toolsVerStr) textParts.push('nostr-tools ' + toolsVerStr);
    else if (runtimeToolsVer) textParts.push('nostr-tools ' + runtimeToolsVer);

    let updatedStr = '';
    try {
      const url = appScript ? appScript.src : (new URL('./js/main.js', location.href)).toString();
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      const lm = res.headers.get('Last-Modified');
      if (lm) updatedStr = 'updated ' + new Date(lm).toLocaleString();
    } catch { }

    if (updatedStr) textParts.unshift(updatedStr);
    if (!textParts.length) textParts.push('loaded ' + new Date().toLocaleString());

    el.textContent = ' · ' + textParts.join(' · ');
  } catch (e) {
    console.error('[エラー] ビルド情報の更新に失敗:', e);
  }
}

// ============================================================================
// UIセットアップ
// ============================================================================

// UI 設定関数は `ui-setup.js` へ委譲済みで、このファイル上部のラッパーから呼び出す。
// 重複宣言を避けるため、このセクションは意図的に空にしている。

// ============================================================================
// フィード管理
// ============================================================================



function markFeedHistBufferStart(feedId) {
  feedLoadState[feedId] = feedLoadState[feedId] || {};
  const st = feedLoadState[feedId];
  st.histLoadingCount = (st.histLoadingCount || 0) + 1;
  st.histLoading = true;
}

function markFeedHistBufferEnd(feedId) {
  feedLoadState[feedId] = feedLoadState[feedId] || {};
  const st = feedLoadState[feedId];
  st.histLoadingCount = Math.max(0, (st.histLoadingCount || 1) - 1);
  if (st.histLoadingCount <= 0) {
    st.histLoading = false;
    st.histLoadingCount = 0;
    st.preferFullRender = true;
  }
}

function markFeedPreferFullRender(feedId) {
  feedLoadState[feedId] = feedLoadState[feedId] || {};
  feedLoadState[feedId].preferFullRender = true;
}

function feedFetcherHistHooks() {
  return {
    onHistBufferStart: markFeedHistBufferStart,
    onHistBufferEnd: markFeedHistBufferEnd
  };
}


// 初回restartFeeds呼び出しフラグ（初回起動時のミュートリスト待ち最適化用）
let _restartFeedsCalled = false;

function resolveGlobalRelays(settingsManager, stateRelays) {
  const mergeHome = settingsManager.get('globalMergeHome') === true;
  const globalRelay = settingsManager.get('globalRelay');
  if (mergeHome && Array.isArray(globalRelay) && globalRelay.length === 0) {
    return [];
  }
  if (!globalRelay || (Array.isArray(globalRelay) && globalRelay.length === 0)) {
    return getReadRelays(stateRelays) || [];
  }
  if (Array.isArray(globalRelay)) return globalRelay.slice();
  return [globalRelay];
}

function buildHomeLoadMoreFiltersForGlobalMerge(until) {
  try {
    const followsForMore = (state.feeds['home'] && state.feeds['home'].follows) || [];
    if (!followsForMore.length) return [];
    return [{ kinds: [1, 6], authors: followsForMore, limit: EVENTS_FETCH_LIMIT, until }];
  } catch (e) {
    return [];
  }
}

function buildHomeLoadMoreFilters(until) {
  try {
    const pubkey = localStorage.getItem('pubkey');
    const followsForMore = (state.feeds['home'] && state.feeds['home'].follows) || [];
    if (!followsForMore.length) return [];
    const baseFilters = [
      { kinds: [1, 6], authors: followsForMore, limit: EVENTS_FETCH_LIMIT },
      { kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
      { kinds: [7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }
    ];
    const optionalHomeFollowKinds = [];
    if (settingsManager.get('showHomeReactions') === true) optionalHomeFollowKinds.push(7);
    if (settingsManager.get('showHomeChannel') === true) optionalHomeFollowKinds.push(42);
    if (settingsManager.get('showHomeRepost16') === true) optionalHomeFollowKinds.push(16);
    if (optionalHomeFollowKinds.length > 0) {
      baseFilters.push({ kinds: optionalHomeFollowKinds, authors: followsForMore, limit: EVENTS_FETCH_LIMIT });
    }
    return baseFilters.map(f => Object.assign({}, f, { until }));
  } catch (e) {
    return [];
  }
}

function trimFeedToMax(feedId, maxCount = EVENTS_MAX) {
  const feed = state.feeds[feedId];
  const list = feed?.list;
  if (!Array.isArray(list) || list.length <= maxCount) return;
  const removed = list.splice(maxCount);
  for (const e of removed) feed.map.delete(e.id);
}

function isGlobalMergeKind(ev) {
  const k = ev?.kind;
  return k === 1 || k === 6;
}

function mirrorHomeEventToGlobal(ev) {
  if (settingsManager.get('globalMergeHome') !== true) return false;
  if (!ev?.id || !isGlobalMergeKind(ev)) return false;
  const gfeed = state.feeds['global'];
  if (!gfeed?.map || gfeed.map.has(ev.id)) return false;
  insertEventSorted(state, 'global', ev);
  return true;
}

function trimGlobalMergedToLimit(maxCount) {
  const gfeed = state.feeds['global'];
  if (!gfeed || !Array.isArray(gfeed.list) || gfeed.list.length <= maxCount) return;
  gfeed.list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const keep = gfeed.list.slice(0, maxCount);
  const keepIds = new Set(keep.map(e => e && e.id));
  gfeed.list = keep;
  try {
    for (const id of Array.from(gfeed.map.keys())) {
      if (!keepIds.has(id)) gfeed.map.delete(id);
    }
  } catch (e) { }
}

function seedGlobalFromHomeKind16() {
  if (settingsManager.get('globalMergeHome') !== true) return false;
  const homeList = state.feeds['home']?.list || [];
  let added = false;
  for (const ev of homeList) {
    if (mirrorHomeEventToGlobal(ev)) added = true;
  }
  return added;
}

function finalizeMergedGlobalFeed(render = true) {
  if (settingsManager.get('globalMergeHome') !== true) return;
  seedGlobalFromHomeKind16();
  trimGlobalMergedToLimit(EVENTS_FETCH_LIMIT);
  if (render) {
    markFeedPreferFullRender('global');
    scheduleRender('global');
  }
}

function mergeFetchedIntoGlobalList(moreBuffer, startListLength) {
  const gfeed = state.feeds['global'];
  if (!gfeed) return 0;
  const existing = Array.isArray(gfeed.list) ? gfeed.list.slice() : [];
  let existingIds = new Set();
  try {
    for (const k of gfeed.map.keys()) existingIds.add(k);
  } catch (e) {
    for (const e of existing) if (e?.id) existingIds.add(e.id);
  }
  for (const ev of moreBuffer.values()) {
    if (!ev?.id || !isGlobalMergeKind(ev) || existingIds.has(ev.id)) continue;
    existing.push(ev);
    existingIds.add(ev.id);
  }
  existing.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const keepCount = Math.min(startListLength + EVENTS_FETCH_LIMIT, EVENTS_MAX);
  const keep = existing.slice(0, keepCount);
  gfeed.list = keep.slice();
  const m = new Map();
  for (const ev of keep) {
    try { if (ev?.id) m.set(ev.id, ev); } catch (e) { }
  }
  gfeed.map = m;
  return gfeed.list.length;
}

function runMergedGlobalLoadMore({ mergeUntil, startListLength }) {
  return new Promise((resolve) => {
    const gfeed = state.feeds['global'];
    if (!gfeed || mergeUntil == null) {
      resolve({ madeProgress: false });
      return;
    }
    const listBeforeLen = gfeed.list?.length || 0;
    const oldestBefore = getFeedOldestCreatedAt(gfeed.list);
    const globalRelays = resolveGlobalRelays(settingsManager, state.relays);
    const homeFilters = buildHomeLoadMoreFiltersForGlobalMerge(mergeUntil);
    const readRelays = getReadRelays(state.relays) || [];
    const moreBuffer = new Map();
    const perRelayUnsubs = new Set();
    const perRelayTimeout = Math.max(EVENTS_TIMEOUT, 10000);
    
    // リレーごとにフィルタをグループ化
    const relayToFilters = new Map();
    if (globalRelays.length > 0) {
      globalRelays.forEach((relay) => {
        if (!relayToFilters.has(relay)) relayToFilters.set(relay, []);
        relayToFilters.get(relay).push({ kinds: [1, 6], limit: EVENTS_FETCH_LIMIT, until: mergeUntil });
      });
    }
    if (homeFilters.length > 0 && readRelays.length > 0) {
      readRelays.forEach((relay) => {
        if (!relayToFilters.has(relay)) relayToFilters.set(relay, []);
        const arr = relayToFilters.get(relay);
        homeFilters.forEach((filter) => arr.push(filter));
      });
    }
    if (relayToFilters.size === 0) {
      resolve({ madeProgress: false });
      return;
    }

    let settled = false;
    const cleanupAll = () => {
      try {
        for (const u of Array.from(perRelayUnsubs)) {
          try { if (typeof u === 'function') u(); } catch (e) { }
        }
        perRelayUnsubs.clear();
      } catch (e) { }
    };
    const finalize = () => {
      if (settled) return;
      settled = true;
      try { mergeFetchedIntoGlobalList(moreBuffer, startListLength); } catch (e) { }
      const listAfterLen = gfeed.list?.length || 0;
      const oldestAfter = getFeedOldestCreatedAt(gfeed.list);
      const madeProgress = listAfterLen > listBeforeLen || listAfterLen > startListLength || (
        oldestAfter != null && (oldestBefore == null || oldestAfter < oldestBefore)
      );
      cleanupAll();
      resolve({ madeProgress });
    };
    let finishedSubs = 0;
    const expected = relayToFilters.size;
    for (const [relay, filtersList] of relayToFilters.entries()) {
      try {
        const key = 'merged_global_more_' + relay + '_' + Math.random().toString(36).slice(2, 8);
        const unsub = subOnce(state, key, filtersList, (ev, r, done) => {
          try { if (ev?.id && isGlobalMergeKind(ev)) moreBuffer.set(ev.id, ev); } catch (e) { }
          if (done) {
            finishedSubs += 1;
            if (finishedSubs >= expected) finalize();
          }
        }, [relay]);
        if (typeof unsub === 'function') perRelayUnsubs.add(unsub);
      } catch (e) {
        finishedSubs += 1;
        if (finishedSubs >= expected) finalize();
      }
    }
    const to = setTimeout(() => { try { finalize(); } catch (e) { } }, perRelayTimeout);
    perRelayUnsubs.add(() => { try { clearTimeout(to); } catch (e) { } });
  });
}

function getFeedOldestCreatedAt(list, kindFilter = null) {
  const src = Array.isArray(list) ? list : [];
  for (let i = src.length - 1; i >= 0; i--) {
    const ev = src[i];
    if (!ev?.created_at) continue;
    if (kindFilter && !kindFilter(ev)) continue;
    return ev.created_at;
  }
  return null;
}

// メモリ上の対応表: targetEventId -> { content, emojiTags }（kind=7 由来）


/**
 * フィードにイベントを追加
 * keepLatestCount は任意。relay も任意でログ用途に受け取る
 */
function addToFeed(feedId, ev, keepLatestCount = null, relay = null) {
  if (ev != null) {
    // kind=30315（User Status）の処理: フィードには追加せずステータスのみ更新
    if (ev.kind === 30315) {
      if (typeof updateUserStatusDom === 'function') {
        // dタグがmusicかチェック
        const dTag = Array.isArray(ev.tags) ? ev.tags.find(t => t[0] === 'd') : null;
        if (dTag && dTag[1] === 'music') {
          let content = ev.content.trim();
          // 期限切れチェック
          const expTag = ev.tags.find(t => t[0] === 'expiration');
          if (expTag && expTag[1]) {
             const exp = parseInt(expTag[1]);
             if (!isNaN(exp) && Date.now() / 1000 > exp) {
               content = null;
             }
          }
          // ステータス更新
          if (content) {
            state.userStatuses.set(ev.pubkey, {
              content: content,
              loaded: true,
              loading: false,
              timestamp: ev.created_at,
              fetchedAt: Date.now()
            });
          } else {
             state.userStatuses.set(ev.pubkey, { content: null, loaded: true, loading: false, fetchedAt: Date.now() });
          }
          updateUserStatusDom(state, ev.pubkey);
        }
      }
      return;
    }

    const feed = state.feeds[feedId];
    const wasEmpty = Array.isArray(feed?.list) && feed.list.length === 0;
    const histLoading = feedLoadState[feedId]?.histLoading === true;
    const listBeforeLen = feed.list?.length || 0;
    const topBefore = feed.list?.[0] || null;
    const bottomBefore = listBeforeLen > 0 ? feed.list[listBeforeLen - 1] : null;
    if (histLoading) {
      insertEventSorted(state, feedId, ev);
    } else {
      if (feed && ev.id && !feed.map.has(ev.id)) {
        feed.map.set(ev.id, ev);
        feed.list.unshift(ev);
        if (ev.created_at && ev.created_at > (feed.lastSeen || 0)) {
          feed.lastSeen = ev.created_at;
        }
      }
    }
    if (ev.kind === 42) {
      try {
        const channelRootId = pickChannelRootId(ev);
        if (channelRootId) prefetchChannelMetadata(state, channelRootId);
      } catch (e) { }
    }
    const listAfterLen = feed.list?.length || 0;
    if (listAfterLen > listBeforeLen && !histLoading) {
      const idx = feed.list.findIndex(e => e?.id === ev.id);
      const ts = ev.created_at || 0;
      const topTs = topBefore?.created_at || 0;
      const bottomTs = bottomBefore?.created_at || 0;
      const isPrepend = idx === 0;
      const isAppend = idx === listAfterLen - 1 && ts <= bottomTs;
      if (!isPrepend && !isAppend) markFeedPreferFullRender(feedId);
    }

    // 自分が送信したリアクション（kind=7）を永続設定とメモリマップの両方に保存
    try {
      if (ev && ev.kind === 7) {
        const myPub = localStorage.getItem('pubkey');
        if (myPub && ev.pubkey === myPub) {
          const eTag = (ev.tags || []).find(t => Array.isArray(t) && t[0] === 'e' && t[1]);
          const targetId = eTag && eTag[1];
          if (targetId) {
            const reactionEmojiTags = (ev.tags || []).filter(t => Array.isArray(t) && t[0] === 'emoji' && t.length >= 3);
            const storedReaction = reactionEmojiTags.length ? { content: ev.content || '', emojiTags: reactionEmojiTags } : (ev.content || '');
            try { settingsManager.saveUserReaction(targetId, storedReaction); } catch (e) { }
            try {
              userKind7Memory.set(targetId, {
                content: ev.content || '',
                emojiTags: reactionEmojiTags
              });
            } catch (e) { }
            // 対象イベントが既に描画済みなら react ボタンを即時更新
            try {
              const btn = document.querySelector('.event[data-event-id="' + targetId + '"] .btn-react');
              if (btn) {
                try {
                  // 可能なら renderer ヘルパーを使い custom emoji を画像表示
                  const targetEv = findEventById(state, targetId) || null;
                  const emojiTags = reactionEmojiTags.length ? reactionEmojiTags : ((targetEv && targetEv.tags) ? targetEv.tags : []);
                  try { applyReactionToButton(btn, storedReaction, emojiTags); } catch (e) {
                    if (ev.content === '+') btn.textContent = '★';
                    else btn.textContent = ev.content || '';
                  }
                  btn.dataset.reacted = 'true';
                } catch (e) { }
              }
            } catch (e) { }
          }
        }
      }
    } catch (e) { }

    //1件目が追加された直後は即描画（hist バッファ中は finalize まで待つ）
    if (!histLoading && wasEmpty && feed.list.length === 1) {
      renderFeed(feedId);
    }

    // ---修正: mentionsフィードに新着が来たら未読判定で明滅ON---
    if (feedId === 'mentions') {
      try {
        // mentions 初期履歴ロード中は点滅を発火しない
        if (typeof window !== 'undefined' && window.__mentionsInitialLoading) {
          // 初期ロード中は点滅判定上、既読として扱う
        } else {
          // storage から最終閲覧時刻を取得
          const lastViewed = parseInt(localStorage.getItem('mentions_last_viewed_at') || '0', 10);
          const lastViewedId = localStorage.getItem('mentions_last_viewed_id') || '';
          // UI 上で mentions タブがアクティブか判定
          let activeTab = null;
          try {
            const activeTabEl = document.querySelector('.tab.active');
            activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : null;
          } catch (e) { }

          // mentions タブがアクティブなら新着を既読扱いにし created_at と id を保存
          if (activeTab === 'mentions') {
            try {
              const created = ev && ev.created_at ? ev.created_at : Math.floor(Date.now() / 1000);
              const id = ev && ev.id ? ev.id : '';
              localStorage.setItem('mentions_last_viewed_at', String(created));
              localStorage.setItem('mentions_last_viewed_id', String(id));
              // mentions 閲覧中は点滅しない
              setMentionBlink(false);
            } catch (e) { }
          } else {
            // mentions 非閲覧時は、最終閲覧より新しければ点滅
            if (ev && ev.created_at) {
              // 保存済み id と一致するイベントは既読扱い
              if (lastViewedId && ev.id && ev.id === lastViewedId) {
                // 何もしない
              } else if (ev.created_at > lastViewed) {
                setMentionBlink(true);
                try {
                  const notifMode = normalizeMentionNotificationMode(
                    settingsManager && settingsManager.get('mentionNotificationMode')
                  );
                  if (notifMode === 'background') {
                    (async () => {
                      try {
                        if (!shouldShowBrowserNotification(notifMode)) return;
                        const permOk = await ensureNotificationPermission();
                        if (!permOk) return;
                        if (ev && ev.id && _notifiedEventIds.has(ev.id)) return;
                        let authorLabel = '';
                        try {
                          if (ev && ev.pubkey && state && state.profiles && state.profiles.get(ev.pubkey)) {
                            const p = state.profiles.get(ev.pubkey) || {};
                            authorLabel = (p.display_name || p.name || '');
                          }
                        } catch (e) { }
                        if (!authorLabel && ev && ev.pubkey && typeof nip19 === 'object' && typeof nip19.npubEncode === 'function') {
                          try { const np = nip19.npubEncode(ev.pubkey); authorLabel = np && np.length > 0 ? (np.length > 12 ? np.slice(0,12) + '…' : np) : ev.pubkey.slice(0,8); } catch (e) { authorLabel = ev.pubkey.slice(0,8); }
                        }
                        const title = authorLabel ? ('新着: ' + authorLabel) : '新着通知';
                        const body = sanitizeNotificationBody(ev && ev.content ? ev.content : t('notification.new_item'));
                        showFeedNotification(title, { body, icon: new URL('../icon/nokakoi-192.png', import.meta.url).href }, ev && ev.id ? ev.id : null, 'mentions', notifMode);
                      } catch (e) { }
                    })();
                  }
                } catch (e) { }
              }
            }
          }
        }
      } catch (e) { }
    }
  }
  const list = state.feeds && state.feeds[feedId] && state.feeds[feedId].list;
  // keepLatestCount 指定時（初期表示・追加取得時）は最新 N 件のみ保持
  if (keepLatestCount && Array.isArray(list) && list.length > keepLatestCount) {
    const keep = list.slice(0, keepLatestCount);
    const keepIds = new Set(keep.map(e => e.id));
    state.feeds[feedId].list = keep;
    for (const id of Array.from(state.feeds[feedId].map.keys())) {
      if (!keepIds.has(id)) state.feeds[feedId].map.delete(id);
    }
  }
  // live や通常追加時は EVENTS_MAX 件まで保持
  trimFeedToMax(feedId);
  if (!feedLoadState[feedId]?.histLoading) scheduleRender(feedId);
  if (feedId === 'home' && settingsManager.get('globalMergeHome') === true && ev != null && isGlobalMergeKind(ev)) {
    const gfeed = state.feeds['global'];
    const gBeforeLen = gfeed?.list?.length || 0;
    const gTopBefore = gfeed?.list?.[0] || null;
    const gBottomBefore = gBeforeLen > 0 ? gfeed.list[gBeforeLen - 1] : null;
    if (mirrorHomeEventToGlobal(ev) && !feedLoadState['global']?.histLoading) {
      const gAfterLen = gfeed?.list?.length || 0;
      if (gAfterLen > gBeforeLen) {
        const gIdx = gfeed.list.findIndex(e => e?.id === ev.id);
        const ts = ev.created_at || 0;
        const isPrepend = gIdx === 0 && (gBeforeLen === 0 || ts >= (gTopBefore?.created_at || 0));
        const isAppend = gIdx === gAfterLen - 1 && ts <= (gBottomBefore?.created_at || 0);
        if (!isPrepend && !isAppend) markFeedPreferFullRender('global');
      }
      scheduleRender('global');
    }
  }
}



/**
 * NIP-30 カスタム絵文字購読のセットアップ
 * 1) kind:10030（絵文字セットリスト）を取得
 * 2) kind:10030 の emoji タグ（直接記載）を取り込む
 * 3) kind:10030 の a タグで参照される kind:30030 も取得
 */
function getCustomEmojiAuthors() {
  const authors = new Set();
  try {
    const myPub = localStorage.getItem('pubkey');
    if (myPub) authors.add(String(myPub));
  } catch (e) { }
  try {
    const fetchFollow = settingsManager && settingsManager.get('fetchFollowEmoji') === true;
    if (fetchFollow) {
      const follows = (state && state.feeds && state.feeds.home && Array.isArray(state.feeds.home.follows))
        ? state.feeds.home.follows
        : [];
      for (const pk of follows) {
        if (pk) authors.add(String(pk));
      }
    }
  } catch (e) { }
  return Array.from(authors);
}

function parseEmojiSetAddress(addr) {
  try {
    if (!addr) return null;
    const s = String(addr);
    if (!s.startsWith('30030:')) return null;
    const first = s.indexOf(':');
    const second = s.indexOf(':', first + 1);
    if (second < 0) return null;
    const pubkey = s.slice(first + 1, second);
    const identifier = s.slice(second + 1);
    if (!pubkey) return null;
    return { pubkey, identifier, address: `30030:${pubkey}:${identifier}` };
  } catch (e) {
    return null;
  }
}

function getEventIdentifier(ev) {
  try {
    if (!ev || !Array.isArray(ev.tags)) return '';
    const dTag = ev.tags.find(t => Array.isArray(t) && t[0] === 'd');
    return dTag && typeof dTag[1] !== 'undefined' ? String(dTag[1]) : '';
  } catch (e) {
    return '';
  }
}

function dispatchCustomEmojiUpdated() {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('customEmoji:updated'));
    }
  } catch (e) { }
}

function ingestDirectEmojiTagsFromListEvent(ev) {
  if (!ev || !Array.isArray(ev.tags)) return 0;
  const listAddress = `10030:${ev.pubkey}:${getEventIdentifier(ev)}`;
  const emojiTags = ev.tags.filter(t => Array.isArray(t) && t[0] === 'emoji' && t[1] && t[2]);
  for (const tag of emojiTags) {
    const shortcode = String(tag[1]);
    const url = String(tag[2]);
    const address = tag[3] ? String(tag[3]) : listAddress;
    addCustomEmojiVariant(state.customEmojis, shortcode, { url, address });
  }
  return emojiTags.length;
}

function setupCustomEmojiSubscription() {
  try {
    if (!state || !state.pool) return;
    const relays = getReadRelays(state.relays);
    if (!relays || relays.length === 0) return;

    // 既存の購読があれば中止（重複防止）
    try {
        if (state.subs && state.subs.has('custom-emoji')) {
        const oldSub = state.subs.get('custom-emoji');
        try { if (oldSub && typeof oldSub.close === 'function') oldSub.close(); } catch (e) { }
      }
      if (state.subs && state.subs.has('custom-emoji-list')) {
        const oldListSub = state.subs.get('custom-emoji-list');
        try { if (oldListSub && typeof oldListSub.close === 'function') oldListSub.close(); } catch (e) { }
      }
    } catch (e) { }

    // いったんクリアして再構築
    try { state.customEmojis.clear(); } catch (e) { }
    try { window.__customEmojis = state.customEmojis; } catch (e) { }
    dispatchCustomEmojiUpdated();

    // kind:10030 購読対象著者: 自分(+設定でフォロー)
    const authors = getCustomEmojiAuthors();
    if (!authors.length) return;

    const latestListByAuthor = new Map();
    const listSub = state.pool.subscribeMany(relays, [{ kinds: [10030], authors, limit: 1000 }], {
      onevent: (ev) => {
        try {
          if (!ev || ev.kind !== 10030 || !ev.pubkey) return;
          const prev = latestListByAuthor.get(ev.pubkey);
          if (!prev || Number(ev.created_at || 0) >= Number(prev.created_at || 0)) {
            latestListByAuthor.set(ev.pubkey, ev);
          }
        } catch (e) { }
      },
      oneose: () => {
        try {
          const referenced = new Set();
          const refAuthors = new Set();
          const refDs = new Set();
          let directEmojiCount = 0;

          for (const ev of latestListByAuthor.values()) {
            try {
              directEmojiCount += ingestDirectEmojiTagsFromListEvent(ev);
              if (!Array.isArray(ev.tags)) continue;
              for (const t of ev.tags) {
                if (!Array.isArray(t) || t[0] !== 'a' || !t[1]) continue;
                const parsed = parseEmojiSetAddress(t[1]);
                if (!parsed) continue;
                referenced.add(parsed.address);
                refAuthors.add(parsed.pubkey);
                refDs.add(parsed.identifier);
              }
            } catch (e) { }
          }

          if (directEmojiCount > 0) {
            try { window.__customEmojis = state.customEmojis; } catch (e) { }
            dispatchCustomEmojiUpdated();
          }

          if (!referenced.size) {
            if (directEmojiCount > 0) {
              console.debug('[Custom Emoji] kind:10030 直接 emoji のみロード完了');
            } else {
              console.debug('[Custom Emoji] kind:10030 に emoji がありません');
            }
            return;
          }

          const filters = [{ kinds: [30030], authors: Array.from(refAuthors), '#d': Array.from(refDs), limit: 1000 }];
          const sub = state.pool.subscribeMany(relays, filters, {
            onevent: (ev) => {
              try {
                if (!ev || ev.kind !== 30030 || !ev.pubkey || !Array.isArray(ev.tags)) return;
                const identifier = getEventIdentifier(ev);
                const coordinate = `30030:${ev.pubkey}:${identifier}`;
                if (!referenced.has(coordinate)) return;

                const emojiTags = ev.tags.filter(t => Array.isArray(t) && t[0] === 'emoji' && t[1] && t[2]);
                for (const tag of emojiTags) {
                  const shortcode = String(tag[1]);
                  const url = String(tag[2]);
                  const address = tag[3] ? String(tag[3]) : coordinate;
                  addCustomEmojiVariant(state.customEmojis, shortcode, { url, address });
                }

                try { window.__customEmojis = state.customEmojis; } catch (e) { }
                dispatchCustomEmojiUpdated();
              } catch (e) {
                console.warn('[Custom Emoji] kind:30030 処理に失敗:', e);
              }
            },
            oneose: () => {
              console.debug('[Custom Emoji] kind:10030 -> kind:30030 初期ロード完了');
            }
          });

          try { state.subs.set('custom-emoji', sub); } catch (e) { }
          try { window.__customEmojiSub = sub; } catch (e) { }
        } catch (e) {
          console.warn('[Custom Emoji] kind:10030 解析に失敗:', e);
        }
      }
    });

    try { state.subs.set('custom-emoji-list', listSub); } catch (e) { }
  } catch (e) {
    console.warn('[Custom Emoji] セットアップに失敗:', e);
  }
}

/**
 * グローバルフィードのセットアップ
 */
function setupGlobalFeed() {
  const relays = resolveGlobalRelays(settingsManager, state.relays);
  const mergeHome = settingsManager.get('globalMergeHome') === true;
  if (!relays || relays.length === 0) {
    if (!mergeHome) {
      console.warn('[警告] グローバルフィード用リレーがありません');
    } else {
      try {
        if (!state.feeds['global']) state.feeds['global'] = { list: [], map: new Map() };
        delete state.feeds['global'].mergedPaginationUntil;
        finalizeMergedGlobalFeed(true);
      } catch (e) { }
    }
    return;
  }
  // history + live の購読処理は共通 feed-fetcher を利用
  try {
    if (!state.feeds['global']) state.feeds['global'] = { list: [], map: new Map() };
    if (mergeHome) delete state.feeds['global'].mergedPaginationUntil;
    const histFilters = [{ kinds: [1, 6], limit: EVENTS_FETCH_LIMIT }];
    const since = Math.floor(Date.now() / 1000);
    const liveFilters = [
      { kinds: [1, 6], since }
    ];
    // global 向け music status のライブ更新は表示設定が有効な場合のみ購読
    try {
      if (settingsManager.get('showMusicStatus') !== false) {
        liveFilters.push({ kinds: [30315], '#d': ['music'], since });
      }
    } catch (e) { /* ignore */ }
    const fetcher = setupFeedFetcher({
      state,
      feedId: 'global',
      histFilters,
      liveFilters,
      relays: relays,
      addToFeed,
      scheduleRender,
      eventsFetchLimit: EVENTS_FETCH_LIMIT,
      eventsTimeout: Math.max(EVENTS_TIMEOUT, 3000),
      histKeepLimit: EVENTS_FETCH_LIMIT,
      ...feedFetcherHistHooks(),
      onHistFinalize: mergeHome ? () => {
        try { finalizeMergedGlobalFeed(true); } catch (e) { }
      } : null
    });
    try { state._globalFetcher = fetcher; } catch (e) { }
  } catch (e) {
    console.warn('[Main] setupGlobalFeed に失敗したため元の挙動へフォールバック', e);
  }
}

/**
 * bitchat フィードのセットアップ（kind:20000）
 */
function setupBitchatFeed() {
const showOmochat = settingsManager.get('showOmochat') !== false;
if (!showOmochat) return; // do not setup feed or connect if disabled

if (!state.feeds['bitchat']) state.feeds['bitchat'] = { list: [], map: new Map() };
const relays = getOmochatRelays();

  const geohash = settingsManager.get('omochatGeohash') || 'xn';
  const subordinate = settingsManager.get('omochatSubordinate') === true;

  // kind:20000
  try {
    let histFilters, liveFilters;
    let feedAdder = addToFeed;

    if (subordinate) {
      // kind:20000 を全取得し、クライアント側でフィルタ
      histFilters = [{ kinds: [20000], limit: EVENTS_FETCH_LIMIT }];
      const since = Math.floor(Date.now() / 1000);
      liveFilters = [{ kinds: [20000], since }];

      const matchesGeohash = (ev) => {
        if (!ev || ev.kind !== 20000) return false;
        const gTag = ev.tags && ev.tags.find(t => t[0] === 'g');
        const gVal = gTag ? gTag[1] : '';
        return !!(gVal && gVal.startsWith(geohash));
      };

      // geohash 接頭辞で絞り込むためのカスタム add 処理
      feedAdder = (fid, ev, limit, r) => {
        try {
          if (matchesGeohash(ev)) addToFeed(fid, ev, limit, r);
        } catch (e) { }
      };

      const fetcher = setupFeedFetcher({
        state,
        feedId: 'bitchat',
        histFilters,
        liveFilters,
        relays,
        addToFeed: feedAdder,
        scheduleRender,
        eventsFetchLimit: EVENTS_FETCH_LIMIT,
        eventsTimeout: Math.max(EVENTS_TIMEOUT, 3000),
        acceptHistEvent: matchesGeohash,
        ...feedFetcherHistHooks()
      });
      try { state._bitchatFetcher = fetcher; } catch (e) { }
      return;
    } else {
      // relay 側で exact match フィルタ
      histFilters = [{ kinds: [20000], '#g': [geohash], limit: EVENTS_FETCH_LIMIT }];
      const since = Math.floor(Date.now() / 1000);
      liveFilters = [{ kinds: [20000], '#g': [geohash], since }];
    }

    const fetcher = setupFeedFetcher({
      state,
      feedId: 'bitchat',
      histFilters,
      liveFilters,
      relays,
      addToFeed: feedAdder,
      scheduleRender,
      eventsFetchLimit: EVENTS_FETCH_LIMIT,
      eventsTimeout: Math.max(EVENTS_TIMEOUT, 3000),
      ...feedFetcherHistHooks()
    });
    try { state._bitchatFetcher = fetcher; } catch (e) { }
  } catch (e) {
    console.warn('[Main] setupBitchatFeed に失敗', e);
  }
}

/**
 * 自動フォローフィードのセットアップ
 */
function setupAuthedFeeds() {
  const pubkey = localStorage.getItem('pubkey');
  subOnce(state, 'follows', [{ kinds: [3], authors: [pubkey], limit: 1 }], function (ev) {
    if (!ev) return; // ignore EOSE/empty callback
    const tags = ev.tags || [];
    const follows = [];
    try {
      for (const t of tags) {
        try {
          if (!t || t.length < 2) continue;
          if (t[0] !== 'p') continue;
          const fpk = t[1];
          if (!fpk) continue;
          follows.push(fpk);
          let pet = null;
          if (t.length >= 4 && t[3]) pet = String(t[3]);
          else if (t.length >= 3 && t[2]) {
            const maybe = String(t[2]);
            if (!maybe.startsWith('wss://') && !maybe.startsWith('ws://') && !maybe.startsWith('http://') && !maybe.startsWith('https://')) {
              pet = maybe;
            }
          }
          if (pet) {
            try { state.followPetnames.set(fpk, pet); } catch (e) { }
          }
        } catch (e) { }
      }
    } catch (e) { }

    // follows を保持
    if (!state.feeds['home']) state.feeds['home'] = { list: [], map: new Map(), follows: follows };
    else state.feeds['home'].follows = follows;

    // follows 取得後に kind:30030 購読を自分+フォロー条件で張り直す
    try { setupCustomEmojiSubscription(); } catch (e) { }

    try {
      for (const pk of follows) {
        try {
          if (state.followPetnames && state.followPetnames.has(pk)) {
            try { updateNameDom(state, pk, nip19); } catch (e) { }
          }
        } catch (e) { }
      }
    } catch (e) { }

    if (!follows.length) return;

    const includeHomeReactions = settingsManager.get('showHomeReactions') === true;
    const includeHomeOmochat = settingsManager.get('showHomeOmochat') === true;
    const includeHomeChannel = settingsManager.get('showHomeChannel') === true;
    const includeHomeRepost16 = settingsManager.get('showHomeRepost16') === true;
    const optionalHomeFollowKinds = [];
    if (includeHomeReactions) optionalHomeFollowKinds.push(7);
    if (includeHomeChannel) optionalHomeFollowKinds.push(42);
    if (includeHomeRepost16) optionalHomeFollowKinds.push(16);

    // home: 複数の hist/live フィルタで feed-fetcher を使用
    try {
      const homeHist = [
        { kinds: [1, 6], authors: follows, limit: EVENTS_FETCH_LIMIT },
        { kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
        { kinds: [7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }
      ];
      if (optionalHomeFollowKinds.length > 0) {
        homeHist.push({ kinds: optionalHomeFollowKinds, authors: follows, limit: EVENTS_FETCH_LIMIT });
      }
      if (includeHomeOmochat) {
        homeHist.push({ kinds: [20000], authors: follows, limit: EVENTS_FETCH_LIMIT });
      }
      const sinceLive = Math.floor(Date.now() / 1000);
      const homeLive = [
        { kinds: [1, 6], authors: follows, since: sinceLive },
        { kinds: [1, 6, 7], '#p': [pubkey], since: sinceLive },
        { kinds: [7, 42, 16], authors: [pubkey], since: sinceLive }
      ];
      // follows 向け kind:30315（User Status）監視は表示設定が有効な場合のみ購読
      try {
        if (settingsManager.get('showMusicStatus') !== false) {
          homeLive.push({ kinds: [30315], authors: follows, '#d': ['music'], since: sinceLive });
        }
      } catch (e) { /* ignore */ }
      if (optionalHomeFollowKinds.length > 0) {
        homeLive.push({ kinds: optionalHomeFollowKinds, authors: follows, since: sinceLive });
      }
      if (includeHomeOmochat) {
        homeLive.push({ kinds: [20000], authors: follows, since: sinceLive });
      }

      // history oneshot 購読作成前に read relays があることを確認。
      // 初期ロードで state.relays が空だと取りこぼす可能性があるため
      // softReload 同様に数回リトライする。
      (function createHomeFetcher(attempts) {
        try {
          const relaysForHist = getReadRelays(state.relays) || [];
          if ((!relaysForHist || relaysForHist.length === 0) && attempts < 5) {
            setTimeout(() => createHomeFetcher(attempts + 1), 300);
            return;
          }
          // フィルタをリレーごとに分割
          const normalHist = homeHist.filter(f => !(f.kinds && f.kinds[0] === 20000));
          const omochatHist = homeHist.filter(f => f.kinds && f.kinds[0] === 20000);
          const normalLive = homeLive.filter(f => !(f.kinds && f.kinds[0] === 20000));
          const omochatLive = homeLive.filter(f => f.kinds && f.kinds[0] === 20000);

          // 通常イベント用 fetcher
          if (normalHist.length > 0 || normalLive.length > 0) {
            const mergeHomeOn = settingsManager.get('globalMergeHome') === true;
            const homeFetcher = setupFeedFetcher({
              state,
              feedId: 'home',
              histFilters: normalHist,
              liveFilters: normalLive,
              relays: relaysForHist,
              addToFeed,
              scheduleRender,
              eventsFetchLimit: EVENTS_FETCH_LIMIT,
              eventsTimeout: Math.max(EVENTS_TIMEOUT, 10000),
              stampReceivedAt: mergeHomeOn,
              ...feedFetcherHistHooks(),
              onHistFinalize: mergeHomeOn ? () => {
                try { finalizeMergedGlobalFeed(true); } catch (e) { }
              } : null
            });
            try { state._homeFetcher = homeFetcher; } catch (e) { }
          }
          // omochat 専用リレー用 fetcher
          if (omochatHist.length > 0 || omochatLive.length > 0) {
            const omochatFetcher = setupFeedFetcher({
              state,
              feedId: 'home',
              histFilters: omochatHist,
              liveFilters: omochatLive,
              relays: getOmochatRelays(),
              addToFeed,
              scheduleRender,
              eventsFetchLimit: EVENTS_FETCH_LIMIT,
              eventsTimeout: Math.max(EVENTS_TIMEOUT, 10000),
              ...feedFetcherHistHooks()
            });
            try { state._homeOmochatFetcher = omochatFetcher; } catch (e) { }
          }
        } catch (e) { }
      })(0);
    } catch (e) {
      // フォールバック: 従来挙動（既存購読を維持）
    }

    // mentions: fetcher を使いつつ初期ロード中フラグで点滅を抑制
    try {
      if (!state.feeds['mentions']) state.feeds['mentions'] = { list: [], map: new Map() };
      try { window.__mentionsInitialLoading = true; } catch (e) { }
      const sinceM = Math.floor(Date.now() / 1000);
      const mentionsHist = [{ kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT }];
      const mentionsLive = [{ kinds: [1, 6, 7], '#p': [pubkey], since: sinceM }];
      const mentionsFetcher = setupFeedFetcher({
        state,
        feedId: 'mentions',
        histFilters: mentionsHist,
        liveFilters: mentionsLive,
        relays: getReadRelays(state.relays),
        addToFeed,
        scheduleRender,
        eventsFetchLimit: EVENTS_FETCH_LIMIT,
        eventsTimeout: Math.max(EVENTS_TIMEOUT, 3000),
        ...feedFetcherHistHooks()
      });
      try { state._mentionsFetcher = mentionsFetcher; } catch (e) { }
      // 安全のため遅延後に初期ロードフラグを解除し点滅再評価
      setTimeout(() => { try { window.__mentionsInitialLoading = false; checkMentionBlink(); } catch (e) { } }, 3000);
    } catch (e) {
      // フォールバック
      try {
        const sinceM = Math.floor(Date.now() / 1000);
        subOnce(state, 'mentions_hist', [{ kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT }], (ev2, relay, done) => {
          if (ev2) addToFeed('mentions', ev2);
          if (done) {
            try { window.__mentionsInitialLoading = false; checkMentionBlink(); } catch (ee) { }
          }
        });
        subOnce(state, 'mentions_live', [{ kinds: [1, 6, 7], '#p': [pubkey], since: sinceM }], ev2 => addToFeed('mentions', ev2));
      } catch (ee) { }
    }

    // me: 自分のイベント取得に fetcher を使用
    try {
      if (!state.feeds['me']) state.feeds['me'] = { list: [], map: new Map() };
      const sinceMe = Math.floor(Date.now() / 1000);
      const meHist = [{ kinds: [1, 6, 7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }];
      const meLive = [
        { kinds: [1, 6, 7, 42, 16], authors: [pubkey], since: sinceMe }
      ];
      // 自分向け user status ライブ更新は表示設定が有効な場合のみ購読
      try {
        if (settingsManager.get('showMusicStatus') !== false) {
          meLive.push({ kinds: [30315], authors: [pubkey], '#d': ['music'], since: sinceMe });
        }
      } catch (e) { /* ignore */ }
      const meFetcher = setupFeedFetcher({
        state,
        feedId: 'me',
        histFilters: meHist,
        liveFilters: meLive,
        relays: getReadRelays(state.relays),
        addToFeed,
        scheduleRender,
        eventsFetchLimit: EVENTS_FETCH_LIMIT,
        eventsTimeout: Math.max(EVENTS_TIMEOUT, 3000),
        ...feedFetcherHistHooks()
      });
      try { state._meFetcher = meFetcher; } catch (e) { }
    } catch (e) {
      // 従来挙動へフォールバック
      try {
        const sinceMe = Math.floor(Date.now() / 1000);
        subOnce(state, 'me_hist', [{ kinds: [1, 6, 7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }], (ev3, relay, done) => {
          if (ev3) addToFeed('me', ev3);
          if (done) {
            const list = state.feeds['me'] && state.feeds['me'].list;
            if (Array.isArray(list)) {
              list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              const keep = list.slice(0, EVENTS_FETCH_LIMIT);
              const keepIds = new Set(keep.map(e => e.id));
              state.feeds['me'].list = keep;
              for (const id of Array.from(state.feeds['me'].map.keys())) {
                if (!keepIds.has(id)) state.feeds['me'].map.delete(id);
              }
              scheduleRender('me');
            }
          }
        });
        setTimeout(() => {
          const list = state.feeds['me'] && state.feeds['me'].list;
          if (Array.isArray(list)) {
            list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            const keep = list.slice(0, EVENTS_FETCH_LIMIT);
            const keepIds = new Set(keep.map(e => e.id));
            state.feeds['me'].list = keep;
            for (const id of Array.from(state.feeds['me'].map.keys())) {
              if (!keepIds.has(id)) state.feeds['me'].map.delete(id);
            }
            scheduleRender('me');
          }
        }, 3000);
        subOnce(state, 'me_live', [{ kinds: [1, 6, 7, 42, 16], authors: [pubkey], since: sinceMe }], ev3 => addToFeed('me', ev3));
      } catch (ee) { }
    }

    // follows の profile cache をバッチで読み込む（既存バッチ挙動を維持）
    const batchSize = 10;
    const delay = 500;
    for (let i = 0; i < Math.min(follows.length, 100); i += batchSize) {
      setTimeout(() => {
        const batch = follows.slice(i, i + batchSize);
        batch.forEach(pk => loadProfile(state, pk));
      }, (i / batchSize) * delay);
    }
  });
}

/**
 * フィードを再起動
 */
function restartFeeds(fullReset = false) {
  // setupFeedFetcher で生成したアクティブ fetcher を中断し、
  // relay 層の unsubscribe 前に購読を安全に停止する。
  try {
    try {
      const fetcherKeys = ['_globalFetcher', '_homeFetcher', '_homeOmochatFetcher', '_mentionsFetcher', '_meFetcher', '_bitchatFetcher'];
      for (const k of fetcherKeys) {
        try {
          const f = state && state[k];
          if (f) {
            try { if (f.controller && typeof f.controller.abort === 'function') f.controller.abort(); } catch (e) { }
            try { if (typeof f.stopHist === 'function') f.stopHist(); } catch (e) { }
            try { if (typeof f.stopLive === 'function') f.stopLive(); } catch (e) { }
          }
        } catch (e) { }
        try { if (state && state[k]) delete state[k]; } catch (e) { }
      }
    } catch (e) { }
  } catch (e) { }

  unsubscribeAll(state);

  if (fullReset) {
    ['home', 'global', 'mentions', 'me', 'bitchat'].forEach(id => clearFeed(state, id));
  }

  ['home', 'global', 'mentions', 'me', 'bitchat'].forEach(id => {
    const el = $('#feed-' + id);
    if (el) el.innerHTML = '';
  });

  const SimplePool = SimplePoolProvider();
  if (!state.pool && !relayConnect(state, SimplePool, restartFeeds)) {
    setStatus($('#relayStatus'), t('nostrtools.not_loaded'));
    return;
  }

  // ミュートリスト取得→フィードセットアップの順序を保証
  function startFeeds() {
    // NIP-30 カスタム絵文字を先に購読（全フィード準備前に）
    setupCustomEmojiSubscription();
    setupGlobalFeed();
    setupBitchatFeed();
    if (localStorage.getItem('pubkey')) setupAuthedFeeds();
    // 初期読み込み完了後にフィード準備完了フラグをセット（通知ドット抑制用）
    window.__nokakoiFeedsReady = false;
    setTimeout(() => { window.__nokakoiFeedsReady = true; }, 5000);
  }

  if (fullReset && localStorage.getItem('pubkey')) {
    // 安全策: setupMuteListUI が失敗しても localStorage から復元
    if (!window.__nokakoiMuteList) {
      try {
        const stored = localStorage.getItem('muteList_expanded');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') window.__nokakoiMuteList = parsed;
        }
      } catch (e) { /* ignore */ }
    }
    _restartFeedsCalled = true;
    // キャッシュ有無に関係なく、初期描画前にミュート取得完了または5秒経過まで待機する。
    let feedsStarted = false;
    const startFeedsOnce = () => {
      if (feedsStarted) return;
      feedsStarted = true;
      startFeeds();
    };
    // フォールバック: ミュートリスト取得が失敗/タイムアウトしてもフィードは開始
    // （リレーのタイムアウトは4秒のため、それより長い5秒に設定）
    const fallbackTimer = setTimeout(startFeedsOnce, 5000);
    try {
      const fetchMute = (typeof window !== 'undefined' && typeof window.__nokakoiFetchMuteList === 'function')
        ? window.__nokakoiFetchMuteList
        : null;
      if (fetchMute) {
        fetchMute(state, SimplePoolProvider, renderFeed)
          .catch((e) => { console.warn('[Main] 起動時ミュート取得に失敗', e); })
          .finally(() => {
            try { clearTimeout(fallbackTimer); } catch (e) { }
            startFeedsOnce();
          });
      } else {
        const onMuteFetched = () => {
          window.removeEventListener('muteListFetched', onMuteFetched);
          try { clearTimeout(fallbackTimer); } catch (e) { }
          startFeedsOnce();
        };
        window.addEventListener('muteListFetched', onMuteFetched);
        const muteBtn = document.getElementById('fetchMuteListBtn');
        if (muteBtn && typeof muteBtn.click === 'function') muteBtn.click();
      }
    } catch (e) {
      try { clearTimeout(fallbackTimer); } catch (ee) { }
      startFeedsOnce();
    }
  } else {
    startFeeds();
  }
}

// ============================================================================
// 初期化処理
// ============================================================================

/**
 * アプリ初期化処理
 */
async function init() {
  // 二重初期化を防止（複数スクリプト読込/複数 DOMContentLoaded 対策）
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

  // relay 設定 UI 初期化（provider を渡す）
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

  // タブスワイプジェスチャー
  setupTabSwipe();

  // スクロールボタン
  setupScrollToTopButton();

  // 表示設定
  setupDisplaySettings();
  // 投稿連携 UI
  try { setupPostLinkUI(settingsManager); } catch (e) { console.warn('[Main] setupPostLinkUI に失敗', e); }

  // メディアビューア
  setupMediaViewerClose();

  // プロフィールモーダル
  setupProfileModalClose();

  // JSONモーダル
  setupJsonModalClose();

  // 全モーダル共通ESCキー閉じ
  setupModalEscClose();

  // 全フィードのメディアリンクハンドラ
  const feedsContainer = $('#feeds');
  if (feedsContainer) {
    setupMediaLinkHandlers(feedsContainer);
  }

  // reaction/reply/repost の処理を単一リスナーへ委譲し、イベントごとのハンドラを避ける
  (function setupDelegatedFeedHandlers() {
    const touchTimers = new Map();
    const eventListContainers = [feedsContainer, document.getElementById('profileEvents')].filter(Boolean);
    if (!eventListContainers.length) return;

    eventListContainers.forEach((container) => {
      container.addEventListener('click', async (e) => {
        try {
          const reactBtn = e.target.closest && e.target.closest('.btn-react');
          if (reactBtn) {
            // ボタン固有リスナーがある場合は二重送信回避のため委譲処理をスキップ
            try { if (reactBtn.dataset && reactBtn.dataset.listenerInstalled === '1') return; } catch (ee) { }
            e.preventDefault();
            const evEl = reactBtn.closest && reactBtn.closest('.event');
            const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
            if (!eventId) return;
            const ev = findEventById(state, eventId);
            if (!ev) return;

            // 修飾キー付きクリック時はカスタム記号用リアクションモーダルを開く
            if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) {
              import('./modals.js').then(m => {
                try {
                  const nowDefault = settingsManager.get('reactionDefault') || settings.reactionDefault || '+'; // デフォルトのリアクションを取得
                  const runReactOnce = async (symbol) => {
                    await reactToEvent(state, ev, symbol); // リアクションを投稿
                    settingsManager.saveUserReaction(ev.id, symbol); // ユーザー設定に保存
                    const reactionDisplay = getReactionContent(symbol) || '+';
                    try { applyReactionToButton(reactBtn, symbol); } catch (ee) { reactBtn.textContent = (reactionDisplay === '+' ? '★' : reactionDisplay); }
                    try { reactBtn.dataset.reacted = 'true'; reactBtn.dataset.reactionDisplay = reactionDisplay; reactBtn.title = t('reaction.button.title_with_default', { display: reactionDisplay }); } catch (ee) { }
                  };
                  m.showReactionModal(nowDefault, (symbol) => {
                    settingsManager.set('reactionDefault', symbol);
                    try { reactBtn.title = t('reaction.button.title_with_default', { display: getReactionContent(symbol) || '+' }); } catch (ee) { }
                  }, settingsManager, {
                    showReactActions: true,
                    onSaveAndReact: runReactOnce,
                    onReactOnly: runReactOnce
                  });
                } catch (ee) { }
              }).catch(() => { });
            } else {
              // 既定リアクション
              const reactionSym = settingsManager.get('reactionDefault') || settings.reactionDefault || '+'; // デフォルトのリアクション
              await reactToEvent(state, ev, reactionSym); // リアクションを投稿
              settingsManager.saveUserReaction(ev.id, reactionSym); // ユーザー設定に保存
              const reactionDisplay = getReactionContent(reactionSym) || '+';
              try { applyReactionToButton(reactBtn, reactionSym); } catch (ee) { reactBtn.textContent = (reactionDisplay === '+' ? '★' : reactionDisplay); }
              try { reactBtn.dataset.reacted = 'true'; reactBtn.dataset.reactionDisplay = reactionDisplay; reactBtn.title = t('reaction.button.title_with_default', { display: reactionDisplay }); } catch (ee) { }
            }
            return;
          }

          // reply ボタン
          const replyBtn = e.target.closest && e.target.closest('.btn-reply');
          if (replyBtn) {
            e.preventDefault();
            const evEl = replyBtn.closest && replyBtn.closest('.event');
            const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
            if (!eventId) return;
            const ev = findEventById(state, eventId);
            if (!ev) return;
            setReplyTarget(state, ev, nip19);
            return;
          }

          // repost ボタン
          const repostBtn = e.target.closest && e.target.closest('.btn-repost');
          if (repostBtn) {
            e.preventDefault();
            const evEl = repostBtn.closest && repostBtn.closest('.event');
            const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
            if (!eventId) return;
            const ev = findEventById(state, eventId);
            if (!ev) return;
            // 確認ダイアログ + repost
            import('./modals.js').then(m => {
              try {
                m.showConfirmModal(t('repost.confirm.title'), t('repost.confirm.message'), async () => {
                  try {
                    repostBtn.disabled = true;
                    const success = await repostEvent(state, ev);
                    if (success) {
                      repostBtn.innerHTML = '✓';
                      setTimeout(() => { try { repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">'; repostBtn.disabled = false; } catch (e) { } }, 3000);
                    } else {
                      try { repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">'; repostBtn.disabled = false; } catch (e) { }
                    }
                  } catch (e) { try { repostBtn.disabled = false; } catch (ee) { } }
                }, () => { });
              } catch (e) { }
            }).catch(() => { });
            return;
          }

          // クリックした投稿を選択状態にする
          const clickedEvent = e.target.closest && e.target.closest('.event');
          if (clickedEvent) {
            setSelectedEventEl(clickedEvent);
          }
        } catch (e) { }
      }, false);

      // コンテキストメニューで react ボタンの既定値設定モーダルを開く
      container.addEventListener('contextmenu', (e) => {
        try {
          const reactBtn = e.target.closest && e.target.closest('.btn-react');
          if (!reactBtn) return;
          e.preventDefault();
          const evEl = reactBtn.closest && reactBtn.closest('.event');
          const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
          if (!eventId) return;
          const ev = findEventById(state, eventId);
          if (!ev) return;
          import('./modals.js').then(m => {
            try {
              const nowDefault = settingsManager.get('reactionDefault') || settings.reactionDefault || '+'; // デフォルトのリアクションを取得
              const runReactOnce = async (symbol) => {
                const ok = await reactToEvent(state, ev, symbol);
                if (!ok) throw new Error('react_failed');
                settingsManager.saveUserReaction(ev.id, symbol);
                const reactionDisplay = getReactionContent(symbol) || '+';
                try { applyReactionToButton(reactBtn, symbol); } catch (ee) { reactBtn.textContent = (reactionDisplay === '+' ? '★' : reactionDisplay); }
                try { reactBtn.dataset.reacted = 'true'; reactBtn.dataset.reactionDisplay = reactionDisplay; reactBtn.title = t('reaction.button.title_with_default', { display: reactionDisplay }); } catch (ee) { }
              };
              m.showReactionModal(nowDefault, (symbol) => {
                settingsManager.set('reactionDefault', symbol); // デフォルトリアクションを更新
                try { reactBtn.title = t('reaction.button.title_with_default', { display: getReactionContent(symbol) || '+' }); } catch (ee) { }
              }, settingsManager, {
                showReactActions: true,
                onSaveAndReact: runReactOnce,
                onReactOnly: runReactOnce
              });
            } catch (e) { }
          }).catch(() => { });
        } catch (e) { }
      }, false);

      // モバイル向け touch 長押し対応: 長押しで既定値設定を開く
      container.addEventListener('touchstart', (e) => {
        try {
          const reactBtn = e.target.closest && e.target.closest('.btn-react');
          if (!reactBtn) return;
          const evEl = reactBtn.closest && reactBtn.closest('.event');
          const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
          if (!eventId) return;
          const ev = findEventById(state, eventId);
          if (!ev) return;
          const tId = eventId + '::longpress';
          if (touchTimers.has(tId)) try { clearTimeout(touchTimers.get(tId)); } catch (e) { }
          const to = setTimeout(() => {
            try {
              import('./modals.js').then(m => {
                try {
                  const nowDefault = settingsManager.get('reactionDefault') || settings.reactionDefault || '+'; // デフォルトのリアクションを取得
                  const runReactOnce = async (symbol) => {
                    const ok = await reactToEvent(state, ev, symbol);
                    if (!ok) throw new Error('react_failed');
                    settingsManager.saveUserReaction(ev.id, symbol);
                    const reactionDisplay = getReactionContent(symbol) || '+';
                    try { applyReactionToButton(reactBtn, symbol); } catch (ee) { reactBtn.textContent = (reactionDisplay === '+' ? '★' : reactionDisplay); }
                    try { reactBtn.dataset.reacted = 'true'; reactBtn.dataset.reactionDisplay = reactionDisplay; reactBtn.title = t('reaction.button.title_with_default', { display: reactionDisplay }); } catch (ee) { }
                  };
                  m.showReactionModal(nowDefault, (symbol) => {
                    settingsManager.set('reactionDefault', symbol); // デフォルトリアクションを更新
                    try { reactBtn.title = t('reaction.button.title_with_default', { display: getReactionContent(symbol) || '+' }); } catch (ee) { }
                  }, settingsManager, {
                    showReactActions: true,
                    onSaveAndReact: runReactOnce,
                    onReactOnly: runReactOnce
                  });
                } catch (e) { }
              }).catch(() => { });
            } catch (e) { }
          }, 600);
          touchTimers.set(tId, to);
        } catch (e) { }
      }, { passive: true });

      container.addEventListener('touchend', (e) => {
        try {
          const reactBtn = e.target.closest && e.target.closest('.btn-react');
          if (!reactBtn) return;
          const evEl = reactBtn.closest && reactBtn.closest('.event');
          const eventId = evEl && evEl.dataset ? evEl.dataset.eventId : null;
          if (!eventId) return;
          const tId = eventId + '::longpress';
          const to = touchTimers.get(tId);
          if (to) { clearTimeout(to); touchTimers.delete(tId); }
        } catch (e) { }
      }, { passive: true });
    });
  })();

  // グローバルリレーセレクタ
  setupGlobalTabSelector(state, settingsManager, () => {
    // グローバルフィード再起動
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

  // --- 追加: 認証保留中は投稿UIを無効化するガード ---
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
    } catch (e) {
      // エラーを無視
    }
  }
  // 初回更新とポーリング開始
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
      // あわせて omochat タブの購読も開始
      try { setupBitchatFeed(); } catch (e) { }
    }
  } catch (e) { }
  updateBuildInfo();

  // UI 初期化後に翻訳を適用
  try {
    import('./i18n.js').then(m => { try { if (m && m.applyTranslations) m.applyTranslations(document); } catch (e) { } }).catch(() => { });
  } catch (e) { }

  // ミュートリストをセットアップ（autoLogin より先にボタンハンドラを登録）
  try { setupMuteListUI(state, SimplePoolProvider, renderFeed, restartFeeds); } catch (e) { console.warn('[Main] setupMuteListUI に失敗', e); }

  // 自動ログイン
  autoLogin(
    state,
    settings,
    settingsManager,
    () => login(state, settings, settingsManager, restartFeeds, enableComposerScroll)
  );

  // 初回ロード時に mentions_last_viewed を設定し、履歴 mention で再読込後に点滅しないようにする
  try {
    if (!localStorage.getItem('mentions_last_viewed_at')) {
      // 現在時刻（秒）と空 id で初期化
      localStorage.setItem('mentions_last_viewed_at', String(Math.floor(Date.now() / 1000)));
      localStorage.setItem('mentions_last_viewed_id', '');
    }
  } catch (e) { /* ignore */ }

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
      settingsManager
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
import('./i18n.js').then(m => { try { if (m && m.applyTranslations) m.applyTranslations(); } catch (e) { } }).catch(() => { });

// data-i18n-title を title 属性へも反映
function applyI18nTitles() {
  try {
    import('./i18n.js').then(m => {
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

// DOMContentLoaded 後に実行
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', applyI18nTitles);
} else {
  applyI18nTitles();
}

// --- 追加: custom emoji 設定変更を監視してフィードを再描画 ---
try {
  window.addEventListener('customEmoji:changed', function () {
    try {
      // 設定変更を UI 全体へ反映するため soft reload で feed/購読を再起動
      try {
        if (typeof window.softReload === 'function') {
          window.softReload();
        } else {
          // フォールバック: 別所の soft reload ハンドラを起動する event を dispatch
          try { window.dispatchEvent(new Event('softReloadRequest')); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        // softReload 失敗時は feed 強制再描画へフォールバック
        try { ['home', 'global', 'mentions', 'me'].forEach(id => { try { renderFeed(id, true); } catch (ee) { } }); } catch (ee) { }
      }
    } catch (e) { }
  });
} catch (e) { }

/*
プロファイルモーダル表示用ラッパー
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
        // モーダルを閉じる
        const modal = document.getElementById('profileModal');
        if (modal) modal.hidden = true;
        // 投稿欄に返信対象をセット
        setReplyTarget(state, ev, nip19);
      },
      (ev) => repostEvent(state, ev)
    );
    // 最前面に
    const modal = document.getElementById('profileModal');
    if (modal) {
      modal.hidden = false;
      try { bringModalToFront(modal); } catch (e) { console.warn('[Main] bringModalToFront に失敗', e); }
    }
  } catch (e) {
    console.warn('[Main] showProfileModalProxy に失敗', e);
  }
}

// 循環 import 回避のためグローバル公開
try { window.showProfileModalProxy = showProfileModalProxy; } catch (e) { }
// 旧モジュール互換のため legacy 名も公開
try { window.invokeShowProfileModalProxy = showProfileModalProxy; } catch (e) { }

// デバッグモジュールを import してセットアップ
import { setupDebugModal } from './debug.js';
// デバッグモーダル設定を接続
try { setupDebugModal(state, settings); } catch (e) { console.warn('[Main] setupDebugModal に失敗', e); }

/**
 * ソフトリロード: フィードを再読み込みして再購読する。
 * - 外部条件の変化（設定変更、プロフィール変更など）で利用する。
 */
try {
  window.softReload = function () {
    // 連続呼び出し抑止: 短時間の連打を無視して競合を回避
    try {
      const now = Date.now();
      const MIN_INTERVAL = 1000; // ミリ秒（間隔を拡大）
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
        // soft reload 完了をリスナーへ通知
        try { window.dispatchEvent(new CustomEvent('softReloadDone')); } catch (e) { }
        try { window.__nokakoiSoftReloading = false; } catch (e) { }
      }, 240);
    } catch (e) { console.warn('[Main] softReload に失敗', e); try { window.__nokakoiSoftReloading = false; } catch (ee) { } }
  };
} catch (e) { }

/**
 * UI から dispatch される softReloadRequest を監視（window.softReload 不在時のフォールバック）
 */
try {
  window.addEventListener('softReloadRequest', () => {
    try {
      debugLog('[softReloadRequest] 受信');
      // 同時リクエストを防ぐガード
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

// タブ設定の並び替え/表示変更後に global タブハンドラを再設定
try {
  window.addEventListener('tabsRebuilt', () => {
    try {
      setupGlobalTabSelector(state, settingsManager, () => {
        clearFeed(state, 'global');
        const el = $('#feed-global');
        if (el) el.innerHTML = '';
        setupGlobalFeed();
      });
      try { updateGlobalButtonLabel(settingsManager); } catch (e) { }
    } catch (e) { }
  });
} catch (e) { }

// omochat 設定変更時に UI と feed を更新するリスナーを追加
try {
  window.addEventListener('omochatSettingsSaved', async () => {
    try {
      // タブラベルを即時更新（アクティブタブは維持）
      setupTabs(true);

      // setupTabs で消えるため global タブのイベント監視/ラベルを再適用
      setupGlobalTabSelector(state, settingsManager, () => {
        clearFeed(state, 'global');
        const el = $('#feed-global');
        if (el) el.innerHTML = '';
        setupGlobalFeed();
      });
      // 現在設定に基づいてラベル更新
      try { updateGlobalButtonLabel(settingsManager); } catch (e) { }

      // 位置情報リレーの更新処理
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

      // 新しいフィルタ設定を反映するため feed 再読込を実行
      if (typeof window.softReload === 'function') window.softReload();
      else window.dispatchEvent(new Event('softReloadRequest'));
    } catch(e) { }
  });
} catch(e) { }

// 無限スクロール用 observer

function setupInfiniteScrollObserver() {
  if (_infiniteScrollObserver) return;
  if (typeof IntersectionObserver === 'undefined') return;

  _infiniteScrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      // 画面下部に入ってきたら自動クリック
      if (entry.isIntersecting) {
        const target = entry.target;
        if (target && typeof target.click === 'function') {
          // すでにロード中、または無効化されている場合はスキップ
          // テキスト内容で判定するのは簡易的だが、loading状態をクラスで管理するほうが安全かも
          // button.click() を呼ぶと onclick ハンドラ内で loading チェックが入るので基本は大丈夫
          // ただし連打防止のため isIntersecting 後も残り続ける実装になっているため、一度クリックされれば
          // 次のレンダリングまで発火しないはず。
          // 一度だけクリックして繰り返さない
          try { _infiniteScrollObserver.unobserve(target); } catch (e) { }
          target.click();
        }
      }
    });
  }, {
    root: null, // viewport
    rootMargin: '200px', // 早めに読み込む
    threshold: 0.1
  });
}

// DOMContentLoaded 後（または main UI 構築後）
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
