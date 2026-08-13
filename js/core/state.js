// ============================================================================
// 状態管理
// ============================================================================

import { loadRelays } from './relay.js';
import { logWarn } from '../utils/utils.js';

/**
 * フィード状態の初期化
 */
export function makeFeedState() {
  return {
    map: new Map(),
    list: [],
    lastSeen: 0
  };
}

/**
 * アプリケーション状態の初期化
 */
export function createState() {
  return {
    pubkey: null,
    signer: 'auto', // 'auto' | 'nip07' | 'nsec' | 'nip46'
    relays: loadRelays(),
    pool: null,
    subs: new Map(),
    profiles: new Map(),
    // NIP-315 のユーザーステータスキャッシュ: pubkey -> { content, timestamp, loaded, loading }
    userStatuses: new Map(),
    // フォロー先 pubkey -> petname の対応表（kind:3 のコンタクトリスト由来）
    followPetnames: new Map(),
    // NIP-30 カスタム絵文字マップ: baseShortcode -> Array<{ url, address? }>
    customEmojis: new Map(),
    feeds: {
      global: makeFeedState(),
      home: makeFeedState(),
      mentions: makeFeedState(),
      me: makeFeedState()
    },
    // pool.get 等で取得したイベントのキャッシュ（フル再描画後の引用表示用）
    eventCache: new Map(),
    // NIP-46（Nostr Connect）状態
    nip46: {
      client: null,        // Nip46Client インスタンス
      remotePubkey: null,  // リモート署名者の pubkey
      connected: false
    }
  };
}

/**
 * フィードキャッシュからIDでイベント検索
 */
export function findEventById(state, eventId) {
  for (const feedName in state.feeds) {
    const feed = state.feeds[feedName];
    if (feed.map.has(eventId)) {
      return feed.map.get(eventId);
    }
  }
  try {
    if (state.eventCache && state.eventCache.has(eventId)) {
      return state.eventCache.get(eventId);
    }
  } catch (e) { logWarn('[State] findEventById 失敗:', e); }
  return null;
}

/**
 * イベントをキャッシュに保存（引用 fetch 結果の再利用）
 */
export function cacheEvent(state, ev) {
  if (!state || !ev?.id) return;
  try {
    if (!state.eventCache) state.eventCache = new Map();
    state.eventCache.set(ev.id, ev);
    // メモリリーク防止のためキャッシュ上限を1000件に制限
    if (state.eventCache.size > 1000) {
      const oldestKey = state.eventCache.keys().next().value;
      if (oldestKey !== undefined) {
        state.eventCache.delete(oldestKey);
      }
    }
  } catch (e) { logWarn('[State] cacheEvent 失敗:', e); }
}

/**
 * イベントを新しい順でフィードに挿入
 */
export function insertEventSorted(state, feedId, ev) {
  const feed = state.feeds[feedId];
  if (!feed) return;
  const id = ev.id;
  if (!id) return;
  if (feed.map.has(id)) return;
  feed.map.set(id, ev);
  if (ev.created_at && ev.created_at > feed.lastSeen) {
    feed.lastSeen = ev.created_at;
  }
  const ts = ev.created_at || 0;
  let lo = 0, hi = feed.list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((feed.list[mid].created_at || 0) > ts) lo = mid + 1;
    else hi = mid;
  }
  feed.list.splice(lo, 0, ev);
  // 最新1000件のみ保持
  if (feed.list.length > 1000) {
    const removed = feed.list.splice(1000);
    for (const e of removed) feed.map.delete(e.id);
  }
}

/**
 * フィード状態をクリア
 */
export function clearFeed(state, feedId) {
  const feed = state.feeds[feedId];
  if (feed) {
    feed.list = [];
    feed.map = new Map();
    feed.lastSeen = 0;
    delete feed.mergedPaginationUntil;
    delete feed.perFilterUntil;
  }
}

/**
 * 全アプリケーション状態（フィード・キャッシュ・通知状態・DOM表示）を完全にリセット
 */
export function clearFullState(state) {
  if (!state) return;

  // 1. 各フィードキャッシュのクリア
  if (state.feeds) {
    Object.keys(state.feeds).forEach(feedId => {
      clearFeed(state, feedId);
      const feed = state.feeds[feedId];
      if (feed) {
        if (feed.follows) feed.follows = [];
        if (feed.followSet) feed.followSet.clear();
      }
    });
  }

  // 2. 各種キャッシュのクリア
  if (state.profiles) state.profiles.clear();
  if (state.userStatuses) state.userStatuses.clear();
  if (state.followPetnames) state.followPetnames.clear();
  if (state.customEmojis) state.customEmojis.clear();
  if (state.eventCache) state.eventCache.clear();

  // 3. DOM上のフィード要素の初期化
  try {
    const feedIds = ['feed-home', 'feed-global', 'feed-mentions', 'feed-me', 'feed-bitchat', 'feed-channels'];
    feedIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    document.querySelectorAll('.feed-container').forEach(el => {
      el.innerHTML = '';
    });
  } catch (e) { }

  // 4. 通知バッジ・点滅の完全消去
  try {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.remove('blink', 'blink-active', 'has-new-dot');
    });
  } catch (e) { }
}

