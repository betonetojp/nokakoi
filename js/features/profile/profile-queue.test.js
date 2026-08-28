import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/relay.js', () => ({
  profileIndexerRelays: ['wss://profile.example', 'wss://profile2.example']
}));
vi.mock('../../utils/utils.js', () => ({
  truncateName: vi.fn((value) => value),
  escapeHtml: vi.fn((value) => value),
  replaceBadgeEmoji: vi.fn((value) => value)
}));
vi.mock('../../core/nostr-compat.js', () => ({
  getNip19: vi.fn(() => ({ npubEncode: vi.fn((pk) => pk) }))
}));
vi.mock('../../ui/renderers/render-helpers.js', () => ({
  evaluateMuteState: vi.fn(),
  applyMutedToneToEvent: vi.fn(),
  updateEventMuteDom: vi.fn()
}));

import { loadProfile } from './profile.js';

describe('profile indexer queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };
    globalThis.document = {
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn()
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs only one profile indexer request at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const pool = {
      querySync: vi.fn((_relays, _filter, options) => new Promise((resolve) => {
        active++;
        maxActive = Math.max(maxActive, active);
        setTimeout(() => {
          active--;
          resolve([]);
        }, options.maxWait);
      }))
    };
    const state = {
      pool,
      profiles: new Map(),
      followPetnames: new Map(),
      pubkey: null
    };

    const first = loadProfile(state, 'alice');
    const second = loadProfile(state, 'bob');
    await Promise.resolve();
    await Promise.resolve();

    expect(pool.querySync).toHaveBeenCalledTimes(1);
    expect(pool.querySync).toHaveBeenLastCalledWith(
      ['wss://profile.example', 'wss://profile2.example'],
      { kinds: [0], authors: ['alice'], limit: 20 },
      { maxWait: 800 }
    );

    await vi.advanceTimersByTimeAsync(799);
    expect(pool.querySync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await first;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);

    expect(pool.querySync).toHaveBeenCalledTimes(2);
    expect(pool.querySync).toHaveBeenLastCalledWith(
      ['wss://profile.example', 'wss://profile2.example'],
      { kinds: [0], authors: ['bob'], limit: 20 },
      { maxWait: 800 }
    );
    expect(maxActive).toBe(1);

    await vi.advanceTimersByTimeAsync(800);
    await second;
    expect(active).toBe(0);
  });
});
