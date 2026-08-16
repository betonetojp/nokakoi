import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getReadRelays: vi.fn(() => ['wss://relay.example']),
  setupFeedFetcher: vi.fn(),
  subOnce: vi.fn(),
  unsubscribeAll: vi.fn()
}));

vi.mock('../../core/state.js', () => ({
  insertEventSorted: vi.fn(),
  findEventById: vi.fn(),
  clearFeed: vi.fn()
}));
vi.mock('../../core/relay.js', () => ({
  getReadRelays: mocks.getReadRelays,
  subOnce: mocks.subOnce,
  relayConnect: vi.fn(() => true),
  unsubscribeAll: mocks.unsubscribeAll,
  cancelInactiveTabOneshots: vi.fn()
}));
vi.mock('./feed-fetcher.js', () => ({
  setupFeedFetcher: mocks.setupFeedFetcher,
  updatePerFilterUntil: vi.fn()
}));
vi.mock('../emoji/custom-emoji-sub.js', () => ({
  setupCustomEmojiSubscription: vi.fn(),
  scheduleCustomEmojiSubscription: vi.fn()
}));
vi.mock('./feed-renderer.js', () => ({
  renderFeed: vi.fn(),
  scheduleRender: vi.fn(),
  userKind7Memory: new Map(),
  feedLoadState: {},
  ensureEventRestored: vi.fn()
}));
vi.mock('../channel/channel.js', () => ({ pickChannelRootId: vi.fn(), prefetchChannelMetadata: vi.fn() }));
vi.mock('../profile/profile.js', () => ({
  updateUserStatusDom: vi.fn(),
  updateNameDom: vi.fn(),
  loadProfile: vi.fn()
}));
vi.mock('../../ui/renderer.js', () => ({ applyReactionToButton: vi.fn() }));
vi.mock('../../utils/notification.js', () => ({
  showFeedNotification: vi.fn(),
  sanitizeNotificationBody: vi.fn(),
  ensureNotificationPermission: vi.fn(),
  shouldShowBrowserNotification: vi.fn(),
  normalizeMentionNotificationMode: vi.fn(),
  _notifiedEventIds: new Set()
}));
vi.mock('../../utils/i18n.js', () => ({ t: vi.fn((key) => key) }));
vi.mock('../../core/nostr-compat.js', () => ({
  getNip19: vi.fn(() => ({ npubEncode: vi.fn() })),
  getSimplePool: vi.fn(),
  getNostrTools: vi.fn(() => ({}))
}));
vi.mock('../../ui/ui-setup.js', () => ({ checkMentionBlink: vi.fn() }));
vi.mock('../../utils/utils.js', () => ({ setStatus: vi.fn() }));
vi.mock('./omochat-lifecycle.js', () => ({
  shouldConnectOmochatOnBoot: vi.fn(() => true),
  shouldLoadOmochatHistory: vi.fn(() => false)
}));
vi.mock('./feed-filters.js', () => ({
  buildHomeLoadMoreFiltersForGlobalMerge: vi.fn(() => []),
  getFeedBaseFilters: vi.fn(() => []),
  buildHomeLoadMoreFilters: vi.fn(() => [])
}));

import {
  initFeedManager,
  restartFeeds,
  setupBitchatFeed,
  setupGlobalFeed,
  setupSingleFeed,
  getRenderSettingsWithUiState
} from './feed-manager.js';

function createSettings(values) {
  return {
    settings: values,
    get: vi.fn((key) => values[key]),
    set: vi.fn((key, val) => { values[key] = val; }),
    saveUserReaction: vi.fn()
  };
}

function createFeed() {
  return { list: [], map: new Map() };
}

describe('feed manager startup lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getReadRelays.mockReturnValue(['wss://relay.example']);
    const values = new Map([['pubkey', 'me']]);
    globalThis.localStorage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => values.set(key, String(value))),
      removeItem: vi.fn((key) => values.delete(key))
    };
    globalThis.window = {
      __nokakoiMuteList: {},
      __mentionsInitialLoading: false,
      dispatchEvent: vi.fn()
    };
    globalThis.document = {
      querySelector: vi.fn(() => ({ dataset: { tab: 'global' } })),
      getElementById: vi.fn(() => null)
    };
    mocks.setupFeedFetcher.mockImplementation((opts) => ({
      feedId: opts.feedId,
      stopHist: vi.fn(),
      stopLive: vi.fn(),
      controller: { abort: vi.fn() }
    }));
    mocks.subOnce.mockImplementation((_state, key, _filters, callback) => {
      if (key === 'follows') {
        callback({ id: 'follows', tags: [['p', 'friend']] });
      }
      return vi.fn();
    });
  });

  it('keeps one global, home, and bitchat fetcher when startup events overlap', () => {
    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      subs: new Map(),
      feeds: {
        home: createFeed(),
        global: createFeed(),
        mentions: createFeed(),
        me: createFeed(),
        bitchat: createFeed()
      },
      followPetnames: new Map(),
      profiles: new Map(),
      userStatuses: new Map()
    };
    const settings = createSettings({
      globalMergeHome: false,
      globalRelay: ['wss://global.example'],
      showMusicStatus: false,
      showOmochat: true,
      showHomeOmochat: false,
      omochatAutoRelays: true,
      omochatComputedRelays: ['wss://omochat.example'],
      omochatGeohash: 'xn'
    });
    initFeedManager(state, settings);

    expect(restartFeeds(false)).toBe(true);
    expect(restartFeeds(false)).toBe(false);
    setupGlobalFeed();
    setupBitchatFeed();
    setupBitchatFeed();
    vi.advanceTimersByTime(1500);

    const feedIds = mocks.setupFeedFetcher.mock.calls.map(([opts]) => opts.feedId);
    expect(feedIds.filter((id) => id === 'global')).toHaveLength(1);
    expect(feedIds.filter((id) => id === 'home')).toHaveLength(1);
    expect(feedIds.filter((id) => id === 'bitchat')).toHaveLength(1);
    const bitchatOptions = mocks.setupFeedFetcher.mock.calls.find(([opts]) => opts.feedId === 'bitchat')[0];
    expect(bitchatOptions.histFilters).toEqual([]);
    expect(bitchatOptions.liveFilters).toHaveLength(1);
  });

  it('replaces bitchat only when its effective settings change', () => {
    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      subs: new Map(),
      feeds: { home: createFeed(), global: createFeed(), bitchat: createFeed() }
    };
    const values = {
      showOmochat: true,
      showHomeOmochat: false,
      omochatAutoRelays: true,
      omochatComputedRelays: ['wss://one.example'],
      omochatGeohash: 'xn'
    };
    const settings = createSettings(values);
    initFeedManager(state, settings);

    const first = setupBitchatFeed();
    expect(setupBitchatFeed()).toBe(first);
    expect(mocks.setupFeedFetcher).toHaveBeenCalledTimes(1);

    values.omochatComputedRelays = ['wss://two.example'];
    const second = setupBitchatFeed();
    expect(second).not.toBe(first);
    expect(mocks.setupFeedFetcher).toHaveBeenCalledTimes(2);
    expect(first.stopHist).toHaveBeenCalledTimes(1);
    expect(first.stopLive).toHaveBeenCalledTimes(1);
  });

  it('boots bitchat live-only and upgrades once to full history', () => {
    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      subs: new Map(),
      feeds: { home: createFeed(), global: createFeed(), bitchat: createFeed() }
    };
    const settings = createSettings({
      showOmochat: true,
      showHomeOmochat: false,
      omochatAutoRelays: true,
      omochatComputedRelays: ['wss://omochat.example'],
      omochatGeohash: 'xn'
    });
    initFeedManager(state, settings);

    const liveOnly = setupBitchatFeed();
    expect(mocks.setupFeedFetcher).toHaveBeenCalledTimes(1);
    expect(mocks.setupFeedFetcher.mock.calls[0][0].histFilters).toEqual([]);
    expect(mocks.setupFeedFetcher.mock.calls[0][0].liveFilters).toHaveLength(1);

    const full = setupBitchatFeed({ mode: 'full' });
    expect(full).not.toBe(liveOnly);
    expect(mocks.setupFeedFetcher).toHaveBeenCalledTimes(2);
    expect(mocks.setupFeedFetcher.mock.calls[1][0].histFilters).toHaveLength(1);
    expect(liveOnly.stopLive).toHaveBeenCalledTimes(1);

    expect(setupBitchatFeed({ mode: 'full' })).toBe(full);
    expect(mocks.setupFeedFetcher).toHaveBeenCalledTimes(2);
    expect(full.stopLive).not.toHaveBeenCalled();
  });

  it('keeps home history on all read relays and avoids the global relay for live', () => {
    const relayJp = 'wss://relay-jp.example';
    const relayUs = 'wss://relay-us.example';
    mocks.getReadRelays.mockReturnValue([relayJp, relayUs]);
    const state = {
      pool: {},
      relays: [relayJp, relayUs],
      subs: new Map(),
      feeds: {
        home: { ...createFeed(), follows: ['friend'], followSet: new Set(['friend']) },
        global: createFeed(),
        mentions: createFeed(),
        me: createFeed()
      }
    };
    const settings = createSettings({
      globalMergeHome: false,
      globalRelay: [relayJp],
      showHomeReactions: false,
      showHomeOmochat: false,
      showHomeChannel: false,
      showHomeRepost16: false,
      showMusicStatus: true
    });
    initFeedManager(state, settings);

    setupSingleFeed('home');

    const homeOptions = mocks.setupFeedFetcher.mock.calls.find(([opts]) => opts.feedId === 'home')[0];
    expect(homeOptions.relays).toEqual([relayJp, relayUs]);
    expect(homeOptions.liveRelays).toEqual([relayUs]);
  });

  it('reflects updated settings in getRenderSettingsWithUiState even if settingsManager.settings object is replaced', () => {
    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      subs: new Map(),
      feeds: { home: createFeed(), global: createFeed() }
    };
    const settingsObj = createSettings({
      showTimelineMedia: false
    });
    initFeedManager(state, settingsObj);

    let renderSettings = getRenderSettingsWithUiState('home');
    expect(renderSettings.showTimelineMedia).toBe(false);

    // settingsManager.settings オブジェクト自体が loadForAccount 等で置換されたケース
    settingsObj.settings = {
      showTimelineMedia: true
    };
    renderSettings = getRenderSettingsWithUiState('home');
    expect(renderSettings.showTimelineMedia).toBe(true);
  });
});
