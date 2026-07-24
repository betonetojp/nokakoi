import { subOnce, getReadRelays } from '../../core/relay.js';
import { EVENTS_MAX } from '../../config/constants.js';

function matchesFilter(ev, filter) {
  if (!ev || !filter) return false;
  if (filter.kinds && Array.isArray(filter.kinds) && filter.kinds.length > 0) {
    if (!filter.kinds.includes(ev.kind)) return false;
  }
  if (filter.authors && Array.isArray(filter.authors) && filter.authors.length > 0) {
    if (!filter.authors.includes(ev.pubkey)) return false;
  }
  if (filter['#p'] && Array.isArray(filter['#p']) && filter['#p'].length > 0) {
    const pTags = Array.isArray(ev.tags) ? ev.tags.filter(t => Array.isArray(t) && t[0] === 'p').map(t => t[1]) : [];
    if (!pTags.some(p => filter['#p'].includes(p))) return false;
  }
  if (filter['#d'] && Array.isArray(filter['#d']) && filter['#d'].length > 0) {
    const dTags = Array.isArray(ev.tags) ? ev.tags.filter(t => Array.isArray(t) && t[0] === 'd').map(t => t[1]) : [];
    if (!dTags.some(d => filter['#d'].includes(d))) return false;
  }
  if (filter['#e'] && Array.isArray(filter['#e']) && filter['#e'].length > 0) {
    const eTags = Array.isArray(ev.tags) ? ev.tags.filter(t => Array.isArray(t) && t[0] === 'e').map(t => t[1]) : [];
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
    if (!Array.isArray(feed.perFilterUntil) || feed.perFilterUntil.length !== filters.length) {
      feed.perFilterUntil = new Array(filters.length).fill(null);
    }
    const events = Array.isArray(eventsList) ? eventsList : (eventsList && typeof eventsList.values === 'function' ? Array.from(eventsList.values()) : []);
    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      let minTs = feed.perFilterUntil[i];
      for (const ev of events) {
        if (!ev || typeof ev.created_at !== 'number') continue;
        if (matchesFilter(ev, filter)) {
          if (minTs == null || ev.created_at < minTs) {
            minTs = ev.created_at;
          }
        }
      }
      if (minTs != null) {
        if (feed.perFilterUntil[i] == null || minTs < feed.perFilterUntil[i]) {
          feed.perFilterUntil[i] = minTs;
        }
      }
    }
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
    addToFeed,
    scheduleRender,
    eventsFetchLimit = 60,
    eventsTimeout = 3000,
    histKeepLimit = eventsFetchLimit,
    histBufferMode = true,
    onHistFinalize = null,
    onHistBufferStart = null,
    onHistBufferEnd = null,
    acceptHistEvent = null,
    stampReceivedAt = false
  } = opts || {};

  // live 受信のみ: 投稿者時計と閲覧者時計のずれ把握用（履歴・追加取得では付けない）
  const stampReceivedAtOnLiveEvent = (ev) => {
    try {
      if (ev && typeof ev === 'object' && !ev.__receivedAt) ev.__receivedAt = Date.now();
    } catch (e) { }
  };

  const usedRelays = Array.isArray(relays) && relays.length ? relays.slice() : getReadRelays(state.relays);
  const perRelayUnsubs = new Set();
  const histBuffer = new Map();
  // この fetcher の購読を宣言的に停止できるよう AbortController を使用
  const controller = new AbortController();
  const onAbort = () => {
    try {
      // 購読をクリーンアップ
      for (const u of Array.from(perRelayUnsubs)) {
        try { if (typeof u === 'function') u(); } catch (e) { }
      }
      perRelayUnsubs.clear();
      // live 購読を停止
      try { if (typeof liveUnsub === 'function') liveUnsub(); } catch (e) { }
    } catch (e) { }
  };
  try { controller.signal.addEventListener('abort', onAbort); } catch (e) { }

  let histFinished = false;
  let liveUnsub = null;

  const absorbHistEvent = (ev, relay) => {
    if (!ev) return;
    if (ev.kind === 30315) {
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
      let totalSubs = 0;
      let finishedSubs = 0;
      const expected = relayList.length;
      if (expected === 0) {
        finalize();
        return;
      }
      relayList.forEach(relay => {
        try {
          const key = feedId + '_hist_' + relay + '_' + Math.random().toString(36).slice(2, 8);
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
          totalSubs += 1;
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
        }, usedRelays.length ? usedRelays : null);
      } catch (e) {
        try {
          liveUnsub = subOnce(state, feedId + '_live', liveFilters, (ev, relay) => {
            stampReceivedAtOnLiveEvent(ev);
            try { if (ev) addToFeed(feedId, ev, null, relay); } catch (ee) { }
          }); } catch (ee) { }
      }
    }
  } catch (e) { }

  return {
    stopHist: () => { try { controller.abort(); } catch (e) { } },
    stopLive: () => { try { if (typeof liveUnsub === 'function') liveUnsub(); } catch (e) { } },
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
    addToFeed,
    scheduleRender,
    eventsFetchLimit = 60,
    eventsTimeout = 10000,
    onCollect = null
  } = opts || {};

  // 呼び出し側が中断できるよう AbortController を作成し、返却 Promise に紐づける
  const controller = new AbortController();
  let abortListener = null;

  // Promise を作成し、controller を関連付けて返す
  const p = new Promise((resolve) => {
    const moreBuffer = new Map();
    const perRelayBuffers = new Map();
    const perRelayEose = new Map();
    const relayList = Array.isArray(relays) && relays.length ? relays.slice() : getReadRelays(state.relays) || [];
    const perRelayUnsubs = new Set();
    const perRelayTimeout = Math.max(eventsTimeout || 10000, 3000);
    const collectEvent = (ev) => {
      try { if (ev && ev.id) moreBuffer.set(ev.id, ev); } catch (e) { }
      try { if (typeof onCollect === 'function' && ev) onCollect(ev); } catch (e) { }
    };
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
    let settled = false;
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
        appended = Math.max(0, (keepCount - startListLength));
        total = keep.length;
      } catch (e) { }
      try { updatePerFilterUntil(state, feedId, filters, state.feeds[feedId]?.list || []); } catch (e) { }
      try { cleanupAll(); } catch (e) { }
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

    // リレーごと・フィルタごとに購読
    if (!relayList.length) {
      let unsubAll = null;
      const doneRelays = new Set();
      const relayCount = Array.isArray(relayList) ? relayList.length : 0;
      try {
        unsubAll = subOnce(state, feedId + '_more_multi_' + Math.random().toString(36).slice(2, 8), filters, (ev, relay, done) => {
          collectEvent(ev);
          try {
            const r = relay || 'multi';
            const pb = perRelayBuffers.get(r) || new Map();
            if (ev && ev.id) pb.set(ev.id, ev);
            perRelayBuffers.set(r, pb);
            // 自分の kind7 をこのリレーが返した場合のログ用フック
            if (ev && ev.kind === 7 && ev.pubkey && ev.pubkey === (localStorage.getItem('pubkey') || '')) {
              // 何もしない
            }
          } catch (e) { }
          try {
            if (done && relay) {
              try { perRelayEose.set(relay, true); } catch (e) { }
              doneRelays.add(relay);
              if (relayCount === 0 || doneRelays.size >= relayCount) {
                finalizeMore();
              }
            }
          } catch (e) { }
        }, getReadRelays(state.relays));
      } catch (e) { }
      const to = setTimeout(() => { try { finalizeMore(); } catch (e) { } finally { try { if (typeof unsubAll === 'function') unsubAll(); } catch (ee) { } cleanupAll(); } }, perRelayTimeout);
      // unsubscribe 関数とタイムアウト解除処理を登録
      if (typeof unsubAll === 'function') perRelayUnsubs.add(() => { try { unsubAll(); } catch (e) { } });
      perRelayUnsubs.add(() => { try { clearTimeout(to); } catch (e) { } });
      return;
    }

    let totalSubs = 0;
    let finishedSubs = 0;
    const expected = relayList.length;
    if (expected === 0) {
      finalizeMore();
      return;
    }
    relayList.forEach(relay => {
      try {
        const key = feedId + '_more_' + relay + '_' + Math.random().toString(36).slice(2, 8);
        const unsub = subOnce(state, key, filters, (ev, r, done) => {
          collectEvent(ev);
          try {
            const rr = relay || r || 'unknown';
            const pb = perRelayBuffers.get(rr) || new Map();
            if (ev && ev.id) pb.set(ev.id, ev);
            perRelayBuffers.set(rr, pb);
            // リレーが自分の kind7 を返した場合のログ用フック
            if (ev && ev.kind === 7 && ev.pubkey && ev.pubkey === (localStorage.getItem('pubkey') || '')) {
              // 何もしない
            }
          } catch (e) { }
          try {
            if (done) {
              try { finishedSubs += 1; } catch (e) { }
              try { perRelayEose.set(relay, true); } catch (e) { }
              if (finishedSubs >= expected) {
                finalizeMore();
              }
            }
          } catch (e) { }
        }, [relay]);
        perRelayUnsubs.add(unsub);
        totalSubs += 1;
      } catch (e) { }
    });
    // セーフティタイムアウト
    const to = setTimeout(() => { try { finalizeMore(); } catch (e) { } finally { cleanupAll(); } }, perRelayTimeout);
    // cleanup 時にタイムアウト解除できるよう登録
    perRelayUnsubs.add(() => { try { clearTimeout(to); } catch (e) { } });
  });
  // 呼び出し側が abort できるよう controller を返却 Promise に付与
  try { p.controller = controller; } catch (e) { }
  return p;
}
