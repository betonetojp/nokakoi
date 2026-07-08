// ============================================================================
// NIP-28 チャンネルメタデータ（kind:40 / kind:41）取得・表示名解決
// ============================================================================

import { truncateName } from './utils.js';
import { findEventById, cacheEvent } from './state.js';
import { getReadRelays } from './relay.js';

const __labelCache = new Map();
const __inflight = new Map();

export function shortenChannelEventId(id) {
  if (!id) return '';
  if (id.length < 12) return id;
  return id.substring(0, 6) + '…' + id.substring(id.length - 6);
}

/**
 * kind:42 のチャンネル root（kind:40）イベント ID を取得
 */
export function pickChannelRootId(ev) {
  if (!ev || ev.kind !== 42 || !Array.isArray(ev.tags)) return null;
  const eTags = (ev.tags || []).filter(t => t && t[0] === 'e' && t[1]);
  if (!eTags.length) return null;
  for (const tag of eTags) {
    try {
      if ((tag[3] || '').toString().toLowerCase() === 'root') return tag[1];
    } catch (e) { }
  }
  return eTags[0][1];
}

/**
 * 単一イベントからチャンネル表示名を抽出
 */
function extractChannelNameFromContent(content) {
  const trimmed = (content || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const name = parsed.name || parsed.title || parsed.label;
        if (name && String(name).trim()) return String(name).trim();
        return null;
      }
    } catch (e) { /* パース失敗時は通常テキストへ */ }
  }
  return truncateName(trimmed);
}

export function resolveChannelLabelFromEvent(ev) {
  if (!ev) return null;
  const tags = ev.tags || [];
  const nameTag = tags.find(tag => tag && tag[0] === 'name' && tag[1]);
  if (nameTag && nameTag[1]) {
    const raw = String(nameTag[1]).trim();
    const fromTag = raw.startsWith('{') ? extractChannelNameFromContent(raw) : raw;
    if (fromTag) return fromTag;
  }
  const dTag = tags.find(tag => tag && tag[0] === 'd' && tag[1]);
  if (dTag && dTag[1]) return String(dTag[1]).trim();
  const fromContent = extractChannelNameFromContent(ev.content);
  if (fromContent) return fromContent;
  return null;
}

/**
 * kind:41 を優先して表示名を解決
 */
export function resolveChannelLabelFromEvents(rootEvent, metaEvent) {
  const fromMeta = resolveChannelLabelFromEvent(metaEvent);
  if (fromMeta) return fromMeta;
  return resolveChannelLabelFromEvent(rootEvent);
}

function channelEventReferencesRoot(ev, rootId) {
  if (!ev || !rootId || !Array.isArray(ev.tags)) return false;
  return ev.tags.some(tag => tag && tag[0] === 'e' && tag[1] === rootId);
}

function findLatestKind41InCache(state, rootId) {
  let best = null;
  const consider = (ev) => {
    if (!ev || ev.kind !== 41 || !channelEventReferencesRoot(ev, rootId)) return;
    if (!best || (ev.created_at || 0) > (best.created_at || 0)) best = ev;
  };
  try {
    if (state && state.feeds) {
      for (const feedName in state.feeds) {
        const feed = state.feeds[feedName];
        if (!feed || !feed.map) continue;
        for (const ev of feed.map.values()) consider(ev);
      }
    }
    if (state && state.eventCache) {
      for (const ev of state.eventCache.values()) consider(ev);
    }
  } catch (e) { }
  return best;
}

async function fetchLatestKind41(state, rootId, relays) {
  if (!state?.pool || !relays?.length) return findLatestKind41InCache(state, rootId);

  const cached = findLatestKind41InCache(state, rootId);
  if (cached) return cached;

  if (typeof state.pool.subscribeMany !== 'function') {
    try {
      const ev = await state.pool.get(relays, { kinds: [41], '#e': [rootId], limit: 20 });
      if (ev && ev.kind === 41) {
        cacheEvent(state, ev);
        return ev;
      }
    } catch (e) { }
    return null;
  }

  return new Promise((resolve) => {
    const collected = [];
    let unsub = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        if (unsub && typeof unsub.close === 'function') unsub.close();
      } catch (e) { }
      if (!collected.length) {
        resolve(null);
        return;
      }
      let best = collected[0];
      for (const ev of collected) {
        if ((ev.created_at || 0) > (best.created_at || 0)) best = ev;
      }
      resolve(best);
    };

    const timer = setTimeout(finish, 5000);
    try {
      unsub = state.pool.subscribeMany(relays, [{ kinds: [41], '#e': [rootId], limit: 50 }], {
        onevent(ev) {
          if (ev && ev.kind === 41 && channelEventReferencesRoot(ev, rootId)) {
            cacheEvent(state, ev);
            collected.push(ev);
          }
        },
        oneose() {
          clearTimeout(timer);
          finish();
        },
        eoseTimeout: 4000,
      });
    } catch (e) {
      clearTimeout(timer);
      finish();
    }
  });
}

/**
 * キャッシュのみで表示名を解決（未取得時は null）
 */
export function getChannelLabelFromCache(state, rootId) {
  if (!rootId) return null;
  if (__labelCache.has(rootId)) return __labelCache.get(rootId);

  const rootEvent = findEventById(state, rootId);
  const metaEvent = findLatestKind41InCache(state, rootId);
  return resolveChannelLabelFromEvents(rootEvent, metaEvent) || null;
}

/**
 * kind:40 + 最新 kind:41 を取得して表示名を解決
 */
export async function fetchChannelMetadata(state, rootId) {
  if (!rootId) return { label: null, rootEvent: null, metaEvent: null };

  if (__labelCache.has(rootId)) {
    return {
      label: __labelCache.get(rootId),
      rootEvent: findEventById(state, rootId),
      metaEvent: findLatestKind41InCache(state, rootId),
    };
  }

  if (__inflight.has(rootId)) return __inflight.get(rootId);

  const promise = (async () => {
    let rootEvent = findEventById(state, rootId);
    let metaEvent = findLatestKind41InCache(state, rootId);

    const relays = getReadRelays(state.relays);
    if (relays && relays.length > 0 && state.pool) {
      if (!rootEvent) {
        try {
          const fetched = await state.pool.get(relays, { ids: [rootId] });
          if (fetched) {
            cacheEvent(state, fetched);
            rootEvent = fetched;
          }
        } catch (e) { }
      }
      if (!metaEvent) {
        try {
          metaEvent = await fetchLatestKind41(state, rootId, relays);
        } catch (e) { }
      }
    }

    const label = resolveChannelLabelFromEvents(rootEvent, metaEvent);
    if (label) __labelCache.set(rootId, label);
    return { label: label || null, rootEvent, metaEvent };
  })().finally(() => {
    __inflight.delete(rootId);
  });

  __inflight.set(rootId, promise);
  return promise;
}

/** fire-and-forget でメタデータを先読み */
export function prefetchChannelMetadata(state, rootId) {
  if (!rootId) return;
  if (__labelCache.has(rootId)) return;
  fetchChannelMetadata(state, rootId).catch(() => { });
}

export function formatChannelLabelText(knownName, rootId) {
  if (knownName) return knownName;
  if (rootId) return shortenChannelEventId(rootId);
  return '?';
}

/**
 * チャンネルラベル要素のテキストを更新
 */
export function applyChannelLabelText(labelEl, knownName, rootId) {
  if (!labelEl) return;
  labelEl.textContent = formatChannelLabelText(knownName, rootId);
}

/**
 * kind:42 カード内のチャンネルラベルを非同期更新
 */
export function scheduleChannelLabelUpdate(state, rootId, containerEl) {
  if (!state || !rootId || !containerEl) return;
  if (__labelCache.has(rootId)) return;

  fetchChannelMetadata(state, rootId).then((meta) => {
    try {
      if (!meta || !meta.label) return;
      const labelEl = containerEl.querySelector('.channel-label[data-channel-root-id="' + rootId + '"]');
      if (!labelEl) return;
      applyChannelLabelText(labelEl, meta.label, rootId);
    } catch (e) { }
  }).catch(() => { });
}
