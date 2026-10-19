import { subOnce, getReadRelays } from '../../core/relay.js';
import { EVENTS_MAX } from '../../config/constants.js';

const moreInFlightByState = new WeakMap();

function getMoreInFlightMap(state) {
  if (!state || (typeof state !== 'object' && typeof state !== 'function')) return null;
  let map = moreInFlightByState.get(state);
  if (!map) {
    map = new Map();
    moreInFlightByState.set(state, map);
  }
  return map;
}

function matchesFilter(ev, filter) {
  if (!ev || !filter) return false;
  if (filter.kinds && Array.isArray(filter.kinds) && filter.kinds.length > 0) {
    if (!filter.kinds.includes(ev.kind)) return false;
  }
  if (filter.authors && Array.isArray(filter.authors) && filter.authors.length > 0) {
    if (!filter.authors.includes(ev.pubkey)) return false;
  }
  if (filter['#p'] && Array.isArray(filter['#p']) && filter['#p'].length > 0) {
    const pTags = Array.isArray(ev.tags) ? ev.tags.filter(t => Array.isArray(t) && (t[0] === 'p' || t[0] === 'P')).map(t => t[1]) : [];
    if (!pTags.some(p => filter['#p'].includes(p))) return false;
  }
  if (filter['#d'] && Array.isArray(filter['#d']) && filter['#d'].length > 0) {
    const dTags = Array.isArray(ev.tags) ? ev.tags.filter(t => Array.isArray(t) && (t[0] === 'd' || t[0] === 'D')).map(t => t[1]) : [];
    if (!dTags.some(d => filter['#d'].includes(d))) return false;
  }
  if (filter['#e'] && Array.isArray(filter['#e']) && filter['#e'].length > 0) {
    const eTags = Array.isArray(ev.tags) ? ev.tags.filter(t => Array.isArray(t) && (t[0] === 'e' || t[0] === 'E')).map(t => t[1]) : [];
    if (!eTags.some(e => filter['#e'].includes(e))) return false;
  }
  if (filter.until != null && typeof ev.created_at === 'number' && ev.created_at > filter.until) return false;
  if (filter.since != null && typeof ev.created_at === 'number' && ev.created_at < filter.since) return false;
  return true;
}

export function updatePerFilterUntil(state, feedId, filters, eventsList) {
  try {
    if (!state || !state.feeds || !state.feeds[feedId] || !Array.isArray(filters) || !filters.length) return;
    const feed = state.feeds[feedId];
    const perFilter = new Array(filters.length).fill(null);
    const events = Array.isArray(eventsList) ? eventsList : (eventsList && typeof eventsList.values === 'function' ? Array.from(eventsList.values()) : []);
    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      let minTs = null;
      for (const ev of events) {
        if (!ev || typeof ev.created_at !== 'number') continue;
        if (matchesFilter(ev, filter)) {
          if (minTs == null || ev.created_at < minTs) {
            minTs = ev.created_at;
          }
        }
      }
      perFilter[i] = minTs;
    }
    feed.perFilterUntil = perFilter;
  } catch (e) { }
}

export function applyPerFilterUntil(state, feedId, baseFilters, fallbackUntil = null) {
  try {
    if (!Array.isArray(baseFilters) || !baseFilters.length) return [];
    const feed = state && state.feeds && state.feeds[feedId];
    const perFilterUntil = feed && Array.isArray(feed.perFilterUntil) ? feed.perFilterUntil : [];
    return baseFilters.map((filter, i) => {
      const filterUntil = (perFilterUntil[i] != null) ? (perFilterUntil[i] - 1) : (fallbackUntil != null ? fallbackUntil - 1 : null);
      const updated = Object.assign({}, filter);
      if (filterUntil != null) {
        updated.until = filterUntil;
      }
      return updated;
    });
  } catch (e) {
    return Array.isArray(baseFilters) ? baseFilters.slice() : [];
  }
}

function mergeHistBufferIntoFeed(state, feedId, histBuffer, histKeepLimit) {
  const feed = state.feeds[feedId];
  if (!feed) return;
  if (!feed.map) feed.map = new Map();
  if (!Array.isArray(feed.list)) feed.list = [];

  let existingIds = new Set();
  try {
    for (const k of feed.map.keys()) existingIds.add(k);
  } catch (e) {
    for (const e of feed.list) if (e?.id) existingIds.add(e.id);
  }

  const merged = feed.list.slice();
  for (const ev of histBuffer.values()) {
    if (!ev?.id || existingIds.has(ev.id)) continue;
    merged.push(ev);
    existingIds.add(ev.id);
  }
  merged.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  let keep = merged;
  if (histKeepLimit != null) {
    keep = merged.slice(0, histKeepLimit);
  }
  feed.list = keep.slice();
  const m = new Map();
  for (const ev of keep) {
    try {
      if (ev?.id) {
        m.set(ev.id, ev);
        if (ev.created_at && ev.created_at > (feed.lastSeen || 0)) {
          feed.lastSeen = ev.created_at;
        }
      }
    } catch (e) { }
  }
  feed.map = m;
}

// 最小構成のフィード取得器: 履歴（oneshot）と live 購読を開始する。
// 呼び出し側は addToFeed(feedId, ev) と scheduleRender(feedId) を提供すること。
// 戻り値: { stopHist(), stopLive() }
export function setupFeedFetcher(opts) {
  const {
    state,
    feedId,
    histFilters = [],
    liveFilters = null,
    relays = null,
    liveRelays = null,
    addToFeed,
    scheduleRender,
    eventsFetchLimit = 60,
    eventsTimeout = 3000,
    histKeepLimit = eventsFetchLimit,
    histBufferMode = true,
    onHistFinalize = null,
    onHistBufferStart = null,
    onHistBufferEnd = null,
    acceptHistEvent = null
  } = opts || {};

  // live 受信のみ: 投稿者時計と閲覧者時計のずれ把握用（履歴・追加取得では付けない）
  const stampReceivedAtOnLiveEvent = (ev) => {
    try {
      if (ev && typeof ev === 'object' && !ev.__receivedAt) ev.__receivedAt = Date.now();
    } catch (e) { }
  };

  const usedRelays = Array.isArray(relays) && relays.length ? relays.slice() : getReadRelays(state.relays);
  const usedLiveRelays = Array.isArray(liveRelays) ? liveRelays.slice() : usedRelays;
  const perRelayUnsubs = new Set();
  const histBuffer = new Map();
  // hist 購読のみを宣言的に停止できるよう AbortController を使用（live は維持）
  const controller = new AbortController();
  const onAbort = () => {
    try {
      for (const u of Array.from(perRelayUnsubs)) {
        try { if (typeof u === 'function') u(); } catch (e) { }
      }
      perRelayUnsubs.clear();
    } catch (e) { }
  };
  try { controller.signal.addEventListener('abort', onAbort); } catch (e) { }

  let histFinished = false;
  let liveUnsub = null;

  const absorbHistEvent = (ev, relay) => {
    if (!ev) return;
    if (ev.kind === 30315 || ev.kind === 9735) {
      try { if (typeof addToFeed === 'function') addToFeed(feedId, ev, null, relay); } catch (e) { }
      return;
    }
    if (!histBufferMode) {
      try { if (typeof addToFeed === 'function') addToFeed(feedId, ev, null, relay); } catch (e) { }
      return;
    }
    if (typeof acceptHistEvent === 'function' && !acceptHistEvent(ev, relay)) return;
    if (ev.id) histBuffer.set(ev.id, ev);
  };

  try { if (histBufferMode && typeof onHistBufferStart === 'function') onHistBufferStart(feedId); } catch (e) { }

  const finalize = () => {
    if (histFinished) return;
    histFinished = true;
    try {
      if (histBufferMode && histBuffer.size > 0) {
        mergeHistBufferIntoFeed(state, feedId, histBuffer, histKeepLimit);
        histBuffer.clear();
      } else if (histKeepLimit != null) {
        const list = state.feeds[feedId] && state.feeds[feedId].list ? state.feeds[feedId].list.slice() : [];
        list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const keep = list.slice(0, histKeepLimit);
        const keepIds = new Set(keep.map(e => e && e.id));
        state.feeds[feedId].list = keep;
        try {
          for (const id of Array.from(state.feeds[feedId].map.keys())) {
            if (!keepIds.has(id)) state.feeds[feedId].map.delete(id);
          }
        } catch (e) { }
      }
    } catch (e) { }
    try { updatePerFilterUntil(state, feedId, histFilters, state.feeds[feedId]?.list || []); } catch (e) { }
    try { if (typeof onHistBufferEnd === 'function') onHistBufferEnd(feedId, histFilters && histFilters.length > 0); } catch (e) { }
    try { if (typeof scheduleRender === 'function') scheduleRender(feedId); } catch (e) { }
    try { if (typeof onHistFinalize === 'function') onHistFinalize(); } catch (e) { }
    try {
      // unsubscribe 関数を安全に実行してクリア
      for (const u of Array.from(perRelayUnsubs)) {
        try { if (typeof u === 'function' && !u.__invoked) { u.__invoked = true; u(); } } catch (e) { }
      }
      perRelayUnsubs.clear();
    } catch (e) { }
  };

  // 履歴取得開始
  try {
    if (!histFilters || histFilters.length === 0) {
      finalize();
    } else {
      const relayList = Array.isArray(usedRelays) ? usedRelays.slice() : [];
    const histTimeout = Math.max(eventsTimeout || 3000, 3000);

    if (!relayList.length) {
      // フォールバック: 複数リレー oneshot
      let unsubAll = null;
      const doneRelays = new Set();
      const relayCount = Array.isArray(getReadRelays(state.relays)) ? getReadRelays(state.relays).length : 0;
      try {
        unsubAll = subOnce(state, feedId + '_hist', histFilters, (ev, relay, done) => {
          try { absorbHistEvent(ev, relay); } catch (e) { }
          try {
            if (ev && ev.kind === 7 && ev.pubkey && ev.pubkey === (localStorage.getItem('pubkey') || '')) {
              // 何もしない
            }
          } catch (e) { }
          try {
            if (done && relay) {
              doneRelays.add(relay);
              if (relayCount === 0 || doneRelays.size >= relayCount) finalize();
            }
          } catch (e) { }
        }, getReadRelays(state.relays));
      } catch (e) { }
      const to = setTimeout(() => { try { finalize(); if (typeof unsubAll === 'function') unsubAll(); } catch (e) { } }, histTimeout);
      const orig = unsubAll;
      unsubAll = function () { try { if (orig) orig(); } catch (e) { } try { clearTimeout(to); } catch (e) { } };
      perRelayUnsubs.add(unsubAll);
    } else {
      // リレーごとに個別購読（フィルタは統合）
      let finishedSubs = 0;
      const expected = relayList.length;
      if (expected === 0) {
        finalize();
        return;
      }
      relayList.forEach(relay => {
        try {
          const key = feedId + '_hist_' + relay;
          const unsub = subOnce(state, key, histFilters, (ev, r, done) => {
            try { absorbHistEvent(ev, r); } catch (e) { }
            try {
              if (ev && ev.kind === 7 && ev.pubkey && ev.pubkey === (localStorage.getItem('pubkey') || '')) {
                // 何もしない
              }
            } catch (e) { }
            try { if (done) { finishedSubs += 1; } } catch (e) { }
            try {
              if (done) {
                if (finishedSubs >= expected) {
                  finalize();
                }
              }
            } catch (e) { }
          }, [relay]);
          perRelayUnsubs.add(unsub);
        } catch (e) { }
      });
      // セーフティタイムアウト
      const to = setTimeout(() => { try { finalize(); } catch (e) { } }, histTimeout);
      perRelayUnsubs.add(() => { try { clearTimeout(to); } catch (e) { } });
    }
    }
  } catch (e) {
    try {
      subOnce(state, feedId + '_hist', histFilters, (ev, relay, done) => {
        absorbHistEvent(ev, relay);
        if (ev && ev.kind === 7 && ev.pubkey && ev.pubkey === (localStorage.getItem('pubkey') || '')) {
          // 何もしない
        }
        if (done) finalize();
      }, usedRelays);
    } catch (ee) { }
    setTimeout(finalize, 3000);
  }

  // live 購読開始
  try {
    if (liveFilters && Array.isArray(liveFilters) && liveFilters.length) {
      try {
        liveUnsub = subOnce(state, feedId + '_live', liveFilters, (ev, relay) => {
          stampReceivedAtOnLiveEvent(ev);
          try { if (ev) addToFeed(feedId, ev, null, relay); } catch (e) { }
        }, usedLiveRelays.length ? usedLiveRelays : null);
      } catch (e) {
        try {
          liveUnsub = subOnce(state, feedId + '_live', liveFilters, (ev, relay) => {
            stampReceivedAtOnLiveEvent(ev);
            try { if (ev) addToFeed(feedId, ev, null, relay); } catch (ee) { }
          }, usedLiveRelays.length ? usedLiveRelays : null); } catch (ee) { }
      }
    }
  } catch (e) { }

  return {
    stopHist: () => { try { controller.abort(); } catch (e) { } },
    stopLive: () => {
      try {
        if (typeof liveUnsub === 'function') {
          const fn = liveUnsub;
          liveUnsub = null;
          fn();
        }
      } catch (e) { }
    },
    controller
  };
}

// フィードの追加履歴取得: eventsFetchLimit 件まで古いイベントを収集
export function fetchMore(opts) {
  const {
    state,
    feedId,
    filters = [],
    relays = null,
    startListLength = 0,
    eventsFetchLimit = 60,
    eventsTimeout = 10000,
    onCollect = null,
    acceptEvent = null
  } = opts || {};

  const inFlightMap = getMoreInFlightMap(state);
  const existing = inFlightMap && inFlightMap.get(feedId);
  if (existing) return existing;

  // 呼び出し側が中断できるよう AbortController を作成し、返却 Promise に紐づける
  const controller = new AbortController();
  let abortListener = null;

  // Promise を作成し、controller を関連付けて返す
  const p = new Promise((resolve) => {
    const moreBuffer = new Map();
    const relayList = Array.isArray(relays) && relays.length ? relays.slice() : getReadRelays(state.relays) || [];
    const perRelayUnsubs = new Set();
    const perRelayTimeout = Math.max(eventsTimeout || 10000, 3000);
    let settled = false;
    let globalMinScannedTs = null;

    // 再入を避けつつ収集済み unsubscribe を安全に実行
    const cleanupAll = () => {
      try {
        const arr = Array.from(perRelayUnsubs);
        perRelayUnsubs.clear();
        for (const u of arr) {
          try { if (typeof u === 'function') u(); } catch (e) { }
        }
      } catch (e) { }
    };

    const finalizeMore = () => {
      if (settled) return;
      settled = true;
      let appended = 0;
      let total = 0;
      try {
        // 既知ID判定は map を優先使用。live 更新と競合した重複追加を回避する。
        const existing = Array.isArray(state.feeds[feedId] && state.feeds[feedId].list) ? state.feeds[feedId].list.slice() : [];
        let existingIds = new Set();
        try {
          const fm = state.feeds[feedId] && state.feeds[feedId].map;
          if (fm && typeof fm.keys === 'function') {
            // Map キーを走査
            for (const k of fm.keys()) existingIds.add(k);
          } else {
            // フォールバック: 現在リストを走査
            for (const e of existing) if (e && e.id) existingIds.add(e.id);
          }
        } catch (e) {
          for (const e of existing) if (e && e.id) existingIds.add(e.id);
        }
        for (const ev of Array.from(moreBuffer.values())) {
          try {
            if (ev && ev.id && !existingIds.has(ev.id)) {
              if (typeof acceptEvent === 'function' && !acceptEvent(ev)) continue;
              existing.push(ev);
              existingIds.add(ev.id);
            }
          } catch (e) { }
        }
        existing.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        const keepCount = Math.min(startListLength + eventsFetchLimit, (typeof EVENTS_MAX === 'number' ? EVENTS_MAX : Math.max(eventsFetchLimit, existing.length)));
        const keep = existing.slice(0, keepCount);
        try {
          state.feeds[feedId].list = keep.slice();
          const m = new Map();
          for (const ev of keep) { try { if (ev && ev.id) m.set(ev.id, ev); } catch (e) { } }
          state.feeds[feedId].map = m;
        } catch (e) { }
        appended = Math.max(0, keep.length - startListLength);
        total = keep.length;
      } catch (e) { }
      try { updatePerFilterUntil(state, feedId, filters, state.feeds[feedId]?.list || []); } catch (e) { }
      cleanupAll();
      // abort リスナーを解除
      try { if (abortListener && controller && controller.signal) controller.signal.removeEventListener('abort', abortListener); } catch (e) { }
      resolve({ appendedCount: appended, totalCount: total });
    };

    // 中断時はクリーンアップ後に Promise を resolve
    abortListener = () => {
      try {
        if (!settled) {
          settled = true;
          cleanupAll();
          try { if (abortListener && controller && controller.signal) controller.signal.removeEventListener('abort', abortListener); } catch (e) { }
          resolve({ appendedCount: 0, totalCount: startListLength });
        }
      } catch (e) { }
    };
    try { controller.signal.addEventListener('abort', abortListener); } catch (e) { }

    let currentFilters = filters;
    let round = 0;
    const maxRounds = (typeof acceptEvent === 'function') ? 5 : 1;

    const runRound = () => {
      if (settled || controller.signal.aborted) {
        finalizeMore();
        return;
      }
      round += 1;
      let roundRawCount = 0;
      let roundMinScannedTs = null;
      let finishedSubs = 0;
      let roundTimer = null;

      const checkRoundDone = () => {
        if (settled) return;
        if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
        cleanupAll();

        if (roundMinScannedTs != null) {
          globalMinScannedTs = (globalMinScannedTs == null)
            ? roundMinScannedTs
            : Math.min(globalMinScannedTs, roundMinScannedTs);
        }

        // フィルタ通過イベントが1件以上あるか、リレーからの返却が0件（枯渇）、または最大走査ラウンドに達した場合は完了
        if (moreBuffer.size > 0 || roundRawCount === 0 || round >= maxRounds || controller.signal.aborted || roundMinScannedTs == null) {
          finalizeMore();
        } else {
          // 次のラウンド: until を roundMinScannedTs - 1 に更新してさらに過去を探索
          currentFilters = currentFilters.map(f => {
            const upd = Object.assign({}, f);
            upd.until = roundMinScannedTs - 1;
            return upd;
          });
          runRound();
        }
      };

      if (!relayList.length) {
        let unsubAll = null;
        const doneRelays = new Set();
        const relayCount = 0;
        try {
          const key = (round === 1) ? (feedId + '_more_multi') : (feedId + '_more_multi_' + round);
          unsubAll = subOnce(state, key, currentFilters, (ev, relay, done) => {
            if (ev && ev.id) {
              roundRawCount += 1;
              if (typeof ev.created_at === 'number') {
                roundMinScannedTs = (roundMinScannedTs == null) ? ev.created_at : Math.min(roundMinScannedTs, ev.created_at);
              }
              if (typeof acceptEvent !== 'function' || acceptEvent(ev)) {
                try { moreBuffer.set(ev.id, ev); } catch (e) { }
                try { if (typeof onCollect === 'function') onCollect(ev); } catch (e) { }
              }
            }
            if (done && relay) {
              doneRelays.add(relay);
              if (relayCount === 0 || doneRelays.size >= relayCount) {
                checkRoundDone();
              }
            }
          }, getReadRelays(state.relays));
        } catch (e) { }
        roundTimer = setTimeout(() => {
          checkRoundDone();
        }, perRelayTimeout);
        if (typeof unsubAll === 'function') perRelayUnsubs.add(unsubAll);
        return;
      }

      const expected = relayList.length;
      relayList.forEach(relay => {
        try {
          const key = (round === 1) ? (feedId + '_more_' + relay) : (feedId + '_more_' + relay + '_' + round);
          const unsub = subOnce(state, key, currentFilters, (ev, r, done) => {
            if (ev && ev.id) {
              roundRawCount += 1;
              if (typeof ev.created_at === 'number') {
                roundMinScannedTs = (roundMinScannedTs == null) ? ev.created_at : Math.min(roundMinScannedTs, ev.created_at);
              }
              if (typeof acceptEvent !== 'function' || acceptEvent(ev)) {
                try { moreBuffer.set(ev.id, ev); } catch (e) { }
                try { if (typeof onCollect === 'function') onCollect(ev); } catch (e) { }
              }
            }
            if (done) {
              finishedSubs += 1;
              if (finishedSubs >= expected) {
                checkRoundDone();
              }
            }
          }, [relay]);
          if (typeof unsub === 'function') perRelayUnsubs.add(unsub);
        } catch (e) {
          finishedSubs += 1;
          if (finishedSubs >= expected) checkRoundDone();
        }
      });

      roundTimer = setTimeout(() => {
        checkRoundDone();
      }, perRelayTimeout);
    };

    runRound();
  });
  // 呼び出し側が abort できるよう controller を返却 Promise に付与
  try { p.controller = controller; } catch (e) { }
  if (inFlightMap) {
    inFlightMap.set(feedId, p);
    const release = () => {
      if (inFlightMap.get(feedId) === p) inFlightMap.delete(feedId);
      if (inFlightMap.size === 0) moreInFlightByState.delete(state);
    };
    p.then(release, release);
  }
  return p;
}
