import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppState: vi.fn(),
  getRelayFromPool: vi.fn()
}));

vi.mock('../../core/app-context.js', () => ({
  getAppState: mocks.getAppState,
  setRelayInspector: vi.fn()
}));
vi.mock('../../core/relay.js', () => ({
  getReadRelays: vi.fn(() => ['wss://relay.example'])
}));
vi.mock('../../core/relay/relay-helpers.js', () => ({
  getReadRelays: vi.fn(() => ['wss://relay.example']),
  normalizeUrl: vi.fn(url => typeof url === 'string' ? url.trim().replace(/\/+$/, '') : url)
}));
vi.mock('../../core/relay/relay-connection.js', () => ({
  getRelayFromPool: mocks.getRelayFromPool
}));
vi.mock('../../core/relay/relay-state.js', () => ({
  debugRelay: vi.fn(),
  relayStates: new Map()
}));
vi.mock('../../core/state.js', () => ({
  findEventById: vi.fn((state, id) => state.eventCache?.get(id) || null),
  cacheEvent: vi.fn((state, event) => {
    if (!state.eventCache) state.eventCache = new Map();
    state.eventCache.set(event.id, event);
  })
}));
vi.mock('./linkifier.js', () => ({ getNip19: vi.fn() }));

import {
  pendingLogicalSubscriptions,
  relayActiveCounts,
  relayCooldownUntil,
  subscribeQueue
} from '../../core/relay/relay-subscription.js';
import {
  _quoteFetchInflight,
  _quoteIdBatches,
  fetchQuoteEventById,
  fetchQuoteEventByNaddr,
  prefetchQuoteEventIds,
  QUOTE_BATCH_WINDOW_MS,
  relaySetKey
} from './quote-resolver.js';

function createState() {
  const subscriptions = [];
  const rawClose = vi.fn(() => Promise.resolve());
  const pool = {
    get: vi.fn(() => {
      throw new Error('quote resolver must not call pool.get');
    }),
    subscribeMany: vi.fn((relays, filters, handlers) => {
      subscriptions.push({ relays, filters, handlers });
      return { close: rawClose };
    })
  };
  const state = {
    pool,
    relays: ['wss://relay.example'],
    subs: new Map(),
    eventCache: new Map()
  };
  mocks.getAppState.mockReturnValue(state);
  return { state, pool, rawClose, subscriptions };
}

async function finishCloseCooldown() {
  await Promise.resolve();
  vi.advanceTimersByTime(250);
}

describe('managed quote resolution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribeQueue.splice(0);
    pendingLogicalSubscriptions.clear();
    relayCooldownUntil.clear();
    relayActiveCounts.live.clear();
    relayActiveCounts.oneshot.clear();
    _quoteFetchInflight.clear();
    _quoteIdBatches.clear();
    globalThis.WebSocket = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
    globalThis.window = { __nostrState: null, addEventListener: vi.fn() };
    globalThis.document = { querySelector: vi.fn(() => ({ dataset: { tab: 'home' } })) };
    mocks.getRelayFromPool.mockReturnValue({ ws: { readyState: WebSocket.OPEN } });
  });

  afterEach(() => {
    subscribeQueue.splice(0);
    pendingLogicalSubscriptions.clear();
    relayCooldownUntil.clear();
    _quoteFetchInflight.clear();
    for (const batch of _quoteIdBatches.values()) {
      if (batch.timer) clearTimeout(batch.timer);
      if (batch.timeout) clearTimeout(batch.timeout);
    }
    _quoteIdBatches.clear();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('combines render-burst IDs and duplicate waiters into one managed request', async () => {
    const { state, pool, subscriptions } = createState();
    const firstEvents = vi.fn();
    const secondEvents = vi.fn();
    const ids = Array.from({ length: 15 }, (_, index) => `id-${index}`);

    const first = prefetchQuoteEventIds(
      state,
      ['wss://relay.example/'],
      ids.slice(0, 8),
      { onEvent: firstEvents }
    );
    const second = prefetchQuoteEventIds(
      state,
      ['wss://relay.example'],
      ids.slice(7),
      { onEvent: secondEvents }
    );
    const duplicateFirst = fetchQuoteEventById(state, [' wss://relay.example '], 'id-7');
    const duplicateSecond = fetchQuoteEventById(state, ['wss://relay.example/'], 'id-7');

    expect(pool.subscribeMany).not.toHaveBeenCalled();
    vi.advanceTimersByTime(QUOTE_BATCH_WINDOW_MS);
    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    expect(subscribeQueue).toHaveLength(0);
    expect(subscriptions[0].filters).toEqual([{ ids: ids.slice().sort() }]);

    const duplicateEvent = { id: 'id-7', kind: 1 };
    subscriptions[0].handlers.onevent(duplicateEvent, 'wss://relay.example');
    await expect(duplicateFirst).resolves.toBe(duplicateEvent);
    await expect(duplicateSecond).resolves.toBe(duplicateEvent);
    subscriptions[0].handlers.oneose('wss://relay.example');
    await Promise.all([first, second]);

    expect(firstEvents).toHaveBeenCalledTimes(1);
    expect(secondEvents).toHaveBeenCalledTimes(1);
    expect(state.eventCache.get('id-7')).toBe(duplicateEvent);
    expect(_quoteFetchInflight.size).toBe(0);
    expect(_quoteIdBatches.size).toBe(0);
    expect(pool.get).not.toHaveBeenCalled();
  });

  it('coalesces duplicate id and naddr reads using normalized relay identities', async () => {
    const { state, pool, subscriptions } = createState();
    expect(relaySetKey(['wss://b.example/', ' wss://a.example ', 'wss://b.example']))
      .toBe('wss://a.example\0wss://b.example');

    const idFirst = fetchQuoteEventById(state, ['wss://relay.example/'], 'same-id');
    const idSecond = fetchQuoteEventById(state, [' wss://relay.example '], 'same-id');
    vi.advanceTimersByTime(QUOTE_BATCH_WINDOW_MS);
    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);

    const idEvent = { id: 'same-id', kind: 1 };
    subscriptions[0].handlers.onevent(idEvent, 'wss://relay.example');
    await expect(idFirst).resolves.toBe(idEvent);
    await expect(idSecond).resolves.toBe(idEvent);

    await finishCloseCooldown();
    const naddrFirst = fetchQuoteEventByNaddr(
      state, ['wss://relay.example/'], 30023, 'author', 'article'
    );
    const naddrSecond = fetchQuoteEventByNaddr(
      state, ['wss://relay.example'], 30023, 'author', 'article'
    );
    expect(pool.subscribeMany).toHaveBeenCalledTimes(2);

    const naddrEvent = {
      id: 'naddr-id',
      kind: 30023,
      pubkey: 'author',
      tags: [['d', 'article']]
    };
    subscriptions[1].handlers.onevent(naddrEvent, 'wss://relay.example');
    await expect(naddrFirst).resolves.toBe(naddrEvent);
    await expect(naddrSecond).resolves.toBe(naddrEvent);
    expect(pool.get).not.toHaveBeenCalled();
  });

  it('settles safely on EOSE, timeout, and cancellation', async () => {
    const { state, pool, rawClose, subscriptions } = createState();

    const eose = fetchQuoteEventById(state, ['wss://relay.example'], 'eose-id');
    vi.advanceTimersByTime(QUOTE_BATCH_WINDOW_MS);
    subscriptions[0].handlers.oneose('wss://relay.example');
    await expect(eose).resolves.toBeNull();
    await finishCloseCooldown();

    const timeout = fetchQuoteEventById(state, ['wss://relay.example'], 'timeout-id');
    vi.advanceTimersByTime(QUOTE_BATCH_WINDOW_MS);
    vi.advanceTimersByTime(4000);
    await expect(timeout).resolves.toBeNull();
    await finishCloseCooldown();

    const controller = new AbortController();
    const cancelled = fetchQuoteEventById(
      state,
      ['wss://relay.example'],
      'cancelled-id',
      { signal: controller.signal }
    );
    controller.abort();
    await expect(cancelled).resolves.toBeNull();
    vi.advanceTimersByTime(QUOTE_BATCH_WINDOW_MS);

    expect(pool.subscribeMany).toHaveBeenCalledTimes(2);
    expect(pool.get).not.toHaveBeenCalled();
    expect(rawClose).toHaveBeenCalledTimes(2);
    expect(_quoteFetchInflight.size).toBe(0);
    expect(_quoteIdBatches.size).toBe(0);
  });

  it('settles missing IDs on EOSE and keeps materially different relay sets separate', async () => {
    const { state, pool, subscriptions } = createState();
    const first = fetchQuoteEventById(state, ['wss://one.example'], 'missing');
    const second = fetchQuoteEventById(state, ['wss://two.example'], 'missing');

    vi.advanceTimersByTime(QUOTE_BATCH_WINDOW_MS);

    expect(pool.subscribeMany).toHaveBeenCalledTimes(2);
    expect(subscriptions.map(subscription => subscription.relays)).toEqual([
      ['wss://one.example'],
      ['wss://two.example']
    ]);
    subscriptions[0].handlers.oneose('wss://one.example');
    subscriptions[1].handlers.oneose('wss://two.example');
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(_quoteFetchInflight.size).toBe(0);
  });

  it('does not cache stale results after account or pool rotation', async () => {
    const { state, subscriptions } = createState();
    state.pubkey = 'account-a';
    const pending = fetchQuoteEventById(state, ['wss://relay.example'], 'stale-id');
    vi.advanceTimersByTime(QUOTE_BATCH_WINDOW_MS);

    state.pool = { subscribeMany: vi.fn() };
    state.pubkey = 'account-b';
    subscriptions[0].handlers.onevent({ id: 'stale-id' }, 'wss://relay.example');

    await expect(pending).resolves.toBeNull();
    expect(state.eventCache.has('stale-id')).toBe(false);
    expect(_quoteFetchInflight.size).toBe(0);
    expect(_quoteIdBatches.size).toBe(0);
  });

  it('settles without subscribing when rotation happens during the batch window', async () => {
    const { state, pool } = createState();
    state.pubkey = 'account-a';
    const pending = fetchQuoteEventById(state, ['wss://relay.example'], 'never-started');

    state.pool = { subscribeMany: vi.fn() };
    state.pubkey = 'account-b';
    vi.advanceTimersByTime(QUOTE_BATCH_WINDOW_MS);

    await expect(pending).resolves.toBeNull();
    expect(pool.subscribeMany).not.toHaveBeenCalled();
    expect(_quoteFetchInflight.size).toBe(0);
    expect(_quoteIdBatches.size).toBe(0);
  });
});
