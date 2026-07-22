import { findEventById, cacheEvent } from '../state.js';
import { getReadRelays, normalizeUrl } from './relay-helpers.js';
import { MAX_LIVE_PER_RELAY, MAX_ONESHOT_PER_RELAY, MAX_TOTAL_SUB_PER_RELAY, EVENTS_TIMEOUT, PER_RELAY_ONESHOT_LIMIT } from '../../config/constants.js';
import { getRelayFromPool } from './relay-connection.js';
import { debugRelay, relayStates } from './relay-state.js';

// subId -> リスナー集合
export const logicalListeners = new Map();

// relay ごと・種別ごとのアクティブ件数
export const relayActiveCounts = {
  live: new Map(),
  oneshot: new Map()
};

export const subscribeQueue = [];

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
    const key = (typeof r === 'string') ? r.trim().replace(/\/+$/, '') : r;
    const v = map.get(key) || 0;
    map.set(key, v + 1);
  }
}

export function decrementActiveCounts(relays, type) {
  const map = relayActiveCounts[type] || relayActiveCounts.oneshot;
  for (const r of relays) {
    const key = (typeof r === 'string') ? r.trim().replace(/\/+$/, '') : r;
    const v = map.get(key) || 0;
    const nv = Math.max(0, v - 1);
    map.set(key, nv);
  }
}

export function hasOpenSocketForRelays(pool, relays) {
  try {
    if (!pool || !Array.isArray(relays) || relays.length === 0) return false;
    const OPEN = (typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number') ? WebSocket.OPEN : 1;
    for (const url of relays) {
      try {
        const relay = getRelayFromPool(pool, url);
        const ws = relay && relay.ws;
        if (ws && typeof ws.readyState === 'number' && ws.readyState === OPEN) {
          return true;
        }
      } catch (e) { }
    }
  } catch (e) { }
  return false;
}

export function canStartForAll(relays, type, priority = false) {
  if (priority) {
    for (const r of relays) {
      const vLive = relayActiveCounts.live.get(r) || 0;
      const vOne = relayActiveCounts.oneshot.get(r) || 0;
      if ((vLive + vOne) >= MAX_TOTAL_SUB_PER_RELAY) return false;
    }
    return true;
  }

  const map = relayActiveCounts[type] || relayActiveCounts.oneshot;
  const limit = (type === 'live') ? MAX_LIVE_PER_RELAY : MAX_ONESHOT_PER_RELAY;
  const totalLimit = typeof MAX_TOTAL_SUB_PER_RELAY === 'number' ? MAX_TOTAL_SUB_PER_RELAY : 5;
  for (const r of relays) {
    const vLive = relayActiveCounts.live.get(r) || 0;
    const vOne = relayActiveCounts.oneshot.get(r) || 0;
    const current = map.get(r) || 0;
    if (current >= limit) return false;
    if ((vLive + vOne) >= totalLimit) return false;
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
    window.addEventListener('tab:changed', () => {
      try { reevaluateQueuePriorities(); } catch (e) { }
    });
  }
} catch (e) { }

export function processSubscribeQueue() {
  if (!subscribeQueue.length) return;
  for (let i = 0; i < subscribeQueue.length; i++) {
    const req = subscribeQueue[i];
    if (req.cancelled) {
      subscribeQueue.splice(i, 1);
      i--;
      continue;
    }
    const type = req.type || inferReqType(req.filters);
    const priority = !!req.priority;
    if (canStartForAll(req.targetRelays, type, priority)) {
      subscribeQueue.splice(i, 1);
      i--;
      try {
        incrementActiveCounts(req.targetRelays, type);
        try {
          req.targetRelays = Array.from(new Set((req.targetRelays || []).map(normalizeUrl).filter(Boolean)));
        } catch (e) { }
        const pool = req.pool || (typeof window !== 'undefined' && window.__nostrState && window.__nostrState.pool) || null;
        if (!pool) {
          decrementActiveCounts(req.targetRelays, type);
          req.reject(new Error('no pool available'));
          continue;
        }
        try {
          debugRelay('[Relay] 購読処理を開始', { relays: req.targetRelays, type: type, filters: req.filters });
        } catch (e) { }
        const sub = pool.subscribeMany(req.targetRelays, req.filters, {
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
                    if (total >= perRelayLimit * relayCount) {
                      try { if (sub && typeof sub.close === 'function') sub.close(); } catch (e) { }
                    }
                    if (eoseSeen.size >= relayCount) {
                      try { if (sub && typeof sub.close === 'function') sub.close(); } catch (e) { }
                    }
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
          }
        });
        const origClose = sub.close.bind(sub);
        try {
          sub.__targetRelays = req.targetRelays ? (Array.isArray(req.targetRelays) ? req.targetRelays.slice() : [req.targetRelays]) : [];
          sub.__pool = pool;
        } catch (e) { }
        let oneshotTimer = null;
        if (type === 'oneshot') {
          try {
            oneshotTimer = setTimeout(() => {
              try { if (sub && typeof sub.close === 'function') sub.close(); } catch (e) { }
            }, EVENTS_TIMEOUT);
          } catch (e) { }
        }

        sub.close = async function () {
          try {
            let shouldClose = true;
            try {
              shouldClose = hasOpenSocketForRelays(pool, req.targetRelays);
            } catch (e) { }
            if (shouldClose) {
              try { await origClose(); } catch (e) { }
            } else {
              try { debugRelay('[Relay] OPEN socket なしのため sub.close の送信をスキップ'); } catch (e) { }
            }
          } finally {
            try { if (oneshotTimer) { clearTimeout(oneshotTimer); oneshotTimer = null; } } catch (e) { }
            try { decrementActiveCounts(req.targetRelays, type); } catch (e) { }
            try { processSubscribeQueue(); } catch (e) { }
          }
        };
        if (req.cancelled) {
          try { sub.close(); } catch (e) { }
          req.reject(new Error('cancelled'));
          continue;
        }
        req.resolve(sub);
      } catch (e) {
        try { decrementActiveCounts(req.targetRelays, type); } catch (er) { }
        req.reject(e);
      }
    }
  }
}

export function inferReqType(filters) {
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
        if (existingSub) {
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
    const dispatcher = function (ev, relay, done) {
      try {
        for (const fn of Array.from(listeners)) {
          try { fn(ev, relay, done); } catch (inner) { console.warn('[Relay] リスナー処理でエラー', inner); }
        }
      } catch (e) { }
    };

    debugRelay('[Relay] 購読開始:', targetRelays.length, 'relays, key=', key);
    queuedReq = { targetRelays: targetRelays, filters: filters, dispatcher: dispatcher, pool: state.pool, cancelled: false, key: key };
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

    let subStarted = null;
    startPromise.then(s => {
      subStarted = s;
      try { queuedReq.sub = s; } catch (e) { }
      try { state.subs.set(subId, s); } catch (e) { }
    }).catch(e => {
    });

  } catch (e) {
    console.warn('[Relay] 購読失敗', e);
    return function () { };
  }
  return function () {
    try {
      if (typeof queuedReq === 'undefined') {
        return;
      }
      if (queuedReq && queuedReq.sub) {
        try { queuedReq.sub.close(); } catch (e) { console.warn('[Relay] 購読解除失敗:', e); }
        try { state.subs.delete(subId); } catch (e) { }
      } else if (queuedReq) {
        try {
          queuedReq.cancelled = true;
          const idx = subscribeQueue.indexOf(queuedReq);
          if (idx !== -1) subscribeQueue.splice(idx, 1);
        } catch (e) { }
      }
    } catch (e) { console.warn('[Relay] 購読解除失敗:', e); }
  };
}

try {
  if (typeof window !== 'undefined') {
    window.__relayDebug = function () {
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
          subsKeys: Array.from((window.__nostrState && window.__nostrState.subs) ? window.__nostrState.subs.keys() : [])
        };
      } catch (e) { return { error: e && e.message }; }
    };
  }
} catch (e) { }

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

