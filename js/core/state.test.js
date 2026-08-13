import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./relay.js', () => ({ loadRelays: () => [] }));
vi.mock('../utils/utils.js', () => ({ logWarn: vi.fn() }));

import {
  cacheEvent,
  clearFullState,
  createState,
  findEventById,
  insertEventSorted,
  makeFeedState
} from './state.js';

describe('state', () => {
  beforeEach(() => {
    const elements = new Map();
    for (const id of [
      'feed-home',
      'feed-global',
      'feed-mentions',
      'feed-me',
      'feed-bitchat',
      'feed-channels'
    ]) {
      elements.set(id, { innerHTML: 'stale' });
    }
    globalThis.document = {
      getElementById: vi.fn(id => elements.get(id) || null),
      querySelectorAll: vi.fn(selector => selector === '.feed-container'
        ? [...elements.values()]
        : [{ classList: { remove: vi.fn() } }])
    };
  });

  it('creates isolated feed state and keeps events sorted without duplicates', () => {
    const state = createState();
    state.feeds.global = makeFeedState();

    insertEventSorted(state, 'global', { id: 'old', created_at: 1 });
    insertEventSorted(state, 'global', { id: 'new', created_at: 3 });
    insertEventSorted(state, 'global', { id: 'middle', created_at: 2 });
    insertEventSorted(state, 'global', { id: 'new', created_at: 9 });

    expect(state.feeds.global.list.map(event => event.id)).toEqual(['new', 'middle', 'old']);
    expect(state.feeds.global.lastSeen).toBe(3);
  });

  it('finds cached events and evicts the oldest entry over the limit', () => {
    const state = createState();
    for (let index = 0; index <= 1000; index++) {
      cacheEvent(state, { id: `event-${index}` });
    }

    expect(findEventById(state, 'event-0')).toBeNull();
    expect(findEventById(state, 'event-1000')).toEqual({ id: 'event-1000' });
    expect(state.eventCache.size).toBe(1000);
  });

  it('clears all feed caches, account caches, feed DOM and notification classes', () => {
    const state = createState();
    state.feeds.channels = makeFeedState();
    state.feeds.bitchat = makeFeedState();
    for (const feed of Object.values(state.feeds)) {
      feed.list.push({ id: 'event' });
      feed.map.set('event', { id: 'event' });
      feed.lastSeen = 10;
      feed.follows = ['pubkey'];
      feed.followSet = new Set(['pubkey']);
    }
    state.profiles.set('pubkey', {});
    state.eventCache.set('event', {});

    clearFullState(state);

    for (const feed of Object.values(state.feeds)) {
      expect(feed.list).toEqual([]);
      expect(feed.map.size).toBe(0);
      expect(feed.lastSeen).toBe(0);
      expect(feed.follows).toEqual([]);
      expect(feed.followSet.size).toBe(0);
    }
    expect(state.profiles.size).toBe(0);
    expect(state.eventCache.size).toBe(0);
    for (const id of ['feed-bitchat', 'feed-channels']) {
      expect(document.getElementById(id).innerHTML).toBe('');
    }
  });
});
