import { insertEventSorted, findEventById, clearFeed } from '../../core/state.js';
import { getReadRelays, subOnce, relayConnect, unsubscribeAll } from '../../core/relay.js';
import { EVENTS_MAX, EVENTS_FETCH_LIMIT, EVENTS_TIMEOUT } from '../../config/constants.js';
import { setupFeedFetcher } from '../../features/timeline/feed-fetcher.js';
import { renderFeed, scheduleRender, userKind7Memory, feedLoadState, ensureEventRestored } from '../../features/timeline/feed-renderer.js';
import { pickChannelRootId, prefetchChannelMetadata } from '../../features/channel/channel.js';
import { updateUserStatusDom, updateNameDom, loadProfile } from '../../features/profile/profile.js';
import { applyReactionToButton } from '../../ui/renderer.js';
import { showFeedNotification, sanitizeNotificationBody, ensureNotificationPermission, shouldShowBrowserNotification, normalizeMentionNotificationMode, _notifiedEventIds } from '../../utils/notification.js';
import { t } from '../../utils/i18n.js';
import { getClosestRelays } from '../../features/relay/geo-relay-directory.js';
import { getNip19, getSimplePool, getNostrTools } from '../../core/nostr-compat.js';
import { checkMentionBlink } from '../../ui/ui-setup.js';
import { setStatus } from '../../utils/utils.js';

// モジュール内の状態管理用変数
let state = null;
let settingsManager = null;
let settings = null;
let nip19 = null;

const SimplePoolProvider = function () {
  try {
    if (typeof getSimplePool === 'function') {
      try {
        const sp = getSimplePool();
        if (sp) return sp;
      } catch (e) { }
    }
  } catch (e) { }
  try {
    const NT = getNostrTools() || {};
    return NT.SimplePool || null;
  } catch (e) {
    return null;
  }
};

const _feedUiStateById = new Map();
let _restartFeedsCalled = false;

// 外部から利用するために export する
export { _feedUiStateById };

/**
 * フィードマネージャーの初期化
 */
export function initFeedManager(appState, appSettingsManager) {
  state = appState;
  settingsManager = appSettingsManager;
  settings = appSettingsManager.settings;
  nip19 = getNip19();
}

/**
 * フィードのUI表示状態を保証して返す
 */
export function ensureFeedUiState(feedId) {
  if (!_feedUiStateById.has(feedId)) {
    _feedUiStateById.set(feedId, {
      selectedEventId: null,
      expandedMutedEventIds: new Set(),
      expandedCwEventIds: new Set()
    });
  }
  return _feedUiStateById.get(feedId);
}

/**
 * フィードイベントの展開（ミュート/Content Warningなど）状態をマークする
 */
export function markFeedEventExpanded(feedId, eventId, type, expanded) {
  try {
    if (!feedId || !eventId) return;
    const uiState = ensureFeedUiState(feedId);
    const setRef = type === 'cw' ? uiState.expandedCwEventIds : uiState.expandedMutedEventIds;
    if (expanded) setRef.add(eventId);
    else setRef.delete(eventId);
  } catch (e) { }
}

/**
 * UI状態を含んだ描画設定を取得する
 */
export function getRenderSettingsWithUiState(feedId) {
  const uiState = ensureFeedUiState(feedId);
  return {
    ...(settings || {}),
    __timelineUiState: uiState,
    __timelineMarkMutedExpanded: (eventId, expanded) => markFeedEventExpanded(feedId, eventId, 'muted', expanded),
    __timelineMarkCwExpanded: (eventId, expanded) => markFeedEventExpanded(feedId, eventId, 'cw', expanded)
  };
}

/**
 * 履歴バッファリング開始時のフック
 */
export function markFeedHistBufferStart(feedId) {
  try {
    if (!feedLoadState[feedId]) feedLoadState[feedId] = {};
    feedLoadState[feedId].histLoading = true;
  } catch (e) { }
}

/**
 * 履歴バッファリング終了時のフック
 */
export function markFeedHistBufferEnd(feedId) {
  try {
    if (!feedLoadState[feedId]) feedLoadState[feedId] = {};
    feedLoadState[feedId].histLoading = false;
  } catch (e) { }
}

/**
 * フルレンダリングを優先させるフラグを立てる
 */
export function markFeedPreferFullRender(feedId) {
  try {
    if (!feedLoadState[feedId]) feedLoadState[feedId] = {};
    feedLoadState[feedId].preferFull = true;
  } catch (e) { }
}

/**
 * フィードフェッチャー用履歴ロード関連のフック設定オブジェクトを返す
 */
export function feedFetcherHistHooks() {
  return {
    onHistBufferStart: markFeedHistBufferStart,
    onHistBufferEnd: markFeedHistBufferEnd
  };
}

/**
 * グローバルフィード用リレーを解決する
 */
export function resolveGlobalRelays(settingsManager, stateRelays) {
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

/**
 * グローバルマージが有効な場合のホーム追加取得用フィルターを構築する
 */
export function buildHomeLoadMoreFiltersForGlobalMerge(until) {
  try {
    const followsForMore = (state.feeds['home'] && state.feeds['home'].follows) || [];
    if (!followsForMore.length) return [];
    return [{ kinds: [1, 6], authors: followsForMore, limit: EVENTS_FETCH_LIMIT, until }];
  } catch (e) {
    return [];
  }
}

/**
 * ホームタイムラインの追加取得用フィルターを構築する
 */
export function buildHomeLoadMoreFilters(until) {
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

/**
 * フィードリストを最大件数制限にトリミングする
 */
export function trimFeedToMax(feedId, maxCount = EVENTS_MAX) {
  const feed = state.feeds[feedId];
  const list = feed?.list;
  if (!Array.isArray(list) || list.length <= maxCount) return;
  const removed = list.splice(maxCount);
  for (const e of removed) feed.map.delete(e.id);
}

/**
 * イベントがグローバルフィードにマージされる対象の kind か判定
 */
export function isGlobalMergeKind(ev) {
  const k = ev?.kind;
  return k === 1 || k === 6;
}

/**
 * ホームのイベントをグローバルに複製する
 */
export function mirrorHomeEventToGlobal(ev) {
  if (settingsManager.get('globalMergeHome') !== true) return false;
  if (!ev?.id || !isGlobalMergeKind(ev)) return false;
  const gfeed = state.feeds['global'];
  if (!gfeed?.map || gfeed.map.has(ev.id)) return false;
  insertEventSorted(state, 'global', ev);
  return true;
}

/**
 * マージ後のグローバルフィードを制限件数にトリミングする
 */
export function trimGlobalMergedToLimit(maxCount) {
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

/**
 * ホームの kind=1,6 由来データをグローバルに流し込む
 */
export function seedGlobalFromHomeKind16() {
  if (settingsManager.get('globalMergeHome') !== true) return false;
  const homeList = state.feeds['home']?.list || [];
  let added = false;
  for (const ev of homeList) {
    if (mirrorHomeEventToGlobal(ev)) added = true;
  }
  return added;
}

/**
 * マージ後のグローバルタイムラインを確定して描画スケジュールを走らせる
 */
export function finalizeMergedGlobalFeed(render = true) {
  if (settingsManager.get('globalMergeHome') !== true) return;
  seedGlobalFromHomeKind16();
  trimGlobalMergedToLimit(EVENTS_FETCH_LIMIT);
  if (render) {
    markFeedPreferFullRender('global');
    scheduleRender('global');
  }
}

/**
 * 取得したイベントリストをグローバルフィードバッファへマージする
 */
export function mergeFetchedIntoGlobalList(moreBuffer, startListLength) {
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

/**
 * マージ有効時のグローバル追加ロード処理を実行
 */
export function runMergedGlobalLoadMore({ mergeUntil, startListLength }) {
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

/**
 * フィード内の最も古い created_at タイムスタンプを取得する
 */
export function getFeedOldestCreatedAt(list, kindFilter = null) {
  const src = Array.isArray(list) ? list : [];
  for (let i = src.length - 1; i >= 0; i--) {
    const ev = src[i];
    if (!ev?.created_at) continue;
    if (kindFilter && !kindFilter(ev)) continue;
    return ev.created_at;
  }
  return null;
}

/**
 * 補助関数: 点滅ステータスのセットアップ（main.js からインポートされた UI 関数へのブリッジ）
 */
function setMentionBlink(active) {
  try {
    if (typeof window !== 'undefined' && typeof window.__setMentionBlink === 'function') {
      window.__setMentionBlink(active);
    }
  } catch (e) { }
}

/**
 * フィードにイベントを追加する
 */
export function addToFeed(feedId, ev, keepLatestCount = null, relay = null) {
  if (ev != null) {
    // kind:30315（User Status）の処理
    if (ev.kind === 30315) {
      if (typeof updateUserStatusDom === 'function') {
        const dTag = Array.isArray(ev.tags) ? ev.tags.find(t => t[0] === 'd') : null;
        if (dTag && dTag[1] === 'music') {
          let content = ev.content.trim();
          const expTag = ev.tags.find(t => t[0] === 'expiration');
          if (expTag && expTag[1]) {
             const exp = parseInt(expTag[1]);
             if (!isNaN(exp) && Date.now() / 1000 > exp) {
               content = null;
             }
          }
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
      const bottomTs = bottomBefore?.created_at || 0;
      const isPrepend = idx === 0;
      const isAppend = idx === listAfterLen - 1 && ts <= bottomTs;
      if (!isPrepend && !isAppend) markFeedPreferFullRender(feedId);
    }

    // 自分が送信したリアクション（kind=7）の即時適用処理
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
            try {
              const btn = document.querySelector('.event[data-event-id="' + targetId + '"] .btn-react');
              if (btn) {
                try {
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

    if (!histLoading && wasEmpty && feed.list.length === 1) {
      renderFeed(feedId);
    }

    // mentions フィード宛て新着通知/点滅処理
    if (feedId === 'mentions') {
      try {
        if (typeof window !== 'undefined' && window.__mentionsInitialLoading) {
          // 初期ロード時は処理スキップ
        } else {
          const lastViewed = parseInt(localStorage.getItem('mentions_last_viewed_at') || '0', 10);
          const lastViewedId = localStorage.getItem('mentions_last_viewed_id') || '';
          let activeTab = null;
          try {
            const activeTabEl = document.querySelector('.tab.active');
            activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : null;
          } catch (e) { }

          if (activeTab === 'mentions') {
            try {
              const created = ev && ev.created_at ? ev.created_at : Math.floor(Date.now() / 1000);
              const id = ev && ev.id ? ev.id : '';
              localStorage.setItem('mentions_last_viewed_at', String(created));
              localStorage.setItem('mentions_last_viewed_id', String(id));
              setMentionBlink(false);
            } catch (e) { }
          } else {
            if (ev && ev.created_at) {
              if (lastViewedId && ev.id && ev.id === lastViewedId) {
                // 重複処理回避
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
                        showFeedNotification(title, { body, icon: 'icon/nokakoi-192.png' }, ev && ev.id ? ev.id : null, 'mentions', notifMode);
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
  if (keepLatestCount && Array.isArray(list) && list.length > keepLatestCount) {
    const keep = list.slice(0, keepLatestCount);
    const keepIds = new Set(keep.map(e => e.id));
    state.feeds[feedId].list = keep;
    for (const id of Array.from(state.feeds[feedId].map.keys())) {
      if (!keepIds.has(id)) state.feeds[feedId].map.delete(id);
    }
  }
  
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
 * グローバルフィードのセットアップ
 */
export function setupGlobalFeed() {
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
  try {
    if (!state.feeds['global']) state.feeds['global'] = { list: [], map: new Map() };
    if (mergeHome) delete state.feeds['global'].mergedPaginationUntil;
    const activeTabEl = document.querySelector('.tab.active');
    const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : 'home';
    const isActive = activeTab === 'global';
    const histFilters = isActive ? [{ kinds: [1, 6], limit: EVENTS_FETCH_LIMIT }] : [];
    const since = Math.floor(Date.now() / 1000);
    const liveFilters = [
      { kinds: [1, 6], since }
    ];
    try {
      if (settingsManager.get('showMusicStatus') !== false) {
        liveFilters.push({ kinds: [30315], '#d': ['music'], since });
      }
    } catch (e) { }
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
      eventsKeepLimit: EVENTS_FETCH_LIMIT, // ※元の main.js のタイポ fethcher 内の引数に合わせる
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
 * 起動時の Bitchat 自動接続判定
 */
function shouldConnectBitchatOnBoot() {
  try {
    if (settingsManager.get('showHomeOmochat') === true) return true;
    if (settingsManager.get('showOmochat') !== false) return true;
    const activeTabEl = document.querySelector('.tab.active');
    const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : 'home';
    if (activeTab === 'bitchat') return true;
  } catch (e) { }
  return false;
}

/**
 * ユーザー設定の omochat リレーを返す
 */
export function getOmochatRelays() {
  const isAuto = settingsManager.get('omochatAutoRelays') !== false;
  if (isAuto) {
    const computed = settingsManager.get('omochatComputedRelays');
    if (Array.isArray(computed) && computed.length > 0) {
      return computed.slice();
    }
  }
  const saved = settingsManager.get('omochatRelays');
  const DEFAULT_OMOCHAT_RELAYS = ['wss://relay.yabu.me']; // デフォルトフォールバック
  return Array.isArray(saved) && saved.length > 0 ? saved.slice() : DEFAULT_OMOCHAT_RELAYS.slice();
}

/**
 * Bitchat (Omochat) フィードのセットアップ
 */
export function setupBitchatFeed() {
  const showOmochat = settingsManager.get('showOmochat') !== false;
  if (!showOmochat) return;

  if (!state.feeds['bitchat']) state.feeds['bitchat'] = { list: [], map: new Map() };
  const relays = getOmochatRelays();
  const geohash = settingsManager.get('omochatGeohash') || 'xn';
  const subordinate = settingsManager.get('omochatSubordinate') === true;
  const includeHomeOmochat = settingsManager.get('showHomeOmochat') === true;

  try {
    const histFilters = [{ kinds: [20000], limit: EVENTS_FETCH_LIMIT }];
    const since = Math.floor(Date.now() / 1000);
    const liveFilters = [{ kinds: [20000], since }];

    const matchesGeohash = (ev) => {
      if (!ev || ev.kind !== 20000) return false;
      const gTag = ev.tags && ev.tags.find(t => t[0] === 'g');
      const gVal = gTag ? gTag[1] : '';
      if (!gVal) return false;
      if (subordinate) {
        return gVal.startsWith(geohash);
      } else {
        return gVal === geohash;
      }
    };

    const feedAdder = (fid, ev, limit, r) => {
      try {
        if (matchesGeohash(ev)) addToFeed(fid, ev, limit, r);
      } catch (e) { }
      try {
        if (includeHomeOmochat && ev && ev.pubkey) {
          const followSet = state.feeds['home'] && state.feeds['home'].followSet;
          if (followSet && followSet.has(ev.pubkey)) {
            addToFeed('home', ev, null, r);
          }
        }
      } catch (e) { }
    };
    try { state._bitchatFeedAdder = feedAdder; } catch (e) { }

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
  } catch (e) {
    console.warn('[Main] setupBitchatFeed に失敗', e);
  }
}

/**
 * 認証情報に基づくフォローフィードなどのセットアップ
 */
export function setupAuthedFeeds() {
  const pubkey = localStorage.getItem('pubkey');
  subOnce(state, 'follows', [{ kinds: [3], authors: [pubkey], limit: 1 }], function (ev) {
    if (!ev) return;
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

    if (!state.feeds['home']) {
      state.feeds['home'] = { list: [], map: new Map(), follows: follows, followSet: new Set(follows) };
    } else {
      state.feeds['home'].follows = follows;
      state.feeds['home'].followSet = new Set(follows);
    }

    // NIP-30 購読のリセット (グローバル関数 setupCustomEmojiSubscription を呼び出す)
    try {
      if (typeof window !== 'undefined' && typeof window.setupCustomEmojiSubscription === 'function') {
        window.setupCustomEmojiSubscription();
      }
    } catch (e) { }

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

    if (includeHomeOmochat && state.feeds['bitchat'] && Array.isArray(state.feeds['bitchat'].list)) {
      const followSet = state.feeds['home'].followSet;
      if (followSet) {
        for (const ev of state.feeds['bitchat'].list) {
          try {
            if (ev && ev.pubkey && followSet.has(ev.pubkey)) {
              addToFeed('home', ev);
            }
          } catch (e) { }
        }
      }
    }
    const includeHomeChannel = settingsManager.get('showHomeChannel') === true;
    const includeHomeRepost16 = settingsManager.get('showHomeRepost16') === true;
    const optionalHomeFollowKinds = [];
    if (includeHomeReactions) optionalHomeFollowKinds.push(7);
    if (includeHomeChannel) optionalHomeFollowKinds.push(42);
    if (includeHomeRepost16) optionalHomeFollowKinds.push(16);

    try {
      const activeTabEl = document.querySelector('.tab.active');
      const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : 'home';
      const isHomeActive = activeTab === 'home';
      const homeHist = isHomeActive ? [
        { kinds: [1, 6, ...optionalHomeFollowKinds], authors: follows, limit: EVENTS_FETCH_LIMIT },
        { kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
        { kinds: [7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }
      ] : [];
      const sinceLive = Math.floor(Date.now() / 1000);
      const homeLive = [
        { kinds: [1, 6, ...optionalHomeFollowKinds], authors: follows, since: sinceLive },
        { kinds: [1, 6, 7], '#p': [pubkey], since: sinceLive },
        { kinds: [7, 42, 16], authors: [pubkey], since: sinceLive }
      ];
      try {
        if (settingsManager.get('showMusicStatus') !== false) {
          homeLive.push({ kinds: [30315], authors: follows, '#d': ['music'], since: sinceLive });
        }
      } catch (e) { }

      (function createHomeFetcher(attempts) {
        try {
          const relaysForHist = getReadRelays(state.relays) || [];
          if ((!relaysForHist || relaysForHist.length === 0) && attempts < 5) {
            setTimeout(() => createHomeFetcher(attempts + 1), 300);
            return;
          }

          const fetcher = setupFeedFetcher({
            state,
            feedId: 'home',
            histFilters: homeHist,
            liveFilters: homeLive,
            relays: relaysForHist,
            addToFeed,
            scheduleRender,
            eventsFetchLimit: EVENTS_FETCH_LIMIT,
            eventsTimeout: EVENTS_TIMEOUT,
            ...feedFetcherHistHooks()
          });
          try { state._homeFetcher = fetcher; } catch (e) { }
        } catch (e) {
          console.warn('[Main] createHomeFetcher に失敗したため元の挙動へフォールバック', e);
        }
      })(0);

      // 通知（mentions）フィードのセットアップ
      try {
        if (!state.feeds['mentions']) state.feeds['mentions'] = { list: [], map: new Map() };
        try { window.__mentionsInitialLoading = true; } catch (e) { }
        const sinceM = Math.floor(Date.now() / 1000);
        const isMentionsActive = activeTab === 'mentions';
        const mentionsHist = isMentionsActive ? [{ kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT }] : [];
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
        
        // 遅延後に初期ロード中フラグを解除し、通知の明滅を再評価
        setTimeout(() => { try { window.__mentionsInitialLoading = false; checkMentionBlink(); } catch (e) { } }, 3000);
      } catch (e) {
        // 例外時のフォールバック処理
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

      // 自分（me）フィードのセットアップ
      try {
        if (!state.feeds['me']) state.feeds['me'] = { list: [], map: new Map() };
        const sinceMe = Math.floor(Date.now() / 1000);
        const isMeActive = activeTab === 'me';
        const meHist = isMeActive ? [{ kinds: [1, 6, 7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }] : [];
        const meLive = [
          { kinds: [1, 6, 7, 42, 16], authors: [pubkey], since: sinceMe }
        ];
        try {
          if (settingsManager.get('showMusicStatus') !== false) {
            meLive.push({ kinds: [30315], authors: [pubkey], '#d': ['music'], since: sinceMe });
          }
        } catch (e) { }
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
        // 例外時のフォールバック処理
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

      // フォロイーのプロフィールキャッシュをバッチ処理で非同期ロード
      const batchSize = 10;
      const delay = 500;
      for (let i = 0; i < Math.min(follows.length, 100); i += batchSize) {
        setTimeout(() => {
          const batch = follows.slice(i, i + batchSize);
          batch.forEach(pk => loadProfile(state, pk));
        }, (i / batchSize) * delay);
      }
    } catch (e) {
      console.warn('[Main] setupAuthedFeeds setupFeedFetcher に失敗', e);
    }
  });
}

/**
 * フィードの再起動
 */
export function restartFeeds(fullReset = false) {
  _restartFeedsCalled = true;
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

  try { unsubscribeAll(state); } catch (e) { }

  if (fullReset) {
    ['home', 'global', 'mentions', 'me', 'bitchat'].forEach(id => {
      try { clearFeed(state, id); } catch (e) { }
    });
  }

  ['home', 'global', 'mentions', 'me', 'bitchat'].forEach(id => {
    const el = document.getElementById('feed-' + id);
    if (el) el.innerHTML = '';
  });

  const SimplePool = SimplePoolProvider();
  if (!state.pool && !relayConnect(state, SimplePool, restartFeeds)) {
    const statusEl = document.getElementById('relayStatus');
    if (statusEl) setStatus(statusEl, t('nostrtools.not_loaded'));
    return;
  }

  function startFeeds() {
    setupCustomEmojiSubscription();
    setupGlobalFeed();
    if (shouldConnectBitchatOnBoot()) {
      setupBitchatFeed();
    }
    if (localStorage.getItem('pubkey')) setupAuthedFeeds();
    window.__nokakoiFeedsReady = false;
    setTimeout(() => { window.__nokakoiFeedsReady = true; }, 5000);
  }

  if (fullReset && localStorage.getItem('pubkey')) {
    if (!window.__nokakoiMuteList) {
      try {
        const stored = localStorage.getItem('muteList_expanded');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') window.__nokakoiMuteList = parsed;
        }
      } catch (e) { }
    }
    let feedsStarted = false;
    const startFeedsOnce = () => {
      if (feedsStarted) return;
      feedsStarted = true;
      startFeeds();
    };
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

/**
 * 位置情報 omchat リレー更新ブリッジ
 */
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

/**
 * 特定のフィードを個別にセットアップする
 */
export function setupSingleFeed(feedId) {
  const pubkey = localStorage.getItem('pubkey');
  if (feedId === 'global') {
    setupGlobalFeed();
  } else if (feedId === 'bitchat') {
    setupBitchatFeed();
  } else if (pubkey) {
    if (feedId === 'home') {
      const follows = (state.feeds['home'] && state.feeds['home'].follows) || [];
      const includeHomeReactions = settingsManager.get('showHomeReactions') === true;
      const includeHomeOmochat = settingsManager.get('showHomeOmochat') === true;
      const includeHomeChannel = settingsManager.get('showHomeChannel') === true;
      const includeHomeRepost16 = settingsManager.get('showHomeRepost16') === true;
      const optionalHomeFollowKinds = [];
      if (includeHomeReactions) optionalHomeFollowKinds.push(7);
      if (includeHomeChannel) optionalHomeFollowKinds.push(42);
      if (includeHomeRepost16) optionalHomeFollowKinds.push(16);

      const homeHist = [
        { kinds: [1, 6, ...optionalHomeFollowKinds], authors: follows, limit: EVENTS_FETCH_LIMIT },
        { kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
        { kinds: [7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }
      ];
      const sinceLive = Math.floor(Date.now() / 1000);
      const homeLive = [
        { kinds: [1, 6, ...optionalHomeFollowKinds], authors: follows, since: sinceLive },
        { kinds: [1, 6, 7], '#p': [pubkey], since: sinceLive },
        { kinds: [7, 42, 16], authors: [pubkey], since: sinceLive }
      ];
      try {
        if (settingsManager.get('showMusicStatus') !== false) {
          homeLive.push({ kinds: [30315], authors: follows, '#d': ['music'], since: sinceLive });
        }
      } catch (e) { }

      const relaysForHist = getReadRelays(state.relays) || [];
      const fetcher = setupFeedFetcher({
        state,
        feedId: 'home',
        histFilters: homeHist,
        liveFilters: homeLive,
        relays: relaysForHist,
        addToFeed,
        scheduleRender,
        eventsFetchLimit: EVENTS_FETCH_LIMIT,
        eventsTimeout: EVENTS_TIMEOUT,
        ...feedFetcherHistHooks()
      });
      state._homeFetcher = fetcher;

      if (includeHomeOmochat && state.feeds['bitchat'] && Array.isArray(state.feeds['bitchat'].list)) {
        const followSet = state.feeds['home'] && state.feeds['home'].followSet;
        if (followSet) {
          for (const ev of state.feeds['bitchat'].list) {
            try {
              if (ev && ev.pubkey && followSet.has(ev.pubkey)) {
                addToFeed('home', ev);
              }
            } catch (e) { }
          }
        }
      }
    } else if (feedId === 'mentions') {
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
      state._mentionsFetcher = mentionsFetcher;
    } else if (feedId === 'me') {
      const sinceMe = Math.floor(Date.now() / 1000);
      const meHist = [{ kinds: [1, 6, 7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }];
      const meLive = [
        { kinds: [1, 6, 7, 42, 16], authors: [pubkey], since: sinceMe }
      ];
      try {
        if (settingsManager.get('showMusicStatus') !== false) {
          meLive.push({ kinds: [30315], authors: [pubkey], '#d': ['music'], since: sinceMe });
        }
      } catch (e) { }
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
      state._meFetcher = meFetcher;
    }
  }
}

/**
 * タブ切り替え時のフィードクリアとソフトリロード処理
 */
export function handleTabChange(oldTab, newTab) {
  if (!state) return;

  // 1. 切り替え元 (oldTab) のクリア処理
  if (oldTab && oldTab !== newTab && oldTab !== 'bitchat') {
    console.log(`[FeedManager] Clearing source tab feed: ${oldTab}`);
    
    // 履歴取得のみ停止 (警告: f.stopHist() は内部で controller.abort() を呼び、live購読も止めてしまうため呼び出さない)
    
    // フィードのデータ（メモリ）をクリア
    clearFeed(state, oldTab);
    
    // DOMをクリア
    const el = document.getElementById('feed-' + oldTab);
    if (el) {
      el.innerHTML = '';
      // 注意: ドット点灯のために el.dataset.topEventId は削除しない
    }
  }

  // 2. 切り替え先 (newTab) のソフトリロード処理
  if (newTab && newTab !== 'bitchat') {
    console.log(`[FeedManager] Soft reloading target tab feed: ${newTab}`);
    
    // 既存の fetcher を完全に停止して破棄
    const fetcherKey = `_${newTab === 'global' ? 'global' : newTab}Fetcher`;
    const f = state[fetcherKey];
    if (f) {
      try { if (f.controller && typeof f.controller.abort === 'function') f.controller.abort(); } catch (e) { }
      try { if (typeof f.stopHist === 'function') f.stopHist(); } catch (e) { }
      try { if (typeof f.stopLive === 'function') f.stopLive(); } catch (e) { }
      delete state[fetcherKey];
    }
    
    // フィードデータをクリア
    clearFeed(state, newTab);
    
    // DOMとtopEventIdをクリア
    const el = document.getElementById('feed-' + newTab);
    if (el) {
      el.innerHTML = '';
      delete el.dataset.topEventId;
    }
    
    // 新規にセットアップ（履歴＆ライブ取得開始）
    setupSingleFeed(newTab);
  }
}

