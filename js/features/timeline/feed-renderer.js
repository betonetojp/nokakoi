// ============================================================================
// フィード描画・タイムライン更新管理
// ============================================================================

import { renderEvent, applyReactionToButton } from '../../ui/renderer.js';
import { reactToEvent, repostEvent } from '../post/actions.js';
import { setReplyTarget } from '../post/composer.js';
import { getReadRelays } from '../../core/relay.js';
import { fetchMore, applyPerFilterUntil } from './feed-fetcher.js';
import { canStartMore, markMoreFinished, markMoreStarted } from './feed-more-policy.js';
import { EVENTS_FETCH_LIMIT, EVENTS_TIMEOUT, EVENTS_MAX } from '../../config/constants.js';
import { buildOutgoingZapReceiptFilter } from './feed-filters.js';
import { shouldDisplayGlobalEvent } from './lang-filter.js';
import { captureTimelineAnchor, restoreTimelineAnchor } from '../../utils/url-parser.js';
import {
  clearAnchorMaintenance,
  isBackScrolling,
  isScrollAnchoringSupported,
  updateBackScrollingState
} from '../../utils/content/timeline-anchor.js';
import { reconcileFeedDom, PRELOAD_EVENT_OFFSET } from './feed-diff.js';
import { initTimelinePerfMonitor, recordFeedRender } from './perf-monitor.js';
import { t } from '../../utils/i18n.js';
import { $, formatLoadBeforeTime } from '../../utils/utils.js';
import { getSelectedEventEl, setSelectedEventEl } from '../../ui/keyboard-shortcuts.js';
import {
  isDebugEnabled,
  isProgrammaticScroll
} from '../../core/app-context.js';

export const feedLoadState = {};
export const userKind7Memory = new Map();
try { window.userKind7Memory = userKind7Memory; } catch (e) { }

export function getLoadMoreLabel(feedId, state = _state, options = _options) {
  try {
    const isMergedGlobal = (feedId === 'global' && options?.settingsManager?.get('globalMergeHome') === true);
    const feed = state?.feeds?.[feedId];
    const untilTs = isMergedGlobal ? feed?.mergedPaginationUntil : feed?.paginationUntil;
    if (typeof untilTs === 'number' && !isNaN(untilTs) && untilTs > 0) {
      const formatted = formatLoadBeforeTime(untilTs);
      if (formatted) {
        const translated = t('feed.load_before', { time: formatted });
        if (translated && translated !== 'feed.load_before') {
          return translated;
        }
        return `${formatted} 以前を読み込む`;
      }
    }
  } catch (e) { }
  return t('feed.load_more') || 'もっと読む';
}

const _renderTimers = {};
let _state = null;
let _options = null;
let _isScrolling = false;
let _scrollTimeout = null;
const _pendingFeedRenders = new Set();
const _allowDuringScrollFeeds = new Set();

function flushPendingFeedRendersWhenIdle() {
  if (_pendingFeedRenders.size === 0) return;
  const feedIds = Array.from(_pendingFeedRenders);
  _pendingFeedRenders.clear();
  for (const feedId of feedIds) {
    try { renderFeed(feedId); } catch (e) { }
  }
}

function markUserScrolling() {
  _isScrolling = true;
  if (_scrollTimeout) clearTimeout(_scrollTimeout);
  _scrollTimeout = setTimeout(() => {
    _isScrolling = false;
    flushPendingFeedRendersWhenIdle();
  }, 280);
}

function initScrollListener() {
  if (typeof window === 'undefined') return;
  if (window.__nokakoiScrollListenerInitialized) return;
  window.__nokakoiScrollListenerInitialized = true;

  const onDirectUserScrollInput = () => {
    try { clearAnchorMaintenance(); } catch (e) { }
    markUserScrolling();
  };

  window.addEventListener('wheel', onDirectUserScrollInput, { passive: true });
  window.addEventListener('touchmove', onDirectUserScrollInput, { passive: true });

  window.addEventListener('scroll', () => {
    try {
      const activeFeed = document.querySelector('.feed.active');
      if (activeFeed) updateBackScrollingState(activeFeed);
    } catch (e) { }

    if (isProgrammaticScroll()) return;
    markUserScrolling();
  }, { passive: true });
}

function debugFeed(...args) {
  try {
    if (isDebugEnabled()) {
      console.debug(...args);
    }
  } catch (e) { }
}

function buildEventNode(eventObj, feedId) {
  if (!_state || !_options) return null;
  if (feedId === 'global' && _options.settingsManager && !shouldDisplayGlobalEvent(eventObj, _state, _options.settingsManager)) {
    return null;
  }
  const renderSettings = _options.getRenderSettingsWithUiState(feedId);
  const node = renderEvent(
    _state,
    eventObj,
    _options.nip19,
    renderSettings,
    _options.settingsManager,
    (ev, sym) => reactToEvent(_state, ev, sym),
    (ev) => { setReplyTarget(_state, ev, _options.nip19); },
    (ev) => repostEvent(_state, ev),
    feedId
  );
  try { applyStoredReactionToNode(eventObj && eventObj.id, node); } catch (e) { }
  return node;
}

// 無限スクロールオブザーバー
let _infiniteScrollObserver = null;

export function initFeedRenderer(state, options) {
  _state = state;
  _options = options;
  _infiniteScrollObserver = options.getInfiniteScrollObserver ? options.getInfiniteScrollObserver() : null;
  initScrollListener();
  initTimelinePerfMonitor();
}

export function setInfiniteScrollObserver(obs) {
  _infiniteScrollObserver = obs;
}

export function captureFeedUiStateFromDom(feedId, feedEl) {
  if (!_state || !_options) return;
  try {
    if (!feedEl) return;
    const uiState = _state.feeds[feedId] ? _options.ensureFeedUiState(feedId) : null;
    if (!uiState) return;

    const cwExpanded = new Set();
    const mutedExpanded = new Set();

    const events = feedEl.querySelectorAll('.event');
    for (const eventEl of Array.from(events)) {
      try {
        const eventId = eventEl.dataset ? eventEl.dataset.eventId : null;
        if (!eventId) continue;
        const hasCw = eventEl.classList.contains('has-cw');
        const isMuteCollapsible = eventEl.dataset && eventEl.dataset.muteCollapsible === '1';
        const cwFoldBar = eventEl.querySelector('.cw-fold-bar');
        const muteFoldBar = eventEl.querySelector('.muted-fold-bar:not(.cw-fold-bar)');
        if (hasCw && !cwFoldBar) cwExpanded.add(eventId);
        if (isMuteCollapsible && !muteFoldBar) mutedExpanded.add(eventId);
      } catch (e) { }
    }
    uiState.expandedCwEventIds = cwExpanded;
    uiState.expandedMutedEventIds = mutedExpanded;
    try {
      const selectedEl = getSelectedEventEl();
      uiState.selectedEventId = (selectedEl && selectedEl.closest && selectedEl.closest('.feed') === feedEl)
        ? (selectedEl.dataset ? selectedEl.dataset.eventId : null)
        : null;
    } catch (e) {
      uiState.selectedEventId = null;
    }
  } catch (e) { }
}

export function applyStoredReactionToNode(eventId, node) {
  if (!_state || !_options) return;
  try {
    if (!eventId || !node) return;
    const mem = userKind7Memory.get(eventId);
    const myReaction = (mem && typeof mem === 'object' && !Array.isArray(mem)) ? (mem.content || '') : mem;
    if (!myReaction) return;
    const btn = node.querySelector && node.querySelector('.btn-react');
    if (!btn) return;
    try {
      const reactionEmojiTags = (mem && typeof mem === 'object' && Array.isArray(mem.emojiTags)) ? mem.emojiTags : [];
      const targetEv = _options.findEventById(_state, eventId) || null;
      const emojiTags = reactionEmojiTags.length ? reactionEmojiTags : ((targetEv && targetEv.tags) ? targetEv.tags : []);
      try { applyReactionToButton(btn, myReaction, emojiTags); } catch (e) {
        if (myReaction === '+') btn.textContent = '★';
        else btn.textContent = myReaction || '';
        try { btn.dataset.reacted = 'true'; } catch (e) { }
      }
    } catch (e) { }
  } catch (e) { }
}

export function scheduleRender(id, delay = 50, options = null) {
  try {
    const allowDuringScroll = !!(options && options.allowDuringScroll === true);
    if (allowDuringScroll) {
      _allowDuringScrollFeeds.add(id);
    }

    const el = $('#feed-' + id);
    const isActiveFeed = el && el.classList.contains('active');
    // ユーザーが遡行スクロールしている最中の新着は、スクロール停止までバッファリングして慣性スクロール停止を防ぐ。
    // ただし「もっと読む」完了（allowDuringScroll）の末尾追加はスクロール中でも即時反映して先読みを継続させる。
    if (!_allowDuringScrollFeeds.has(id) && _isScrolling && isActiveFeed && isBackScrolling(el)) {
      _pendingFeedRenders.add(id);
      return;
    }

    if (_renderTimers[id]) {
      if (_allowDuringScrollFeeds.has(id) && !allowDuringScroll) {
        return;
      }
      clearTimeout(_renderTimers[id]);
    }
    _renderTimers[id] = setTimeout(() => {
      try {
        _allowDuringScrollFeeds.delete(id);
        renderFeed(id);
      } catch (e) { console.warn('[FeedRenderer] スケジュール済み描画に失敗', e); }
      try { delete _renderTimers[id]; } catch (e) { }
    }, delay);
  } catch (e) {
    console.error('[FeedRenderer] scheduleRender err:', e);
  }
}

export function renderFeed(id = 'global', force = false) {
  if (!_state || !_options) {
    console.warn('[FeedRenderer] renderFeed called before initialization');
    return;
  }
  _allowDuringScrollFeeds.delete(id);
  const el = $('#feed-' + id);
  if (!el) return;
  const perfStartMs = (isDebugEnabled() && typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : null;
  const feed = _state.feeds[id];
  const loadSt = feedLoadState[id] || {};
  if (loadSt.preferFullRender) {
    force = true;
    loadSt.preferFullRender = false;
  }
  if (loadSt.histLoading) force = true;
  const isActiveFeed = el.classList.contains('active');
  let isBackScrollingActiveFeed = false;
  if (isActiveFeed) {
    try {
      const prevScrollY = window.scrollY;
      const tabsBar = document.querySelector('.tabs');
      const tabsBarHeight = tabsBar ? tabsBar.getBoundingClientRect().height : 0;
      const feedRect = el.getBoundingClientRect();
      const tabTopPos = Math.max(0, Math.round(feedRect.top + prevScrollY - tabsBarHeight));
      isBackScrollingActiveFeed = prevScrollY > tabTopPos;
    } catch (e) { }
  }
  captureFeedUiStateFromDom(id, el);


  const addNotifyDot = () => {
    try {
      const tabEl = document.querySelector('.tab[data-tab="' + id + '"]');
      if (tabEl) {
        const tabsCfg = _options.settingsManager.get('tabs_v2');
        const tabCfg = tabsCfg && tabsCfg.find(tc => tc.id === id);
        if (!tabCfg || tabCfg.notifyDot !== false) {
          tabEl.classList.add('has-new-dot');
        }
      }
    } catch (e) { }
  };

  const finalizeTopEventMarker = () => {
    const newTopId = eventsToRender.length > 0 ? eventsToRender[0].id : '';
    const prevTopId = el.dataset.topEventId || '';
    el.dataset.topEventId = newTopId;
    if (!isActiveFeed && newTopId && (prevTopId === '' || prevTopId !== newTopId) && window.__nokakoiFeedsReady) {
      addNotifyDot();
    }
  };



  let eventsToRender;
  try {
    const seen = new Map();
    for (const ev of (feed.list || [])) {
      if (!ev || !ev.id) continue;
      if (id === 'global' && _options?.settingsManager && !shouldDisplayGlobalEvent(ev, _state, _options.settingsManager)) {
        continue;
      }
      seen.set(ev.id, ev);
    }
    eventsToRender = Array.from(seen.values());
  } catch (e) {
    eventsToRender = feed.list || [];
    if (id === 'global' && _options?.settingsManager) {
      eventsToRender = eventsToRender.filter(ev => shouldDisplayGlobalEvent(ev, _state, _options.settingsManager));
    }
  }

  // スクロール中に「もっと読む」完了で描画する際、先頭に届いていた未描画の新着だけはスクロール停止後まで保留する
  if (!force && _isScrolling && isActiveFeed && isBackScrollingActiveFeed) {
    const firstExisting = el.querySelector('.event[data-event-id]');
    const firstExistingId = firstExisting && firstExisting.dataset ? firstExisting.dataset.eventId : '';
    if (firstExistingId) {
      const firstIdx = eventsToRender.findIndex(ev => ev && ev.id === firstExistingId);
      if (firstIdx > 0) {
        eventsToRender = eventsToRender.slice(firstIdx);
        _pendingFeedRenders.add(id);
      }
    }
  }

  let bottomBar = null;
  let scrollSentinel = null;
  const displayCount = feed.list?.length || 0;
  const showLoadMore = displayCount < EVENTS_MAX && !(feedLoadState[id] && feedLoadState[id].noMoreEvents);
  if (showLoadMore && id !== 'bitchat') {
    scrollSentinel = document.createElement('div');
    scrollSentinel.className = 'feed-scroll-sentinel';
    scrollSentinel.style.height = '1px';
    scrollSentinel.style.pointerEvents = 'none';

    const isFailedMode = !!(feedLoadState[id] && feedLoadState[id].autoFetchFailed);
    const isLoadingMore = !!(feedLoadState[id] && feedLoadState[id].loadingMore);
    const isAutoMode = !isFailedMode;

    bottomBar = document.createElement('button');
    bottomBar.type = 'button';
    bottomBar.className = 'feed-bar feed-bar-bottom accent-center load-more-btn' + (isAutoMode ? ' is-loading-auto' : '');
    bottomBar.textContent = isAutoMode ? t('loading') : (isLoadingMore ? t('loading') : getLoadMoreLabel(id, _state, _options));
    bottomBar.dataset.autoLoad = isAutoMode ? '1' : '0';

    if (_options.setupInfiniteScrollObserver) {
      _options.setupInfiniteScrollObserver();
      _infiniteScrollObserver = _options.getInfiniteScrollObserver();
    }

    bottomBar.onclick = (clickEvent) => {
      try {
        const isManual = clickEvent?.isTrusted === true;
        const listForClick = feed.list || [];
        const hasPagination = (typeof feed.paginationUntil === 'number') || (Array.isArray(feed.perFilterUntil) && feed.perFilterUntil.some(t => t != null));
        if (!listForClick.length && !hasPagination && id !== 'global') {
          return;
        }
        feedLoadState[id] = feedLoadState[id] || {};
        const now = Date.now();
        if (!canStartMore(feedLoadState[id], isManual, now)) return;
        markMoreStarted(feedLoadState[id], isManual, now);
        if (bottomBar) {
          bottomBar.classList.add('is-loading-auto');
          bottomBar.textContent = t('loading');
        }

        const oldest = listForClick[listForClick.length - 1];

        const isValidTimestamp = (ts) => {
          if (typeof ts !== 'number' || isNaN(ts)) return false;
          // 2010年(1262304000)から現在時刻の1日後までの範囲を妥当とする（ミリ秒13桁や0を除外）
          const nowSec = Math.floor(Date.now() / 1000);
          return ts > 1262304000 && ts < nowSec + 86400;
        };

        let untilFallback = Math.floor(Date.now() / 1000);
        if (typeof feed.paginationUntil === 'number' && isValidTimestamp(feed.paginationUntil)) {
          untilFallback = feed.paginationUntil;
        } else if (oldest && isValidTimestamp(oldest.created_at)) {
          untilFallback = oldest.created_at;
        } else {
          const validEvent = listForClick.slice().reverse().find(e => e && isValidTimestamp(e.created_at));
          if (validEvent) {
            untilFallback = validEvent.created_at;
          }
        }
        const startListLength = listForClick.length;

        let baseFilters = [];
        if (id === 'home') {
          try {
            const pubkey = localStorage.getItem('pubkey');
            const followsForMore = (_state.feeds['home'] && _state.feeds['home'].follows) || [];
            if (!followsForMore.length) {
              feedLoadState[id].loadingMore = false;
              scheduleRender(id, 0, { allowDuringScroll: true });
              return;
            }
            const optionalHomeFollowKinds = [];
            if (_options.settingsManager.get('showHomeReactions') === true) optionalHomeFollowKinds.push(7);
            if (_options.settingsManager.get('showHomeChannel') === true) optionalHomeFollowKinds.push(42);
            if (_options.settingsManager.get('showHomeRepost16') === true) optionalHomeFollowKinds.push(16);

            baseFilters = [
              // 1. フォロイーの全対象投稿（基本の1,6,1111 ＋ オンになっているオプション）を1つに統合
              { kinds: [1, 6, 1111, ...optionalHomeFollowKinds], authors: followsForMore, limit: EVENTS_FETCH_LIMIT },
              // 2. 自分宛ての投稿
              { kinds: [1, 6, 7, 1111, 9735], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
              buildOutgoingZapReceiptFilter(pubkey, { limit: EVENTS_FETCH_LIMIT }),
              // 3. 自分自身の投稿
              { kinds: [7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }
            ].filter(Boolean);
          } catch (e) { console.error('[FeedRenderer] home filter err:', e); baseFilters = []; }
        } else if (id === 'mentions') {
          const pubkey = localStorage.getItem('pubkey');
          baseFilters = [
            { kinds: [1, 6, 7, 16, 42, 1111, 9735], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
            { kinds: [1111], '#P': [pubkey], limit: EVENTS_FETCH_LIMIT }
          ];
        } else if (id === 'me') {
          const pubkey = localStorage.getItem('pubkey');
          baseFilters = [
            { kinds: [1, 6, 7, 42, 16, 1111], authors: [pubkey], limit: EVENTS_FETCH_LIMIT },
            buildOutgoingZapReceiptFilter(pubkey, { limit: EVENTS_FETCH_LIMIT })
          ].filter(Boolean);
        } else if (id === 'global') {
          baseFilters = [{ kinds: [1, 6, 1111], limit: EVENTS_FETCH_LIMIT }];
        } else {
          baseFilters = [{ kinds: [1, 6, 1111], limit: EVENTS_FETCH_LIMIT }];
        }

        const filtersToUse = applyPerFilterUntil(_state, id, baseFilters, untilFallback);

        const finishLoadMore = (result) => {
          try {
            if (result && typeof result === 'object') {
              markMoreFinished(feedLoadState[id], result.appendedCount, Date.now());
            } else {
              markMoreFinished(feedLoadState[id], 0, Date.now());
            }
          } catch (e) { }
          try {
            if (bottomBar) {
              if (feedLoadState[id].autoFetchFailed) {
                bottomBar.classList.remove('is-loading-auto');
                bottomBar.textContent = getLoadMoreLabel(id, _state, _options);
                bottomBar.dataset.autoLoad = '0';
              } else {
                bottomBar.classList.add('is-loading-auto');
                bottomBar.textContent = t('loading');
                bottomBar.dataset.autoLoad = '1';
              }
            }
          } catch (e) { }
          try { scheduleRender(id, 0, { allowDuringScroll: true }); } catch (e) { }
        };

        if (id === 'global' && _options.settingsManager.get('globalMergeHome') === true) {
          const globalRelays = _options.resolveGlobalRelays(_options.settingsManager, _state.relays);

          const gfeed = _state.feeds['global'];
          const displayed = listForClick;
          const fallbackUntil = Math.floor(Date.now() / 1000);
          const mergeUntil = (typeof gfeed?.mergedPaginationUntil === 'number')
            ? gfeed.mergedPaginationUntil
            : (displayed.length > 0
              ? (displayed[displayed.length - 1]?.created_at ?? fallbackUntil) - 1
              : fallbackUntil - 1);

          if (globalRelays.length === 0 && _options.buildHomeLoadMoreFiltersForGlobalMerge(mergeUntil).length === 0) {
            finishLoadMore();
            return;
          }

          _options.runMergedGlobalLoadMore({ mergeUntil, startListLength })
            .then(({ madeProgress, appendedCount, minScannedTs }) => {
              try {
                if (!gfeed) return;
                if (madeProgress) {
                  delete gfeed.mergedPaginationUntil;
                } else if (typeof minScannedTs === 'number') {
                  gfeed.mergedPaginationUntil = minScannedTs - 1;
                } else {
                  gfeed.mergedPaginationUntil = mergeUntil - 3600;
                }
              } catch (e) { }
              const count = typeof appendedCount === 'number' ? appendedCount : (madeProgress ? 1 : 0);
              finishLoadMore({ appendedCount: count });
            })
            .catch((err) => {
              console.error('[FeedRenderer] runMergedGlobalLoadMore err:', err);
              finishLoadMore({ appendedCount: 0 });
            });
          return;
        }

        let relays = getReadRelays(_state.relays);
        if (id === 'global') {
          relays = _options.resolveGlobalRelays(_options.settingsManager, _state.relays);
        }

        try {
          const morePromise = fetchMore({
            state: _state,
            feedId: id,
            filters: filtersToUse,
            relays: relays,
            startListLength,
            addToFeed: _options.addToFeed,
            scheduleRender,
            eventsFetchLimit: EVENTS_FETCH_LIMIT,
            eventsTimeout: Math.max(EVENTS_TIMEOUT, 10000),
            acceptEvent: (ev) => {
              if (id === 'global' && _options?.settingsManager) {
                return shouldDisplayGlobalEvent(ev, _state, _options.settingsManager);
              }
              return true;
            }
          });
          try {
            if (!feedLoadState[id]) feedLoadState[id] = {};
            feedLoadState[id].moreController = morePromise && morePromise.controller ? morePromise.controller : null;
          } catch (e) { }
          morePromise.then((result) => {
            try {
              if (feedLoadState[id] && feedLoadState[id].moreController === (morePromise && morePromise.controller)) {
                feedLoadState[id].moreController = null;
              }
            } catch (e) { }
            finishLoadMore(result);
          }).catch((err) => {
            try {
              if (feedLoadState[id] && feedLoadState[id].moreController === (morePromise && morePromise.controller)) {
                feedLoadState[id].moreController = null;
              }
            } catch (e) { }
            console.error('[FeedRenderer] fetchMore promise err:', err);
            debugFeed('[FeedRenderer] fetchMore promise err summary', {
              feedId: id,
              filtersCount: Array.isArray(filtersToUse) ? filtersToUse.length : 0,
              relaysCount: Array.isArray(relays) ? relays.length : 0,
              startListLength
            });
            finishLoadMore();
          });
        } catch (e) {
          console.error('[FeedRenderer] fetchMore call err:', e);
          debugFeed('[FeedRenderer] fetchMore call err summary', {
            feedId: id,
            filtersCount: Array.isArray(filtersToUse) ? filtersToUse.length : 0,
            relaysCount: Array.isArray(relays) ? relays.length : 0,
            startListLength
          });
          try { feedLoadState[id].loadingMore = false; } catch (ee) { }
          try { if (bottomBar) bottomBar.textContent = getLoadMoreLabel(id, _state, _options); } catch (ee) { }
        }
      } catch (err) {
        console.error('[FeedRenderer] bottomBar.onclick crash:', err);
        debugFeed('[FeedRenderer] bottomBar onclick crash summary', {
          feedId: id,
          listLength: Array.isArray(feed && feed.list) ? feed.list.length : 0
        });
        try { feedLoadState[id].loadingMore = false; } catch (ee) { }
        try { if (bottomBar) bottomBar.textContent = getLoadMoreLabel(id, _state, _options); } catch (ee) { }
      }
    };
  }

  const unobserveOldBottomControls = () => {
    if (!_infiniteScrollObserver) return;
    try {
      el.querySelectorAll('.feed-scroll-sentinel, .feed-bar-bottom').forEach((node) => {
        try { _infiniteScrollObserver.unobserve(node); } catch (e) { }
      });
    } catch (e) { }
  };

  const observeNewBottomControls = () => {
    if (!_infiniteScrollObserver) return;
    try {
      if (scrollSentinel && scrollSentinel.parentNode === el) {
        _infiniteScrollObserver.observe(scrollSentinel);
      }
      if (bottomBar && bottomBar.parentNode === el) {
        _infiniteScrollObserver.observe(bottomBar);
      }
    } catch (e) { }
  };

  unobserveOldBottomControls();

  const prevTopId = el.dataset.topEventId || '';
  const scrollAnchor = (isActiveFeed && isBackScrollingActiveFeed && !_isScrolling)
    ? captureTimelineAnchor(el)
    : null;

  if (!force) {
    try {
      const newTopId = eventsToRender.length > 0 ? eventsToRender[0].id : '';
      const isTopChanged = newTopId && prevTopId && newTopId !== prevTopId;
      const shouldAnimate = !isBackScrollingActiveFeed && isTopChanged && (!_options?.settingsManager || !_options.settingsManager.get('disableBlink'));

      const res = reconcileFeedDom({
        container: el,
        eventsToRender,
        buildNode: (ev, fid) => buildEventNode(ev, fid),
        feedId: id,
        bottomBar,
        scrollSentinel,
        animateNewItems: shouldAnimate
      });

      observeNewBottomControls();

      if (res.modified) {
        if (scrollAnchor && !res.appendOnly && !_isScrolling) {
          try {
            const anchorOpts = isScrollAnchoringSupported() ? { maintainMs: 50 } : undefined;
            restoreTimelineAnchor(scrollAnchor, el, anchorOpts);
          } catch (e) { }
        }
        if (isActiveFeed && isBackScrollingActiveFeed && isTopChanged) {
          try { addNotifyDot(); } catch (e) { }
          try {
            if (!_options.settingsManager.get('disableBlink')) {
              const topBtn = document.getElementById('scrollToTopBtn');
              if (topBtn) {
                topBtn.classList.add('has-new');
                topBtn.hidden = false;
              }
            }
          } catch (e) { }
        }
      }

      finalizeTopEventMarker();
      if (perfStartMs !== null) {
        recordFeedRender({
          feedId: id,
          mode: res.modified ? 'diff' : 'noop',
          durationMs: performance.now() - perfStartMs
        });
      }
      return;
    } catch (e) {
      console.warn('[FeedRenderer] 差分描画に失敗したため全件描画にフォールバックします:', e);
    }
  }

  const frag = document.createDocumentFragment();
  const sentinelIndex = eventsToRender.length >= PRELOAD_EVENT_OFFSET
    ? eventsToRender.length - PRELOAD_EVENT_OFFSET
    : -1;

  for (let i = 0; i < eventsToRender.length; i++) {
    if (scrollSentinel && i === sentinelIndex) {
      frag.appendChild(scrollSentinel);
    }
    const node = buildEventNode(eventsToRender[i], id);
    if (node) frag.appendChild(node);
  }
  if (scrollSentinel && !scrollSentinel.parentNode) {
    frag.appendChild(scrollSentinel);
  }
  if (bottomBar) frag.appendChild(bottomBar);

  // full render fallback
  const selectedEventId = (() => {
    try {
      const selectedEl = getSelectedEventEl();
      if (selectedEl) {
        return (selectedEl.closest && selectedEl.closest('.feed') === el)
          ? (selectedEl.dataset ? selectedEl.dataset.eventId : null)
          : null;
      }
      if (isActiveFeed) {
        return null;
      }
      const uiState = _options.ensureFeedUiState(id);
      if (uiState && uiState.selectedEventId) return uiState.selectedEventId;
      return null;
    } catch (e) {
      return null;
    }
  })();

  el.innerHTML = '';
  el.appendChild(frag);
  observeNewBottomControls();

  if (selectedEventId) {
    const restoredEl = el.querySelector('.event[data-event-id="' + selectedEventId + '"]');
    if (restoredEl) {
      setSelectedEventEl(restoredEl, { smooth: false, scroll: false });
    } else {
      setSelectedEventEl(null);
    }
  }

  try {
    const uiState = _options.ensureFeedUiState(id);
    uiState.selectedEventId = selectedEventId || null;
  } catch (e) { }

  if (scrollAnchor && !_isScrolling) {
    try {
      const anchorOpts = isScrollAnchoringSupported() ? { maintainMs: 50 } : undefined;
      restoreTimelineAnchor(scrollAnchor, el, anchorOpts);
    } catch (e) { }
  }

  const newTopId = eventsToRender.length > 0 ? eventsToRender[0].id : '';
  if (isActiveFeed && isBackScrollingActiveFeed && prevTopId && newTopId && prevTopId !== newTopId) {
    try { addNotifyDot(); } catch (e) { }
    try {
      if (!_options.settingsManager.get('disableBlink')) {
        const topBtn = document.getElementById('scrollToTopBtn');
        if (topBtn) {
          topBtn.classList.add('has-new');
          topBtn.hidden = false;
        }
      }
    } catch (e) { }
  }

  finalizeTopEventMarker();
  if (perfStartMs !== null) {
    recordFeedRender({
      feedId: id,
      mode: 'full',
      durationMs: performance.now() - perfStartMs
    });
  }
}
