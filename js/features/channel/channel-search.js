// ============================================================================
// チャンネル検索（kind:40/41/42 取得 + クライアント側絞り込み・アクティブ順ソート）
// NIP-50 search は非対応リレーで REQ 全体が拒否されるため使わない
// ============================================================================

import { getReadRelays } from '../../core/relay.js';
import { cacheEvent } from '../../core/state.js';
import { getNip19 } from '../../core/nostr-compat.js';
import {
  extractChannelProfileFields,
  fetchChannelMetadata,
  resolveChannelLabelFromEvents,
  shortenChannelEventId,
} from './channel.js';

const SEARCH_LIMIT = 150;
const SEARCH_TIMEOUT_MS = 5000;

function normalizeQuery(q) {
  return String(q || '').trim();
}

function normalizeRootId(id) {
  if (!id || typeof id !== 'string') return null;
  const hex = id.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/**
 * hex / nevent / note を rootId に解決（検索欄の ID 直入力用）
 */
export function resolveChannelRootIdInput(raw) {
  const trimmed = normalizeQuery(raw);
  if (!trimmed) return null;
  const asHex = normalizeRootId(trimmed);
  if (asHex) return asHex;

  const candidate = trimmed.replace(/^nostr:/i, '');
  try {
    const nip19 = getNip19();
    if (nip19 && typeof nip19.decode === 'function') {
      const decoded = nip19.decode(candidate);
      if (decoded && decoded.type === 'nevent') {
        return normalizeRootId(decoded.data && decoded.data.id);
      }
      if (decoded && decoded.type === 'note') {
        const id = typeof decoded.data === 'string' ? decoded.data : null;
        return normalizeRootId(id);
      }
    }
  } catch (_e) {}
  return null;
}

export function pickRootIdFromKind41(ev) {
  if (!ev || !Array.isArray(ev.tags)) return null;
  for (const tag of ev.tags) {
    if (tag && tag[0] === 'e' && tag[1] && (tag[3] || '').toString().toLowerCase() === 'root') {
      return normalizeRootId(tag[1]);
    }
  }
  for (const tag of ev.tags) {
    if (tag && tag[0] === 'e' && tag[1]) return normalizeRootId(tag[1]);
  }
  return null;
}

export function pickRootIdFromKind42(ev) {
  if (!ev || ev.kind !== 42 || !Array.isArray(ev.tags)) return null;
  for (const tag of ev.tags) {
    if (tag && tag[0] === 'e' && tag[1] && (tag[3] || '').toString().toLowerCase() === 'root') {
      return normalizeRootId(tag[1]);
    }
  }
  for (const tag of ev.tags) {
    if (tag && tag[0] === 'e' && tag[1]) return normalizeRootId(tag[1]);
  }
  return null;
}

function buildChannelRecord(rootId, rootEvent, metaEvent, lastMessageAt = 0) {
  const profile = extractChannelProfileFields(rootEvent, metaEvent);
  const label = resolveChannelLabelFromEvents(rootEvent, metaEvent);
  const name = (profile && profile.name) || label || shortenChannelEventId(rootId);
  const about = (profile && profile.about) || '';
  const haystack = [
    name,
    about,
    rootEvent && rootEvent.content,
    metaEvent && metaEvent.content,
  ].filter(Boolean).join('\n').toLowerCase();

  const created_at = Math.max(
    (rootEvent && rootEvent.created_at) || 0,
    (metaEvent && metaEvent.created_at) || 0,
  );
  const last_active_at = Math.max(lastMessageAt || 0, created_at || 0);

  return {
    rootId,
    name,
    about,
    relays: (profile && profile.relays) || null,
    created_at,
    last_message_at: lastMessageAt || 0,
    last_active_at,
    haystack,
  };
}

function matchesQuery(record, queryLower) {
  if (!queryLower) return true;
  return !!(record && record.haystack && record.haystack.includes(queryLower));
}

/**
 * 最初の oneose で打ち切ると空振りしやすいので、timeout まで収集する
 */
function collectViaSubscribe(state, relays, filter, timeoutMs) {
  return new Promise((resolve) => {
    const byId = new Map();
    let finished = false;
    let sub = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        if (sub && typeof sub.close === 'function') sub.close();
      } catch (_e) {}
      resolve(Array.from(byId.values()));
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      if (!state || !state.pool || typeof state.pool.subscribeMany !== 'function' || !relays.length) {
        clearTimeout(timer);
        finish();
        return;
      }
      sub = state.pool.subscribeMany(relays, [filter], {
        onevent(ev) {
          if (!ev || !ev.id) return;
          if (ev.kind !== 40 && ev.kind !== 41 && ev.kind !== 42) return;
          cacheEvent(state, ev);
          const prev = byId.get(ev.id);
          if (!prev || (ev.created_at || 0) >= (prev.created_at || 0)) {
            byId.set(ev.id, ev);
          }
        },
        // oneose では閉じない（先行リレーの空 EOSE で打ち切られるのを防ぐ）
        oneose() {},
      });
    } catch (_e) {
      clearTimeout(timer);
      finish();
    }
  });
}

async function collectChannelEvents(state, relays, timeoutMs) {
  const filter = { kinds: [40, 41, 42], limit: SEARCH_LIMIT };

  // querySync があれば優先（maxWait でまとめて待つ）
  if (state && state.pool && typeof state.pool.querySync === 'function') {
    try {
      const events = await state.pool.querySync(relays, filter, { maxWait: timeoutMs });
      if (Array.isArray(events) && events.length) {
        for (const ev of events) {
          try { cacheEvent(state, ev); } catch (_e) {}
        }
        return events.filter(ev => ev && (ev.kind === 40 || ev.kind === 41 || ev.kind === 42));
      }
    } catch (_e) {}
  }

  return collectViaSubscribe(state, relays, filter, timeoutMs);
}

async function assembleChannelRecords(state, events) {
  const byRoot = new Map(); // rootId -> { rootEvent, metaEvent, lastMessageAt }

  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.kind === 40 && ev.id) {
      const rootId = normalizeRootId(ev.id);
      if (!rootId) continue;
      const cur = byRoot.get(rootId) || {};
      if (!cur.rootEvent || (ev.created_at || 0) >= (cur.rootEvent.created_at || 0)) {
        cur.rootEvent = ev;
      }
      byRoot.set(rootId, cur);
    } else if (ev.kind === 41) {
      const rootId = pickRootIdFromKind41(ev);
      if (!rootId) continue;
      const cur = byRoot.get(rootId) || {};
      if (!cur.metaEvent || (ev.created_at || 0) >= (cur.metaEvent.created_at || 0)) {
        cur.metaEvent = ev;
      }
      byRoot.set(rootId, cur);
    } else if (ev.kind === 42) {
      const rootId = pickRootIdFromKind42(ev);
      if (!rootId) continue;
      const cur = byRoot.get(rootId) || {};
      cur.lastMessageAt = Math.max(cur.lastMessageAt || 0, ev.created_at || 0);
      byRoot.set(rootId, cur);
    }
  }

  // kind:42 メッセージはあるが kind:40/41 メタデータがまだないチャンネルを非同期で補完
  const unresolvedRoots = [];
  for (const [rootId, pair] of byRoot.entries()) {
    if (!pair.rootEvent && !pair.metaEvent) {
      unresolvedRoots.push(rootId);
    }
  }

  if (unresolvedRoots.length > 0 && state) {
    await Promise.allSettled(
      unresolvedRoots.slice(0, 30).map(async (rootId) => {
        try {
          const meta = await fetchChannelMetadata(state, rootId);
          if (meta) {
            const cur = byRoot.get(rootId) || {};
            if (meta.rootEvent) cur.rootEvent = meta.rootEvent;
            if (meta.metaEvent) cur.metaEvent = meta.metaEvent;
            byRoot.set(rootId, cur);
          }
        } catch (_e) {}
      }),
    );
  }

  const records = [];
  for (const [rootId, pair] of byRoot.entries()) {
    records.push(buildChannelRecord(
      rootId,
      pair.rootEvent || null,
      pair.metaEvent || null,
      pair.lastMessageAt || 0,
    ));
  }
  return records;
}

/**
 * キーワード / 空（直近一覧）でチャンネル候補を検索
 * 最新メッセージ (kind:42) またはメタデータが新しいチャンネル順にソート
 * @returns {Promise<{ results: Array, query: string, mode: 'browse'|'search' }>}
 */
export async function searchChannels(state, query, options = {}) {
  const q = normalizeQuery(query);
  const limit = typeof options.limit === 'number' ? options.limit : 20;
  const results = [];
  const seen = new Set();

  const pushResult = (item) => {
    if (!item || !item.rootId || seen.has(item.rootId)) return;
    seen.add(item.rootId);
    results.push(item);
  };

  const relays = (state && state.relays) ? getReadRelays(state.relays).slice(0, 4) : [];
  if (!relays.length) {
    return { results: [], query: q, mode: q ? 'search' : 'browse' };
  }

  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : SEARCH_TIMEOUT_MS;
  const events = await collectChannelEvents(state, relays, timeoutMs);
  const records = await assembleChannelRecords(state, events);
  const queryLower = q.toLowerCase();
  const mode = q ? 'search' : 'browse';

  const scored = records
    .filter(rec => matchesQuery(rec, queryLower))
    .map((rec) => {
      let score = rec.last_active_at || 0;
      if (queryLower) {
        const nameLower = (rec.name || '').toLowerCase();
        if (nameLower === queryLower) score += 1e11;
        else if (nameLower.startsWith(queryLower)) score += 5e10;
        else if (nameLower.includes(queryLower)) score += 1e10;
        else {
          const aboutLower = (rec.about || '').toLowerCase();
          if (aboutLower.includes(queryLower)) score += 5e9;
        }
      }
      return { ...rec, score, fromIdLookup: false };
    })
    .sort((a, b) => (b.score - a.score) || ((b.last_active_at || 0) - (a.last_active_at || 0)) || ((b.created_at || 0) - (a.created_at || 0)));

  for (const item of scored.slice(0, limit)) {
    pushResult(item);
  }

  return { results: results.slice(0, limit), query: q, mode };
}

