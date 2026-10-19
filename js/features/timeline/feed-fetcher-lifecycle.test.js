import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ subOnce: vi.fn() }));

vi.mock('../../core/relay.js', () => ({
  subOnce: mocks.subOnce,
  getReadRelays: vi.fn(() => ['wss://relay.example'])
}));

import { fetchMore, setupFeedFetcher, updatePerFilterUntil, applyPerFilterUntil } from './feed-fetcher.js';

describe('feed fetcher logical keys', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.subOnce.mockReset();
    mocks.subOnce.mockReturnValue(vi.fn());
    globalThis.localStorage = { getItem: vi.fn(() => null) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a stable per-relay history key across repeated setup', () => {
    const state = {
      relays: ['wss://relay.example'],
      feeds: { home: { list: [], map: new Map() } }
    };
    const options = {
      state,
      feedId: 'home',
      histFilters: [{ kinds: [1], limit: 20 }],
      liveFilters: null,
      relays: ['wss://relay.example'],
      addToFeed: vi.fn(),
      scheduleRender: vi.fn()
    };

    setupFeedFetcher(options);
    setupFeedFetcher(options);

    expect(mocks.subOnce).toHaveBeenCalledTimes(2);
    expect(mocks.subOnce.mock.calls.map((call) => call[1])).toEqual([
      'home_hist_wss://relay.example',
      'home_hist_wss://relay.example'
    ]);
  });

  it('uses all history relays but only the configured live relay', () => {
    const state = {
      relays: ['wss://one.example', 'wss://two.example'],
      feeds: { home: { list: [], map: new Map() } }
    };

    setupFeedFetcher({
      state,
      feedId: 'home',
      histFilters: [{ kinds: [1], limit: 20 }],
      liveFilters: [{ kinds: [1], since: 100 }],
      relays: ['wss://one.example', 'wss://two.example'],
      liveRelays: ['wss://two.example'],
      addToFeed: vi.fn(),
      scheduleRender: vi.fn()
    });

    expect(mocks.subOnce.mock.calls.map((call) => [call[1], call[4]])).toEqual([
      ['home_hist_wss://one.example', ['wss://one.example']],
      ['home_hist_wss://two.example', ['wss://two.example']],
      ['home_live', ['wss://two.example']]
    ]);
  });

  it('shares one in-flight fetchMore per state and feed, then releases it on abort', async () => {
    const state = {
      relays: ['wss://relay.example'],
      feeds: { home: { list: [], map: new Map() } }
    };
    const options = {
      state,
      feedId: 'home',
      filters: [{ kinds: [1], until: 100 }],
      relays: ['wss://relay.example'],
      startListLength: 0,
      addToFeed: vi.fn(),
      scheduleRender: vi.fn()
    };

    const first = fetchMore(options);
    const duplicate = fetchMore(options);
    expect(duplicate).toBe(first);
    expect(mocks.subOnce).toHaveBeenCalledTimes(1);

    first.controller.abort();
    await expect(first).resolves.toEqual({ appendedCount: 0, totalCount: 0 });
    await Promise.resolve();

    const next = fetchMore(options);
    expect(next).not.toBe(first);
    expect(mocks.subOnce).toHaveBeenCalledTimes(2);
    const nextCallback = mocks.subOnce.mock.calls[1][3];
    nextCallback(null, 'wss://relay.example', true);
    await expect(next).resolves.toEqual({ appendedCount: 0, totalCount: 0 });
    await Promise.resolve();

    const afterSettle = fetchMore(options);
    expect(afterSettle).not.toBe(next);
    expect(mocks.subOnce).toHaveBeenCalledTimes(3);
    afterSettle.controller.abort();
    await afterSettle;
  });

  it('filters events using acceptEvent when provided', async () => {
    const state = {
      relays: ['wss://relay.example'],
      feeds: { global: { list: [], map: new Map() } }
    };
    const options = {
      state,
      feedId: 'global',
      filters: [{ kinds: [1], until: 100 }],
      relays: ['wss://relay.example'],
      startListLength: 0,
      addToFeed: vi.fn(),
      scheduleRender: vi.fn(),
      acceptEvent: (ev) => ev && ev.content === 'allowed'
    };

    const promise = fetchMore(options);
    const cb = mocks.subOnce.mock.calls[mocks.subOnce.mock.calls.length - 1][3];

    // Emit one rejected event and one allowed event, then done
    cb({ id: 'ev1', content: 'disallowed', created_at: 50 }, 'wss://relay.example', false);
    cb({ id: 'ev2', content: 'allowed', created_at: 60 }, 'wss://relay.example', true);

    const res = await promise;
    expect(res.appendedCount).toBe(1);
    expect(res.totalCount).toBe(1);
    expect(state.feeds.global.list).toHaveLength(1);
    expect(state.feeds.global.list[0].id).toBe('ev2');
  });

  it('advances until and scans next round when all events are filtered out by acceptEvent', async () => {
    const state = {
      relays: ['wss://relay.example'],
      feeds: { global: { list: [], map: new Map() } }
    };
    const options = {
      state,
      feedId: 'global',
      filters: [{ kinds: [1], until: 100 }],
      relays: ['wss://relay.example'],
      startListLength: 0,
      addToFeed: vi.fn(),
      scheduleRender: vi.fn(),
      acceptEvent: (ev) => ev && ev.content === 'allowed'
    };

    const promise = fetchMore(options);
    const cb1 = mocks.subOnce.mock.calls[mocks.subOnce.mock.calls.length - 1][3];

    // Round 1 returns only rejected events (created_at: 80)
    cb1({ id: 'ev1', content: 'disallowed', created_at: 80 }, 'wss://relay.example', true);

    // This should trigger round 2 with until: 79
    expect(mocks.subOnce).toHaveBeenCalledTimes(2);
    expect(mocks.subOnce.mock.calls[1][2][0].until).toBe(79);

    const cb2 = mocks.subOnce.mock.calls[1][3];
    cb2({ id: 'ev2', kind: 1, content: 'allowed', created_at: 70 }, 'wss://relay.example', true);

    const res = await promise;
    expect(res.appendedCount).toBe(1);
    expect(state.feeds.global.list).toHaveLength(1);
    expect(state.feeds.global.list[0].id).toBe('ev2');
    expect(state.feeds.global.perFilterUntil[0]).toBe(70);
  });
});

