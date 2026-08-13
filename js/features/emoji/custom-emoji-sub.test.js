import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addCustomEmojiVariant: vi.fn(),
  setCustomEmojis: vi.fn(),
  subOnce: vi.fn()
}));

vi.mock('../../core/relay.js', () => ({
  getReadRelays: vi.fn(() => ['wss://relay.example']),
  subOnce: mocks.subOnce
}));
vi.mock('./custom-emoji-store.js', () => ({
  addCustomEmojiVariant: mocks.addCustomEmojiVariant
}));
vi.mock('../../core/app-context.js', () => ({
  setCustomEmojis: mocks.setCustomEmojis
}));

import {
  initCustomEmojiSub,
  setupCustomEmojiSubscription
} from './custom-emoji-sub.js';

function createState() {
  return {
    pool: {},
    relays: ['wss://relay.example'],
    subs: new Map(),
    customEmojis: new Map(),
    feeds: { home: { follows: [] } }
  };
}

describe('managed custom emoji startup requests', () => {
  let values;
  let state;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    values = new Map([['pubkey', 'account-a']]);
    globalThis.localStorage = {
      getItem: vi.fn((key) => values.get(key) ?? null)
    };
    globalThis.Event = class {
      constructor(type) { this.type = type; }
    };
    globalThis.window = { dispatchEvent: vi.fn() };
    state = createState();
    initCustomEmojiSub(state, { get: vi.fn(() => false) });
  });

  it('uses managed list and set requests and finalizes each once', () => {
    const calls = [];
    mocks.subOnce.mockImplementation((_state, key, filters, callback) => {
      const unsubscribe = vi.fn();
      calls.push({ key, filters, callback, unsubscribe });
      return unsubscribe;
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    setupCustomEmojiSubscription();
    expect(calls[0].key).toBe('custom-emoji-list:account-a');
    expect(calls[0].filters).toEqual([
      { kinds: [10030], authors: ['account-a'], limit: 1000 }
    ]);

    calls[0].callback({
      id: 'list',
      kind: 10030,
      pubkey: 'account-a',
      created_at: 10,
      tags: [['a', '30030:set-author:faces']]
    }, 'wss://relay.example', false);
    calls[0].callback(null, 'wss://relay.example', true);
    calls[0].callback(null, 'wss://relay.example', true);

    expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls[1].key).toBe('custom-emoji-sets:account-a');
    expect(calls[1].filters).toEqual([{
      kinds: [30030],
      authors: ['set-author'],
      '#d': ['faces'],
      limit: 1000
    }]);

    const setEvent = {
      id: 'set-event',
      kind: 30030,
      pubkey: 'set-author',
      created_at: 20,
      tags: [['d', 'faces'], ['emoji', 'wave', 'https://example.com/wave.png']]
    };
    calls[1].callback(setEvent, 'wss://relay.example', false);
    calls[1].callback(setEvent, 'wss://relay.example', false);
    calls[1].callback(null, 'wss://relay.example', true);
    calls[1].callback(null, 'wss://relay.example', true);

    expect(mocks.addCustomEmojiVariant).toHaveBeenCalledTimes(1);
    expect(calls[1].unsubscribe).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls.filter(([message]) => message.includes('初期ロード完了'))).toHaveLength(1);
    expect(state.subs.size).toBe(0);
  });

  it('cancels the old setup and ignores its stale callbacks', () => {
    const calls = [];
    mocks.subOnce.mockImplementation((_state, key, _filters, callback) => {
      const unsubscribe = vi.fn();
      calls.push({ key, callback, unsubscribe });
      return unsubscribe;
    });

    setupCustomEmojiSubscription();
    const old = calls[0];
    values.set('pubkey', 'account-b');
    setupCustomEmojiSubscription();

    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls[1].key).toBe('custom-emoji-list:account-b');

    old.callback({
      id: 'stale-list',
      kind: 10030,
      pubkey: 'account-a',
      created_at: 10,
      tags: [['emoji', 'stale', 'https://example.com/stale.png']]
    }, 'wss://relay.example', false);
    old.callback(null, 'wss://relay.example', true);

    expect(mocks.addCustomEmojiVariant).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it('runs timeout finalization only once', () => {
    vi.useFakeTimers();
    const calls = [];
    mocks.subOnce.mockImplementation((_state, key, _filters, callback) => {
      const unsubscribe = vi.fn();
      calls.push({ key, callback, unsubscribe });
      return unsubscribe;
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    setupCustomEmojiSubscription();
    calls[0].callback({
      id: 'list',
      kind: 10030,
      pubkey: 'account-a',
      created_at: 10,
      tags: [['a', '30030:set-author:faces']]
    }, 'wss://relay.example', false);

    vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(2);
    expect(calls[0].unsubscribe).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    calls[1].callback(null, 'wss://relay.example', true);
    expect(calls[1].unsubscribe).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls.filter(([message]) => message.includes('初期ロード完了'))).toHaveLength(1);
  });
});
