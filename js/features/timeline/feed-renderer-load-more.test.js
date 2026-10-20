import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  t: (key, params) => {
    if (key === 'feed.load_before' && params && params.time) {
      return `${params.time} 以前を読み込む`;
    }
    if (key === 'feed.load_more') return 'もっと読む';
    return key;
  }
}));

import { getLoadMoreLabel } from './feed-renderer.js';

describe('getLoadMoreLabel', () => {
  it('returns default load more text when feed has no paginationUntil', () => {
    const state = {
      feeds: {
        home: { list: [] }
      }
    };
    expect(getLoadMoreLabel('home', state, {})).toBe('もっと読む');
  });

  it('returns formatted load before label when feed has paginationUntil', () => {
    const now = new Date();
    const d = new Date(now.getFullYear(), 9, 19, 14, 30);
    const ts = Math.floor(d.getTime() / 1000);
    const state = {
      feeds: {
        home: { list: [], paginationUntil: ts }
      }
    };
    expect(getLoadMoreLabel('home', state, {})).toBe('10/19 14:30 以前を読み込む');
  });

  it('returns formatted load before label for merged global when mergedPaginationUntil is set', () => {
    const d = new Date(2025, 11, 31, 23, 59);
    const ts = Math.floor(d.getTime() / 1000);
    const state = {
      feeds: {
        global: { list: [], mergedPaginationUntil: ts }
      }
    };
    const options = {
      settingsManager: {
        get: (k) => k === 'globalMergeHome'
      }
    };
    expect(getLoadMoreLabel('global', state, options)).toBe('2025/12/31 23:59 以前を読み込む');
  });

  it('falls back to default load more text if paginationUntil is invalid', () => {
    const state = {
      feeds: {
        home: { list: [], paginationUntil: 0 }
      }
    };
    expect(getLoadMoreLabel('home', state, {})).toBe('もっと読む');
  });
});
