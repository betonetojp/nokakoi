import { logWarn } from '../../utils/utils.js';
import { getNostrTools } from '../nostr-compat.js';
import { getAllRelayUrls, cleanupPoolDuplicates } from './relay-helpers.js';
import { stopMonitoringRelays, monitorRelayConnections, startKeepalive, setupVisibilityHandler, debugRelay } from './relay-state.js';
import { releaseSubscriptionsForPool } from './relay-subscription.js';
import { appendRelayConnectionLog } from '../app-context.js';

/**
 * リレー設定をオブジェクト形式に正規化
 */
export function normalizeRelay(relay) {
  let rawUrl;
  if (typeof relay === 'string') rawUrl = relay;
  else rawUrl = relay && (relay.url || relay);
  const url = (typeof rawUrl === 'string') ? rawUrl.trim().replace(/\/+$|\/+$/g, '').replace(/\/+$/, '') : rawUrl;
  return {
    url,
    read: (relay && typeof relay === 'object') ? (relay.read !== false) : true,
    write: (relay && typeof relay === 'object') ? (relay.write !== false) : true
  };
}

/**
 * リレーURLの妥当性チェック
 */
export function isValidRelayUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.startsWith('wss://') || trimmed.startsWith('ws://');
}

/**
 * SimplePool.relays から末尾スラッシュ差異を吸収してリレー項目を取得
 */
export function getRelayFromPool(pool, url) {
  try {
    if (!pool || !pool.relays) return null;
    const relays = pool.relays;
    if (typeof relays.get === 'function') {
      const direct = relays.get(url);
      if (direct) return direct;
      const withSlash = url.endsWith('/') ? url.slice(0, -1) : url + '/';
      const alt = relays.get(withSlash);
      if (alt) return alt;
    }
    const target = (typeof url === 'string') ? url.trim().replace(/\/+$/, '') : url;
    for (const [k, v] of relays.entries()) {
      try {
        const kn = (typeof k === 'string') ? k.trim().replace(/\/+$/, '') : k;
        if (kn === target) return v;
        if (normalizeRelay(kn).url === normalizeRelay(target).url) return v;
      } catch (e) { }
    }
  } catch (e) { }
  return null;
}

/**
 * プール内の WebSocket 接続数を数える
 */
export function countPoolSockets(pool) {
  try {
    if (!pool || !pool.relays) return { total: 0, open: 0 };
    let total = 0, open = 0;
    for (const [k, v] of pool.relays.entries()) {
      try {
        total++;
        const ws = v && v.ws;
        if (ws && typeof ws.readyState !== 'undefined' && ws.readyState === WebSocket.OPEN) open++;
      } catch (e) { }
    }
    return { total, open };
  } catch (e) { return { total: 0, open: 0 }; }
}

/**
 * CONNECTING/OPEN の socket のみ個別に close する
 */
export function closePoolSocketsSafely(pool) {
  try {
    if (!pool || !pool.relays || typeof pool.relays.values !== 'function') return 0;
    const CONNECTING = (typeof WebSocket !== 'undefined' && typeof WebSocket.CONNECTING === 'number') ? WebSocket.CONNECTING : 0;
    const OPEN = (typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number') ? WebSocket.OPEN : 1;
    let closed = 0;

    for (const relay of pool.relays.values()) {
      try {
        const ws = relay && relay.ws;
        if (!ws || typeof ws.readyState !== 'number') continue;
        if (ws.readyState !== CONNECTING && ws.readyState !== OPEN) continue;
        ws.close();
        closed++;
      } catch (e) { }
    }

    try {
      if (typeof pool.relays.clear === 'function') pool.relays.clear();
    } catch (e) { }
    return closed;
  } catch (e) {
    return 0;
  }
}

/**
 * SimplePool でリレー接続
 */
export function relayConnect(state, SimplePool, restartFeedsCallback = null) {
  if (!getNostrTools() || !SimplePool) return false;
  try {
    stopMonitoringRelays(state);
    if (state.pool) {
      const oldPool = state.pool;
      try {
        try {
          const counts = countPoolSockets(oldPool);
          appendRelayConnectionLog({ when: Date.now(), action: 'closing_old_pool', totalRelays: counts.total, openSockets: counts.open });
          debugRelay('[Relay] 既存 pool を閉じます, relays:', counts.total, 'open sockets:', counts.open);
        } catch (e) { }

        try { releaseSubscriptionsForPool(state, oldPool, 'relay pool replaced'); } catch (e) { }
        try { state.subs.clear(); } catch (e) { console.warn('[Relay] 購読参照クリア失敗:', e); }
        try {
          closePoolSocketsSafely(oldPool);
        } catch (e) { }
        state.pool = null;
      } catch (e) {
        console.warn('[Relay] 既存poolクリーンアップ失敗:', e);
      }
    }
  } catch (e) {
    console.warn('[Relay] 既存poolクリーンアップ失敗:', e);
  }
  try {
    state.pool = new SimplePool();
    try { state.pool.trackRelays = true; } catch (e) { }
    try {
      const countsNew = countPoolSockets(state.pool);
      appendRelayConnectionLog({ when: Date.now(), action: 'created_new_pool', totalRelays: countsNew.total, openSockets: countsNew.open });
      debugRelay('[Relay] 新しい pool を作成, relays:', countsNew.total, 'open sockets:', countsNew.open);
    } catch (e) { }
    try { cleanupPoolDuplicates(state.pool); } catch (e) { logWarn('[Relay] cleanupPoolDuplicates 失敗:', e); }
    if (restartFeedsCallback) {
      monitorRelayConnections(state, restartFeedsCallback);
    }
    startKeepalive(state);
    setupVisibilityHandler(state, restartFeedsCallback);
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('relay:poolReady'));
      }
    } catch (e) {
      console.warn('[Relay] relay:poolReady の dispatch に失敗', e);
    }
    return true;
  } catch (e) {
    console.error('[Relay] SimplePool生成失敗:', e);
    state.pool = null;
    return false;
  }
}

/**
 * 既存 pool を閉じ、socket が閉じるか timeout まで待機する。
 */
export async function closePoolAndWait(state, timeoutMs = 1000) {
  if (!state || !state.pool) return false;
  const oldPool = state.pool;
  try {
    try { stopMonitoringRelays(state); } catch (e) { }
    try { releaseSubscriptionsForPool(state, oldPool, 'relay pool closed'); } catch (e) { }
    try { state.subs.clear(); } catch (e) { }

    const fetcherKeys = [
      '_globalFetcher',
      '_homeFetcher',
      '_homeOmochatFetcher',
      '_mentionsFetcher',
      '_meFetcher',
      '_bitchatFetcher'
    ];
    for (const key of fetcherKeys) {
      try {
        const fetcher = state[key];
        if (fetcher) {
          try { if (fetcher.controller && typeof fetcher.controller.abort === 'function') fetcher.controller.abort(); } catch (e) { }
        }
      } catch (e) { }
      try { state[key] = null; } catch (e) { }
    }

    try {
      closePoolSocketsSafely(oldPool);
    } catch (e) { }

    const start = Date.now();
    while (true) {
      try {
        let anyOpen = false;
        if (oldPool && oldPool.relays) {
          for (const [k, entry] of oldPool.relays.entries()) {
            try {
              const ws = entry && entry.ws;
              if (ws && typeof ws.readyState !== 'undefined' && ws.readyState === WebSocket.OPEN) {
                anyOpen = true;
                break;
              }
            } catch (e) { }
          }
        }
        if (!anyOpen) break;
      } catch (e) { }
      if ((Date.now() - start) >= timeoutMs) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (e) {
  } finally {
    try { state.pool = null; } catch (e) { }
  }
  return true;
}
