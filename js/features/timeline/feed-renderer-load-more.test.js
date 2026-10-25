// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMoreMock = vi.fn();

vi.mock('./feed-fetcher.js', () => ({
  fetchMore: (...args) => fetchMoreMock(...args),
  applyPerFilterUntil: (_state, _id, baseFilters) => baseFilters
}));

vi.mock('../../ui/renderer.js', () => ({
  renderEvent: (_state, ev) => {
    const div = document.createElement('div');
    div.className = 'event';
    div.dataset.eventId = ev.id;
    div.textContent = ev.content || ev.id;
    return div;
  },
  applyReactionToButton: vi.fn()
}));

vi.mock('../../utils/i18n.js', () => ({
  t: (key, params) => {
    if (key === 'feed.load_before' && params && params.time) {
      return `${params.time} 以前を読み込む`;
    }
    if (key === 'feed.load_more') return 'もっと読む';
    if (key === 'loading') return '読み込み中...';
    return key;
  }
}));

import {
  feedLoadState,
  getLoadMoreLabel,
  initFeedRenderer,
  renderFeed,
  scheduleRender
} from './feed-renderer.js';

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

describe('scroll-time load more rendering', () => {
  let mockObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMoreMock.mockReset();
    document.body.innerHTML = '<div class="tabs"></div><div id="feed-global" class="feed active"></div>';
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    window.scrollTo = vi.fn();
    delete feedLoadState.global;

    mockObserver = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    };
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders load-more appended items immediately during active back-scrolling while deferring top live items until scroll idle', async () => {
    const state = {
      relays: [],
      feeds: {
        global: {
          list: [
            { id: 'ev-1', kind: 1, created_at: 1000, content: 'first' },
            { id: 'ev-2', kind: 1, created_at: 900, content: 'second' }
          ],
          map: new Map()
        }
      }
    };

    const options = {
      nip19: null,
      settingsManager: { get: () => false },
      getRenderSettingsWithUiState: () => ({}),
      ensureFeedUiState: () => ({}),
      findEventById: () => null,
      resolveGlobalRelays: () => ['wss://relay.example.com'],
      setupInfiniteScrollObserver: () => mockObserver,
      getInfiniteScrollObserver: () => mockObserver,
      addToFeed: vi.fn()
    };

    initFeedRenderer(state, options);
    renderFeed('global', true);

    const feedEl = document.getElementById('feed-global');
    feedEl.getBoundingClientRect = () => ({ top: -300, bottom: 500, height: 800 });
    expect(Array.from(feedEl.querySelectorAll('.event')).map(n => n.dataset.eventId)).toEqual(['ev-1', 'ev-2']);

    // Simulate active user back-scrolling
    window.scrollY = 300;
    window.dispatchEvent(new Event('wheel'));
    window.dispatchEvent(new Event('scroll'));

    // 1) A live event arrives at top during scroll -> buffered, not inserted yet
    state.feeds.global.list.unshift({ id: 'ev-live', kind: 1, created_at: 1100, content: 'live' });
    scheduleRender('global', 10);
    vi.advanceTimersByTime(50);
    expect(Array.from(feedEl.querySelectorAll('.event')).map(n => n.dataset.eventId)).toEqual(['ev-1', 'ev-2']);

    // 2) Infinite scroll triggers load-more while still scrolling!
    fetchMoreMock.mockImplementation(() => {
      state.feeds.global.list.push(
        { id: 'ev-3', kind: 1, created_at: 800, content: 'third' },
        { id: 'ev-4', kind: 1, created_at: 700, content: 'fourth' }
      );
      return Promise.resolve({ appendedCount: 2, totalCount: 5 });
    });

    const loadMoreBtn = feedEl.querySelector('.load-more-btn');
    expect(loadMoreBtn).not.toBeNull();
    mockObserver.observe.mockClear();
    mockObserver.unobserve.mockClear();

    loadMoreBtn.click();
    await Promise.resolve();
    vi.advanceTimersByTime(5); // still well within 280ms scroll-idle window!

    // Older items ev-3, ev-4 MUST already be rendered at the bottom while ev-live stays deferred!
    expect(Array.from(feedEl.querySelectorAll('.event')).map(n => n.dataset.eventId)).toEqual([
      'ev-1',
      'ev-2',
      'ev-3',
      'ev-4'
    ]);
    expect(window.scrollTo).not.toHaveBeenCalled();

    // Old sentinel/button unobserved, newly attached sentinel/button observed for next page preload!
    expect(mockObserver.unobserve).toHaveBeenCalled();
    const currentSentinel = feedEl.querySelector('.feed-scroll-sentinel');
    const currentBtn = feedEl.querySelector('.load-more-btn');
    expect(mockObserver.observe).toHaveBeenCalledWith(currentSentinel);
    expect(mockObserver.observe).toHaveBeenCalledWith(currentBtn);

    // 3) Once scrolling stops (280ms idle), deferred live item ev-live flushes at top!
    vi.advanceTimersByTime(300);
    expect(Array.from(feedEl.querySelectorAll('.event')).map(n => n.dataset.eventId)).toEqual([
      'ev-live',
      'ev-1',
      'ev-2',
      'ev-3',
      'ev-4'
    ]);
  });
});
