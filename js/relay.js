// ============================================================================
// リレー管理
// ============================================================================

import { uniqueRelays, $, logWarn } from './utils.js';
import { RECONNECT_DELAY, MAX_RECONNECT_ATTEMPTS, DOWN_PERSIST_MS, MAX_LIVE_PER_RELAY, MAX_ONESHOT_PER_RELAY, MAX_TOTAL_SUB_PER_RELAY } from './constants.js';
import { getNostrTools } from './nostr-compat.js';

/**
 * デフォルトのリレーリスト（読込/書込フラグ付き）
 */
export const defaultRelays = [
  { url: 'wss://relay.damus.io', read: true, write: true },
  { url: 'wss://yabu.me', read: true, write: true }
];

export const profileIndexerRelay = 'wss://directory.yabu.me';

/**
 * リレー接続状態
 */
const relayStates = new Map();

function debugRelay(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.debug(...args);
    }
  } catch (e) { }
}

/**
 * リレー状態更新ヘルパー
 */
function updateRelayState(url, connected) {
  try {
    const prev = relayStates.get(url) || {};
    const state = Object.assign({ connected: false, reconnectAttempts: 0, reconnectTimer: null, lastSeenDown: null }, prev);
    state.connected = !!connected;
    if (state.connected) {
      // 接続時: 再試行回数とタイマーをリセット
      state.reconnectAttempts = 0;
      if (state.reconnectTimer) {
        try { clearTimeout(state.reconnectTimer); } catch (e) { }
        state.reconnectTimer = null;
      }
      state.lastSeenDown = null;
    } else {
      // 切断時: 未記録なら切断時刻を記録
      if (!state.lastSeenDown) state.lastSeenDown = Date.now();
    }
    relayStates.set(url, state);
  } catch (e) {
    console.warn('[Relay] updateRelayState に失敗:', url, e);
  }
}

/**
 * Schedule reconnection for a relay
 */
function scheduleReconnect(state, url, restartFeedsCallback) {
  try {
    const relayState = relayStates.get(url);
    if (!relayState) return;

    // Don't schedule if already scheduled
    if (relayState.reconnectTimer) return;

    // Check if we've exceeded max attempts
    if (relayState.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      debugRelay(`[Relay] Max reconnect attempts reached for ${url}`);
      return;
    }

    relayState.reconnectAttempts++;
    debugRelay(`[Relay] Scheduling reconnect for ${url} (attempt ${relayState.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    relayState.reconnectTimer = setTimeout(() => {
      try {
        relayState.reconnectTimer = null;
        debugRelay(`[Relay] Attempting to reconnect to ${url}`);

        // Trigger restart feeds which will reconnect to all relays
        if (restartFeedsCallback) {
          restartFeedsCallback(false);
        }
      } catch (e) {
        console.warn(`[Relay] Reconnect timer task failed for ${url}:`, e);
      }
    }, RECONNECT_DELAY);

    relayStates.set(url, relayState);
  } catch (e) {
    console.warn(`[Relay] scheduleReconnect failed for ${url}:`, e);
  }
}

/**
 * リレー設定をオブジェクト形式に正規化
 */
function normalizeRelay(relay) {
  // 文字列/オブジェクトどちらでも受け取り、URLを正規化して返す
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
function isValidRelayUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.startsWith('wss://') || trimmed.startsWith('ws://');
}

// SimplePool.relays から末尾スラッシュ差異を吸収してリレー項目を取得
function getRelayFromPool(pool, url) {
  try {
    if (!pool || !pool.relays) return null;
    const relays = pool.relays;
    // まずは直接参照
    if (typeof relays.get === 'function') {
      const direct = relays.get(url);
      if (direct) return direct;
      // 末尾スラッシュ有無を入れ替えて再試行
      const withSlash = url.endsWith('/') ? url.slice(0, -1) : url + '/';
      const alt = relays.get(withSlash);
      if (alt) return alt;
    }
    // フォールバック: 全走査して正規化URLを比較
    const target = (typeof url === 'string') ? url.trim().replace(/\/+$/, '') : url;
    for (const [k, v] of relays.entries()) {
      try {
        const kn = (typeof k === 'string') ? k.trim().replace(/\/+$/, '') : k;
        if (kn === target) return v;
        // normalizeRelay 後の URL も比較
        if (normalizeRelay(kn).url === normalizeRelay(target).url) return v;
      } catch (e) { /* ignore entry */ }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * リレー接続監視
 */
function monitorRelayConnections(state, restartFeedsCallback) {
  if (!state.pool) return;
  const allRelays = getAllRelayUrls(state.relays);
  // 全リレーの状態初期化
  allRelays.forEach(url => {
    if (!relayStates.has(url)) {
      updateRelayState(url, false);
    }
  });
  // 定期的に接続状態チェック
  const checkInterval = setInterval(() => {
    if (!state.pool) {
      clearInterval(checkInterval);
      return;
    }
    allRelays.forEach(url => {
      try {
        // pool 内のリレー取得（寛容検索）
        const relay = getRelayFromPool(state.pool, url);
        const now = Date.now();
        if (relay && relay.ws) {
          const isConnected = relay.ws.readyState === WebSocket.OPEN;
          const wasConnected = relayStates.get(url)?.connected || false;
          if (isConnected && !wasConnected) {
            debugRelay(`[Relay] 接続: ${url}`);
            updateRelayState(url, true);
          } else if (!isConnected && wasConnected) {
            debugRelay(`[Relay] 切断: ${url}`);
            updateRelayState(url, false);
            // スケジューリングは一定時間継続してから行う
            const rs = relayStates.get(url);
            if (rs.lastSeenDown && (now - rs.lastSeenDown) >= DOWN_PERSIST_MS) {
              scheduleReconnect(state, url, restartFeedsCallback);
              rs.lastSeenDown = null; // 一度スケジュールしたらリセット
              relayStates.set(url, rs);
            }
          }
        } else {
          // pool 未登録または ws なし → 切断扱い
          const wasConnected = relayStates.get(url)?.connected || false;
          if (wasConnected) {
            debugRelay(`[Relay] 接続喪失: ${url}`);
            updateRelayState(url, false);
            const rs = relayStates.get(url);
            if (rs.lastSeenDown && (now - rs.lastSeenDown) >= DOWN_PERSIST_MS) {
              scheduleReconnect(state, url, restartFeedsCallback);
              rs.lastSeenDown = null;
              relayStates.set(url, rs);
            }
          }
        }
      } catch (e) {
        console.warn(`[Relay] 接続確認エラー: ${url}`, e);
      }
    });
  }, 8000); // 8秒ごとにチェック
  // クリーンアップ用interval保持
  if (!state.relayMonitorInterval) {
    state.relayMonitorInterval = checkInterval;
  } else {
    clearInterval(state.relayMonitorInterval);
    state.relayMonitorInterval = checkInterval;
  }
}

/**
 * リレー接続監視停止
 */
export function stopMonitoringRelays(state) {
  if (state.relayMonitorInterval) {
    clearInterval(state.relayMonitorInterval);
    state.relayMonitorInterval = null;
  }
  // 全再接続タイマークリア
  relayStates.forEach((relayState, url) => {
    if (relayState.reconnectTimer) {
      clearTimeout(relayState.reconnectTimer);
      relayState.reconnectTimer = null;
    }
  });
  relayStates.clear();
}

/**
 * localStorageからリレーリストを読み込む
 */
export function loadRelays() {
  try {
    const raw = localStorage.getItem('relays');
    if (!raw) return defaultRelays;
    const list = JSON.parse(raw);
    if (Array.isArray(list) && list.length) {
      // オブジェクト形式に正規化＆無効URL除外
      const normalized = list
        .map(normalizeRelay)
        .filter(r => isValidRelayUrl(r.url));
      // URLで重複除去
      const map = new Map();
      for (const r of normalized) {
        if (!map.has(r.url)) map.set(r.url, r);
      }
      const unique = Array.from(map.values());
      // 有効リレーなければデフォルト返す
      if (unique.length === 0) {
        console.warn('[Relay] ストレージに有効なリレーなし、デフォルト使用');
        return defaultRelays;
      }
      return unique;
    }
  } catch (e) {
    console.warn('[Relay] リレー読み込み失敗:', e);
  }
  return defaultRelays;
}

/**
 * リレーリストをlocalStorageに保存
 */
export function saveRelays(list) {
  try {
    if (!Array.isArray(list)) {
      localStorage.setItem('relays', JSON.stringify(list));
      return;
    }
    // 保存前に正規化して重複除去
    const normalized = list.map(normalizeRelay).filter(r => isValidRelayUrl(r.url));
    const map = new Map();
    for (const r of normalized) {
      if (!map.has(r.url)) map.set(r.url, r);
    }
    const unique = Array.from(map.values());
    localStorage.setItem('relays', JSON.stringify(unique));
  } catch (e) {
    console.warn('[Relay] リレー保存失敗:', e);
  }
}

// プール内の WebSocket 接続数を数えるデバッグヘルパー
function countPoolSockets(pool) {
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

// CONNECTING/OPEN の socket のみ個別に close する
function closePoolSocketsSafely(pool) {
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

// デバッグ用にプール接続イベントのランタイムログを公開
try {
  if (typeof window !== 'undefined') {
    window.__relayConnectionLog = window.__relayConnectionLog || [];
  }
} catch (e) { }

/**
 * SimplePool でリレー接続
 */
export function relayConnect(state, SimplePool, restartFeedsCallback = null) {
  if (!getNostrTools() || !SimplePool) return false;
  try {
    // 事前に監視停止
    stopMonitoringRelays(state);
    // 既存poolがあればクローズ
    if (state.pool) {
      const oldPool = state.pool;
      try {
        // close 前の接続数を記録
        try {
          const counts = countPoolSockets(oldPool);
          try { window.__relayConnectionLog && window.__relayConnectionLog.push({ when: Date.now(), action: 'closing_old_pool', totalRelays: counts.total, openSockets: counts.open }); } catch (e) { }
          debugRelay('[Relay] 既存 pool を閉じます, relays:', counts.total, 'open sockets:', counts.open);
        } catch (e) { }

        // 旧 pool 破棄時は購読参照のみ破棄（実 socket クローズは closePoolSocketsSafely に一本化）
        try {
          state.subs.clear();
        } catch (e) {
          console.warn('[Relay] 購読参照クリア失敗:', e);
        }
        // pool をクローズ
        try {
          closePoolSocketsSafely(state.pool);
        } catch (e) { }
        // 旧 pool に紐づく待機中 subscribe リクエストを取り消す
        try {
          if (typeof subscribeQueue !== 'undefined' && Array.isArray(subscribeQueue) && subscribeQueue.length) {
            for (let i = subscribeQueue.length - 1; i >= 0; i--) {
              try {
                const req = subscribeQueue[i];
                if (req && req.pool === oldPool) {
                  try { req.cancelled = true; } catch (e) { }
                  try { subscribeQueue.splice(i, 1); } catch (e) { }
                }
              } catch (e) { }
            }
          }
        } catch (e) { }
        // pool 参照をクリア
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
    // 新規 pool 作成直後の接続数を記録（通常は0）
    try {
      const countsNew = countPoolSockets(state.pool);
      try { window.__relayConnectionLog && window.__relayConnectionLog.push({ when: Date.now(), action: 'created_new_pool', totalRelays: countsNew.total, openSockets: countsNew.open }); } catch (e) { }
      debugRelay('[Relay] 新しい pool を作成, relays:', countsNew.total, 'open sockets:', countsNew.open);
    } catch (e) { }
    // 末尾スラッシュ差異のみの重複キーを整理
    try { cleanupPoolDuplicates(state.pool); } catch (e) { logWarn('[Relay] cleanupPoolDuplicates 失敗:', e); }
    // 接続監視開始
    if (restartFeedsCallback) {
      monitorRelayConnections(state, restartFeedsCallback);
    }
    // pool 準備完了を通知
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

// subId -> リスナー集合（論理再利用用）
const logicalListeners = new Map();

// JSON.stringify の結果を安定化するためフィルタを正規化
function canonicalize(val) {
  // プリミティブ値
  if (val === null || typeof val === 'undefined') return null;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') return val;
  if (Array.isArray(val)) {
    // 各要素を正規化し、JSON文字列順で並べ替えて順序差を吸収
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
    // オブジェクトキーをソート
    const keys = Object.keys(val).sort();
    const out = {};
    for (const k of keys) {
      out[k] = canonicalize(val[k]);
    }
    return out;
  }
  // フォールバック
  try { return String(val); } catch (e) { return null; }
}

/**
 * 1回限りのイベント購読
 */
export function subOnce(state, key, filters, onEvent, relays = null) {
  if (!state.pool) {
    console.warn('[Relay] pool 未利用のため購読をスキップ', key);
    return function () { };
  }
  // 末尾スラッシュ混在を避けるため、対象リレーを正規化して重複除去
  let targetRelays = relays || getReadRelays(state.relays);
  if (!Array.isArray(targetRelays)) targetRelays = [];
  targetRelays = Array.from(new Set(targetRelays.map(normalizeUrl).filter(Boolean)));

  // 購読前にリレー妥当性チェック
  if (!targetRelays || targetRelays.length === 0) {
    console.warn('[Relay] 購読用リレーなし:', key);
    return function () { };
  }

  // 全分岐で unsubscribe 側から参照できるよう外側スコープに置く
  let queuedReq;

  // デバッグ用ログは実際に新規購読または再利用が決まってから出す
  // デバッグ用ログは後で出す

  // 異なるフィルタで誤再利用しないよう、正規化フィルタ込みの論理IDを作る
  let filterKey = '';
  try {
    filterKey = JSON.stringify(canonicalize(filters || []));
  } catch (e) {
    try { filterKey = String(filters); } catch (e2) { filterKey = '' + Math.random(); }
  }
  const logicalPrefix = key + '|' + filterKey + ':';

  // 購読再利用は無効化: stale/旧pool再利用を避けるため常に新規作成
  // 以前の再利用ロジックは意図的に廃止

  // stale/旧pool問題を避けるため常に新規購読を作成
  // （既存の論理購読は再利用しない）
  try {
    let existingSid = null;
    for (const sid of state.subs.keys()) {
      if (typeof sid === 'string' && sid.indexOf(logicalPrefix) === 0) {
        existingSid = sid;
        break;
      }
    }
    if (existingSid) {
      // 再利用条件を検証: current pool 所属かつ対象リレーが順序非依存で一致すること
      // 条件を満たさなければ新規購読作成へ進む
      try {
        const existingSub = state.subs.get(existingSid);
        let canReuse = false;
        if (existingSub) {
          try {
            // pool 同一性チェック（同一参照）
            if (existingSub.__pool && state.pool && existingSub.__pool === state.pool) {
              // リレー一覧比較
              const oldTargets = Array.isArray(existingSub.__targetRelays) ? existingSub.__targetRelays.map(normalizeUrl).filter(Boolean) : [];
              const newTargets = Array.isArray(targetRelays) ? targetRelays.map(normalizeUrl).filter(Boolean) : [];
              // まず件数を比較
              if (oldTargets.length === newTargets.length) {
                const sOld = oldTargets.slice().sort();
                const sNew = newTargets.slice().sort();
                canReuse = (JSON.stringify(sOld) === JSON.stringify(sNew));
              }
            }
          } catch (e) { /* ignore comparison errors */ }
        }

        if (canReuse) {
          // 既存購読を再利用: リスナー登録し、解除関数を返す
          try {
            let listeners = logicalListeners.get(existingSid);
            if (!listeners) {
              listeners = new Set();
              logicalListeners.set(existingSid, listeners);
            }
            listeners.add(onEvent);
            debugRelay('[Relay] 購読再利用:', existingSid);
            // このリスナー専用の解除関数を返す
            return function () {
              try {
                listeners.delete(onEvent);
                // リスナーがなくなったら下位subをcloseして後始末
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
            // 新規購読作成へフォールスルー
          }
        } else {
          // 既存subが current pool/relays と不一致なので再利用せず新規作成
          existingSid = null;
        }
      } catch (e) {
        console.warn('[Relay] subOnce の再利用判定でエラー', e);
        // 新規購読作成へフォールスルー
      }
    }
  } catch (e) {
    console.warn('[Relay] subOnce の再利用判定でエラー', e);
  }

  const subId = logicalPrefix + Math.random().toString(36).slice(2, 8);

  try {
    // リスナー集合とディスパッチャを準備
    const listeners = new Set();
    listeners.add(onEvent);
    const dispatcher = function (ev, relay, done) {
      try {
        for (const fn of Array.from(listeners)) {
          try { fn(ev, relay, done); } catch (inner) { console.warn('[Relay] リスナー処理でエラー', inner); }
        }
      } catch (e) { /* ignore */ }
    };

    // ここで新規購読用の queuedReq を作成
    debugRelay('[Relay] 購読開始:', targetRelays.length, 'relays, key=', key);
    // subscribe リクエストをキュー投入して非同期開始。解除関数は即返す
    // queuedReq は解除クロージャから参照できる必要がある
    queuedReq = { targetRelays: targetRelays, filters: filters, dispatcher: dispatcher, pool: state.pool, cancelled: false, key: key };
    const startPromise = new Promise((resolve, reject) => {
      queuedReq.resolve = resolve;
      queuedReq.reject = reject;

      // 優先度の判定: follows、profile関連、または現在アクティブなタブに関連するリクエストを優先する
      let isHighPriority = false;
      try {
        if (key === 'follows') {
          isHighPriority = true;
        } else if (key && key.includes('profile')) {
          // プロフィールモーダル関連は常に最優先
          isHighPriority = true;
        } else {
          // 現在のアクティブタブを取得
          const activeTabEl = document.querySelector('.tab.active');
          const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : 'home'; // デフォルトは home
          if (activeTab && key && key.includes(activeTab)) {
            isHighPriority = true;
          }
        }
      } catch (e) {
        if (key && key.includes('home')) isHighPriority = true;
      }

      if (isHighPriority) {
        // 優先度の高いものはキューの先頭（ただし既存の優先リクエストの後ろ）に挿入
        let insertIdx = 0;
        while (insertIdx < subscribeQueue.length && subscribeQueue[insertIdx].priority) {
          insertIdx++;
        }
        queuedReq.priority = true;
        subscribeQueue.splice(insertIdx, 0, queuedReq);
      } else {
        subscribeQueue.push(queuedReq);
      }

      // 直ちにキュー処理を試行
      try { processSubscribeQueue(); } catch (e) { console.warn('[Relay] processSubscribeQueue に失敗', e); }
    });

    let subStarted = null;
    // 開始後に state.subs へ保存
    startPromise.then(s => {
      subStarted = s;
      try { queuedReq.sub = s; } catch (e) { }
      try { state.subs.set(subId, s); } catch (e) { /* ignore */ }
    }).catch(e => {
      // 開始失敗またはキャンセル時は追加処理なし
    });

  } catch (e) {
    console.warn('[Relay] 購読失敗', e);
    return function () { };
  }
  // queued リクエストの取消、または開始済み購読を close する解除関数
  return function () {
    try {
      if (typeof queuedReq === 'undefined') {
        // 取消対象なし
        return;
      }
      if (queuedReq && queuedReq.sub) {
        try { queuedReq.sub.close(); } catch (e) { console.warn('[Relay] 購読解除失敗:', e); }
        try { state.subs.delete(subId); } catch (e) { }
      } else if (queuedReq) {
        // キュー上のリクエストを取消
        try {
          queuedReq.cancelled = true;
          const idx = subscribeQueue.indexOf(queuedReq);
          if (idx !== -1) subscribeQueue.splice(idx, 1);
        } catch (e) { }
      }
    } catch (e) { console.warn('[Relay] 購読解除失敗:', e); }
  };
}

/**
 * リレー接続後の状態報告
 */
export function reportRelayStatus(state) {
  try {
    if (!state.pool) return [];
    const allRelays = getAllRelayUrls(state.relays);
    const report = [];
    allRelays.forEach(url => {
      try {
        const { connected, reconnectAttempts, lastSeenDown } = relayStates.get(url) || {};
        report.push({ url, connected, reconnectAttempts, lastSeenDown });
      } catch (e) { /* ignore */ }
    });
    return report;
  } catch (e) {
    console.warn('[Relay] リレー状態報告失敗:', e);
    return [];
  }
}

/**
 * 重複するリレーキーを報告
 */
export function reportPoolDuplicates(pool) {
  try {
    if (!pool || !pool.relays) return [];
    const groups = new Map();
    for (const [k, v] of pool.relays.entries()) {
      try {
        const nk = (typeof k === 'string') ? k.trim().replace(/\/+$/, '') : k;
        if (!groups.has(nk)) groups.set(nk, []);
        groups.get(nk).push({ key: k, entry: v });
      } catch (e) { /* ignore */ }
    }
    const dups = [];
    for (const [nk, arr] of groups.entries()) {
      if (arr.length > 1) dups.push({ url: nk, entries: arr.map(a => a.key) });
    }
    return dups;
  } catch (e) { return []; }
}

/**
 * プール内の重複リレーエントリをクリーンアップ
 */
export function cleanupPoolDuplicates(pool) {
  try {
    if (!pool || !pool.relays) return { cleaned: 0, groups: [] };
    const groups = new Map();
    for (const [k, v] of pool.relays.entries()) {
      try {
        const nk = (typeof k === 'string') ? k.trim().replace(/\/+$/, '') : k;
        if (!groups.has(nk)) groups.set(nk, []);
        groups.get(nk).push({ key: k, entry: v });
      } catch (e) { /* ignore */ }
    }
    const cleanedGroups = [];
    let cleaned = 0;
    for (const [nk, arr] of groups.entries()) {
      if (arr.length <= 1) continue;
      // 先頭を残して他を削除
      const keep = arr[0];
      const removed = [];
      for (let i = 1; i < arr.length; i++) {
        const it = arr[i];
        try {
          if (it.entry && it.entry.ws && typeof it.entry.ws.close === 'function') {
            try { it.entry.ws.close(); } catch (e) { /* ignore */ }
          }
        } catch (e) { }
        try { if (pool.relays && typeof pool.relays.delete === 'function') pool.relays.delete(it.key); } catch (e) { }
        removed.push(it.key);
        cleaned++;
      }
      cleanedGroups.push({ url: nk, kept: keep.key, removed });
    }
    return { cleaned, groups: cleanedGroups };
  } catch (e) { return { cleaned: 0, groups: [] }; }
}

// relay ごと・種別ごとのアクティブ件数を保持
const relayActiveCounts = {
  live: new Map(),
  oneshot: new Map()
};
const subscribeQueue = []; // array of { targetRelays, filters, dispatcher, resolve, reject, subId, type }

function incrementActiveCounts(relays, type) {
  const map = relayActiveCounts[type] || relayActiveCounts.oneshot;
  for (const r of relays) {
    const key = (typeof r === 'string') ? r.trim().replace(/\/+$/, '') : r;
    const v = map.get(key) || 0;
    map.set(key, v + 1);
  }
}

function decrementActiveCounts(relays, type) {
  const map = relayActiveCounts[type] || relayActiveCounts.oneshot;
  for (const r of relays) {
    const key = (typeof r === 'string') ? r.trim().replace(/\/+$/, '') : r;
    const v = map.get(key) || 0;
    const nv = Math.max(0, v - 1);
    map.set(key, nv);
  }
}

function hasOpenSocketForRelays(pool, relays) {
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
  } catch (e) { logWarn('[Relay] hasOpenSocketForRelays 失敗:', e); }
  return false;
}

function canStartForAll(relays, type, priority = false) {
  if (priority) {
    // 優先リクエスト（アクティブタブなど）はスロットリングをバイパス。
    // ただし、過度な接続を防ぐ緩いセーフティチェックのみ適用。
    for (const r of relays) {
      const vLive = relayActiveCounts.live.get(r) || 0;
      const vOne = relayActiveCounts.oneshot.get(r) || 0;
      if ((vLive + vOne) >= 12) return false;
    }
    return true;
  }

  const map = relayActiveCounts[type] || relayActiveCounts.oneshot;
  const limit = (type === 'live') ? MAX_LIVE_PER_RELAY : MAX_ONESHOT_PER_RELAY;
  const totalLimit = typeof MAX_TOTAL_SUB_PER_RELAY === 'number' ? MAX_TOTAL_SUB_PER_RELAY : 5;
  for (const r of relays) {
    const vLive = relayActiveCounts.live.get(r) || 0;
    const vOne = relayActiveCounts.oneshot.get(r) || 0;
    // このリクエスト種別が relay ごとの上限を超えないことを確認
    const current = map.get(r) || 0;
    if (current >= limit) return false;
    // 過負荷防止のため合計も上限化
    if ((vLive + vOne) >= totalLimit) return false;
  }
  return true;
}

function processSubscribeQueue() {
  if (!subscribeQueue.length) return;
  for (let i = 0; i < subscribeQueue.length; i++) {
    const req = subscribeQueue[i];
    // キャンセル済みリクエストはスキップ
    if (req.cancelled) {
      subscribeQueue.splice(i, 1);
      i--;
      continue;
    }
    const type = req.type || inferReqType(req.filters);
    const priority = !!req.priority;
    if (canStartForAll(req.targetRelays, type, priority)) {
      // キューから除去
      subscribeQueue.splice(i, 1);
      i--;
      // 実行開始
      try {
        incrementActiveCounts(req.targetRelays, type);
        // 購読開始前に req.targetRelays を正規化・重複排除
        try {
          req.targetRelays = Array.from(new Set((req.targetRelays || []).map(normalizeUrl).filter(Boolean)));
        } catch (e) { }
        const pool = req.pool || (typeof window !== 'undefined' && window.__nostrState && window.__nostrState.pool) || null;
        if (!pool) {
          // pool がなければ開始できないため reject
          decrementActiveCounts(req.targetRelays, type);
          req.reject(new Error('no pool available'));
          continue;
        }
        // デバッグ: 実際に購読開始に使う filters と relays を表示
        try {
          debugRelay('[Relay] 購読処理を開始', { relays: req.targetRelays, type: type, filters: req.filters });
        } catch (e) { }
        const sub = pool.subscribeMany(req.targetRelays, req.filters, {
          onevent: (function () {
            // oneshot は dispatcher をラップし、一定件数または timeout で自動 close
            if (type === 'oneshot') {
              // 1 relay 偏重で早期 close しないよう relay ごとに件数を管理
              const perRelayLimit = 20;
              const relayCount = Array.isArray(req.targetRelays) && req.targetRelays.length ? req.targetRelays.length : 1;
              const counts = new Map();
              let total = 0;
              // EOSE を通知した relay を追跡
              const eoseSeen = new Set();
              // pool 実装により callback は (ev, relay) を受け取る場合がある
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
                  // イベントをリスナーへ転送
                  try { req.dispatcher(ev, relay, false); } catch (e) { }
                  if (!ev) return;
                  try {
                    const key = (relay && typeof relay === 'string') ? relay.trim().replace(/\/+$/, '') : '__unknown__';
                    const cur = counts.get(key) || 0;
                    if (cur < perRelayLimit) {
                      counts.set(key, cur + 1);
                      total++;
                    }
                    // この relay の doneFlag（EOSE）が来たら記録
                    if (doneFlag) {
                      eoseSeen.add(key);
                    }
                    // 各 relay から perRelayLimit 件に達したら close
                    if (total >= perRelayLimit * relayCount) {
                      try { if (sub && typeof sub.close === 'function') sub.close(); } catch (e) { }
                    }
                    // 全 relay の EOSE を確認したら早期 close 可能
                    if (eoseSeen.size >= relayCount) {
                      try { if (sub && typeof sub.close === 'function') sub.close(); } catch (e) { }
                    }
                  } catch (e) { /* ignore counting errors */ }
                } catch (e) { /* ignore */ }
              };
            }
            // 既定: そのまま転送（live subscriptions）
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
              // pool 実装によっては relay ごとに oneose が来るため、done 信号として転送
              try { req.dispatcher(null, relay, true); } catch (e) { }
            } catch (e) { }
          }
        });
        // close をラップして件数デクリメントとキュー処理を実行
        const origClose = sub.close.bind(sub);
        // 将来の再利用判定で pool/relay 同一性を確認できるようメタデータを付与
        try {
          sub.__targetRelays = req.targetRelays ? (Array.isArray(req.targetRelays) ? req.targetRelays.slice() : [req.targetRelays]) : [];
          sub.__pool = pool;
        } catch (e) { /* ignore */ }
        // oneshot はイベント未到着時に close する安全タイムアウトを設定
        let oneshotTimer = null;
        if (type === 'oneshot') {
          try {
            oneshotTimer = setTimeout(() => {
              try { if (sub && typeof sub.close === 'function') sub.close(); } catch (e) { }
            }, 4000);
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
        // 起動中にキャンセルされた場合は即 close して reject
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

// フィルタから種別を推定するヘルパー: いずれかに since があれば live
function inferReqType(filters) {
  try {
    if (!filters) return 'oneshot';
    for (const f of filters) {
      if (f && typeof f === 'object' && ('since' in f)) return 'live';
    }
  } catch (e) { }
  return 'oneshot';
}

// デバッグヘルパー: 実行時確認用に queue と件数を公開
try {
  if (typeof window !== 'undefined') {
    window.__relayDebug = function () {
      try {
        // 内部 map を正規化配列へ集約して安全に確認可能にする
        function aggregateCounts(map) {
          const agg = Object.create(null);
          for (const [k, v] of map.entries()) {
            try {
              const nk = (typeof k === 'string') ? k.trim().replace(/\/+$/, '') : k;
              agg[nk] = (agg[nk] || 0) + (v || 0);
            } catch (e) { /* ignore entry */ }
          }
          return Object.entries(agg);
        }
        const liveCounts = aggregateCounts(relayActiveCounts.live);
        const oneshotCounts = aggregateCounts(relayActiveCounts.oneshot);
        // 表示用に queued targetRelays を正規化
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

/**
 * relay URL 文字列を正規化（trim + 末尾スラッシュ除去）
 */
function normalizeUrl(u) {
  try {
    if (!u || typeof u !== 'string') return u;
    return u.trim().replace(/\/+$/, '');

  } catch (e) {
    return u;
  }
}

/**
 * 読込用リレーURL取得
 */
export function getReadRelays(relays) {
  if (!Array.isArray(relays)) return [];
  const urls = relays
    .map(normalizeRelay)
    .filter(r => r && r.read && isValidRelayUrl(r.url))
    .map(r => normalizeUrl(r.url));
  return Array.from(new Set(urls.filter(Boolean)));
}

/**
 * 書込用リレーURL取得
 */
export function getWriteRelays(relays) {
  if (!Array.isArray(relays)) return [];
  const urls = relays
    .map(normalizeRelay)
    .filter(r => r && r.write && isValidRelayUrl(r.url))
    .map(r => normalizeUrl(r.url));
  return Array.from(new Set(urls.filter(Boolean)));
}

/**
 * 全リレーURL取得（正規化して重複排除）
 */
export function getAllRelayUrls(relays) {
  if (!Array.isArray(relays)) return [];
  const urls = relays
    .map(normalizeRelay)
    .filter(r => r && isValidRelayUrl(r.url))
    .map(r => normalizeUrl(r.url));
  return Array.from(new Set(urls.filter(Boolean)));
}

/**
 * 全購読解除
 */
export function unsubscribeAll(state) {
  try {
    if (!state || !state.subs) return;
    for (const [, sub] of state.subs) {
      try {
        if (sub && typeof sub.close === 'function') sub.close();
      } catch (e) { /* ignore */ }
    }
    try { state.subs.clear(); } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn('[Relay] 購読解除失敗:', e);
  }
}

/**
 * 既存 pool を閉じ、socket が閉じるか timeout まで待機する。
 * pool を閉じた場合は true、存在しない場合は false を返す。
 */
export async function closePoolAndWait(state, timeoutMs = 1000) {
  if (!state || !state.pool) return false;
  const oldPool = state.pool;
  try {
    // 監視を停止
    try { stopMonitoringRelays(state); } catch (e) { }
    // 追跡中の論理購読は参照のみ破棄（実 socket クローズは closePoolSocketsSafely に一本化）
    try {
      try { state.subs.clear(); } catch (e) { }
    } catch (e) { }

    // 旧 pool に紐づく queued subscribe リクエストをキャンセル
    try {
      if (typeof subscribeQueue !== 'undefined' && Array.isArray(subscribeQueue) && subscribeQueue.length) {
        for (let i = subscribeQueue.length - 1; i >= 0; i--) {
          try {
            const req = subscribeQueue[i];
            if (req && req.pool === oldPool) {
              try { req.cancelled = true; } catch (e) { }
              try { subscribeQueue.splice(i, 1); } catch (e) { }
            }
          } catch (e) { }
        }
      }
    } catch (e) { }

    // pool に接続クローズを依頼
    try {
      closePoolSocketsSafely(oldPool);
    } catch (e) { }

    // relay に OPEN socket がなくなるか timeout まで待機
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
      // 短時間スリープ
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (e) {
    // エラーを無視
  } finally {
    try { state.pool = null; } catch (e) { }
  }
  return true;
}

/**
 * イベントの受信リレーリスト（ev.seenOn）から、現在の設定に基づき最適なリレーヒントを決定する
 * 優先順位: 自分の書き込みリレー -> 自分の読み込みリレー -> 最初に受信したリレー -> 空文字
 */
export function getBestRelayHint(state, ev) {
  if (!ev) return '';

  let seenOn = Array.isArray(ev.seenOn) ? ev.seenOn.slice() : [];

  // もし ev.seenOn が空で、pool.seenOn がある場合、そこから取得を試みる
  if (seenOn.length === 0 && state && state.pool && state.pool.seenOn) {
    try {
      const poolSeen = state.pool.seenOn.get(ev.id);
      if (poolSeen) {
        // Set の中身が Relay オブジェクトか url 文字列か異なるため両対応
        seenOn = Array.from(poolSeen).map(r => {
          if (typeof r === 'string') return r;
          return r && (r.url || r.relay || r);
        }).filter(Boolean);
      }
    } catch (e) { }
  }

  if (seenOn.length === 0) {
    return '';
  }

  // 1. 自分の書き込みリレーに含まれるものを探す
  try {
    const writeRelays = getWriteRelays(state.relays);
    for (const r of writeRelays) {
      const normalizedR = normalizeUrl(r);
      const found = seenOn.find(s => normalizeUrl(s) === normalizedR);
      if (found) return found;
    }
  } catch (e) { }

  // 2. 自分の読み込みリレーに含まれるものを探す
  try {
    const readRelays = getReadRelays(state.relays);
    for (const r of readRelays) {
      const normalizedR = normalizeUrl(r);
      const found = seenOn.find(s => normalizeUrl(s) === normalizedR);
      if (found) return found;
    }
  } catch (e) { }

  // 3. 最初に受信したリレーを返す
  return seenOn[0] || '';
}

