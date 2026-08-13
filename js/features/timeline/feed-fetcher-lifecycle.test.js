import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ subOnce: vi.fn() }));

vi.mock('../../core/relay.js', () => ({
  subOnce: mocks.subOnce,
  getReadRelays: vi.fn(() => ['wss://relay.example'])
}));

import { fetchMore, setupFeedFetcher } from './feed-fetcher.js';

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
});
