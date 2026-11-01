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

import { sendChannelMessage, subscribeChannelFeed, unsubscribeAllChannelFeeds } from './channel-feed.js';
import { fetchChannelMetadata, pickChannelRootRelayHints } from './channel.js';

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

  it('subscribes to read relays before metadata and adds hint relays afterwards', async () => {
    let resolveMeta;
    fetchChannelMetadata.mockImplementation(() => new Promise((resolve) => {
      resolveMeta = resolve;
    }));
    pickChannelRootRelayHints.mockReturnValue(['wss://extra.example/']);
    const closes = [];
    mockState.pool.subscribeMany = vi.fn(() => {
      const close = vi.fn();
      closes.push(close);
      return { close };
    });

    try {
      const pending = subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager);
      await Promise.resolve();
      expect(mockState.pool.subscribeMany).toHaveBeenCalledTimes(1);

      resolveMeta({ metaEvent: { id: 'meta' } });
      await pending;
      await Promise.resolve();

      expect(mockState.pool.subscribeMany).toHaveBeenCalledTimes(2);
      expect(mockState.pool.subscribeMany.mock.calls[1][0]).toContain('wss://extra.example/');
      unsubscribeAllChannelFeeds();
      expect(closes[0]).toHaveBeenCalledTimes(1);
      expect(closes[1]).toHaveBeenCalledTimes(1);
    } finally {
      fetchChannelMetadata.mockImplementation(async () => ({ label: 'TestChannel', metaEvent: null, rootEvent: null }));
      pickChannelRootRelayHints.mockReturnValue([]);
    }
  });

  it('does not open hint relays after the feed session has ended', async () => {
    let resolveMeta;
    fetchChannelMetadata.mockImplementation(() => new Promise((resolve) => {
      resolveMeta = resolve;
    }));
    pickChannelRootRelayHints.mockReturnValue(['wss://extra.example/']);

    try {
      const pending = subscribeChannelFeed('chan-root-1', mockState, containerEl, mockSettingsManager);
      await Promise.resolve();
      unsubscribeAllChannelFeeds();
      resolveMeta({ metaEvent: { id: 'meta' } });
      await pending;
      await Promise.resolve();
      expect(mockState.pool.subscribeMany).toHaveBeenCalledTimes(1);
    } finally {
      fetchChannelMetadata.mockImplementation(async () => ({ label: 'TestChannel', metaEvent: null, rootEvent: null }));
      pickChannelRootRelayHints.mockReturnValue([]);
    }
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

  it('correctly appends history to bottom even if DOM contains child elements with event class (like quotes)', async () => {
    const handlersList = [];
    mockState.pool.subscribeMany = vi.fn((relays, filters, handlers) => {
      handlersList.push(handlers);
      return { close: vi.fn() };
    });

    await subscribeChannelFeed('chan-root-quote', mockState, containerEl, mockSettingsManager);

    handlersList[0].onevent({
      id: 'ev-top-quote',
      kind: 42,
      pubkey: 'u1',
      created_at: 3000,
      content: 'Top message',
      tags: [['e', 'chan-root-quote', '', 'root']]
    });
    handlersList[0].oneose();

    // カード内に引用などの子要素（.event）をシミュレート
    const topMsgEl = containerEl.querySelector('.event[data-event-id="ev-top-quote"]');
    const childQuote = document.createElement('div');
    childQuote.className = 'event event-quote';
    childQuote.dataset.eventId = 'quoted-msg-xyz';
    topMsgEl.appendChild(childQuote);

    const loadMoreBtn = containerEl.querySelector('.load-more-btn');
    loadMoreBtn.click();

    expect(handlersList.length).toBe(2);
    handlersList[1].onevent({
      id: 'ev-old-hist',
      kind: 42,
      pubkey: 'u2',
      created_at: 1000,
      content: 'Old history',
      tags: [['e', 'chan-root-quote', '', 'root']]
    });
    handlersList[1].oneose();

    const topLevelIds = Array.from(containerEl.querySelectorAll(':scope > .event:not(.feed-bar)')).map(el => el.dataset.eventId);
    expect(topLevelIds).toEqual(['ev-top-quote', 'ev-old-hist']);
  });

  it('discards late loadMoreHistory results if channel feed was unsubscribed or reloaded', async () => {
    const handlersList = [];
    mockState.pool.subscribeMany = vi.fn((relays, filters, handlers) => {
      handlersList.push(handlers);
      return { close: vi.fn() };
    });

    await subscribeChannelFeed('chan-root-reload', mockState, containerEl, mockSettingsManager);

    handlersList[0].onevent({
      id: 'ev-top-1',
      kind: 42,
      pubkey: 'u1',
      created_at: 3000,
      content: 'Message 1',
      tags: [['e', 'chan-root-reload', '', 'root']]
    });
    handlersList[0].oneose();

    const loadMoreBtn = containerEl.querySelector('.load-more-btn');
    loadMoreBtn.click();

    expect(handlersList.length).toBe(2);
    // 1回目の loadMoreHistory が非同期通信中にリロード（unsubscribeAllChannelFeeds + 再購読）が発生
    unsubscribeAllChannelFeeds();
    containerEl.innerHTML = '';
    await subscribeChannelFeed('chan-root-reload', mockState, containerEl, mockSettingsManager);

    // 1回目の loadMoreHistory の EOSE が遅れて到着
    handlersList[1].onevent({
      id: 'ev-stale-history',
      kind: 42,
      pubkey: 'u2',
      created_at: 1000,
      content: 'Stale history',
      tags: [['e', 'chan-root-reload', '', 'root']]
    });
    handlersList[1].oneose();

    // 遅れて届いた古い過去ログは DOM に追加されていないこと
    expect(containerEl.querySelector('.event[data-event-id="ev-stale-history"]')).toBeNull();
  });

  it('does not show load-more button during initial message arrival before EOSE or limit', async () => {
    let handlers;
    mockState.pool.subscribeMany = vi.fn((relays, filters, h) => {
      handlers = h;
      return { close: vi.fn() };
    });

    await subscribeChannelFeed('chan-root-initial', mockState, containerEl, mockSettingsManager);

    // Initial loading indicator is shown
    expect(containerEl.querySelector('.muted.text-center')).not.toBeNull();

    // First event arrives while batch is still streaming
    handlers.onevent({
      id: 'ev-batch-1',
      kind: 42,
      pubkey: 'u1',
      created_at: 2000,
      content: 'Incoming 1',
      tags: [['e', 'chan-root-initial', '', 'root']]
    });

    // Event is in DOM, but load-more button is NOT yet shown (prevent premature load-more flash)
    expect(containerEl.querySelector('.event[data-event-id="ev-batch-1"]')).not.toBeNull();
    expect(containerEl.querySelector('.load-more-btn')).toBeNull();

    // Now EOSE fires -> batch is complete, load-more button is attached at bottom
    handlers.oneose();
    expect(containerEl.querySelector('.load-more-btn')).not.toBeNull();
  });

  it('keeps load-more available after a duplicate-only page and steps until back one second', async () => {
    const handlersList = [];
    const filtersList = [];
    mockState.pool.subscribeMany = vi.fn((_relays, filters, handlers) => {
      filtersList.push(filters);
      handlersList.push(handlers);
      return { close: vi.fn() };
    });

    await subscribeChannelFeed('chan-root-dup', mockState, containerEl, mockSettingsManager);

    handlersList[0].onevent({
      id: 'ev-dup-a',
      kind: 42,
      pubkey: 'u1',
      created_at: 1000,
      content: 'A',
      tags: [['e', 'chan-root-dup', '', 'root']]
    });
    handlersList[0].onevent({
      id: 'ev-dup-b',
      kind: 42,
      pubkey: 'u2',
      created_at: 1000,
      content: 'B',
      tags: [['e', 'chan-root-dup', '', 'root']]
    });
    handlersList[0].oneose();

    const loadMoreBtn = containerEl.querySelector('.load-more-btn');
    expect(loadMoreBtn).toBeTruthy();
    loadMoreBtn.click();

    expect(handlersList.length).toBe(2);
    expect(filtersList[1][0].until).toBe(1000);

    // Relay returns only already-known events at the boundary second
    handlersList[1].onevent({
      id: 'ev-dup-a',
      kind: 42,
      pubkey: 'u1',
      created_at: 1000,
      content: 'A',
      tags: [['e', 'chan-root-dup', '', 'root']]
    });
    handlersList[1].onevent({
      id: 'ev-dup-b',
      kind: 42,
      pubkey: 'u2',
      created_at: 1000,
      content: 'B',
      tags: [['e', 'chan-root-dup', '', 'root']]
    });
    handlersList[1].oneose();

    const btnAfterDup = containerEl.querySelector('.load-more-btn');
    expect(btnAfterDup).toBeTruthy();
    btnAfterDup.click();

    expect(handlersList.length).toBe(3);
    expect(filtersList[2][0].until).toBe(999);
  });

  it('adds optional p-tags from includedPubkeys on channel replies', async () => {
    const myPubkey = 'a'.repeat(64);
    const bobPubkey = 'b'.repeat(64);
    const carolPubkey = 'c'.repeat(64);
    const rootId = 'd'.repeat(64);
    const storage = new Map([['pubkey', myPubkey]]);
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k)
      },
      configurable: true
    });
    window.nostr = {
      getPublicKey: vi.fn(async () => myPubkey),
      signEvent: vi.fn(async (draft) => ({
        ...draft,
        pubkey: myPubkey,
        id: 'e'.repeat(64),
        sig: 'f'.repeat(128)
      }))
    };

    const published = [];
    const state = {
      signer: 'nip07',
      pubkey: myPubkey,
      relays: [{ url: 'wss://relay.example.com/', read: true, write: true }],
      pool: {
        publish: vi.fn(async (_relays, ev) => {
          published.push(ev);
          return [Promise.resolve('ok')];
        })
      }
    };

    const signed = await sendChannelMessage(rootId, 'channel reply', state, {
      replyToEvent: {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 42,
        tags: [['e', rootId, '', 'root']]
      },
      includedPubkeys: new Set([bobPubkey, carolPubkey])
    });

    expect(signed).toBeTruthy();
    expect(published).toHaveLength(1);
    expect(published[0].tags.some(t => t[0] === 'p' && t[1] === bobPubkey)).toBe(true);
    expect(published[0].tags.some(t => t[0] === 'p' && t[1] === carolPubkey)).toBe(true);
  });
});

