import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppState: vi.fn(),
  getRelayFromPool: vi.fn(),
  debugRelay: vi.fn()
}));

vi.mock('../app-context.js', () => ({
  getAppState: mocks.getAppState,
  setRelayInspector: vi.fn()
}));
vi.mock('../state.js', () => ({ findEventById: vi.fn(), cacheEvent: vi.fn() }));
vi.mock('./relay-helpers.js', () => ({
  getReadRelays: vi.fn(() => ['wss://relay.example']),
  normalizeUrl: vi.fn((url) => typeof url === 'string' ? url.replace(/\/+$/, '') : url)
}));
vi.mock('./relay-connection.js', () => ({ getRelayFromPool: mocks.getRelayFromPool }));
vi.mock('./relay-state.js', () => ({ debugRelay: mocks.debugRelay, relayStates: new Map() }));

import {
  cancelQueuedSubscription,
  cancelQueuedSubscriptionsForPool,
  cancelOneshotByPredicate,
  logicalListeners,
  pendingLogicalSubscriptions,
  processSubscribeQueue,
  RelaySubscriptionCancelledError,
  relayActiveCounts,
  relayCooldownUntil,
  releaseSubscriptionsForPool,
  subOnce,
  subscribeQueue
} from './relay-subscription.js';

function createState() {
  let handlers;
  const rawClose = vi.fn(() => Promise.resolve());
  const pool = {
    subscribeMany: vi.fn((_relays, _filters, params) => {
      handlers = params;
      return { close: rawClose };
    })
  };
  const state = {
    pool,
    relays: ['wss://relay.example'],
    subs: new Map()
  };
  mocks.getAppState.mockReturnValue(state);
  mocks.getRelayFromPool.mockReturnValue({ ws: { readyState: 1 } });
  return { state, pool, rawClose, getHandlers: () => handlers };
}

describe('relay logical subscriptions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribeQueue.splice(0);
    logicalListeners.clear();
    pendingLogicalSubscriptions.clear();
    relayCooldownUntil.clear();
    relayActiveCounts.live.clear();
    relayActiveCounts.oneshot.clear();
    globalThis.WebSocket = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
    globalThis.window = { __nostrState: null, addEventListener: vi.fn() };
    globalThis.document = { querySelector: vi.fn(() => ({ dataset: { tab: 'home' } })) };
  });

  afterEach(async () => {
    subscribeQueue.splice(0);
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    vi.runOnlyPendingTimers();
    relayCooldownUntil.clear();
    vi.useRealTimers();
  });

  it('coalesces starts before state.subs registration and closes oneshot once on EOSE', async () => {
    const { state, pool, rawClose, getHandlers } = createState();
    const first = vi.fn();
    const second = vi.fn();

    subOnce(state, 'home_hist', [{ kinds: [1] }], first);
    subOnce(state, 'home_hist', [{ kinds: [1] }], second);

    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    getHandlers().onevent({ id: 'event-1' }, 'wss://relay.example');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    getHandlers().oneose('wss://relay.example');
    await Promise.resolve();
    vi.runAllTimers();

    expect(rawClose).toHaveBeenCalledTimes(1);
    expect(state.subs.size).toBe(0);
    expect(relayActiveCounts.oneshot.get('wss://relay.example')).toBe(0);
  });

  it('reuses a live subscription and closes it after the last listener leaves', async () => {
    const { state, pool, rawClose, getHandlers } = createState();
    const first = vi.fn();
    const second = vi.fn();
    const filters = [{ kinds: [1], since: 100 }];

    const stopFirst = subOnce(state, 'home_live', filters, first);
    await Promise.resolve();
    const stopSecond = subOnce(state, 'home_live', filters, second);

    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    getHandlers().onevent({ id: 'event-2' }, 'wss://relay.example');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    stopFirst();
    expect(rawClose).not.toHaveBeenCalled();
    stopSecond();
    expect(rawClose).toHaveBeenCalledTimes(1);
  });

  it('closes library pending work while the socket is connecting', async () => {
    const { state, rawClose } = createState();
    mocks.getRelayFromPool.mockReturnValue({ ws: { readyState: WebSocket.CONNECTING } });

    const stop = subOnce(state, 'home_live', [{ kinds: [1], since: 100 }], vi.fn());
    await Promise.resolve();
    stop();
    await Promise.resolve();

    expect(rawClose).toHaveBeenCalledTimes(1);
    expect(state.subs.size).toBe(0);
    expect(relayActiveCounts.live.get('wss://relay.example')).toBe(0);
  });

  it('closes library pending work when no relay socket entry is observable', async () => {
    const { state, rawClose } = createState();
    mocks.getRelayFromPool.mockReturnValue(null);

    const stop = subOnce(state, 'home_live', [{ kinds: [1], since: 100 }], vi.fn());
    await Promise.resolve();
    stop();
    await Promise.resolve();

    expect(rawClose).toHaveBeenCalledTimes(1);
    expect(relayActiveCounts.live.get('wss://relay.example')).toBe(0);
  });

  it('skips network close only when all target sockets are closing or closed', async () => {
    const { state, rawClose } = createState();
    mocks.getRelayFromPool.mockReturnValue({ ws: { readyState: WebSocket.CLOSED } });

    const stop = subOnce(state, 'home_live', [{ kinds: [1], since: 100 }], vi.fn());
    await Promise.resolve();
    stop();

    expect(rawClose).not.toHaveBeenCalled();
    expect(state.subs.size).toBe(0);
    expect(relayActiveCounts.live.get('wss://relay.example')).toBe(0);
  });

  it('locally releases pool subscriptions without network close and stays idempotent', async () => {
    const { state, pool, rawClose } = createState();
    const relays = ['wss://relay-one.example', 'wss://relay-two.example'];
    mocks.getRelayFromPool.mockImplementation((_pool, url) => ({
      ws: { readyState: url.includes('one') ? WebSocket.OPEN : WebSocket.CLOSED }
    }));
    subOnce(state, 'home_live', [{ kinds: [1], since: 100 }], vi.fn(), relays);
    await Promise.resolve();
    const sub = Array.from(state.subs.values())[0];

    expect(releaseSubscriptionsForPool(state, pool)).toBe(1);
    sub.close();
    expect(releaseSubscriptionsForPool(state, pool)).toBe(0);

    expect(rawClose).not.toHaveBeenCalled();
    expect(state.subs.size).toBe(0);
    expect(relayActiveCounts.live.get(relays[0])).toBe(0);
    expect(relayActiveCounts.live.get(relays[1])).toBe(0);
  });

  it('cancels old-pool queued work before processing the queue after local release', async () => {
    const { state, pool, rawClose } = createState();
    subOnce(state, 'home_live', [{ kinds: [1], since: 100 }], vi.fn());
    await Promise.resolve();
    const reject = vi.fn();
    const queued = {
      pool,
      targetRelays: ['wss://relay.example'],
      cancelled: false,
      reject
    };
    subscribeQueue.push(queued);

    expect(releaseSubscriptionsForPool(state, pool, 'relay pool closed')).toBe(1);

    expect(rawClose).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith(expect.objectContaining({
      code: 'RELAY_SUBSCRIPTION_CANCELLED'
    }));
    expect(subscribeQueue).toHaveLength(0);
  });

  it('cancels a started oneshot before state.subs registration', async () => {
    const { state, rawClose } = createState();

    subOnce(state, 'mentions_hist', [{ kinds: [1] }], vi.fn());
    expect(state.subs.size).toBe(0);

    expect(cancelOneshotByPredicate((key) => key === 'mentions_hist')).toBe(1);
    await Promise.resolve();

    expect(rawClose).toHaveBeenCalledTimes(1);
    expect(state.subs.size).toBe(0);
    expect(pendingLogicalSubscriptions.size).toBe(0);
  });

  it('starts the next oneshot only after the old tab request is cancelled', async () => {
    const { state, pool } = createState();

    subOnce(state, 'mentions_hist', [{ kinds: [1] }], vi.fn());
    subOnce(state, 'home_hist', [{ kinds: [1] }], vi.fn());
    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    expect(subscribeQueue).toHaveLength(1);

    expect(cancelOneshotByPredicate((key) => key === 'mentions_hist')).toBe(1);
    await Promise.resolve();

    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pool.subscribeMany).toHaveBeenCalledTimes(2);
    expect(subscribeQueue).toHaveLength(0);
  });

  it('waits for async network close and cooldown before starting the next oneshot', async () => {
    const { state, pool, rawClose, getHandlers } = createState();
    let resolveClose;
    rawClose.mockReturnValue(new Promise(resolve => { resolveClose = resolve; }));

    subOnce(state, 'mentions_hist', [{ kinds: [1] }], vi.fn());
    subOnce(state, 'home_hist', [{ kinds: [1] }], vi.fn());
    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    expect(subscribeQueue).toHaveLength(1);

    getHandlers().oneose('wss://relay.example');
    expect(rawClose).toHaveBeenCalledTimes(1);
    expect(relayActiveCounts.oneshot.get('wss://relay.example')).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);

    resolveClose();
    await Promise.resolve();
    expect(relayActiveCounts.oneshot.get('wss://relay.example')).toBe(0);

    await vi.advanceTimersByTimeAsync(249);
    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(pool.subscribeMany).toHaveBeenCalledTimes(2);
  });

  it('continues queue release after async network close rejects', async () => {
    const { state, pool, rawClose, getHandlers } = createState();
    let rejectClose;
    rawClose.mockReturnValue(new Promise((_resolve, reject) => { rejectClose = reject; }));

    subOnce(state, 'mentions_hist', [{ kinds: [1] }], vi.fn());
    subOnce(state, 'home_hist', [{ kinds: [1] }], vi.fn());
    getHandlers().oneose('wss://relay.example');

    rejectClose(new Error('close failed'));
    await Promise.resolve();
    expect(relayActiveCounts.oneshot.get('wss://relay.example')).toBe(0);

    await vi.advanceTimersByTimeAsync(251);
    expect(pool.subscribeMany).toHaveBeenCalledTimes(2);
    expect(subscribeQueue).toHaveLength(0);
  });

  it('rejects a cancelled queued request exactly once with a recognizable error', async () => {
    let rejectStart;
    const startPromise = new Promise((_resolve, reject) => {
      rejectStart = vi.fn(reject);
    });
    const req = {
      pool: {},
      targetRelays: ['wss://relay.example'],
      reject: (error) => rejectStart(error)
    };
    subscribeQueue.push(req);

    expect(cancelQueuedSubscription(req, 'test cancellation')).toBe(true);
    expect(cancelQueuedSubscription(req, 'duplicate cancellation')).toBe(false);

    const error = await startPromise.catch(value => value);
    expect(error).toBeInstanceOf(RelaySubscriptionCancelledError);
    expect(error).toMatchObject({
      code: 'RELAY_SUBSCRIPTION_CANCELLED',
      message: 'test cancellation'
    });
    expect(rejectStart).toHaveBeenCalledTimes(1);
    expect(subscribeQueue).toHaveLength(0);
  });

  it('settles requests already marked cancelled when processing the queue', async () => {
    let rejectStart;
    const startPromise = new Promise((_resolve, reject) => {
      rejectStart = vi.fn(reject);
    });
    const req = {
      cancelled: true,
      logicalIdentity: 'cancelled-identity',
      subId: 'cancelled-sub',
      targetRelays: ['wss://relay.example'],
      reject: (error) => rejectStart(error)
    };
    const listeners = new Set([vi.fn()]);
    pendingLogicalSubscriptions.set(req.logicalIdentity, { listeners, queuedReq: req });
    logicalListeners.set(req.subId, listeners);
    subscribeQueue.push(req);

    processSubscribeQueue();

    const error = await startPromise.catch(value => value);
    expect(error.code).toBe('RELAY_SUBSCRIPTION_CANCELLED');
    expect(rejectStart).toHaveBeenCalledTimes(1);
    expect(subscribeQueue).toHaveLength(0);
    expect(pendingLogicalSubscriptions.size).toBe(0);
    expect(logicalListeners.size).toBe(0);
    expect(listeners.size).toBe(0);
  });

  it('cancels only queued requests belonging to the closed pool', async () => {
    const old = createState();
    const newer = createState();
    relayActiveCounts.oneshot.set('wss://relay.example', 999);

    subOnce(old.state, 'old_hist', [{ kinds: [1] }], vi.fn());
    subOnce(newer.state, 'new_hist', [{ kinds: [1] }], vi.fn());
    const oldReq = subscribeQueue.find(req => req.pool === old.pool);
    const newReq = subscribeQueue.find(req => req.pool === newer.pool);
    const originalReject = oldReq.reject;
    oldReq.reject = vi.fn(error => originalReject(error));

    expect(cancelQueuedSubscriptionsForPool(old.pool)).toBe(1);
    await Promise.resolve();

    expect(oldReq.reject).toHaveBeenCalledWith(expect.objectContaining({
      code: 'RELAY_SUBSCRIPTION_CANCELLED'
    }));
    expect(subscribeQueue).toEqual([newReq]);
    expect(Array.from(pendingLogicalSubscriptions.values()).some(pending => pending.queuedReq === oldReq)).toBe(false);
    expect(logicalListeners.has(oldReq.subId)).toBe(false);
    expect(Array.from(pendingLogicalSubscriptions.values()).some(pending => pending.queuedReq === newReq)).toBe(true);
    expect(logicalListeners.has(newReq.subId)).toBe(true);
  });

  it('cleans an early queued unsubscribe so the same logical subscription can start next', async () => {
    const { state, pool } = createState();
    relayActiveCounts.oneshot.set('wss://relay.example', 999);

    const stop = subOnce(state, 'home_hist', [{ kinds: [1] }], vi.fn());
    const cancelledReq = subscribeQueue[0];
    const originalReject = cancelledReq.reject;
    cancelledReq.reject = vi.fn(error => originalReject(error));
    expect(subscribeQueue).toHaveLength(1);
    expect(pendingLogicalSubscriptions.size).toBe(1);

    stop();
    await Promise.resolve();

    expect(cancelledReq.reject).toHaveBeenCalledTimes(1);
    expect(subscribeQueue).toHaveLength(0);
    expect(pendingLogicalSubscriptions.size).toBe(0);
    expect(logicalListeners.size).toBe(0);
    expect(relayActiveCounts.oneshot.get('wss://relay.example')).toBe(999);

    relayActiveCounts.oneshot.clear();
    const stopNext = subOnce(state, 'home_hist', [{ kinds: [1] }], vi.fn());
    await Promise.resolve();

    expect(pool.subscribeMany).toHaveBeenCalledTimes(1);
    expect(pendingLogicalSubscriptions.size).toBe(0);
    expect(state.subs.size).toBe(1);
    stopNext();
  });
});
