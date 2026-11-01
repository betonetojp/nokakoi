import { RECONNECT_DELAY, MAX_RECONNECT_DELAY, DOWN_PERSIST_MS, KEEPALIVE_INTERVAL, RESUME_RESTART_MS, RELAY_MONITOR_INTERVAL } from '../../config/constants.js';
import { getRelayFromPool } from './relay-connection.js';
import { getAllRelayUrls } from './relay-helpers.js';
import { sanitizeRelayActiveCounts, processSubscribeQueue } from './relay-subscription.js';

/**
 * リレー接続状態
 */
export const relayStates = new Map();

// ダミーの pubkey
const KEEPALIVE_DUMMY_AUTHOR = '0000000000000000000000000000000000000000000000000000000000000000';

export function debugRelay(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.debug(...args);
    }
  } catch (e) { }
}

/**
 * リレー状態更新ヘルパー
 */
export function updateRelayState(url, connected) {
  try {
    const prev = relayStates.get(url) || {};
    const state = Object.assign({ connected: false, reconnectAttempts: 0, reconnectTimer: null, lastSeenDown: null }, prev);
    state.connected = !!connected;
    if (state.connected) {
      state.reconnectAttempts = 0;
      if (state.reconnectTimer) {
        try { clearTimeout(state.reconnectTimer); } catch (e) { }
        state.reconnectTimer = null;
      }
      state.lastSeenDown = null;
    } else {
      if (!state.lastSeenDown) state.lastSeenDown = Date.now();
      try {
        sanitizeRelayActiveCounts();
        processSubscribeQueue();
      } catch (e) { }
    }
    relayStates.set(url, state);
  } catch (e) {
    console.warn('[Relay] updateRelayState に失敗:', url, e);
  }
}

/**
 * 単一リレーへの接続を再試行する（フィード全体は再起動しない）
 */
export async function reconnectSingleRelay(state, url) {
  if (!state || !state.pool || !url) return false;
  try {
    debugRelay(`[Relay] 単一リレー ${url} への再接続を試行`);
    if (typeof state.pool.ensureRelay === 'function') {
      const relay = await state.pool.ensureRelay(url);
      const isConnected = relay && relay.ws && relay.ws.readyState === WebSocket.OPEN;
      updateRelayState(url, !!isConnected);
      return !!isConnected;
    }
  } catch (e) {
    debugRelay(`[Relay] ${url} の再接続に失敗:`, e);
    updateRelayState(url, false);
  }
  return false;
}

/**
 * リレーの再接続をスケジュール（指数バックオフ、上限なし）
 */
export function scheduleReconnect(state, url) {
  try {
    const relayState = relayStates.get(url);
    if (!relayState) return;

    if (relayState.reconnectTimer) return;

    relayState.reconnectAttempts++;
    const delay = Math.min(RECONNECT_DELAY * Math.pow(2, relayState.reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    debugRelay(`[Relay] ${url} の再接続をスケジュール中 (試行: ${relayState.reconnectAttempts}, 遅延: ${delay}ms)`);

    relayState.reconnectTimer = setTimeout(() => {
      try {
        relayState.reconnectTimer = null;
        debugRelay(`[Relay] ${url} へ再接続を試行中`);
        reconnectSingleRelay(state, url).catch(() => {});
      } catch (e) {
        console.warn(`[Relay] ${url} の再接続タイマー処理に失敗しました:`, e);
      }
    }, delay);

    relayStates.set(url, relayState);
  } catch (e) {
    console.warn(`[Relay] ${url} の scheduleReconnect に失敗しました:`, e);
  }
}

/**
 * WebSocket keepalive
 */
export function startKeepalive(state) {
  stopKeepalive(state);
  state._keepaliveInterval = setInterval(() => {
    try {
      if (!state.pool || !state.pool.relays) return;
      for (const [url, relay] of state.pool.relays.entries()) {
        try {
          const ws = relay && relay.ws;
          if (!ws || ws.readyState !== WebSocket.OPEN) continue;
          const kaId = 'ka_' + Date.now().toString(36);
          ws.send(JSON.stringify(["REQ", kaId, { "kinds": [0], "authors": [KEEPALIVE_DUMMY_AUTHOR], "limit": 1 }]));
          ws.send(JSON.stringify(["CLOSE", kaId]));
          debugRelay('[Relay] keepalive 送信先:', url);
        } catch (e) { }
      }
    } catch (e) {
      console.warn('[Relay] keepalive 送信失敗:', e);
    }
  }, KEEPALIVE_INTERVAL);
}

export function stopKeepalive(state) {
  if (state._keepaliveInterval) {
    try { clearInterval(state._keepaliveInterval); } catch (e) { }
    state._keepaliveInterval = null;
  }
}

/**
 * 画面表示・復帰時のリレー接続チェック及びフィード再起動
 */
export function setupVisibilityHandler(state, restartFeedsCallback) {
  removeVisibilityHandler(state);
  if (!restartFeedsCallback) return;

  state._feedHiddenAt = (typeof document !== 'undefined' && document.hidden) ? Date.now() : null;

  const triggerResumeCheck = (inferredHiddenFor = 0) => {
    try {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }

      const now = Date.now();
      if (state._lastResumeHandledAt && (now - state._lastResumeHandledAt) < 2000) {
        return;
      }
      state._lastResumeHandledAt = now;

      const hiddenFor = state._feedHiddenAt
        ? (now - state._feedHiddenAt)
        : inferredHiddenFor;
      state._feedHiddenAt = null;

      debugRelay('[Relay] 画面が表示状態になりました。接続状態を確認中', { hiddenFor });
      if (!state.pool || !state.pool.relays) return;

      const allRelays = getAllRelayUrls(state.relays);

      allRelays.forEach(url => {
        try {
          const relay = getRelayFromPool(state.pool, url);
          const ws = relay && relay.ws;
          const isConnected = ws && ws.readyState === WebSocket.OPEN;
          if (!isConnected) {
            const rs = relayStates.get(url);
            if (rs) {
              rs.reconnectAttempts = 0;
              rs.lastSeenDown = null;
              relayStates.set(url, rs);
            }
            reconnectSingleRelay(state, url).catch(() => {});
          }
          updateRelayState(url, !!isConnected);
        } catch (e) { }
      });

      const forceRestart = hiddenFor >= RESUME_RESTART_MS;
      if (forceRestart) {
        debugRelay('[Relay] 長時間離脱後のフィード再起動をトリガー', { forceRestart, hiddenFor });
        setTimeout(() => {
          try { if (restartFeedsCallback) restartFeedsCallback(false); } catch (e) { }
        }, 500);
      }
    } catch (e) {
      console.warn('[Relay] resume ハンドラーでエラー:', e);
    }
  };

  state._visibilityHandler = () => {
    try {
      if (typeof document !== 'undefined' && document.hidden) {
        state._feedHiddenAt = Date.now();
        return;
      }
      triggerResumeCheck();
    } catch (e) {
      console.warn('[Relay] visibilitychange ハンドラーでエラー:', e);
    }
  };

  state._pageHideHandler = () => {
    try {
      if (!state._feedHiddenAt) {
        state._feedHiddenAt = Date.now();
      }
    } catch (e) { }
  };

  state._pageshowHandler = () => {
    try {
      triggerResumeCheck();
    } catch (e) { }
  };

  state._focusHandler = () => {
    try {
      triggerResumeCheck();
    } catch (e) { }
  };

  state._onlineHandler = () => {
    try {
      triggerResumeCheck();
    } catch (e) { }
  };

  try {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', state._visibilityHandler);
    }
  } catch (e) { }

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pageshow', state._pageshowHandler);
      window.addEventListener('focus', state._focusHandler);
      window.addEventListener('online', state._onlineHandler);
      window.addEventListener('pagehide', state._pageHideHandler);
      window.addEventListener('blur', state._pageHideHandler);
    }
  } catch (e) { }

  // iOS PWA等のサスペンド復帰検知用ハートビート（タイマージャンプ検知）
  let lastHeartbeat = Date.now();
  state._resumeHeartbeatInterval = setInterval(() => {
    try {
      const current = Date.now();
      const elapsed = current - lastHeartbeat;
      lastHeartbeat = current;
      if (elapsed >= RESUME_RESTART_MS) {
        debugRelay('[Relay] ハートビートギャップを検知 (サスペンド復帰):', elapsed);
        triggerResumeCheck(elapsed);
      }
    } catch (e) { }
  }, 2000);
}

export function removeVisibilityHandler(state) {
  if (state._visibilityHandler) {
    try {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', state._visibilityHandler);
      }
    } catch (e) { }
    state._visibilityHandler = null;
  }
  if (state._pageshowHandler) {
    try {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pageshow', state._pageshowHandler);
        window.removeEventListener('focus', state._focusHandler);
        window.removeEventListener('online', state._onlineHandler);
        window.removeEventListener('pagehide', state._pageHideHandler);
        window.removeEventListener('blur', state._pageHideHandler);
      }
    } catch (e) { }
    state._pageshowHandler = null;
    state._focusHandler = null;
    state._onlineHandler = null;
    state._pageHideHandler = null;
  }
  if (state._resumeHeartbeatInterval) {
    try { clearInterval(state._resumeHeartbeatInterval); } catch (e) { }
    state._resumeHeartbeatInterval = null;
  }
  try { state._feedHiddenAt = null; } catch (e) { }
  try { state._lastResumeHandledAt = null; } catch (e) { }
}


/**
 * リレー接続監視
 */
export function monitorRelayConnections(state) {
  if (!state.pool) return;
  const allRelays = getAllRelayUrls(state.relays);
  allRelays.forEach(url => {
    if (!relayStates.has(url)) {
      updateRelayState(url, false);
    }
  });

  const checkInterval = setInterval(() => {
    if (!state.pool) {
      clearInterval(checkInterval);
      return;
    }
    allRelays.forEach(url => {
      try {
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
            const rs = relayStates.get(url);
            if (rs.lastSeenDown && (now - rs.lastSeenDown) >= DOWN_PERSIST_MS) {
              scheduleReconnect(state, url);
              rs.lastSeenDown = null;
              relayStates.set(url, rs);
            }
          }
        } else {
          const wasConnected = relayStates.get(url)?.connected || false;
          if (wasConnected) {
            debugRelay(`[Relay] 接続喪失: ${url}`);
            updateRelayState(url, false);
            const rs = relayStates.get(url);
            if (rs.lastSeenDown && (now - rs.lastSeenDown) >= DOWN_PERSIST_MS) {
              scheduleReconnect(state, url);
              rs.lastSeenDown = null;
              relayStates.set(url, rs);
            }
          }
        }
      } catch (e) {
        console.warn(`[Relay] 接続確認エラー: ${url}`, e);
      }
    });
  }, RELAY_MONITOR_INTERVAL);

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
  stopKeepalive(state);
  removeVisibilityHandler(state);
  relayStates.forEach((relayState) => {
    if (relayState.reconnectTimer) {
      clearTimeout(relayState.reconnectTimer);
      relayState.reconnectTimer = null;
    }
  });
  relayStates.clear();
}
