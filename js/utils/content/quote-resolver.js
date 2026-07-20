import { findEventById, cacheEvent } from '../../core/state.js';
import { getReadRelays } from '../../core/relay.js';
import { getNip19 } from './linkifier.js';

export const _quoteFetchInflight = new Map();
export const QUOTE_BATCH_TIMEOUT_MS = 4000;

export function relaySetKey(relays) {
  return (relays || []).slice().sort().join('\0');
}

export function resolveQuoteRelays(quoteEl, state) {
  const defaultRelays = sanitizeRelays(getReadRelays(state.relays));
  if (quoteEl && quoteEl.dataset && quoteEl.dataset.relays) {
    try {
      const relayHints = JSON.parse(quoteEl.dataset.relays);
      if (Array.isArray(relayHints) && relayHints.length > 0) {
        const sanitizedHints = sanitizeRelays(relayHints);
        if (sanitizedHints.length > 0) return sanitizedHints;
      }
    } catch (e) { }
  }
  return defaultRelays;
}

export function eventFetchKey(eventId, relays) {
  return `id:${eventId}:${relaySetKey(relays)}`;
}

export function naddrFetchKey(kind, pubkey, identifier, relays) {
  return `naddr:${kind}:${pubkey}:${identifier}:${relaySetKey(relays)}`;
}

export async function fetchQuoteEventById(state, relays, eventId) {
  if (!eventId || !state?.pool || !relays?.length) return null;
  const cached = findEventById(state, eventId);
  if (cached) return cached;

  const key = eventFetchKey(eventId, relays);
  if (_quoteFetchInflight.has(key)) return _quoteFetchInflight.get(key);

  const promise = state.pool.get(relays, { ids: [eventId] })
    .then((ev) => {
      if (ev) cacheEvent(state, ev);
      return ev || null;
    })
    .catch(() => null)
    .finally(() => {
      _quoteFetchInflight.delete(key);
    });

  _quoteFetchInflight.set(key, promise);
  return promise;
}

export async function fetchQuoteEventByNaddr(state, relays, kind, pubkey, identifier) {
  if (!state?.pool || !relays?.length || isNaN(kind) || !pubkey || identifier === undefined) return null;

  const key = naddrFetchKey(kind, pubkey, identifier, relays);
  if (_quoteFetchInflight.has(key)) return _quoteFetchInflight.get(key);

  const promise = state.pool.get(relays, { authors: [pubkey], kinds: [kind], '#d': [identifier] })
    .then((ev) => {
      if (ev) cacheEvent(state, ev);
      return ev || null;
    })
    .catch(() => null)
    .finally(() => {
      _quoteFetchInflight.delete(key);
    });

  _quoteFetchInflight.set(key, promise);
  return promise;
}

export async function prefetchQuoteEventIds(state, relays, eventIds) {
  const uniqueIds = [...new Set(eventIds)].filter(Boolean);
  const missing = uniqueIds.filter((id) => {
    if (findEventById(state, id)) return false;
    if (_quoteFetchInflight.has(eventFetchKey(id, relays))) return false;
    return true;
  });

  if (!missing.length) {
    await Promise.all(uniqueIds.map((id) => {
      const inflight = _quoteFetchInflight.get(eventFetchKey(id, relays));
      return inflight || Promise.resolve();
    }));
    return;
  }

  if (missing.length === 1) {
    await fetchQuoteEventById(state, relays, missing[0]);
    return;
  }

  const batchKey = `batch:${relaySetKey(relays)}:${missing.slice().sort().join(',')}`;
  if (_quoteFetchInflight.has(batchKey)) {
    await _quoteFetchInflight.get(batchKey);
    return;
  }

  let finishBatch;
  const batchPromise = new Promise((resolve) => { finishBatch = resolve; });
  _quoteFetchInflight.set(batchKey, batchPromise);

  for (const id of missing) {
    const ikey = eventFetchKey(id, relays);
    if (_quoteFetchInflight.has(ikey)) continue;
    const tracked = batchPromise
      .then(() => findEventById(state, id) || null)
      .finally(() => { _quoteFetchInflight.delete(ikey); });
    _quoteFetchInflight.set(ikey, tracked);
  }

  const pending = new Set(missing);
  let unsub = null;
  const timer = setTimeout(done, QUOTE_BATCH_TIMEOUT_MS);
  function done() {
    clearTimeout(timer);
    try { if (typeof unsub === 'function') unsub(); } catch (e) { }
    finishBatch();
    _quoteFetchInflight.delete(batchKey);
  }

  try {
    unsub = state.pool.subscribeMany(relays, [{ ids: missing }], {
      onevent(ev) {
        if (!ev?.id || !pending.has(ev.id)) return;
        pending.delete(ev.id);
        cacheEvent(state, ev);
        if (pending.size === 0) done();
      },
      oneose: done
    });
  } catch (e) {
    done();
  }

  await batchPromise;
}

export async function prefetchQuotesForElements(state, quoteElements) {
  const prefetchByRelay = new Map();

  for (const quoteEl of quoteElements) {
    const eventId = quoteEl.dataset.eventId;
    const naddrKind = quoteEl.dataset.naddrKind;
    const ownerEventEl = quoteEl.closest && quoteEl.closest('.event[data-event-id]');
    const ownerEventId = ownerEventEl && ownerEventEl.dataset ? ownerEventEl.dataset.eventId : null;
    if (eventId && ownerEventId && ownerEventId === eventId) continue;
    if (!eventId && !naddrKind) continue;

    const relays = resolveQuoteRelays(quoteEl, state);
    if (!relays.length) continue;
    const rk = relaySetKey(relays);
    if (!prefetchByRelay.has(rk)) {
      prefetchByRelay.set(rk, { relays, ids: [], naddrs: [] });
    }
    const group = prefetchByRelay.get(rk);

    if (eventId) {
      group.ids.push(eventId);
    } else if (naddrKind) {
      const kind = parseInt(naddrKind, 10);
      const pubkey = quoteEl.dataset.naddrPubkey;
      const identifier = quoteEl.dataset.naddrIdentifier;
      if (!isNaN(kind) && pubkey && identifier !== undefined) {
        group.naddrs.push({ kind, pubkey, identifier });
      }
    }
  }

  const tasks = [];
  for (const { relays, ids, naddrs } of prefetchByRelay.values()) {
    if (ids.length) tasks.push(prefetchQuoteEventIds(state, relays, ids));
    for (const na of naddrs) {
      tasks.push(fetchQuoteEventByNaddr(state, relays, na.kind, na.pubkey, na.identifier));
    }
  }
  if (tasks.length) await Promise.all(tasks);
}

export function sanitizeRelays(relays) {
  if (!Array.isArray(relays)) return [];
  return relays.filter(r => {
    try {
      if (typeof r !== 'string') return false;
      const trimmed = r.trim();
      if (!trimmed) return false;
      const u = new URL(trimmed);
      return u.protocol === 'ws:' || u.protocol === 'wss:';
    } catch (e) {
      return false;
    }
  });
}
