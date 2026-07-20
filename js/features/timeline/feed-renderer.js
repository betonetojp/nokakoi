// ============================================================================
// フィード描画・タイムライン更新管理
// ============================================================================

import { renderEvent, applyReactionToButton } from '../../ui/renderer.js';
import { reactToEvent, repostEvent } from '../post/actions.js';
import { setReplyTarget } from '../post/composer.js';
import { getReadRelays } from '../../core/relay.js';
import { fetchMore } from './feed-fetcher.js';
import { EVENTS_FETCH_LIMIT, EVENTS_TIMEOUT, EVENTS_MAX } from '../../config/constants.js';
import { captureTimelineAnchor, restoreTimelineAnchor, followUpTimelineAnchor } from '../../utils/url-parser.js';
import { t } from '../../utils/i18n.js';
import { $ } from '../../utils/utils.js';
import { getSelectedEventEl, setSelectedEventEl } from '../../ui/keyboard-shortcuts.js';

export const feedLoadState = {};
export const userKind7Memory = new Map();
try { window.userKind7Memory = userKind7Memory; } catch (e) { }

const _renderTimers = {};
let _state = null;
let _options = null;
let _domPurgeObserver = null;
let _isScrolling = false;
let _scrollTimeout = null;
let _purgeScrollClearTimer = null;
let _purgeBatchRaf = 0;
let _heightReleaseRaf = 0;
const _pendingPurges = new Set();
const _pendingRestores = new Set();
/** @type {{ node: Element, wasAboveViewport: boolean }[]} */
const _pendingHeightReleases = [];
/** eventId → 最後の復元タイムスタンプ（連続する再パージに対するヒステリシス） */
const _recentlyRestoredAt = new Map();
/** eventId → 最後のパージ時のロックされた高さ */
const _purgedHeights = new Map();

/** ビューポートのこのマージン内に入った時に復元する */
const DOM_PURGE_RESTORE_MARGIN_PX = 1200;
/** これより遠い場合のみパージする（復元とパージの境界に差を設けることで頻繁な切り替えを抑制） */
const DOM_PURGE_PURGE_MARGIN_PX = 2200;
const DOM_PURGE_IDLE_MS = 280;
const DOM_PURGE_RESTORE_COOLDOWN_MS = 600;

function isDomPurgeEnabled() {
  return !!(
    _options &&
    _options.settingsManager &&
    _options.settingsManager.get('useDomPurge') === true
  );
}

function isProgrammaticScroll() {
  try {
    return typeof window !== 'undefined' && window.__nokakoiProgrammaticScroll === true;
  } catch (e) {
    return false;
  }
}

function markProgrammaticScrollBriefly(ms) {
  if (typeof window === 'undefined') return;
  try {
    window.__nokakoiProgrammaticScroll = true;
    if (_purgeScrollClearTimer) clearTimeout(_purgeScrollClearTimer);
    _purgeScrollClearTimer = setTimeout(() => {
      _purgeScrollClearTimer = null;
      try {
        if (!window.__nokakoiScrollAnchor) {
          window.__nokakoiProgrammaticScroll = false;
        }
      } catch (e) { }
    }, typeof ms === 'number' ? ms : 120);
  } catch (e) { }
}

function applyAccumulatedScroll(heightDiff) {
  if (!heightDiff || typeof window === 'undefined') return;
  try {
    if (window.__nokakoiScrollAnchor) {
      const feed = document.querySelector('.feed.active');
      if (feed) followUpTimelineAnchor(feed);
      return;
    }
  } catch (e) { }
  markProgrammaticScrollBriefly();
  try { window.scrollBy(0, heightDiff); } catch (e) { }
}

/** ビューポート端からの距離（ビューポートと交差している場合は0） */
function distanceOutsideViewport(el) {
  if (!el || !el.isConnected) return Infinity;
  try {
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || 0;
    if (rect.bottom < 0) return -rect.bottom;
    if (rect.top > vh) return rect.top - vh;
    return 0;
  } catch (e) {
    return Infinity;
  }
}

function isBeyondPurgeMargin(el) {
  return distanceOutsideViewport(el) > DOM_PURGE_PURGE_MARGIN_PX;
}

function scheduleDomPurgeBatch() {
  if (_purgeBatchRaf || typeof requestAnimationFrame === 'undefined') {
    if (!_purgeBatchRaf && typeof requestAnimationFrame === 'undefined') {
      runDomPurgeBatch();
    }
    return;
  }
  _purgeBatchRaf = requestAnimationFrame(() => {
    _purgeBatchRaf = 0;
    runDomPurgeBatch();
  });
}

function queueRestore(el) {
  if (!el || !el.isConnected) return;
  _pendingPurges.delete(el);
  _pendingRestores.add(el);
  scheduleDomPurgeBatch();
}

function queuePurge(el) {
  if (!el || !el.isConnected) return;
  if (el.classList.contains('event-placeholder')) return;
  _pendingRestores.delete(el);
  _pendingPurges.add(el);
  scheduleDomPurgeBatch();
}

function flushPendingPurgesWhenIdle() {
  if (_pendingPurges.size === 0) {
    // Still schedule in case restores waited on scroll end.
    if (_pendingRestores.size > 0) scheduleDomPurgeBatch();
    return;
  }
  scheduleDomPurgeBatch();
}

function initScrollListener() {
  if (typeof window === 'undefined') return;
  if (window.__nokakoiScrollListenerInitialized) return;
  window.__nokakoiScrollListenerInitialized = true;

  window.addEventListener('scroll', () => {
    if (isProgrammaticScroll()) return;
    _isScrolling = true;
    if (_scrollTimeout) clearTimeout(_scrollTimeout);
    _scrollTimeout = setTimeout(() => {
      _isScrolling = false;
      flushPendingPurgesWhenIdle();
    }, DOM_PURGE_IDLE_MS);
  }, { passive: true });
}

function unobserveFeedEvents(feedEl) {
  if (!_domPurgeObserver || !feedEl) return;
  try {
    const nodes = feedEl.querySelectorAll('.event');
    for (const node of Array.from(nodes)) {
      try { _domPurgeObserver.unobserve(node); } catch (e) { }
      _pendingPurges.delete(node);
      _pendingRestores.delete(node);
    }
  } catch (e) { }
}

/** オブザーバーと保留状態を破棄（例: useDomPurge がオフになった時など） */
export function teardownDomPurge() {
  _pendingPurges.clear();
  _pendingRestores.clear();
  _pendingHeightReleases.length = 0;
  _recentlyRestoredAt.clear();
  _purgedHeights.clear();
  if (_purgeBatchRaf && typeof cancelAnimationFrame === 'function') {
    try { cancelAnimationFrame(_purgeBatchRaf); } catch (e) { }
    _purgeBatchRaf = 0;
  }
  if (_heightReleaseRaf && typeof cancelAnimationFrame === 'function') {
    try { cancelAnimationFrame(_heightReleaseRaf); } catch (e) { }
    _heightReleaseRaf = 0;
  }
  if (_scrollTimeout) {
    clearTimeout(_scrollTimeout);
    _scrollTimeout = null;
  }
  _isScrolling = false;
  if (_domPurgeObserver) {
    try { _domPurgeObserver.disconnect(); } catch (e) { }
    _domPurgeObserver = null;
  }
}

function debugFeed(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.debug(...args);
    }
  } catch (e) { }
}

function buildEventNode(eventObj, feedId) {
  if (!_state || !_options) return null;
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

function lookupFeedEvent(eventId) {
  if (!_state || !_state.feeds || !eventId) return null;
  for (const feedId in _state.feeds) {
    const feed = _state.feeds[feedId];
    if (feed && feed.map && feed.map.has(eventId)) {
      return feed.map.get(eventId);
    }
  }
  for (const feedId in _state.feeds) {
    const feed = _state.feeds[feedId];
    if (feed && Array.isArray(feed.list)) {
      const found = feed.list.find(e => e && e.id === eventId);
      if (found) return found;
    }
  }
  return null;
}

function resolvePlaceholderFeedId(placeholder) {
  const feedIdAttr = (placeholder && placeholder.dataset && placeholder.dataset.parentFeedId) || '';
  if (feedIdAttr) {
    return feedIdAttr.startsWith('feed-') ? feedIdAttr.slice(5) : feedIdAttr;
  }
  try {
    const feed = placeholder && placeholder.closest ? placeholder.closest('.feed') : null;
    if (feed && feed.id && feed.id.startsWith('feed-')) return feed.id.slice(5);
  } catch (e) { }
  return 'global';
}

function getDomPurgeObserver() {
  if (typeof window === 'undefined' || !window.IntersectionObserver) return null;
  if (!isDomPurgeEnabled()) return null;
  if (_domPurgeObserver) return _domPurgeObserver;
  const margin = `${DOM_PURGE_RESTORE_MARGIN_PX}px 0px ${DOM_PURGE_RESTORE_MARGIN_PX}px 0px`;
  _domPurgeObserver = new IntersectionObserver((entries) => {
    if (!isDomPurgeEnabled()) return;
    for (const entry of entries) {
      const el = entry.target;
      if (!el || !el.isConnected) continue;
      const eventId = el.dataset.eventId;
      if (!eventId) continue;

      if (entry.isIntersecting) {
        _pendingPurges.delete(el);
        if (el.classList.contains('event-placeholder')) {
          // スクロール中は、実際にビューポート内にある投稿のみを復元します。
          // プリフェッチ領域の復元は、スクロール中の再構築によるカクつきを減らすためにアイドル状態になるまで待ちます。
          if (_isScrolling && distanceOutsideViewport(el) > 0) {
            _pendingRestores.add(el);
          } else {
            queueRestore(el);
          }
        }
      } else if (!el.classList.contains('event-placeholder') && el.classList.contains('event')) {
        // ヒステリシス: 外側のマージンを超えた場合のみパージキューに追加します。
        if (!isBeyondPurgeMargin(el)) continue;
        const restoredAt = _recentlyRestoredAt.get(eventId) || 0;
        if (Date.now() - restoredAt < DOM_PURGE_RESTORE_COOLDOWN_MS) {
          // Keep soft-pending for idle flush after cooldown / farther scroll.
          _pendingPurges.add(el);
          continue;
        }
        if (_isScrolling) {
          _pendingPurges.add(el);
        } else {
          queuePurge(el);
        }
      }
    }
  }, {
    rootMargin: margin
  });
  return _domPurgeObserver;
}

/**
 * 復元されたノードの高さを安定化：プレースホルダーの高さにロックされた状態から開始し、
 * スクロール補正が一度に適用されるように単一の共有フレームでロックを解除します。
 */
function stabilizeRestoredNodeHeight(node, lockedHeight, wasAboveViewport) {
  if (!node || !(lockedHeight > 0)) return;
  try {
    node.style.boxSizing = 'border-box';
    node.style.height = `${lockedHeight}px`;
    node.style.overflow = 'hidden';
  } catch (e) { }

  _pendingHeightReleases.push({ node, wasAboveViewport: !!wasAboveViewport });
  scheduleHeightReleaseBatch();
}

function scheduleHeightReleaseBatch() {
  if (_heightReleaseRaf || typeof requestAnimationFrame === 'undefined') {
    if (!_heightReleaseRaf && typeof requestAnimationFrame === 'undefined') {
      flushHeightReleases();
    }
    return;
  }
  _heightReleaseRaf = requestAnimationFrame(() => {
    _heightReleaseRaf = requestAnimationFrame(() => {
      _heightReleaseRaf = 0;
      flushHeightReleases();
    });
  });
}

function flushHeightReleases() {
  if (_pendingHeightReleases.length === 0) return;
  const items = _pendingHeightReleases.splice(0);
  let scrollAccum = 0;
  for (const item of items) {
    const node = item && item.node;
    if (!node || !node.isConnected) continue;
    let rectBefore;
    try { rectBefore = node.getBoundingClientRect(); } catch (e) { continue; }
    try {
      node.style.height = '';
      node.style.overflow = '';
    } catch (e) { }
    let rectAfter;
    try { rectAfter = node.getBoundingClientRect(); } catch (e) { continue; }
    const diff = rectAfter.height - rectBefore.height;
    if (item.wasAboveViewport && diff) scrollAccum += diff;
  }
  if (scrollAccum) applyAccumulatedScroll(scrollAccum);
}

/** @returns {number} 要素がビューポートより上にあった場合に適用する heightDiff */
function purgeEventToPlaceholder(el, eventId) {
  if (!isDomPurgeEnabled()) return 0;
  if (!el || !el.isConnected) return 0;
  if (el.classList.contains('muted-hidden') || el.classList.contains('d-none')) return 0;
  if (el.classList.contains('event-placeholder')) return 0;

  _pendingPurges.delete(el);
  _pendingRestores.delete(el);

  const isSelected = (typeof getSelectedEventEl === 'function' && getSelectedEventEl() === el);
  const rectBefore = el.getBoundingClientRect();
  const height = el.offsetHeight;
  const finalHeight = height > 0 ? height : 1;
  const wasAbove = rectBefore.top < 0;

  if (eventId) _purgedHeights.set(eventId, finalHeight);

  const placeholder = document.createElement('div');
  placeholder.className = 'event event-placeholder';
  placeholder.dataset.eventId = eventId;
  const parentFeedId = el.parentElement ? el.parentElement.id : '';
  if (parentFeedId) {
    placeholder.dataset.parentFeedId = parentFeedId;
  }
  placeholder.style.height = `${finalHeight}px`;

  const obs = getDomPurgeObserver();
  if (obs) obs.unobserve(el);

  el.replaceWith(placeholder);

  const rectAfter = placeholder.getBoundingClientRect();
  const heightDiff = wasAbove ? (rectAfter.height - rectBefore.height) : 0;

  if (obs) obs.observe(placeholder);

  if (isSelected && typeof setSelectedEventEl === 'function') {
    setSelectedEventEl(placeholder, { smooth: false, scroll: false });
  }
  return heightDiff;
}

function removeFailedPlaceholder(placeholder) {
  if (!placeholder || !placeholder.isConnected) return 0;
  const obs = _domPurgeObserver;
  if (obs) {
    try { obs.unobserve(placeholder); } catch (e) { }
  }
  const eventId = placeholder.dataset && placeholder.dataset.eventId;
  if (eventId) _purgedHeights.delete(eventId);
  const rectBefore = placeholder.getBoundingClientRect();
  const wasAbove = rectBefore.top < 0;
  const height = rectBefore.height;
  placeholder.remove();
  return wasAbove ? -height : 0;
}

/** @returns {{ node: Element|null, heightDiff: number }} */
function restorePurgedEvent(placeholder, eventId) {
  if (!_state || !_options) return { node: null, heightDiff: 0 };
  if (!isDomPurgeEnabled()) return { node: null, heightDiff: 0 };
  if (!placeholder || !placeholder.isConnected) return { node: null, heightDiff: 0 };

  _pendingPurges.delete(placeholder);
  _pendingRestores.delete(placeholder);

  const eventObj = lookupFeedEvent(eventId);
  if (!eventObj) {
    return { node: null, heightDiff: removeFailedPlaceholder(placeholder) };
  }

  const feedId = resolvePlaceholderFeedId(placeholder);
  const node = buildEventNode(eventObj, feedId);
  if (!node) {
    return { node: null, heightDiff: removeFailedPlaceholder(placeholder) };
  }

  const isSelected = (typeof getSelectedEventEl === 'function' && getSelectedEventEl() === placeholder);
  const rectBefore = placeholder.getBoundingClientRect();
  const wasAbove = rectBefore.top < 0;
  const lockedHeight = (_purgedHeights.get(eventId) || rectBefore.height || 0);

  const obs = getDomPurgeObserver();
  if (obs) obs.unobserve(placeholder);

  // 入れ替え自体でレイアウトが崩れないよう、プレースホルダーの高さにロックします。
  if (lockedHeight > 0) {
    try {
      node.style.boxSizing = 'border-box';
      node.style.height = `${lockedHeight}px`;
      node.style.overflow = 'hidden';
    } catch (e) { }
  }

  placeholder.replaceWith(node);

  // ロック下の入れ替え ≈ 0 heightDiff。残差は stabilize で処理されます。
  const heightDiff = 0;

  if (obs) obs.observe(node);

  if (eventId) {
    _purgedHeights.delete(eventId);
    _recentlyRestoredAt.set(eventId, Date.now());
    // マップの肥大化を防止します。
    if (_recentlyRestoredAt.size > 400) {
      const oldest = _recentlyRestoredAt.keys().next().value;
      _recentlyRestoredAt.delete(oldest);
    }
  }

  if (isSelected && typeof setSelectedEventEl === 'function') {
    setSelectedEventEl(node, { smooth: false, scroll: false });
  }

  stabilizeRestoredNodeHeight(node, lockedHeight, wasAbove);
  return { node, heightDiff };
}

function runDomPurgeBatch() {
  if (!isDomPurgeEnabled()) {
    _pendingPurges.clear();
    _pendingRestores.clear();
    return;
  }

  let scrollAccum = 0;

  // 最初に復元（ビューポート内のコンテンツ）を行い、その後にパージします。
  const restores = Array.from(_pendingRestores);
  _pendingRestores.clear();
  for (const el of restores) {
    if (!el || !el.isConnected || !el.classList.contains('event-placeholder')) continue;
    const eventId = el.dataset.eventId;
    if (!eventId) continue;
    try {
      const result = restorePurgedEvent(el, eventId);
      if (result && result.heightDiff) scrollAccum += result.heightDiff;
    } catch (e) {
      debugFeed('[FeedRenderer] batched restore failed', e);
    }
  }

  const purges = Array.from(_pendingPurges);
  _pendingPurges.clear();
  for (const el of purges) {
    if (!el || !el.isConnected || el.classList.contains('event-placeholder')) continue;
    if (!isBeyondPurgeMargin(el)) continue;
    const eventId = el.dataset.eventId;
    if (!eventId) continue;
    const restoredAt = _recentlyRestoredAt.get(eventId) || 0;
    if (Date.now() - restoredAt < DOM_PURGE_RESTORE_COOLDOWN_MS) {
      // クールダウンが終わるまで再キューイングします。
      _pendingPurges.add(el);
      continue;
    }
    // ユーザーがスクロールしている間は、パージを延期し続けます。
    if (_isScrolling) {
      _pendingPurges.add(el);
      continue;
    }
    try {
      scrollAccum += purgeEventToPlaceholder(el, eventId) || 0;
    } catch (e) {
      debugFeed('[FeedRenderer] batched purge failed', e);
    }
  }

  if (scrollAccum) applyAccumulatedScroll(scrollAccum);

  // Cooldown leftovers: check again after cooldown window.
  if (_pendingPurges.size > 0) {
    setTimeout(() => {
      if (!_isScrolling) scheduleDomPurgeBatch();
    }, DOM_PURGE_RESTORE_COOLDOWN_MS);
  }
}

/** el がパージプレースホルダーである場合は復元してライブノードを返し、そうでない場合は el を返します。 */
export function ensureEventRestored(el) {
  if (!el || !el.isConnected) return null;
  if (!el.classList || !el.classList.contains('event-placeholder')) return el;
  const eventId = el.dataset && el.dataset.eventId;
  if (!eventId) return el;
  const result = restorePurgedEvent(el, eventId);
  return (result && result.node) || null;
}

/** 現在のビューポート付近のプレースホルダーを復元（例: トップへのジャンプ後） */
export function restoreDomPurgeAround(container, marginPx) {
  if (!isDomPurgeEnabled() || !container) return;
  const margin = typeof marginPx === 'number' ? marginPx : DOM_PURGE_RESTORE_MARGIN_PX;
  const vh = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 0;
  const placeholders = container.querySelectorAll('.event-placeholder');
  let scrollAccum = 0;
  for (const ph of Array.from(placeholders)) {
    try {
      const rect = ph.getBoundingClientRect();
      if (rect.bottom < -margin || rect.top > vh + margin) continue;
      const eventId = ph.dataset && ph.dataset.eventId;
      if (!eventId) continue;
      const result = restorePurgedEvent(ph, eventId);
      if (result && result.heightDiff) scrollAccum += result.heightDiff;
    } catch (e) { }
  }
  if (scrollAccum) applyAccumulatedScroll(scrollAccum);
}

// 無限スクロールオブザーバー
let _infiniteScrollObserver = null;

export function initFeedRenderer(state, options) {
  _state = state;
  _options = options;
  _infiniteScrollObserver = options.getInfiniteScrollObserver ? options.getInfiniteScrollObserver() : null;
  initScrollListener();
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
    if (!isActiveFeed && newTopId && (prevTopId === '' || prevTopId !== newTopId) && window.__nokakoiFeedsReady) {
      addNotifyDot();
    }
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
  const showLoadMore = displayCount < EVENTS_MAX && !(feedLoadState[id] && feedLoadState[id].noMoreEvents);
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

        const isValidTimestamp = (ts) => {
          if (typeof ts !== 'number' || isNaN(ts)) return false;
          // 2010年(1262304000)から現在時刻の1日後までの範囲を妥当とする（ミリ秒13桁や0を除外）
          const nowSec = Math.floor(Date.now() / 1000);
          return ts > 1262304000 && ts < nowSec + 86400;
        };

        let until = Math.floor(Date.now() / 1000);
        if (oldestTextEvent && isValidTimestamp(oldestTextEvent.created_at)) {
          until = oldestTextEvent.created_at;
        } else if (oldest && isValidTimestamp(oldest.created_at)) {
          until = oldest.created_at;
        } else {
          const validEvent = listForClick.slice().reverse().find(e => e && isValidTimestamp(e.created_at));
          if (validEvent) {
            until = validEvent.created_at;
          }
        }
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

        const finishLoadMore = (result) => {
          try {
            feedLoadState[id].loadingMore = false;
            if (result && typeof result === 'object' && result.appendedCount === 0) {
              feedLoadState[id].noMoreEvents = true;
            }
          } catch (e) { }
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
          const obs = getDomPurgeObserver();
          const anchorNode = existingEvents[0];
          for (let i = firstExistingIdx - 1; i >= 0; i--) {
            const node = buildEventNode(eventsToRender[i], id);
            if (node) {
              el.insertBefore(node, anchorNode);
              if (obs) obs.observe(node);
            }
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
        const obs = getDomPurgeObserver();
        for (let i = startIdx; i < eventsToRender.length; i++) {
          const node = buildEventNode(eventsToRender[i], id);
          if (node) {
            if (bottomBar) {
              const currentBottom = el.querySelector('.feed-bar-bottom');
              if (currentBottom) el.insertBefore(node, currentBottom);
              else el.appendChild(node);
            } else {
              el.appendChild(node);
            }
            if (obs) obs.observe(node);
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
    const node = buildEventNode(eventsToRender[i], id);
    if (node) frag.appendChild(node);
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

  // 親のない observe/purge コールバックを避けるため、DOMをクリアする前に古い IO ターゲットを解除します。
  unobserveFeedEvents(el);
  el.innerHTML = '';
  el.appendChild(frag);

  // 監視対象に登録
  const obs = getDomPurgeObserver();
  if (obs) {
    const nodes = el.querySelectorAll('.event:not(.event-placeholder)');
    for (const node of Array.from(nodes)) {
      obs.observe(node);
    }
  }

  if (selectedEventId) {
    const restoredEl = el.querySelector('.event[data-event-id="' + selectedEventId + '"]');
    if (restoredEl) {
      setSelectedEventEl(restoredEl, isDomPurgeEnabled() ? { smooth: false } : undefined);
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
