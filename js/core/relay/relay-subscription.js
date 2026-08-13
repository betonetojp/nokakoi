import { getAppState, setRelayInspector } from '../app-context.js';

import { findEventById, cacheEvent } from '../state.js';
import { getReadRelays, normalizeUrl } from './relay-helpers.js';
import { MAX_LIVE_PER_RELAY, MAX_ONESHOT_PER_RELAY, MAX_TOTAL_SUB_PER_RELAY, EVENTS_TIMEOUT, PER_RELAY_ONESHOT_LIMIT } from '../../config/constants.js';
import { getRelayFromPool } from './relay-connection.js';
import { debugRelay, relayStates } from './relay-state.js';

// subId -> リスナー集合
export const logicalListeners = new Map();
// state.subs へ登録される前の同一 logical subscription 開始競合を集約する。
export const pendingLogicalSubscriptions = new Map();

// relay ごと・種別ごとのアクティブ件数
export const relayActiveCounts = {
  live: new Map(),
  oneshot: new Map()
};

export const subscribeQueue = [];
export const relayCooldownUntil = new Map();
const RELAY_DRAIN_COOLDOWN_MS = 250;
let queueCooldownTimer = null;
let queueProcessingSuspended = 0;

export class RelaySubscriptionCancelledError extends Error {
  constructor(message = 'relay subscription cancelled') {
    super(message);
    this.name = 'RelaySubscriptionCancelledError';
    this.code = 'RELAY_SUBSCRIPTION_CANCELLED';
  }
}

function settleQueuedRequest(req, outcome, value) {
  if (!req || req.__startSettled) return false;
  req.__startSettled = true;
  try {
    const callback = outcome === 'resolve' ? req.resolve : req.reject;
    if (typeof callback === 'function') callback(value);
  } catch (e) { }
  return true;
}

function cleanupQueuedRequestIdentity(req) {
  if (!req) return;
  if (req.logicalIdentity) {
    const pending = pendingLogicalSubscriptions.get(req.logicalIdentity);
    if (pending && pending.queuedReq === req) {
      try { pending.listeners.clear(); } catch (e) { }
      pendingLogicalSubscriptions.delete(req.logicalIdentity);
    }
  }
  if (req.subId) logicalListeners.delete(req.subId);
}

/**
 * Cancel a queued (or not-yet-registered) subscription and settle its start promise.
 * Safe to call repeatedly; cleanup, close, and rejection happen at most once.
 */
export function cancelQueuedSubscription(req, reason = 'relay subscription cancelled') {
  if (!req) return false;
  const wasQueued = subscribeQueue.includes(req);
  const wasPending = !!(req.logicalIdentity &&
    pendingLogicalSubscriptions.get(req.logicalIdentity)?.queuedReq === req);
  const wasUnsettled = !req.__startSettled;

  req.cancelled = true;
  for (let i = subscribeQueue.length - 1; i >= 0; i--) {
    if (subscribeQueue[i] === req) subscribeQueue.splice(i, 1);
  }
  cleanupQueuedRequestIdentity(req);

  if (req.sub && typeof req.sub.close === 'function') {
    try { req.sub.close(); } catch (e) { }
  }
  settleQueuedRequest(
    req,
    'reject',
    reason instanceof RelaySubscriptionCancelledError
      ? reason
      : new RelaySubscriptionCancelledError(String(reason || 'relay subscription cancelled'))
  );
  return wasQueued || wasPending || wasUnsettled;
}

export function cancelQueuedSubscriptionsForPool(pool, reason = 'relay pool closed') {
  if (!pool) return 0;
  let count = 0;
  const requests = new Set(subscribeQueue);
  for (const pending of pendingLogicalSubscriptions.values()) {
    if (pending && pending.queuedReq) requests.add(pending.queuedReq);
  }
  for (const req of requests) {
    if (req && req.pool === pool && cancelQueuedSubscription(req, reason)) count++;
  }
  return count;
}

const FEED_TAB_IDS = ['home', 'global', 'mentions', 'me'];

function relayKey(url) {
  return (typeof url === 'string') ? url.trim().replace(/\/+$/, '') : url;
}

function scheduleQueueAfterCooldown() {
  if (queueCooldownTimer) return;
  const now = Date.now();
  let wait = Infinity;
  for (const until of relayCooldownUntil.values()) {
    if (until > now) wait = Math.min(wait, until - now);
  }
  if (!Number.isFinite(wait)) return;
  queueCooldownTimer = setTimeout(() => {
    queueCooldownTimer = null;
    const current = Date.now();
    for (const [key, until] of relayCooldownUntil.entries()) {
      if (until <= current) relayCooldownUntil.delete(key);
    }
    processSubscribeQueue();
    if (subscribeQueue.length) scheduleQueueAfterCooldown();
  }, Math.max(0, wait));
}

function markRelayCooldown(relays) {
  const until = Date.now() + RELAY_DRAIN_COOLDOWN_MS;
  for (const relay of relays || []) {
    const key = relayKey(relay);
    if (key) relayCooldownUntil.set(key, Math.max(relayCooldownUntil.get(key) || 0, until));
  }
  scheduleQueueAfterCooldown();
}

function getNostrState() {
  try {
    return (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : null;
  } catch (e) {
    return null;
  }
}

function getActiveTabId() {
  try {
    const activeTabEl = document.querySelector('.tab.active');
    return (activeTabEl && activeTabEl.dataset) ? activeTabEl.dataset.tab : 'home';
  } catch (e) {
    return 'home';
  }
}

function isLiveOrProtectedKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key === 'follows') return true;
  if (key.includes('live')) return true;
  if (key.includes('profile')) return true;
  return false;
}

function keyBelongsToInactiveFeedTab(key, activeTab) {
  if (!key || typeof key !== 'string' || isLiveOrProtectedKey(key)) return false;
  let preserveHomeOnGlobal = false;
  try {
    if (activeTab === 'global' && typeof window !== 'undefined' && window.__nostrState) {
      // settings は feed-manager 側と同じ localStorage appSettings を参照
      const raw = localStorage.getItem('appSettings');
      if (raw) {
        const s = JSON.parse(raw);
        preserveHomeOnGlobal = !!(s && s.globalMergeHome === true);
      }
    }
  } catch (e) { }
  for (const tabId of FEED_TAB_IDS) {
    if (tabId === activeTab) continue;
    if (preserveHomeOnGlobal && tabId === 'home') continue;
    if (key === tabId || key.startsWith(tabId + '_')) return true;
  }
  if (activeTab !== 'global' && (key.startsWith('merged_global') || key.includes('merged_global_'))) return true;
  return false;
}

/**
 * 条件に合う oneshot（キュー待ち・実行中）をキャンセル。live は対象外。
 * @returns {number} キャンセル/クローズした件数
 */
export function cancelOneshotByPredicate(predicate) {
  let count = 0;
  try {
    if (typeof predicate !== 'function') return 0;

    for (let i = subscribeQueue.length - 1; i >= 0; i--) {
      const req = subscribeQueue[i];
      if (!req || req.cancelled) continue;
      const type = req.type || inferReqType(req.filters, req.key);
      if (type !== 'oneshot') continue;
      if (!predicate(req.key, req)) continue;
      if (cancelQueuedSubscription(req)) count++;
    }

    // subscribeMany 開始済みだが Promise の state.subs 登録前にある購読も対象にする。
    for (const pending of Array.from(pendingLogicalSubscriptions.values())) {
      const req = pending && pending.queuedReq;
      if (!req || req.cancelled) continue;
      const type = req.type || inferReqType(req.filters, req.key);
      if (type !== 'oneshot' || !predicate(req.key, req)) continue;
      if (cancelQueuedSubscription(req)) count++;
    }

    const state = getNostrState();
    if (state && state.subs) {
      for (const [sid, sub] of Array.from(state.subs.entries())) {
        try {
          if (!sub || sub.__type !== 'oneshot') continue;
          if (!predicate(sub.__key, sub)) continue;
          try { if (typeof sub.close === 'function') sub.close(); } catch (e) { }
          try { state.subs.delete(sid); } catch (e) { }
          count++;
        } catch (e) { }
      }
    }
  } catch (e) {
    console.warn('[Relay] cancelOneshotByPredicate 失敗:', e);
  }
  return count;
}

/**
 * 非アクティブタブの hist/more oneshot を閉じる（live は維持）
 */
export function cancelInactiveTabOneshots(activeTab) {
  const tab = activeTab || getActiveTabId();
  const n = cancelOneshotByPredicate((key) => keyBelongsToInactiveFeedTab(key, tab));
  if (n > 0) {
    debugRelay('[Relay] 非アクティブタブの oneshot をキャンセル:', n, 'activeTab=', tab);
    try { processSubscribeQueue(); } catch (e) { }
  }
  return n;
}

export function canonicalize(val) {
  if (val === null || typeof val === 'undefined') return null;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') return val;
  if (Array.isArray(val)) {
    const items = val.map(v => canonicalize(v));
    try {
      return items.sort((a, b) => {
        const sa = JSON.stringify(a);
        const sb = JSON.stringify(b);
        if (sa < sb) return -1;
        if (sa > sb) return 1;
        return 0;
      });
    } catch (e) {
      return items;
    }
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val).sort();
    const out = {};
    for (const k of keys) {
      out[k] = canonicalize(val[k]);
    }
    return out;
  }
  try { return String(val); } catch (e) { return null; }
}

export function incrementActiveCounts(relays, type) {
  const map = relayActiveCounts[type] || relayActiveCounts.oneshot;
  for (const r of relays) {
    const key = relayKey(r);
    const v = map.get(key) || 0;
    map.set(key, v + 1);
  }
}

export function decrementActiveCounts(relays, type) {
  const map = relayActiveCounts[type] || relayActiveCounts.oneshot;
  for (const r of relays) {
    const key = relayKey(r);
    const v = map.get(key) || 0;
    const nv = Math.max(0, v - 1);
    map.set(key, nv);
  }
}

/**
 * 実際の state.subs に基づいて relayActiveCounts の不整合・漏れを補正
 */
export function sanitizeRelayActiveCounts() {
  try {
    const state = getNostrState();
    if (!state || !state.subs) return;
    const liveCounts = new Map();
    const oneshotCounts = new Map();

    for (const sub of state.subs.values()) {
      if (!sub || sub.closed) continue;
      const type = sub.__type || 'oneshot';
      const relays = sub.__targetRelays || [];
      const map = (type === 'live') ? liveCounts : oneshotCounts;
      for (const r of relays) {
        const key = relayKey(r);
        map.set(key, (map.get(key) || 0) + 1);
      }
    }

    relayActiveCounts.live = liveCounts;
    relayActiveCounts.oneshot = oneshotCounts;
  } catch (e) {
    console.warn('[Relay] sanitizeRelayActiveCounts に失敗:', e);
  }
}

export function shouldCloseSubscriptionNetwork(pool, relays) {
  try {
    if (!pool || !Array.isArray(relays) || relays.length === 0) return true;
    const CONNECTING = (typeof WebSocket !== 'undefined' && typeof WebSocket.CONNECTING === 'number') ? WebSocket.CONNECTING : 0;
    const OPEN = (typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number') ? WebSocket.OPEN : 1;
    const CLOSING = (typeof WebSocket !== 'undefined' && typeof WebSocket.CLOSING === 'number') ? WebSocket.CLOSING : 2;
    const CLOSED = (typeof WebSocket !== 'undefined' && typeof WebSocket.CLOSED === 'number') ? WebSocket.CLOSED : 3;
    for (const url of relays) {
      try {
        const relay = getRelayFromPool(pool, url);
        const ws = relay && relay.ws;
        if (!ws || typeof ws.readyState !== 'number') return true;
        if (ws.readyState === CONNECTING || ws.readyState === OPEN) return true;
        if (ws.readyState !== CLOSING && ws.readyState !== CLOSED) return true;
      } catch (e) {
        return true;
      }
    }
    return false;
  } catch (e) { }
  return true;
}

export function hasOpenSocketForRelays(pool, relays) {
  try {
    if (!pool || !Array.isArray(relays) || relays.length === 0) return false;
    const OPEN = (typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number') ? WebSocket.OPEN : 1;
    for (const url of relays) {
      const relay = getRelayFromPool(pool, url);
      const ws = relay && relay.ws;
      if (ws && typeof ws.readyState === 'number' && ws.readyState === OPEN) return true;
    }
  } catch (e) { }
  return false;
}

export function canStartForAll(relays, type, priority = false) {
  // priority はキュー順序のみに使い、同時実行上限は bypass しない
  void priority;
  const map = relayActiveCounts[type] || relayActiveCounts.oneshot;
  const limit = (type === 'live') ? MAX_LIVE_PER_RELAY : MAX_ONESHOT_PER_RELAY;
  const totalLimit = typeof MAX_TOTAL_SUB_PER_RELAY === 'number' ? MAX_TOTAL_SUB_PER_RELAY : 5;
  const now = Date.now();
  for (const relay of relays) {
    if ((relayCooldownUntil.get(relayKey(relay)) || 0) > now) return false;
  }
  
  let blocked = false;
  for (const r of relays) {
    const key = relayKey(r);
    const vLive = relayActiveCounts.live.get(key) || 0;
    const vOne = relayActiveCounts.oneshot.get(key) || 0;
    const current = map.get(key) || 0;
    if (current >= limit || (vLive + vOne) >= totalLimit) {
      blocked = true;
      break;
    }
  }

  // もし上限に達してブロックされた場合は、カウント不整合の可能性を考慮して再計算して再確認
  if (blocked) {
    sanitizeRelayActiveCounts();
    for (const r of relays) {
      const key = relayKey(r);
      const vLive = relayActiveCounts.live.get(key) || 0;
      const vOne = relayActiveCounts.oneshot.get(key) || 0;
      const current = map.get(key) || 0;
      if (current >= limit) return false;
      if ((vLive + vOne) >= totalLimit) return false;
    }
  }

  return true;
}

export function reevaluateQueuePriorities() {
  try {
    const activeTabEl = document.querySelector('.tab.active');
    const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : 'home';

    for (const req of subscribeQueue) {
      let isHighPriority = false;
      const key = req.key;
      if (key === 'follows' || (key && (key.includes('profile') || key.includes('live')))) {
        isHighPriority = true;
      } else if (activeTab && key && (key === activeTab || key.startsWith(activeTab + '_'))) {
        isHighPriority = true;
      }
      req.priority = isHighPriority;
    }

    subscribeQueue.sort((a, b) => {
      const aPri = a.priority ? 1 : 0;
      const bPri = b.priority ? 1 : 0;
      return bPri - aPri;
    });

    debugRelay('[Relay] キューの優先度を再評価しました。アクティブタブ:', activeTab);
    processSubscribeQueue();
  } catch (e) {
    console.warn('[Relay] キューの優先度再評価に失敗しました:', e);
  }
}

try {
  if (typeof window !== 'undefined') {
    window.addEventListener('tab:changed', (e) => {
      try {
        const tab = (e && e.detail && e.detail.tab) ? e.detail.tab : getActiveTabId();
        cancelInactiveTabOneshots(tab);
      } catch (err) { }
      try { reevaluateQueuePriorities(); } catch (err) { }
    });
  }
} catch (e) { }

export function processSubscribeQueue() {
  if (queueProcessingSuspended > 0) return;
  if (!subscribeQueue.length) return;
  for (let i = 0; i < subscribeQueue.length; i++) {
    const req = subscribeQueue[i];
    if (req.cancelled) {
      cancelQueuedSubscription(req);
      i--;
      continue;
    }
    const type = req.type || inferReqType(req.filters, req.key);
    req.type = type;
    const priority = !!req.priority;
    try {
      req.targetRelays = Array.from(new Set((req.targetRelays || []).map(normalizeUrl).filter(Boolean)));
    } catch (e) { }
    if (canStartForAll(req.targetRelays, type, priority)) {
      subscribeQueue.splice(i, 1);
      i--;
      try {
        incrementActiveCounts(req.targetRelays, type);
        const pool = req.pool || (typeof window !== 'undefined' && window.__nostrState && window.__nostrState.pool) || null;
        if (!pool) {
          decrementActiveCounts(req.targetRelays, type);
          settleQueuedRequest(req, 'reject', new Error('no pool available'));
          continue;
        }
        try {
          debugRelay('[Relay] 購読処理を開始', { relays: req.targetRelays, type: type, filters: req.filters });
        } catch (e) { }
        let sub = null;
        let closeRequested = false;
        const requestClose = () => {
          closeRequested = true;
          try { if (sub && typeof sub.close === 'function') sub.close(); } catch (e) { }
        };
        sub = pool.subscribeMany(req.targetRelays, req.filters, {
          onevent: (function () {
            if (type === 'oneshot') {
              const perRelayLimit = PER_RELAY_ONESHOT_LIMIT;
              const relayCount = Array.isArray(req.targetRelays) && req.targetRelays.length ? req.targetRelays.length : 1;
              const counts = new Map();
              let total = 0;
              const eoseSeen = new Set();
              return function (ev, relay, doneFlag) {
                try {
                  if (ev && relay) {
                    try {
                      ev.seenOn = ev.seenOn || [];
                      const norm = normalizeUrl(relay);
                      if (norm && !ev.seenOn.map(normalizeUrl).includes(norm)) {
                        ev.seenOn.push(relay);
                      }
                    } catch (e) { }
                  }
                  try { req.dispatcher(ev, relay, false); } catch (e) { }
                  if (!ev) return;
                  try {
                    const key = (relay && typeof relay === 'string') ? relay.trim().replace(/\/+$/, '') : '__unknown__';
                    const cur = counts.get(key) || 0;
                    if (cur < perRelayLimit) {
                      counts.set(key, cur + 1);
                      total++;
                    }
                    if (doneFlag) {
                      eoseSeen.add(key);
                    }
                    if (total >= perRelayLimit * relayCount) requestClose();
                    if (eoseSeen.size >= relayCount) requestClose();
                  } catch (e) { }
                } catch (e) { }
              };
            }
            return function (ev, relay) {
              if (ev && relay) {
                try {
                  ev.seenOn = ev.seenOn || [];
                  const norm = normalizeUrl(relay);
                  if (norm && !ev.seenOn.map(normalizeUrl).includes(norm)) {
                    ev.seenOn.push(relay);
                  }
                } catch (e) { }
              }
              req.dispatcher(ev, relay, false);
            };
          })(),
          oneose: function (relay) {
            try {
              try { req.dispatcher(null, relay, true); } catch (e) { }
            } catch (e) { }
            if (type === 'oneshot') requestClose();
          }
        });
        const origClose = sub.close.bind(sub);
        try {
          sub.__targetRelays = req.targetRelays ? (Array.isArray(req.targetRelays) ? req.targetRelays.slice() : [req.targetRelays]) : [];
          sub.__pool = pool;
          sub.__type = type;
          sub.__key = req.key || null;
          sub.__sid = req.subId || null;
          sub.__logicalIdentity = req.logicalIdentity || null;
        } catch (e) { }
        let oneshotTimer = null;
        if (type === 'oneshot') {
          try {
            oneshotTimer = setTimeout(() => {
              requestClose();
            }, EVENTS_TIMEOUT);
          } catch (e) { }
        }

        sub.closed = false;
        sub.__decremented = false;
        const subId = sub.__sid || null;
        const logicalIdentity = sub.__logicalIdentity || null;

        let releaseStarted = false;
        let releaseFinalized = false;
        const finalizeRelease = function () {
          if (releaseFinalized) return;
          releaseFinalized = true;
          if (!sub.__decremented) {
            sub.__decremented = true;
            try { decrementActiveCounts(req.targetRelays, type); } catch (e) { }
          }
          markRelayCooldown(req.targetRelays);
          try { processSubscribeQueue(); } catch (e) { }
        };
        const release = function (closeNetwork) {
          if (releaseFinalized) return;
          if (releaseStarted) {
            // Pool teardown must release accounting synchronously even if a prior
            // network CLOSE is still pending.
            if (!closeNetwork) finalizeRelease();
            return;
          }
          releaseStarted = true;
          sub.closed = true;
          try {
            const appState = req.state || getAppState();
            if (subId && appState && appState.subs && appState.subs.get(subId) === sub) {
              appState.subs.delete(subId);
            }
          } catch (e) { }
          if (subId) logicalListeners.delete(subId);
          if (logicalIdentity) {
            const pending = pendingLogicalSubscriptions.get(logicalIdentity);
            if (pending && pending.queuedReq === req) pendingLogicalSubscriptions.delete(logicalIdentity);
          }
          if (oneshotTimer) {
            clearTimeout(oneshotTimer);
            oneshotTimer = null;
          }

          if (!closeNetwork || !shouldCloseSubscriptionNetwork(pool, req.targetRelays)) {
            finalizeRelease();
            return;
          }

          let closeResult;
          try {
            closeResult = origClose();
          } catch (e) {
            finalizeRelease();
            return;
          }
          if (closeResult && typeof closeResult.then === 'function') {
            Promise.resolve(closeResult).then(finalizeRelease, finalizeRelease);
          } else {
            finalizeRelease();
          }
        };
        sub.__releaseLocal = function () {
          release(false);
        };
        sub.close = function () {
          release(true);
        };
        if (closeRequested) sub.close();
        if (req.cancelled) {
          req.sub = sub;
          cancelQueuedSubscription(req);
          continue;
        }
        req.sub = sub;
        settleQueuedRequest(req, 'resolve', sub);
      } catch (e) {
        try { decrementActiveCounts(req.targetRelays, type); } catch (er) { }
        settleQueuedRequest(req, 'reject', e);
      }
    }
  }
}

export function inferReqType(filters, key = null) {
  try {
    if (key && typeof key === 'string') {
      // hist / more は since 付きでも oneshot（EOSE で閉じる）
      if (/_hist(?:_|$)/.test(key) || /_more(?:_|$)/.test(key) || key.includes('merged_global_more')) {
        return 'oneshot';
      }
      // live キーは常に live
      if (/_live(?:_|$)/.test(key) || /(^|_)live$/.test(key)) {
        return 'live';
      }
    }
  } catch (e) { }
  try {
    if (!filters) return 'oneshot';
    for (const f of filters) {
      if (f && typeof f === 'object' && ('since' in f)) return 'live';
    }
  } catch (e) { }
  return 'oneshot';
}

export function subOnce(state, key, filters, onEvent, relays = null) {
  if (!state.pool) {
    console.warn('[Relay] pool 未利用のため購読をスキップ', key);
    return function () { };
  }
  let targetRelays = relays || getReadRelays(state.relays);
  if (!Array.isArray(targetRelays)) targetRelays = [];
  targetRelays = Array.from(new Set(targetRelays.map(normalizeUrl).filter(Boolean)));

  if (!targetRelays || targetRelays.length === 0) {
    console.warn('[Relay] 購読用リレーなし:', key);
    return function () { };
  }

  let queuedReq;

  let filterKey;
  try {
    filterKey = JSON.stringify(canonicalize(filters || []));
  } catch (e) {
    try { filterKey = String(filters); } catch (e2) { filterKey = '' + Math.random(); }
  }
  const logicalPrefix = key + '|' + filterKey + ':';

  const inferredType = inferReqType(filters, key);
  const logicalIdentity = logicalPrefix + '|' + targetRelays.slice().sort().join(',');

  const pending = pendingLogicalSubscriptions.get(logicalIdentity);
  if (pending && pending.state === state && pending.pool === state.pool &&
      pending.type === inferredType && pending.queuedReq && !pending.queuedReq.cancelled) {
    pending.listeners.add(onEvent);
    let removed = false;
    return function () {
      if (removed) return;
      removed = true;
      pending.listeners.delete(onEvent);
      if (pending.listeners.size > 0) return;
      const req = pending.queuedReq;
      if (req.sub && typeof req.sub.close === 'function') {
        try { req.sub.close(); } catch (e) { }
      } else {
        cancelQueuedSubscription(req);
      }
    };
  }

  try {
    let existingSid = null;
    for (const sid of state.subs.keys()) {
      if (typeof sid === 'string' && sid.indexOf(logicalPrefix) === 0) {
        existingSid = sid;
        break;
      }
    }
    if (existingSid) {
      try {
        const existingSub = state.subs.get(existingSid);
        let canReuse = false;
        if (existingSub && !existingSub.closed) {
          try {
            if (existingSub.__pool && state.pool && existingSub.__pool === state.pool) {
              const oldTargets = Array.isArray(existingSub.__targetRelays) ? existingSub.__targetRelays.map(normalizeUrl).filter(Boolean) : [];
              const newTargets = Array.isArray(targetRelays) ? targetRelays.map(normalizeUrl).filter(Boolean) : [];
              if (oldTargets.length === newTargets.length) {
                const sOld = oldTargets.slice().sort();
                const sNew = newTargets.slice().sort();
                canReuse = (JSON.stringify(sOld) === JSON.stringify(sNew));
              }
            }
          } catch (e) { }

          // Live 購読の場合は対象リレーに OPEN な WebSocket が存在しないなら再利用せず新規作成する
          if (canReuse && inferredType === 'live') {
            const hasSocket = hasOpenSocketForRelays(state.pool, targetRelays);
            if (!hasSocket) {
              canReuse = false;
              debugRelay('[Relay] Live 購読再利用をキャンセル (OPEN socket なし):', existingSid);
              try { if (typeof existingSub.close === 'function') existingSub.close(); } catch (e) { }
            }
          }
        }

        if (canReuse) {
          try {
            let listeners = logicalListeners.get(existingSid);
            if (!listeners) {
              listeners = new Set();
              logicalListeners.set(existingSid, listeners);
            }
            listeners.add(onEvent);
            debugRelay('[Relay] 購読再利用:', existingSid);
            return function () {
              try {
                listeners.delete(onEvent);
                if (listeners.size === 0) {
                  try {
                    const s = state.subs.get(existingSid);
                    if (s && typeof s.close === 'function') s.close();
                  } catch (e) { console.warn('[Relay] 購読解除失敗:', e); }
                  state.subs.delete(existingSid);
                  logicalListeners.delete(existingSid);
                }
              } catch (e) { console.warn('[Relay] 購読解除失敗:', e); }
            };
          } catch (e) {
            console.warn('[Relay] 既存購読の再利用に失敗', e);
          }
        } else {
          existingSid = null;
        }
      } catch (e) {
        console.warn('[Relay] subOnce の再利用判定でエラー', e);
      }
    }
  } catch (e) {
    console.warn('[Relay] subOnce の再利用判定でエラー', e);
  }

  const subId = logicalPrefix + Math.random().toString(36).slice(2, 8);

  try {
    const listeners = new Set();
    listeners.add(onEvent);
    logicalListeners.set(subId, listeners);
    const dispatcher = function (ev, relay, done) {
      try {
        for (const fn of Array.from(listeners)) {
          try { fn(ev, relay, done); } catch (inner) { console.warn('[Relay] リスナー処理でエラー', inner); }
        }
      } catch (e) { }
    };

    debugRelay('[Relay] 購読開始:', targetRelays.length, 'relays, key=', key);
    const inferredType = inferReqType(filters, key);
    // 同名 live の孤児購読が残っている場合は差し替え前に閉じる
    if (inferredType === 'live' && key) {
      try {
        for (const [sid, existing] of Array.from(state.subs.entries())) {
          try {
            if (!existing || existing.__type !== 'live') continue;
            if (existing.__key !== key) continue;
            try { if (typeof existing.close === 'function') existing.close(); } catch (e) { }
            try { state.subs.delete(sid); } catch (e) { }
            debugRelay('[Relay] 既存 live を差し替えのためクローズ:', key);
          } catch (e) { }
        }
      } catch (e) { }
    }
    queuedReq = {
      targetRelays,
      filters,
      dispatcher,
      pool: state.pool,
      state,
      cancelled: false,
      key,
      type: inferredType,
      subId,
      logicalIdentity
    };
    pendingLogicalSubscriptions.set(logicalIdentity, {
      state,
      pool: state.pool,
      type: inferredType,
      listeners,
      queuedReq
    });
    const startPromise = new Promise((resolve, reject) => {
      queuedReq.resolve = resolve;
      queuedReq.reject = reject;

      let isHighPriority = false;
      try {
        if (key === 'follows') {
          isHighPriority = true;
        } else if (key && (key.includes('profile') || key.includes('live'))) {
          isHighPriority = true;
        } else {
          const activeTabEl = document.querySelector('.tab.active');
          const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : 'home';
          if (activeTab && key && (key === activeTab || key.startsWith(activeTab + '_'))) {
            isHighPriority = true;
          }
        }
      } catch (e) {
        if (key && (key === 'home' || key.startsWith('home_') || key.includes('live'))) isHighPriority = true;
      }

      if (isHighPriority) {
        let insertIdx = 0;
        while (insertIdx < subscribeQueue.length && subscribeQueue[insertIdx].priority) {
          insertIdx++;
        }
        queuedReq.priority = true;
        subscribeQueue.splice(insertIdx, 0, queuedReq);
      } else {
        subscribeQueue.push(queuedReq);
      }

      try { processSubscribeQueue(); } catch (e) { console.warn('[Relay] processSubscribeQueue に失敗', e); }
    });

    startPromise.then(s => {
      try { queuedReq.sub = s; } catch (e) { }
      const currentPending = pendingLogicalSubscriptions.get(logicalIdentity);
      if (currentPending && currentPending.queuedReq === queuedReq) {
        pendingLogicalSubscriptions.delete(logicalIdentity);
      }
      try {
        if (s && !s.closed && listeners.size > 0 && !queuedReq.cancelled) {
          state.subs.set(subId, s);
        }
      } catch (e) { }
    }).catch(e => {
      const currentPending = pendingLogicalSubscriptions.get(logicalIdentity);
      if (currentPending && currentPending.queuedReq === queuedReq) {
        pendingLogicalSubscriptions.delete(logicalIdentity);
      }
    });

  } catch (e) {
    try { logicalListeners.delete(subId); } catch (inner) { }
    try {
      const pending = pendingLogicalSubscriptions.get(logicalIdentity);
      if (pending && pending.queuedReq === queuedReq) pendingLogicalSubscriptions.delete(logicalIdentity);
    } catch (inner) { }
    console.warn('[Relay] 購読失敗', e);
    return function () { };
  }
  let unsubscribed = false;
  return function () {
    if (unsubscribed) return;
    unsubscribed = true;
    try {
      if (typeof queuedReq === 'undefined') {
        return;
      }
      if (queuedReq && queuedReq.sub) {
        const listeners = logicalListeners.get(subId);
        if (listeners) listeners.delete(onEvent);
        if (!listeners || listeners.size === 0) {
          try { queuedReq.sub.close(); } catch (e) { console.warn('[Relay] 購読解除失敗:', e); }
          try { state.subs.delete(subId); } catch (e) { }
        }
      } else if (queuedReq) {
        const pending = pendingLogicalSubscriptions.get(logicalIdentity);
        if (pending) pending.listeners.delete(onEvent);
        if (!pending || pending.listeners.size === 0) {
          try {
            cancelQueuedSubscription(queuedReq);
          } catch (e) { }
        }
      }
    } catch (e) { console.warn('[Relay] 購読解除失敗:', e); }
  };
}

setRelayInspector(function inspectRelaySubscriptions() {
  try {
        function aggregateCounts(map) {
          const agg = Object.create(null);
          for (const [k, v] of map.entries()) {
            try {
              const nk = (typeof k === 'string') ? k.trim().replace(/\/+$/, '') : k;
              agg[nk] = (agg[nk] || 0) + (v || 0);
            } catch (e) { }
          }
          return Object.entries(agg);
        }
        const liveCounts = aggregateCounts(relayActiveCounts.live);
        const oneshotCounts = aggregateCounts(relayActiveCounts.oneshot);
        const q = subscribeQueue.map(q => ({ targetRelays: (q.targetRelays || []).map(u => (typeof u === 'string' ? u.trim().replace(/\/+$/, '') : u)), filters: q.filters, cancelled: !!q.cancelled, hasSub: !!q.sub }));
        return {
          queueLength: subscribeQueue.length,
          queue: q,
          activeCounts: { live: liveCounts, oneshot: oneshotCounts },
          logicalListenersCount: logicalListeners.size,
          subsKeys: Array.from((getAppState() && getAppState().subs) ? getAppState().subs.keys() : [])
        };
  } catch (e) {
    return { error: e && e.message };
  }
});

/**
 * Release managed subscriptions for a pool without sending per-subscription CLOSE messages.
 * Pool socket shutdown cancels the corresponding server-side requests.
 */
export function releaseSubscriptionsForPool(state, pool, queuedReason = null) {
  if (!pool) return 0;
  const subscriptions = new Set();
  try {
    if (state && state.subs) {
      for (const sub of state.subs.values()) {
        if (sub && sub.__pool === pool) subscriptions.add(sub);
      }
    }
  } catch (e) { }
  try {
    for (const pending of pendingLogicalSubscriptions.values()) {
      const req = pending && pending.queuedReq;
      if (req && req.pool === pool && req.sub) subscriptions.add(req.sub);
    }
  } catch (e) { }
  try {
    for (const req of subscribeQueue) {
      if (req && req.pool === pool && req.sub) subscriptions.add(req.sub);
    }
  } catch (e) { }

  let released = 0;
  queueProcessingSuspended++;
  try {
    for (const sub of subscriptions) {
      try {
        if (typeof sub.__releaseLocal === 'function') {
          const wasClosed = !!sub.closed;
          sub.__releaseLocal();
          if (!wasClosed) released++;
        }
      } catch (e) { }
    }
    if (queuedReason) {
      cancelQueuedSubscriptionsForPool(pool, queuedReason);
    }
  } finally {
    queueProcessingSuspended = Math.max(0, queueProcessingSuspended - 1);
  }
  try { processSubscribeQueue(); } catch (e) { }
  return released;
}

export function unsubscribeAll(state) {
  try {
    if (!state || !state.subs) return;
    for (const [, sub] of state.subs) {
      try {
        if (sub && typeof sub.close === 'function') sub.close();
      } catch (e) { }
    }
    try { state.subs.clear(); } catch (e) { }
  } catch (e) {
    console.warn('[Relay] 購読解除失敗:', e);
  }
}

