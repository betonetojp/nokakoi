import { findEventById, cacheEvent } from '../../core/state.js';
import { getReadRelays } from '../../core/relay.js';
import { subOnce } from '../../core/relay/relay-subscription.js';
import { getNip19 } from './linkifier.js';

export const _quoteFetchInflight = new Map();
export const _quoteIdBatches = new Map();
export const QUOTE_BATCH_TIMEOUT_MS = 4000;
export const QUOTE_BATCH_WINDOW_MS = 30;

const objectIds = new WeakMap();
const idPromiseEntries = new WeakMap();
let nextObjectId = 1;

function objectIdentity(value) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return String(value);
  }
  if (!objectIds.has(value)) objectIds.set(value, nextObjectId++);
  return String(objectIds.get(value));
}

export function relaySetKey(relays) {
  return Array.from(new Set((relays || [])
    .map(relay => typeof relay === 'string' ? relay.trim().replace(/\/+$/, '') : '')
    .filter(Boolean)))
    .sort()
    .join('\0');
}

export function resolveQuoteRelays(quoteEl, state) {
  const defaultRelays = sanitizeRelays(getReadRelays(state.relays));
  if (quoteEl && quoteEl.dataset) {
    if (quoteEl.dataset.relays) {
      try {
        const relayHints = JSON.parse(quoteEl.dataset.relays);
        if (Array.isArray(relayHints) && relayHints.length > 0) {
          const sanitizedHints = sanitizeRelays(relayHints);
          if (sanitizedHints.length > 0) return sanitizedHints;
        }
      } catch (e) { }
    }
    if (quoteEl.dataset.relayHint) {
      const sanitized = sanitizeRelays([quoteEl.dataset.relayHint]);
      if (sanitized.length > 0) return sanitized;
    }
  }
  return defaultRelays;
}

export function eventFetchKey(eventId, relays) {
  return `id:${eventId}:${relaySetKey(relays)}`;
}

export function naddrFetchKey(kind, pubkey, identifier, relays) {
  return `naddr:${kind}:${pubkey}:${identifier}:${relaySetKey(relays)}`;
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  const input = String(value);
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function captureContext(state) {
  const pool = state?.pool || null;
  const account = state?.pubkey || null;
  const memoryKey = `${objectIdentity(state)}\0${objectIdentity(pool)}\0${account || ''}`;
  return { state, pool, account, memoryKey };
}

function isContextCurrent(context) {
  return context.state?.pool === context.pool &&
    (context.state?.pubkey || null) === context.account;
}

function safeSubscriptionKey(type, relayKey, requestKey) {
  return `quote:${type}:${stableHash(relayKey)}:${stableHash(requestKey)}`;
}

function waitWithSignal(promise, signal) {
  if (!signal || typeof signal.addEventListener !== 'function') return promise;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      try { signal.removeEventListener('abort', onAbort); } catch (e) { }
      resolve(value);
    };
    const onAbort = () => finish(null);
    try { signal.addEventListener('abort', onAbort, { once: true }); } catch (e) { }
    promise.then(finish, () => finish(null));
  });
}

function managedFirstEvent(state, key, relays, filter, matches, options = {}, context = captureContext(state)) {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = null;
    let unsubscribeCalled = false;
    const signal = options?.signal;
    const safeUnsubscribe = () => {
      if (unsubscribeCalled || typeof unsubscribe !== 'function') return;
      unsubscribeCalled = true;
      try { unsubscribe(); } catch (e) { }
    };
    const finish = (event = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') {
        try { signal.removeEventListener('abort', onAbort); } catch (e) { }
      }
      safeUnsubscribe();
      resolve(event);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), QUOTE_BATCH_TIMEOUT_MS);

    if (signal?.aborted) {
      finish(null);
      return;
    }
    if (signal && typeof signal.addEventListener === 'function') {
      try { signal.addEventListener('abort', onAbort, { once: true }); } catch (e) { }
    }

    try {
      unsubscribe = subOnce(state, key, [filter], (event, _relay, done) => {
        if (!isContextCurrent(context)) {
          finish(null);
        } else if (event && matches(event)) {
          cacheEvent(state, event);
          finish(event);
        } else if (done) {
          finish(null);
        }
      }, relays);
      // A synchronous event/EOSE may settle before subOnce returns its handle.
      if (settled) safeUnsubscribe();
    } catch (e) {
      finish(null);
    }
  });
}

function settleBatchEntry(batch, id, event) {
  const entry = batch.entries.get(id);
  if (!entry || entry.settled) return;
  entry.settled = true;
  batch.pending.delete(id);
  if (_quoteFetchInflight.get(entry.inflightKey) === entry.promise) {
    _quoteFetchInflight.delete(entry.inflightKey);
  }
  entry.resolve(event || null);
}

function finishIdBatch(batch) {
  if (batch.settled) return;
  batch.settled = true;
  if (batch.timer) clearTimeout(batch.timer);
  if (batch.timeout) clearTimeout(batch.timeout);
  if (typeof batch.unsubscribe === 'function' && !batch.unsubscribeCalled) {
    batch.unsubscribeCalled = true;
    try { batch.unsubscribe(); } catch (e) { }
  }
  for (const id of batch.pending) settleBatchEntry(batch, id, null);
}

function startIdBatch(batch) {
  batch.timer = null;
  _quoteIdBatches.delete(batch.key);
  const ids = [...batch.entries.entries()]
    .filter(([, entry]) => !entry.settled)
    .map(([id]) => id)
    .sort();
  batch.pending = new Set(ids);
  if (!ids.length) {
    finishIdBatch(batch);
    return;
  }
  if (!isContextCurrent(batch.context)) {
    finishIdBatch(batch);
    return;
  }

  batch.timeout = setTimeout(() => finishIdBatch(batch), QUOTE_BATCH_TIMEOUT_MS);
  try {
    batch.unsubscribe = subOnce(
      batch.state,
      safeSubscriptionKey('ids', batch.relayKey, ids.join(',')),
      [{ ids }],
      (event, _relay, done) => {
        if (!isContextCurrent(batch.context)) {
          finishIdBatch(batch);
          return;
        }
        if (event?.id && batch.pending.has(event.id)) {
          cacheEvent(batch.state, event);
          settleBatchEntry(batch, event.id, event);
          if (batch.pending.size === 0) finishIdBatch(batch);
        }
        if (done) finishIdBatch(batch);
      },
      batch.relays
    );
    if (batch.settled && typeof batch.unsubscribe === 'function' && !batch.unsubscribeCalled) {
      batch.unsubscribeCalled = true;
      try { batch.unsubscribe(); } catch (e) { }
    }
  } catch (e) {
    finishIdBatch(batch);
  }
}

function getSharedIdEntry(state, relays, eventId) {
  const relayKey = relaySetKey(relays);
  const context = captureContext(state);
  const inflightKey = `${context.memoryKey}\0${eventFetchKey(eventId, relays)}`;
  const existing = _quoteFetchInflight.get(inflightKey);
  if (existing) return idPromiseEntries.get(existing);

  const batchKey = `${context.memoryKey}\0${relayKey}`;
  let batch = _quoteIdBatches.get(batchKey);
  if (!batch) {
    batch = {
      key: batchKey,
      state,
      relays,
      relayKey,
      context,
      entries: new Map(),
      pending: new Set(),
      timer: null,
      timeout: null,
      unsubscribe: null,
      unsubscribeCalled: false,
      settled: false
    };
    batch.timer = setTimeout(() => startIdBatch(batch), QUOTE_BATCH_WINDOW_MS);
    _quoteIdBatches.set(batchKey, batch);
  }

  let resolveEntry;
  const promise = new Promise(resolve => { resolveEntry = resolve; })
    .finally(() => {
      if (_quoteFetchInflight.get(inflightKey) === promise) {
        _quoteFetchInflight.delete(inflightKey);
      }
    });
  const entry = {
    id: eventId,
    resolve: resolveEntry,
    settled: false,
    inflightKey,
    promise,
    batch,
    waiters: 0
  };
  batch.entries.set(eventId, entry);
  idPromiseEntries.set(promise, entry);
  _quoteFetchInflight.set(inflightKey, promise);
  return entry;
}

function cancelIdEntryIfUnused(entry) {
  if (!entry || entry.settled || entry.waiters > 0) return;
  const batch = entry.batch;
  settleBatchEntry(batch, entry.id, null);
  if (batch.timer && [...batch.entries.values()].every(candidate => candidate.settled)) {
    _quoteIdBatches.delete(batch.key);
    finishIdBatch(batch);
  } else if (!batch.timer && batch.pending.size === 0) {
    finishIdBatch(batch);
  }
}

function waitForIdEntry(entry, signal) {
  entry.waiters++;
  return new Promise(resolve => {
    let settled = false;
    const finish = (value, cancelled = false) => {
      if (settled) return;
      settled = true;
      entry.waiters = Math.max(0, entry.waiters - 1);
      if (signal && typeof signal.removeEventListener === 'function') {
        try { signal.removeEventListener('abort', onAbort); } catch (e) { }
      }
      if (cancelled) cancelIdEntryIfUnused(entry);
      resolve(value);
    };
    const onAbort = () => finish(null, true);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (signal && typeof signal.addEventListener === 'function') {
      try { signal.addEventListener('abort', onAbort, { once: true }); } catch (e) { }
    }
    entry.promise.then(value => finish(value), () => finish(null));
  });
}

export async function fetchQuoteEventById(state, relays, eventId, options = {}) {
  if (!eventId || !state?.pool || !relays?.length) return null;
  const cached = findEventById(state, eventId);
  if (cached) return cached;
  return waitForIdEntry(getSharedIdEntry(state, relays, eventId), options?.signal);
}

export async function fetchQuoteEventByNaddr(state, relays, kind, pubkey, identifier, options = {}) {
  if (!state?.pool || !relays?.length || isNaN(kind) || !pubkey || identifier === undefined) return null;

  const context = captureContext(state);
  const key = naddrFetchKey(kind, pubkey, identifier, relays);
  const inflightKey = `${context.memoryKey}\0${key}`;
  if (_quoteFetchInflight.has(inflightKey)) {
    return waitWithSignal(_quoteFetchInflight.get(inflightKey), options?.signal);
  }

  const promise = managedFirstEvent(
    state,
    safeSubscriptionKey('naddr', relaySetKey(relays), key),
    relays,
    { authors: [pubkey], kinds: [kind], '#d': [identifier] },
    event => event?.kind === kind && event?.pubkey === pubkey &&
      Array.isArray(event.tags) && event.tags.some(tag => tag?.[0] === 'd' && tag?.[1] === identifier),
    options,
    context
  )
    .finally(() => {
      if (_quoteFetchInflight.get(inflightKey) === promise) {
        _quoteFetchInflight.delete(inflightKey);
      }
    });

  _quoteFetchInflight.set(inflightKey, promise);
  return waitWithSignal(promise, options?.signal);
}

export async function prefetchQuoteEventIds(state, relays, eventIds, options = {}) {
  const uniqueIds = [...new Set(eventIds)].filter(Boolean);
  const missing = uniqueIds.filter(id => !findEventById(state, id));
  const fetched = await Promise.all(
    missing.map(id => fetchQuoteEventById(state, relays, id, options))
  );
  if (options && typeof options.onEvent === 'function') {
    for (const event of fetched) {
      if (!event) continue;
      try { options.onEvent(event); } catch (e) { }
    }
  }
}

export async function prefetchQuotesForElements(state, quoteElements, options = {}) {
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
    if (ids.length) tasks.push(prefetchQuoteEventIds(state, relays, ids, options));
    for (const na of naddrs) {
      tasks.push(fetchQuoteEventByNaddr(state, relays, na.kind, na.pubkey, na.identifier, options));
    }
  }
  if (tasks.length) await Promise.all(tasks);
}

export function sanitizeRelays(relays) {
  if (!Array.isArray(relays)) return [];
  const sanitized = relays.map(r => {
    try {
      if (typeof r !== 'string') return null;
      const trimmed = r.trim().replace(/\/+$/, '');
      if (!trimmed) return null;
      const u = new URL(trimmed);
      return (u.protocol === 'ws:' || u.protocol === 'wss:') ? trimmed : null;
    } catch (e) {
      return null;
    }
  });
  return Array.from(new Set(sanitized.filter(Boolean)));
}
