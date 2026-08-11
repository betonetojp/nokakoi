import { defaultRelays } from './relay-constants.js';
import { relayStates } from './relay-state.js';
import { normalizeRelay, isValidRelayUrl } from './relay-connection.js';

export function normalizeUrl(u) {
  try {
    if (!u || typeof u !== 'string') return u;
    return u.trim().replace(/\/+$/, '');
  } catch (e) {
    return u;
  }
}

export function getReadRelays(relays) {
  if (!Array.isArray(relays)) return [];
  const urls = relays
    .map(normalizeRelay)
    .filter(r => r && r.read && isValidRelayUrl(r.url))
    .map(r => normalizeUrl(r.url));
  return Array.from(new Set(urls.filter(Boolean)));
}

export function getWriteRelays(relays) {
  if (!Array.isArray(relays)) return [];
  const urls = relays
    .map(normalizeRelay)
    .filter(r => r && r.write && isValidRelayUrl(r.url))
    .map(r => normalizeUrl(r.url));
  return Array.from(new Set(urls.filter(Boolean)));
}

export function getAllRelayUrls(relays) {
  if (!Array.isArray(relays)) return [];
  const urls = relays
    .map(normalizeRelay)
    .filter(r => r && isValidRelayUrl(r.url))
    .map(r => normalizeUrl(r.url));
  return Array.from(new Set(urls.filter(Boolean)));
}

export function loadRelays() {
  try {
    const raw = localStorage.getItem('relays');
    if (!raw) return defaultRelays;
    const list = JSON.parse(raw);
    if (Array.isArray(list) && list.length) {
      const normalized = list
        .map(normalizeRelay)
        .filter(r => isValidRelayUrl(r.url));
      const map = new Map();
      for (const r of normalized) {
        if (!map.has(r.url)) map.set(r.url, r);
      }
      const unique = Array.from(map.values());
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

export function saveRelays(list) {
  try {
    if (!Array.isArray(list)) {
      const raw = JSON.stringify(list);
      localStorage.setItem('relays', raw);
      const currentPk = localStorage.getItem('pubkey');
      if (currentPk) {
        localStorage.setItem(`relays.${currentPk.toLowerCase()}`, raw);
      }
      return;
    }
    const normalized = list.map(normalizeRelay).filter(r => isValidRelayUrl(r.url));
    const map = new Map();
    for (const r of normalized) {
      if (!map.has(r.url)) map.set(r.url, r);
    }
    const unique = Array.from(map.values());
    const raw = JSON.stringify(unique);
    localStorage.setItem('relays', raw);

    const currentPk = localStorage.getItem('pubkey');
    if (currentPk) {
      localStorage.setItem(`relays.${currentPk.toLowerCase()}`, raw);
    }
  } catch (e) {
    console.warn('[Relay] リレー保存失敗:', e);
  }
}

/**
 * 現在のリレー設定をアカウント別キーに退避
 */
export function saveRelaysForAccount(pubkey) {
  if (!pubkey) return;
  try {
    const raw = localStorage.getItem('relays');
    if (raw) {
      localStorage.setItem(`relays.${pubkey.toLowerCase()}`, raw);
    } else {
      localStorage.setItem(`relays.${pubkey.toLowerCase()}`, JSON.stringify(defaultRelays));
    }
  } catch (e) {
    console.warn('[Relay] アカウント別リレー保存失敗:', e);
  }
}

/**
 * アカウント別キーからリレー設定を復元
 */
export function loadRelaysForAccount(pubkey) {
  if (!pubkey) {
    saveRelays(defaultRelays);
    return defaultRelays;
  }
  const targetId = pubkey.toLowerCase();
  try {
    const raw = localStorage.getItem(`relays.${targetId}`);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) {
        localStorage.setItem('relays', JSON.stringify(list));
        return loadRelays();
      }
    }
    // 個別設定が未作成の場合: 単一キーに有効なリレー設定があればそれをアカウント用に自動昇格・コピー保存
    const existingRaw = localStorage.getItem('relays');
    if (existingRaw) {
      try {
        const existingList = JSON.parse(existingRaw);
        if (Array.isArray(existingList) && existingList.length) {
          localStorage.setItem(`relays.${targetId}`, existingRaw);
          return loadRelays();
        }
      } catch (e) {}
    }

    saveRelays(defaultRelays);
    localStorage.setItem(`relays.${targetId}`, JSON.stringify(defaultRelays));
    return defaultRelays;
  } catch (e) {
    console.warn('[Relay] アカウント別リレー読み込み失敗:', e);
    saveRelays(defaultRelays);
    return defaultRelays;
  }
}

export function reportRelayStatus(state) {
  try {
    if (!state.pool) return [];
    const allRelays = getAllRelayUrls(state.relays);
    const report = [];
    allRelays.forEach(url => {
      try {
        const { connected, reconnectAttempts, lastSeenDown } = relayStates.get(url) || {};
        report.push({ url, connected, reconnectAttempts, lastSeenDown });
      } catch (e) { }
    });
    return report;
  } catch (e) {
    console.warn('[Relay] リレー状態報告失敗:', e);
    return [];
  }
}

export function reportPoolDuplicates(pool) {
  try {
    if (!pool || !pool.relays) return [];
    const groups = new Map();
    for (const [k, v] of pool.relays.entries()) {
      try {
        const nk = (typeof k === 'string') ? k.trim().replace(/\/+$/, '') : k;
        if (!groups.has(nk)) groups.set(nk, []);
        groups.get(nk).push({ key: k, entry: v });
      } catch (e) { }
    }
    const dups = [];
    for (const [nk, arr] of groups.entries()) {
      if (arr.length > 1) dups.push({ url: nk, entries: arr.map(a => a.key) });
    }
    return dups;
  } catch (e) { return []; }
}

export function cleanupPoolDuplicates(pool) {
  try {
    if (!pool || !pool.relays) return { cleaned: 0, groups: [] };
    const groups = new Map();
    for (const [k, v] of pool.relays.entries()) {
      try {
        const nk = (typeof k === 'string') ? k.trim().replace(/\/+$/, '') : k;
        if (!groups.has(nk)) groups.set(nk, []);
        groups.get(nk).push({ key: k, entry: v });
      } catch (e) { }
    }
    const cleanedGroups = [];
    let cleaned = 0;
    for (const [nk, arr] of groups.entries()) {
      if (arr.length <= 1) continue;
      const keep = arr[0];
      const removed = [];
      for (let i = 1; i < arr.length; i++) {
        const it = arr[i];
        try {
          if (it.entry && it.entry.ws && typeof it.entry.ws.close === 'function') {
            try { it.entry.ws.close(); } catch (e) { }
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

export function getEventSeenOn(state, ev) {
  if (!ev) return [];

  const merged = [];
  const seen = new Set();

  function addRelay(url) {
    if (!url || typeof url !== 'string') return;
    const norm = normalizeUrl(url);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    merged.push(url.trim().replace(/\/+$/, '') || url);
  }

  if (Array.isArray(ev.seenOn)) {
    for (const r of ev.seenOn) {
      if (typeof r === 'string') addRelay(r);
      else if (r) addRelay(r.url || r.relay || r);
    }
  }

  if (state && state.pool && state.pool.seenOn && ev.id) {
    try {
      const poolSeen = state.pool.seenOn.get(ev.id);
      if (poolSeen) {
        for (const r of poolSeen) {
          if (typeof r === 'string') addRelay(r);
          else if (r) addRelay(r.url || r.relay || r);
        }
      }
    } catch (e) { }
  }

  return merged;
}

export function getBestRelayHint(state, ev) {
  if (!ev) return '';

  const seenOn = getEventSeenOn(state, ev);

  if (seenOn.length === 0) {
    return '';
  }

  try {
    const writeRelays = getWriteRelays(state.relays);
    for (const r of writeRelays) {
      const normalizedR = normalizeUrl(r);
      const found = seenOn.find(s => normalizeUrl(s) === normalizedR);
      if (found) return found;
    }
  } catch (e) { }

  try {
    const readRelays = getReadRelays(state.relays);
    for (const r of readRelays) {
      const normalizedR = normalizeUrl(r);
      const found = seenOn.find(s => normalizeUrl(s) === normalizedR);
      if (found) return found;
    }
  } catch (e) { }

  return seenOn[0] || '';
}
