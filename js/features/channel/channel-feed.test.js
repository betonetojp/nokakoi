// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./channel.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchChannelMetadata: vi.fn(async () => ({ label: 'TestChannel', metaEvent: null, rootEvent: null })),
    pickChannelRootRelayHints: vi.fn(() => []),
    scheduleChannelLabelUpdate: vi.fn(),
  };
});

import { subscribeChannelFeed, unsubscribeAllChannelFeeds } from './channel-feed.js';

describe('channel-feed', () => {
  let containerEl;
  let mockState;
  let mockSettingsManager;

  beforeEach(() => {
    containerEl = document.createElement('div');
    mockState = {
      relays: [{ url: 'wss://relay.example.com', read: true, write: true }],
      profiles: new Map(),
      pool: {
        subscribeMany: vi.fn((relays, filters, handlers) => {
          return { close: vi.fn() };
        })
      }
    };
    mockSettingsManager = {
      settings: {
        showAvatars: false
      },
      get: (k) => mockSettingsManager.settings[k]
    };
  });

  it('respects showAvatars: false in channel message elements', async () => {
    mockState.profiles.set('user1', { picture: 'https://example.com/avatar.png', name: 'Alice' });

    let oneventCallback;
    mockState.pool.subscribeMany = vi.fn((relays, filters, handlers) => {
      oneventCallback = handlers.onevent;
      return { close: vi.fn() };
    });

    await subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager);

    const testEvent = {
      id: 'event-1',
      kind: 42,
      pubkey: 'user1',
      created_at: 1000,
      content: 'Hello channel',
      tags: [['e', 'chan-root-1', '', 'root']]
    };

    oneventCallback(testEvent);

    const eventEl = containerEl.querySelector('.event[data-event-id="event-1"]');
    expect(eventEl).toBeTruthy();
    const avatarImg = eventEl.querySelector('.avatar');
    expect(avatarImg).toBeNull();
  });

  it('performs incremental rendering (prepend) for incoming messages', async () => {
    let oneventCallback;
    mockState.pool.subscribeMany = vi.fn((relays, filters, handlers) => {
      oneventCallback = handlers.onevent;
      return { close: vi.fn() };
    });

    await subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager);

    oneventCallback({
      id: 'ev-1',
      kind: 42,
      pubkey: 'u1',
      created_at: 1000,
      content: 'First msg',
      tags: [['e', 'chan-root-1', '', 'root']]
    });

    const firstMsg = containerEl.querySelector('.event[data-event-id="ev-1"]');
    expect(firstMsg).toBeTruthy();

    oneventCallback({
      id: 'ev-2',
      kind: 42,
      pubkey: 'u2',
      created_at: 2000,
      content: 'Newer msg',
      tags: [['e', 'chan-root-1', '', 'root']]
    });

    const events = containerEl.querySelectorAll('.event:not(.feed-bar)');
    expect(events.length).toBe(2);
    // ev-2 は created_at: 2000 なので先頭に挿入される
    expect(events[0].dataset.eventId).toBe('ev-2');
    expect(events[1].dataset.eventId).toBe('ev-1');
  });

  it('preserves existing DOM and eventsMap when resume: true is passed', async () => {
    let oneventCallback;
    mockState.pool.subscribeMany = vi.fn((relays, filters, handlers) => {
      oneventCallback = handlers.onevent;
      return { close: vi.fn() };
    });

    await subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager);

    oneventCallback({
      id: 'ev-1',
      kind: 42,
      pubkey: 'u1',
      created_at: 1000,
      content: 'First msg',
      tags: [['e', 'chan-root-1', '', 'root']]
    });

    const originalEl = containerEl.querySelector('.event[data-event-id="ev-1"]');
    expect(originalEl).toBeTruthy();

    // 他タブから戻ってきた時の resume 呼び出し
    await subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager, { resume: true });

    // 「メッセージを取得中...」でクリアされず、元の要素が保持されている
    const stillPresentEl = containerEl.querySelector('.event[data-event-id="ev-1"]');
    expect(stillPresentEl).toBe(originalEl);
  });

  it('falls back to fresh subscription if resume: true is passed but DOM has no event elements', async () => {
    let oneventCallback;
    mockState.pool.subscribeMany = vi.fn((relays, filters, handlers) => {
      oneventCallback = handlers.onevent;
      return { close: vi.fn() };
    });

    await subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager);

    oneventCallback({
      id: 'ev-1',
      kind: 42,
      pubkey: 'u1',
      created_at: 1000,
      content: 'First msg',
      tags: [['e', 'chan-root-1', '', 'root']]
    });

    expect(containerEl.querySelector('.event[data-event-id="ev-1"]')).toBeTruthy();

    // DOM is wiped (e.g. by soft reload placeholder)
    containerEl.innerHTML = '<div class="muted">Loading...</div>';

    // resume: true is called
    await subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager, { resume: true });

    // New event arrives with same ID (re-delivered by relay)
    oneventCallback({
      id: 'ev-1',
      kind: 42,
      pubkey: 'u1',
      created_at: 1000,
      content: 'First msg',
      tags: [['e', 'chan-root-1', '', 'root']]
    });

    // Should be successfully added to DOM because fresh subscription cleared eventsMap
    expect(containerEl.querySelector('.event[data-event-id="ev-1"]')).toBeTruthy();
  });

  it('sorts out-of-order history batch chronologically on EOSE and closes in-flight history sub on unsubscribeAll', async () => {
    const handlersList = [];
    const closeFns = [];
    mockState.pool.subscribeMany = vi.fn((_relays, _filters, handlers) => {
      handlersList.push(handlers);
      const close = vi.fn();
      closeFns.push(close);
      return { close };
    });

    await subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager);

    // Initial live/recent event
    handlersList[0].onevent({
      id: 'ev-top',
      kind: 42,
      pubkey: 'u1',
      created_at: 2000,
      content: 'Top',
      tags: [['e', 'chan-root-1', '', 'root']]
    });
    handlersList[0].oneose();

    const loadMoreBtn = containerEl.querySelector('.load-more-btn');
    expect(loadMoreBtn).toBeTruthy();
    loadMoreBtn.click();

    // Out-of-order history arrivals from multiple relays (older 800 arrives before newer 1500)
    expect(handlersList.length).toBe(2);
    handlersList[1].onevent({
      id: 'ev-800',
      kind: 42,
      pubkey: 'u1',
      created_at: 800,
      content: 'Older 800',
      tags: [['e', 'chan-root-1', '', 'root']]
    });
    handlersList[1].onevent({
      id: 'ev-1500',
      kind: 42,
      pubkey: 'u2',
      created_at: 1500,
      content: 'Newer 1500',
      tags: [['e', 'chan-root-1', '', 'root']]
    });
    handlersList[1].oneose();

    const ids = Array.from(containerEl.querySelectorAll('.event:not(.feed-bar)')).map(el => el.dataset.eventId);
    expect(ids).toEqual(['ev-top', 'ev-1500', 'ev-800']);

    // Start another history load and verify unsubscribeAllChannelFeeds closes it
    containerEl.querySelector('.load-more-btn').click();
    expect(handlersList.length).toBe(3);
    unsubscribeAllChannelFeeds();
    expect(closeFns[2]).toHaveBeenCalledTimes(1);
  });
});

