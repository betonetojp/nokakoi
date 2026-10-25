// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  configureAppContext,
  resetAppContextForTests,
  setCustomEmojis
} from '../../core/app-context.js';
import { addCustomEmojiVariant } from '../emoji/custom-emoji-store.js';
import { enrichDraftTagsFromContent, replyToEvent } from './actions.js';

describe('replyToEvent & enrichDraftTagsFromContent (Quote Mode, NIP-30 Emojis, NIP-10/22 Threading)', () => {
  const myPubkey = 'a'.repeat(64);
  const bobPubkey = 'b'.repeat(64);
  const carolPubkey = 'c'.repeat(64);
  const rootPubkey = 'd'.repeat(64);
  let publishedEvents;
  let state;
  let settingsMap;

  beforeEach(() => {
    resetAppContextForTests();
    publishedEvents = [];
    settingsMap = new Map();

    const storageMap = new Map([['pubkey', myPubkey]]);
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((k) => storageMap.has(k) ? storageMap.get(k) : null),
        setItem: vi.fn((k, v) => storageMap.set(k, String(v))),
        removeItem: vi.fn((k) => storageMap.delete(k)),
        clear: vi.fn(() => storageMap.clear())
      },
      configurable: true,
      writable: true
    });

    window.nostr = {
      getPublicKey: vi.fn(async () => myPubkey),
      signEvent: vi.fn(async (draft) => ({
        ...draft,
        pubkey: myPubkey,
        id: 'f'.repeat(64),
        sig: 'e'.repeat(128)
      }))
    };
    window.__nokakoiQuoteMode = false;
    delete window.getQuoteMode;
    delete window.__nostrState;
    window.alert = vi.fn();

    const emojis = new Map();
    addCustomEmojiVariant(emojis, 'blobcat', 'https://example.com/blobcat.png');
    setCustomEmojis(emojis);

    const settingsManager = {
      get: (k) => settingsMap.get(k)
    };

    state = {
      signer: 'nip07',
      pubkey: myPubkey,
      relays: [{ url: 'wss://relay.example.com/', read: true, write: true }],
      profiles: new Map(),
      feeds: {
        home: { list: [], map: new Map() },
        global: { list: [], map: new Map() }
      },
      eventCache: new Map(),
      pool: {
        publish: vi.fn((_relays, ev) => {
          publishedEvents.push(ev);
          return [Promise.resolve('ok')];
        })
      }
    };

    configureAppContext({ state, settingsManager, customEmojis: emojis });
  });

  afterEach(() => {
    resetAppContextForTests();
    delete window.nostr;
    delete window.getQuoteMode;
    window.__nokakoiQuoteMode = false;
    vi.restoreAllMocks();
  });

  it('sends kind:1 quote with q tag and NIP-30 emoji tag even when alwaysUseNip22Comment is true or target is kind:1111', async () => {
    settingsMap.set('alwaysUseNip22Comment', true);
    window.getQuoteMode = () => true;

    const targetEv = {
      id: '1'.repeat(64),
      pubkey: bobPubkey,
      kind: 1111,
      content: 'NIP-22 comment',
      tags: [['E', '2'.repeat(64), 'wss://relay.example.com/', rootPubkey]]
    };

    const ok = await replyToEvent(state, targetEv, 'Look at this :blobcat: #nostr');
    expect(ok).toBe(true);
    expect(publishedEvents).toHaveLength(1);

    const sent = publishedEvents[0];
    expect(sent.kind).toBe(1);
    expect(sent.tags).toContainEqual(['q', targetEv.id, '', bobPubkey]);
    expect(sent.tags).toContainEqual(['emoji', 'blobcat', 'https://example.com/blobcat.png']);
    expect(sent.tags).toContainEqual(['t', 'nostr']);
    expect(sent.tags.some(t => t[0] === 'E')).toBe(false);
  });

  it('sends kind:1 quote when quoting a kind:42 channel message outside an open channel chat', async () => {
    window.getQuoteMode = () => true;
    window.isChannelChatOpen = () => false;

    const channelMsg = {
      id: '3'.repeat(64),
      pubkey: bobPubkey,
      kind: 42,
      content: 'channel hello',
      tags: [['e', '4'.repeat(64), 'wss://relay.example.com/', 'root']]
    };

    const ok = await replyToEvent(state, channelMsg, 'Quoting channel msg :blobcat:');
    expect(ok).toBe(true);
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0].kind).toBe(1);
    expect(publishedEvents[0].tags).toContainEqual(['q', channelMsg.id, '', bobPubkey]);
    expect(publishedEvents[0].tags).toContainEqual(['emoji', 'blobcat', 'https://example.com/blobcat.png']);
    delete window.isChannelChatOpen;
  });

  it('enriches kind:1111 NIP-22 comments with hashtag and custom emoji tags', () => {
    const draft = {
      kind: 1111,
      content: 'Nice comment :blobcat: #NIP22',
      tags: []
    };
    enrichDraftTagsFromContent(draft);

    expect(draft.tags).toContainEqual(['t', 'nip22']);
    expect(draft.tags).toContainEqual(['emoji', 'blobcat', 'https://example.com/blobcat.png']);
  });

  it('does not promote parent mention e-tag to root in NIP-10 reply and inherits thread p tags', async () => {
    const citedId = '9'.repeat(64);
    const parentTopLevelWithMention = {
      id: '5'.repeat(64),
      pubkey: bobPubkey,
      kind: 1,
      content: 'Top-level post citing another note',
      tags: [
        ['e', citedId, 'wss://relay.example.com/', 'mention'],
        ['p', carolPubkey]
      ]
    };

    const ok = await replyToEvent(state, parentTopLevelWithMention, 'Replying to top-level :blobcat:');
    expect(ok).toBe(true);
    expect(publishedEvents).toHaveLength(1);

    const sent = publishedEvents[0];
    expect(sent.kind).toBe(1);
    const eTags = sent.tags.filter(t => t[0] === 'e');
    expect(eTags).toEqual([
      ['e', parentTopLevelWithMention.id, '', 'root', bobPubkey]
    ]);
    expect(sent.tags).toContainEqual(['p', carolPubkey]);
    expect(sent.tags).toContainEqual(['p', bobPubkey, '']);
    expect(sent.tags).toContainEqual(['emoji', 'blobcat', 'https://example.com/blobcat.png']);
  });
});
