// ============================================================================
// フィード描画・タイムライン更新管理
// ============================================================================

import { renderEvent, applyReactionToButton } from './renderer.js';
import { reactToEvent, repostEvent } from './actions.js';
import { setReplyTarget } from './composer.js';
import { getReadRelays } from './relay.js';
import { fetchMore } from './feed-fetcher.js';
import { EVENTS_FETCH_LIMIT, EVENTS_TIMEOUT, EVENTS_MAX } from './constants.js';
import { captureTimelineAnchor, restoreTimelineAnchor } from './url-parser.js';
import { t } from './i18n.js';
import { $ } from './utils.js';
import { getSelectedEventEl, setSelectedEventEl } from './keyboard-shortcuts.js';

export const feedLoadState = {};
export const userKind7Memory = new Map();
try { window.userKind7Memory = userKind7Memory; } catch (e) { }

const _renderTimers = {};
let _state = null;
let _options = null;

function debugFeed(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.debug(...args);
    }
  } catch (e) { }
}

// 無限スクロールオブザーバー
let _infiniteScrollObserver = null;

export function initFeedRenderer(state, options) {
  _state = state;
  _options = options;
  _infiniteScrollObserver = options.getInfiniteScrollObserver ? options.getInfiniteScrollObserver() : null;
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

function classifyIncrementalRender(domIds, eventsToRender) {
  const renderIds = (eventsToRender || []).map(e => e && e.id).filter(Boolean);
  if (!domIds.length || !renderIds.length) return 'full';
  if (new Set(domIds).size !== domIds.length) return 'full';

  const firstDomId = domIds[0];
  const firstIdx = renderIds.indexOf(firstDomId);
  if (firstIdx < 0) return 'full';

  const prefixOk = domIds.length <= renderIds.length
    && domIds.every((id, i) => renderIds[i] === id);
  if (prefixOk && renderIds.length > domIds.length) return 'append';

  if (firstIdx > 0) {
    const suffixOk = domIds.every((id, i) => renderIds[firstIdx + i] === id);
    if (suffixOk) return 'prepend';
  }

  if (domIds.length === renderIds.length && domIds.every((id, i) => id === renderIds[i])) {
    return 'noop';
  }

  return 'full';
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

export function scheduleRender(id, delay = 50) {
  try {
    if (_renderTimers[id]) {
      clearTimeout(_renderTimers[id]);
    }
    _renderTimers[id] = setTimeout(() => {
      try { renderFeed(id); } catch (e) { console.warn('[FeedRenderer] スケジュール済み描画に失敗', e); }
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
  const el = $('#feed-' + id);
  if (!el) return;
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
  const renderSettings = _options.getRenderSettingsWithUiState(id);

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
    if (!isActiveFeed && prevTopId && newTopId && prevTopId !== newTopId && window.__nokakoiFeedsReady) {
      addNotifyDot();
    }
  };

  const buildEventNode = (eventObj) => {
    const node = renderEvent(
      _state,
      eventObj,
      _options.nip19,
      renderSettings,
      _options.settingsManager,
      (ev, sym) => reactToEvent(_state, ev, sym),
      (ev) => { setReplyTarget(_state, ev, _options.nip19); },
      (ev) => repostEvent(_state, ev),
      id
    );
    try { applyStoredReactionToNode(eventObj && eventObj.id, node); } catch (e) { }
    return node;
  };

  let eventsToRender;
  try {
    const seen = new Map();
    for (const ev of (feed.list || [])) {
      if (!ev || !ev.id) continue;
      seen.set(ev.id, ev);
    }
    eventsToRender = Array.from(seen.values());
  } catch (e) {
    eventsToRender = feed.list || [];
  }

  let bottomBar = null;
  const displayCount = feed.list?.length || 0;
  const showLoadMore = displayCount < EVENTS_MAX;
  if (showLoadMore && id !== 'bitchat') {
    bottomBar = document.createElement('button');
    bottomBar.type = 'button';
    bottomBar.className = 'feed-bar feed-bar-bottom accent-center load-more-btn';
    bottomBar.textContent = feedLoadState[id] && feedLoadState[id].loadingMore ? t('loading') : t('feed.load_more');

    if (_options.setupInfiniteScrollObserver) {
      _options.setupInfiniteScrollObserver();
      _infiniteScrollObserver = _options.getInfiniteScrollObserver();
    }
    if (_infiniteScrollObserver) _infiniteScrollObserver.observe(bottomBar);

    bottomBar.onclick = () => {
      try {
        const listForClick = feed.list || [];
        if (!listForClick.length || (feedLoadState[id] && feedLoadState[id].loadingMore)) {
          return;
        }
        feedLoadState[id] = feedLoadState[id] || {};
        feedLoadState[id].loadingMore = true;
        if (bottomBar) bottomBar.textContent = t('loading');

        const oldest = listForClick[listForClick.length - 1];
        // 隙間バグを防ぐため、投稿頻度の高い kind:1 または kind:6 の中での最古のイベント時間を基準にする
        const oldestTextEvent = listForClick.slice().reverse().find(e => e && (e.kind === 1 || e.kind === 6));
        const until = oldestTextEvent && oldestTextEvent.created_at 
          ? oldestTextEvent.created_at 
          : (oldest && oldest.created_at ? oldest.created_at : Math.floor(Date.now() / 1000));
        const startListLength = listForClick.length;

        let filtersToUse = [];
        if (id === 'home') {
          try {
            const pubkey = localStorage.getItem('pubkey');
            const followsForMore = (_state.feeds['home'] && _state.feeds['home'].follows) || [];
            if (!followsForMore.length) {
              feedLoadState[id].loadingMore = false;
              scheduleRender(id);
              return;
            }
            const optionalHomeFollowKinds = [];
            if (_options.settingsManager.get('showHomeReactions') === true) optionalHomeFollowKinds.push(7);
            if (_options.settingsManager.get('showHomeChannel') === true) optionalHomeFollowKinds.push(42);
            if (_options.settingsManager.get('showHomeRepost16') === true) optionalHomeFollowKinds.push(16);

            const baseFilters = [
              // 1. フォロイーの全対象投稿（基本の1,6 ＋ オンになっているオプション）を1つに統合
              { kinds: [1, 6, ...optionalHomeFollowKinds], authors: followsForMore, limit: EVENTS_FETCH_LIMIT },
              // 2. 自分宛ての投稿
              { kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
              // 3. 自分自身の投稿
              { kinds: [7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }
            ];
            filtersToUse = baseFilters.map(f => Object.assign({}, f, { until: until - 1 }));
          } catch (e) { console.error('[FeedRenderer] home filter err:', e); filtersToUse = []; }
        } else if (id === 'mentions') {
          const pubkey = localStorage.getItem('pubkey');
          filtersToUse = [{ kinds: [1, 6, 7], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT, until: until - 1 }];
        } else if (id === 'me') {
          const pubkey = localStorage.getItem('pubkey');
          filtersToUse = [{ kinds: [1, 6, 7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT, until: until - 1 }];
        } else if (id === 'bitchat') {
          filtersToUse = [{ kinds: [20000], limit: EVENTS_FETCH_LIMIT, until: until - 1 }];
        } else if (id === 'global') {
          filtersToUse = [{ kinds: [1, 6], limit: EVENTS_FETCH_LIMIT, until: until - 1 }];
        } else {
          filtersToUse = [{ kinds: [1, 6], limit: EVENTS_FETCH_LIMIT, until: until - 1 }];
        }

        const finishLoadMore = () => {
          try { feedLoadState[id].loadingMore = false; } catch (e) { }
          try { if (bottomBar) bottomBar.textContent = t('feed.load_more'); } catch (e) { }
          try { scheduleRender(id); } catch (e) { }
        };

        if (id === 'global' && _options.settingsManager.get('globalMergeHome') === true) {
          const globalRelays = _options.resolveGlobalRelays(_options.settingsManager, _state.relays);

          const gfeed = _state.feeds['global'];
          const displayed = listForClick;
          const mergeUntil = (typeof gfeed?.mergedPaginationUntil === 'number')
            ? gfeed.mergedPaginationUntil
            : (displayed.length > 0
              ? (displayed[displayed.length - 1]?.created_at ?? until) - 1
              : until - 1);

          if (globalRelays.length === 0 && _options.buildHomeLoadMoreFiltersForGlobalMerge(mergeUntil).length === 0) {
            finishLoadMore();
            return;
          }

          _options.runMergedGlobalLoadMore({ mergeUntil, startListLength })
            .then(({ madeProgress }) => {
              try {
                if (!gfeed) return;
                if (madeProgress) delete gfeed.mergedPaginationUntil;
                else gfeed.mergedPaginationUntil = mergeUntil - 86400;
              } catch (e) { }
            })
            .catch((err) => { console.error('[FeedRenderer] runMergedGlobalLoadMore err:', err); })
            .finally(finishLoadMore);
          return;
        }

        let relays = getReadRelays(_state.relays);
        if (id === 'bitchat') {
          relays = _options.getOmochatRelays();
        } else if (id === 'global') {
          relays = _options.resolveGlobalRelays(_options.settingsManager, _state.relays);
        }

        try {
          fetchMore({
            state: _state,
            feedId: id,
            filters: filtersToUse,
            relays: relays,
            startListLength,
            addToFeed: (id === 'bitchat' && _state._bitchatFeedAdder) ? _state._bitchatFeedAdder : _options.addToFeed,
            scheduleRender,
            eventsFetchLimit: EVENTS_FETCH_LIMIT,
            eventsTimeout: Math.max(EVENTS_TIMEOUT, 10000)
          }).then(finishLoadMore).catch((err) => {
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
          try { if (bottomBar) bottomBar.textContent = t('feed.load_more'); } catch (ee) { }
        }
      } catch (err) {
        console.error('[FeedRenderer] bottomBar.onclick crash:', err);
        debugFeed('[FeedRenderer] bottomBar onclick crash summary', {
          feedId: id,
          listLength: Array.isArray(feed && feed.list) ? feed.list.length : 0
        });
        try { feedLoadState[id].loadingMore = false; } catch (ee) { }
        try { if (bottomBar) bottomBar.textContent = t('feed.load_more'); } catch (ee) { }
      }
    };
  }

  if (!force) {
    try {
      const existingEvents = Array.from(el.querySelectorAll('.event'));
      const domIds = existingEvents.map(n => n.dataset.eventId).filter(Boolean);
      const mode = classifyIncrementalRender(domIds, eventsToRender);
      if (mode === 'noop') {
        finalizeTopEventMarker();
        return;
      }
      if (mode === 'prepend') {
        const firstExistingIdx = eventsToRender.findIndex(e => e && e.id === domIds[0]);
        if (firstExistingIdx > 0) {
          const scrollAnchor = (isActiveFeed && isBackScrollingActiveFeed)
            ? captureTimelineAnchor(el)
            : null;
          const anchorNode = existingEvents[0];
          for (let i = firstExistingIdx - 1; i >= 0; i--) {
            const node = buildEventNode(eventsToRender[i]);
            el.insertBefore(node, anchorNode);
          }
          const existingBottom = el.querySelector('.feed-bar-bottom');
          if (existingBottom) existingBottom.remove();
          if (bottomBar) el.appendChild(bottomBar);

          if (scrollAnchor) {
            try { restoreTimelineAnchor(scrollAnchor, el); } catch (e) { }
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
          return;
        }
      }
      if (mode === 'append') {
        const startIdx = domIds.length;
        for (let i = startIdx; i < eventsToRender.length; i++) {
          const node = buildEventNode(eventsToRender[i]);
          if (bottomBar) {
            const currentBottom = el.querySelector('.feed-bar-bottom');
            if (currentBottom) el.insertBefore(node, currentBottom);
            else el.appendChild(node);
          } else {
            el.appendChild(node);
          }
        }
        const existingBottom = el.querySelector('.feed-bar-bottom');
        if (existingBottom) existingBottom.remove();
        if (bottomBar) el.appendChild(bottomBar);
        finalizeTopEventMarker();
        return;
      }
    } catch (e) { }
  }

  const frag = document.createDocumentFragment();
  for (let i = 0; i < eventsToRender.length; i++) {
    const node = buildEventNode(eventsToRender[i]);
    frag.appendChild(node);
  }
  if (bottomBar) frag.appendChild(bottomBar);

  const prevTopId = el.dataset.topEventId || '';
  const scrollAnchor = (isActiveFeed && isBackScrollingActiveFeed)
    ? captureTimelineAnchor(el)
    : null;
  const selectedEventId = (() => {
    try {
      const uiState = _options.ensureFeedUiState(id);
      if (uiState && uiState.selectedEventId) return uiState.selectedEventId;
      const selectedEl = getSelectedEventEl();
      return (selectedEl && selectedEl.closest && selectedEl.closest('.feed') === el)
        ? selectedEl.dataset.eventId
        : null;
    } catch (e) {
      return null;
    }
  })();

  el.innerHTML = '';
  el.appendChild(frag);

  if (selectedEventId) {
    const restoredEl = el.querySelector('.event[data-event-id="' + selectedEventId + '"]');
    if (restoredEl) {
      setSelectedEventEl(restoredEl);
    } else {
      setSelectedEventEl(null);
    }
  }

  try {
    const uiState = _options.ensureFeedUiState(id);
    uiState.selectedEventId = selectedEventId || null;
  } catch (e) { }

  if (scrollAnchor) {
    try { restoreTimelineAnchor(scrollAnchor, el); } catch (e) { }
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
}
