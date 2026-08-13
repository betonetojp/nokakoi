import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanupPoolDuplicates: vi.fn(),
  getNostrTools: vi.fn(() => ({})),
  monitorRelayConnections: vi.fn(),
  releaseSubscriptionsForPool: vi.fn(),
  setupVisibilityHandler: vi.fn(),
  startKeepalive: vi.fn(),
  stopMonitoringRelays: vi.fn()
}));

vi.mock('../../utils/utils.js', () => ({ logWarn: vi.fn() }));
vi.mock('../nostr-compat.js', () => ({ getNostrTools: mocks.getNostrTools }));
vi.mock('./relay-helpers.js', () => ({
  cleanupPoolDuplicates: mocks.cleanupPoolDuplicates,
  getAllRelayUrls: vi.fn()
}));
vi.mock('./relay-state.js', () => ({
  debugRelay: vi.fn(),
  monitorRelayConnections: mocks.monitorRelayConnections,
  setupVisibilityHandler: mocks.setupVisibilityHandler,
  startKeepalive: mocks.startKeepalive,
  stopMonitoringRelays: mocks.stopMonitoringRelays
}));
vi.mock('./relay-subscription.js', () => ({
  releaseSubscriptionsForPool: mocks.releaseSubscriptionsForPool
}));

import {
  closePoolAndWait,
  closePoolSocketsSafely,
  getRelayFromPool,
  isValidRelayUrl,
  normalizeRelay,
  relayConnect
} from './relay-connection.js';

describe('relay connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.WebSocket = { CONNECTING: 0, OPEN: 1 };
    globalThis.window = {
      dispatchEvent: vi.fn()
    };
    globalThis.CustomEvent = class {
      constructor(type) {
        this.type = type;
      }
    };
  });

  it('normalizes relay settings and validates WebSocket URLs', () => {
    expect(normalizeRelay({ url: ' wss://relay.example/// ', read: false })).toEqual({
      url: 'wss://relay.example',
      read: false,
      write: true
    });
    expect(isValidRelayUrl(' ws://localhost ')).toBe(true);
    expect(isValidRelayUrl('https://relay.example')).toBe(false);
  });

  it('finds relays regardless of a trailing slash', () => {
    const relay = { url: 'wss://relay.example/' };
    const pool = { relays: new Map([['wss://relay.example/', relay]]) };
    expect(getRelayFromPool(pool, 'wss://relay.example')).toBe(relay);
  });

  it('closes only connecting/open sockets and clears the relay map', () => {
    const open = { close: vi.fn(), readyState: 1 };
    const closed = { close: vi.fn(), readyState: 3 };
    const pool = { relays: new Map([['open', { ws: open }], ['closed', { ws: closed }]]) };

    expect(closePoolSocketsSafely(pool)).toBe(1);
    expect(open.close).toHaveBeenCalled();
    expect(closed.close).not.toHaveBeenCalled();
    expect(pool.relays.size).toBe(0);
  });

  it('replaces an old pool and starts connection lifecycle hooks', () => {
    const socket = { close: vi.fn(), readyState: 1 };
    const oldPool = { relays: new Map([['old', { ws: socket }]]) };
    const state = { pool: oldPool, subs: new Map([['sub', {}]]) };
    class SimplePool {
      constructor() {
        this.relays = new Map();
      }
    }
    const restartFeeds = vi.fn();

    expect(relayConnect(state, SimplePool, restartFeeds)).toBe(true);
    expect(state.pool).toBeInstanceOf(SimplePool);
    expect(socket.close).toHaveBeenCalled();
    expect(mocks.releaseSubscriptionsForPool).toHaveBeenCalledWith(state, oldPool, 'relay pool replaced');
    expect(mocks.monitorRelayConnections).toHaveBeenCalledWith(state, restartFeeds);
    expect(mocks.startKeepalive).toHaveBeenCalledWith(state);
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'relay:poolReady' }));
  });

  it('detaches the pool when closing completes', async () => {
    const oldPool = { relays: new Map() };
    const fetcher = {
      controller: { abort: vi.fn() },
      stopHist: vi.fn(),
      stopLive: vi.fn()
    };
    const state = {
      _homeFetcher: fetcher,
      pool: oldPool,
      subs: new Map([['sub', {}]])
    };
    expect(await closePoolAndWait(state, 0)).toBe(true);
    expect(state.pool).toBeNull();
    expect(state._homeFetcher).toBeNull();
    expect(fetcher.controller.abort).toHaveBeenCalledTimes(1);
    expect(fetcher.stopHist).not.toHaveBeenCalled();
    expect(fetcher.stopLive).not.toHaveBeenCalled();
    expect(state.subs.size).toBe(0);
    expect(mocks.releaseSubscriptionsForPool).toHaveBeenCalledWith(state, oldPool, 'relay pool closed');
  });

  it('releases subscriptions before closing mixed pool sockets once', async () => {
    const connecting = { close: vi.fn(), readyState: WebSocket.CONNECTING };
    const open = { close: vi.fn(), readyState: WebSocket.OPEN };
    const closing = { close: vi.fn(), readyState: 2 };
    const closed = { close: vi.fn(), readyState: 3 };
    const oldPool = {
      relays: new Map([
        ['connecting', { ws: connecting }],
        ['open', { ws: open }],
        ['closing', { ws: closing }],
        ['closed', { ws: closed }]
      ])
    };
    const state = { pool: oldPool, subs: new Map([['sub', {}]]) };

    await closePoolAndWait(state, 0);

    expect(mocks.releaseSubscriptionsForPool).toHaveBeenCalledTimes(1);
    expect(connecting.close).toHaveBeenCalledTimes(1);
    expect(open.close).toHaveBeenCalledTimes(1);
    expect(closing.close).not.toHaveBeenCalled();
    expect(closed.close).not.toHaveBeenCalled();
    expect(mocks.releaseSubscriptionsForPool.mock.invocationCallOrder[0])
      .toBeLessThan(connecting.close.mock.invocationCallOrder[0]);
  });
});
