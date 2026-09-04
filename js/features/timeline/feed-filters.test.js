import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildHomeLoadMoreFilters,
  buildHomeLoadMoreFiltersForGlobalMerge,
  getFeedBaseFilters
} from './feed-filters.js';
import { EVENTS_FETCH_LIMIT } from '../../config/constants.js';

describe('feed filters', () => {
  beforeEach(() => {
    globalThis.localStorage = {
      getItem: vi.fn(key => key === 'pubkey' ? 'me' : null)
    };
  });

  it('builds home filters with enabled optional event kinds', () => {
    const state = { feeds: { home: { follows: ['alice', 'bob'] } } };
    const settings = {
      get: vi.fn(key => key === 'showHomeReactions' || key === 'showHomeChannel')
    };

    expect(getFeedBaseFilters(state, settings, 'home')).toEqual([
      {
        kinds: [1, 6, 1111, 7, 42],
        authors: ['alice', 'bob'],
        limit: EVENTS_FETCH_LIMIT
      },
      { kinds: [1, 6, 7, 1111, 9735], '#p': ['me'], limit: EVENTS_FETCH_LIMIT },
      { kinds: [9735], '#P': ['me'], limit: EVENTS_FETCH_LIMIT },
      { kinds: [7, 42, 16], authors: ['me'], limit: EVENTS_FETCH_LIMIT }
    ]);
  });

  it('returns no home filters without follows', () => {
    const state = { feeds: { home: { follows: [] } } };
    expect(getFeedBaseFilters(state, { get: vi.fn() }, 'home')).toEqual([]);
    expect(buildHomeLoadMoreFiltersForGlobalMerge(state, 10)).toEqual([]);
  });

  it('builds mention, own, omochat and global filters', () => {
    const state = { feeds: { home: { follows: [] } } };
    const settings = { get: vi.fn() };

    const mentionFilters = getFeedBaseFilters(state, settings, 'mentions');
    expect(mentionFilters).toHaveLength(2);
    expect(mentionFilters[0].kinds).toEqual([1, 6, 7, 16, 42, 1111, 9735]);
    expect(mentionFilters[1].kinds).toEqual([1111]);
    expect(mentionFilters[1]['#P']).toEqual(['me']);
    expect(getFeedBaseFilters(state, settings, 'me')[0].authors).toEqual(['me']);
    expect(getFeedBaseFilters(state, settings, 'bitchat')[0].kinds).toEqual([20000]);
    expect(getFeedBaseFilters(state, settings, 'global')[0].kinds).toEqual([1, 6, 1111]);
  });

  it('applies pagination to every load-more filter', () => {
    const state = { feeds: { home: { follows: ['alice'] } } };
    const settings = { get: vi.fn(key => key === 'showHomeRepost16') };
    const filters = buildHomeLoadMoreFilters(state, settings, 123);

    expect(filters).toHaveLength(5);
    expect(filters.every(filter => filter.until === 123)).toBe(true);
    expect(filters[2]).toEqual({ kinds: [9735], '#P': ['me'], limit: EVENTS_FETCH_LIMIT, until: 123 });
    expect(filters[4].kinds).toEqual([16]);
  });
});
