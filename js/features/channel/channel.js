// ============================================================================
// NIP-28 チャンネルメタデータ（kind:40 / kind:41）取得・表示名解決
// ============================================================================

import { truncateName } from '../../utils/utils.js';
import { findEventById, cacheEvent } from '../../core/state.js';
import { getReadRelays, getEventSeenOn } from '../../core/relay.js';
import { getNip19 } from '../../core/nostr-compat.js';

const __labelCache = new Map();
const __inflight = new Map();

function normalizeRelayUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return null;
    return parsed.toString();
  } catch (e) {
    return null;
  }
}

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
  const fields = parseChannelContentFields(content);
  if (fields && fields.name) return fields.name;
  const trimmed = (content || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null;
  return truncateName(trimmed);
}

/**
 * kind:40 / kind:41 content JSON からプロファイル項目を抽出
 */
function parseChannelContentFields(content) {
  const trimmed = (content || '').trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out = {};
    const name = parsed.name || parsed.title || parsed.label;
    if (name && String(name).trim()) out.name = String(name).trim();
    if (parsed.about != null && String(parsed.about).trim()) out.about = String(parsed.about).trim();
    if (parsed.picture != null && String(parsed.picture).trim()) out.picture = String(parsed.picture).trim();
    if (Array.isArray(parsed.relays)) {
      const relays = [];
      const seen = new Set();
      for (const r of parsed.relays) {
        const normalizedRelay = normalizeRelayUrl(r);
        if (!normalizedRelay) continue;
        const key = normalizedRelay.replace(/\/+$/, '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        relays.push(normalizedRelay);
      }
      if (relays.length) out.relays = relays;
    }
    return Object.keys(out).length ? out : null;
  } catch (e) {
    return null;
  }
}

function pickNonEmptyString(...candidates) {
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function mergeRelayLists(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      const normalizedRelay = normalizeRelayUrl(r);
      if (!normalizedRelay) continue;
      const key = normalizedRelay.replace(/\/+$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalizedRelay);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

/**
 * kind:42 の e タグからチャンネル root 向け relay hint を拾う
 */
export function pickChannelRootRelayHints(ev, rootId) {
  if (!ev || !Array.isArray(ev.tags) || !rootId) return [];
  const hints = [];
  const seen = new Set();
  for (const tag of ev.tags) {
    if (!tag || tag[0] !== 'e' || tag[1] !== rootId) continue;
    const relay = normalizeRelayUrl(tag[2]);
    if (!relay) continue;
    const key = relay.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push(relay);
  }
  return hints;
}

/**
 * kind:41 優先で name / about / picture を解決。
 * relays は最新 kind:41 にあればそれだけ。無ければ kind:40 にフォールバック。
 */
export function extractChannelProfileFields(rootEvent, metaEvent) {
  const fromMeta = parseChannelContentFields(metaEvent && metaEvent.content);
  const fromRoot = parseChannelContentFields(rootEvent && rootEvent.content);
  const nameFromLabel = resolveChannelLabelFromEvents(rootEvent, metaEvent);

  const name = pickNonEmptyString(
    fromMeta && fromMeta.name,
    nameFromLabel,
    fromRoot && fromRoot.name,
  );
  const about = pickNonEmptyString(
    fromMeta && fromMeta.about,
    fromRoot && fromRoot.about,
  );
  const picture = pickNonEmptyString(
    fromMeta && fromMeta.picture,
    fromRoot && fromRoot.picture,
  );
  // 最新 41 の relays を正本とする（死にリレーを 40 から引きずらない）
  const relays = (fromMeta && Array.isArray(fromMeta.relays) && fromMeta.relays.length)
    ? fromMeta.relays.slice()
    : ((fromRoot && Array.isArray(fromRoot.relays) && fromRoot.relays.length) ? fromRoot.relays.slice() : []);

  const out = {};
  if (name) out.name = name;
  if (about) out.about = about;
  if (picture) out.picture = picture;
  if (relays.length) out.relays = relays;
  return out;
}

export function encodeChannelNevent(eventId, options = {}) {
  const normalizedEventId = (typeof eventId === 'string') ? eventId.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(normalizedEventId)) return null;
  let nevent = null;
  const relays = Array.isArray(options.relays) ? options.relays : [];
  const payload = { id: normalizedEventId, relays };
  if (options.author && typeof options.author === 'string') payload.author = options.author;
  try {
    const nip19local = getNip19 && getNip19();
    if (nip19local) {
      try {
        if (nip19local.nevent && typeof nip19local.nevent.encode === 'function') {
          nevent = nip19local.nevent.encode(payload);
        }
      } catch (e) { }
      try {
        if (!nevent && typeof nip19local.neventEncode === 'function') {
          nevent = nip19local.neventEncode(payload);
        }
      } catch (e) { }
    }
  } catch (e) { }
  if (!nevent) return null;
  return String(nevent).replace(/^nostr:/i, '');
}

/**
 * eHagaki composer.setContext / URL クエリ用の channel context を組み立てる
 */
export async function buildChannelEmbedContext(state, rootId, kind42Ev = null) {
  if (!rootId) return null;

  const meta = await fetchChannelMetadata(state, rootId);
  const rootEvent = (meta && meta.rootEvent) || findEventById(state, rootId) || null;
  const metaEvent = (meta && meta.metaEvent) || null;
  const profile = extractChannelProfileFields(rootEvent, metaEvent);

  const tagHints = pickChannelRootRelayHints(kind42Ev, rootId);
  let seenHints = [];
  try {
    if (state && rootEvent) {
      seenHints = getEventSeenOn(state, rootEvent) || [];
    }
  } catch (e) { }
  let readHints = [];
  try {
    if (state && state.relays) {
      readHints = getReadRelays(state.relays) || [];
    }
  } catch (e) { }

  const relays = mergeRelayLists(tagHints, profile.relays, seenHints, readHints);
  const reference = encodeChannelNevent(rootId, {
    relays,
    author: (rootEvent && typeof rootEvent.pubkey === 'string') ? rootEvent.pubkey : undefined,
  });
  if (!reference) return null;

  const channel = { reference };
  if (relays.length) channel.relays = relays;
  if (profile.name) channel.name = profile.name;
  else if (meta && meta.label) channel.name = meta.label;
  if (profile.about) channel.about = profile.about;
  if (profile.picture) channel.picture = profile.picture;
  return channel;
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

function isKind41FromCreator(ev, rootEvent) {
  if (!ev || ev.kind !== 41) return false;
  if (!rootEvent || typeof rootEvent.pubkey !== 'string' || !rootEvent.pubkey) {
    // root 未取得時は一旦受理し、後段で root 取得後に再フィルタする
    return true;
  }
  return typeof ev.pubkey === 'string' && ev.pubkey.toLowerCase() === rootEvent.pubkey.toLowerCase();
}

function pickNewerEvent(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return ((b.created_at || 0) > (a.created_at || 0)) ? b : a;
}

function findLatestKind41InCache(state, rootId, rootEvent = null) {
  let best = null;
  const effectiveRoot = rootEvent || findEventById(state, rootId);
  const consider = (ev) => {
    if (!ev || ev.kind !== 41 || !channelEventReferencesRoot(ev, rootId)) return;
    if (!isKind41FromCreator(ev, effectiveRoot)) return;
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

async function fetchLatestKind41(state, rootId, relays, rootEvent = null) {
  if (!state?.pool || !relays?.length) return findLatestKind41InCache(state, rootId, rootEvent);

  const cached = findLatestKind41InCache(state, rootId, rootEvent);
  const effectiveRoot = rootEvent || findEventById(state, rootId);

  if (typeof state.pool.subscribeMany !== 'function') {
    try {
      const ev = await state.pool.get(relays, { kinds: [41], '#e': [rootId], limit: 20 });
      if (ev && ev.kind === 41 && channelEventReferencesRoot(ev, rootId) && isKind41FromCreator(ev, effectiveRoot)) {
        cacheEvent(state, ev);
        return pickNewerEvent(cached, ev);
      }
    } catch (e) { }
    return cached;
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
      let best = cached;
      for (const ev of collected) {
        best = pickNewerEvent(best, ev);
      }
      resolve(best || null);
    };

    const timer = setTimeout(finish, 5000);
    try {
      unsub = state.pool.subscribeMany(relays, [{ kinds: [41], '#e': [rootId], limit: 50 }], {
        onevent(ev) {
          if (ev && ev.kind === 41 && channelEventReferencesRoot(ev, rootId) && isKind41FromCreator(ev, effectiveRoot)) {
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
  const metaEvent = findLatestKind41InCache(state, rootId, rootEvent);
  return resolveChannelLabelFromEvents(rootEvent, metaEvent) || null;
}

/**
 * kind:40 + 最新 kind:41 を取得して表示名を解決
 * キャッシュ命中時もネット取得し、新しい kind:41 があれば採用する
 */
export async function fetchChannelMetadata(state, rootId) {
  if (!rootId) return { label: null, rootEvent: null, metaEvent: null };

  if (__inflight.has(rootId)) return __inflight.get(rootId);

  const promise = (async () => {
    let rootEvent = findEventById(state, rootId);
    let metaEvent = findLatestKind41InCache(state, rootId, rootEvent);

    const relays = getReadRelays(state.relays);
    if (relays && relays.length > 0 && state.pool) {
      if (!rootEvent) {
        try {
          const fetched = await state.pool.get(relays, { ids: [rootId] });
          if (fetched) {
            cacheEvent(state, fetched);
            rootEvent = fetched;
            // root 取得後に作成者フィルタでキャッシュを見直す
            metaEvent = findLatestKind41InCache(state, rootId, rootEvent);
          }
        } catch (e) { }
      }
      try {
        const fetchedMeta = await fetchLatestKind41(state, rootId, relays, rootEvent);
        metaEvent = pickNewerEvent(metaEvent, fetchedMeta);
      } catch (e) { }
    }

    // 最終的に作成者以外の kind:41 を落とす
    if (metaEvent && rootEvent && !isKind41FromCreator(metaEvent, rootEvent)) {
      metaEvent = findLatestKind41InCache(state, rootId, rootEvent);
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

/** メタデータ更新後に表示名キャッシュを無効化 */
export function invalidateChannelLabelCache(rootId) {
  if (!rootId) {
    __labelCache.clear();
    return;
  }
  __labelCache.delete(rootId);
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
