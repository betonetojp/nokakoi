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

import { subscribeChannelFeed } from './channel-feed.js';

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
});

