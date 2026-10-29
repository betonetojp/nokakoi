// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  configureAppContext,
  resetAppContextForTests
} from '../../core/app-context.js';
import {
  extractReplyRecipients,
  extractQuoteRecipients,
  ReplyRecipientsManager,
  ensureHexPubkey
} from './reply-recipients.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { replyToEvent, publishNote } from './actions.js';

describe('reply-recipients & selective p-tag reply & quote', () => {
  const myPubkey = 'a'.repeat(64);
  const bobPubkey = 'b'.repeat(64);
  const carolPubkey = 'c'.repeat(64);
  const davePubkey = 'd'.repeat(64);
  const rootPubkey = 'e'.repeat(64);

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
        sig: '1'.repeat(128)
      }))
    };
    window.__nokakoiQuoteMode = false;
    delete window.getQuoteMode;
    delete window.__nostrState;
    window.alert = vi.fn();

    const settingsManager = {
      get: (k) => settingsMap.get(k)
    };

    state = {
      signer: 'nip07',
      pubkey: myPubkey,
      relays: [{ url: 'wss://relay.example.com/', read: true, write: true }],
      profiles: new Map([
        [bobPubkey, { name: 'Bob', picture: 'https://example.com/bob.png' }],
        [carolPubkey, { name: 'Carol' }],
        [davePubkey, { name: 'Dave' }],
        [rootPubkey, { name: 'RootUser' }]
      ]),
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

    configureAppContext({ state, settingsManager });
  });

  afterEach(() => {
    resetAppContextForTests();
    delete window.nostr;
    delete window.getQuoteMode;
    window.__nokakoiQuoteMode = false;
    vi.restoreAllMocks();
  });

  describe('ensureHexPubkey', () => {
    it('normalizes 64-char hex', () => {
      expect(ensureHexPubkey(bobPubkey.toUpperCase())).toBe(bobPubkey);
      expect(ensureHexPubkey('invalid')).toBeNull();
      expect(ensureHexPubkey('')).toBeNull();
      expect(ensureHexPubkey(null)).toBeNull();
    });
  });

  describe('extractReplyRecipients', () => {
    it('returns author only when post has no other p-tags and is root', () => {
      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Hello world',
        tags: []
      };

      const { author, others } = extractReplyRecipients(state, targetEv);
      expect(author.pubkey).toBe(bobPubkey);
      expect(author.isAuthor).toBe(true);
      expect(author.active).toBe(true);
      expect(others).toEqual([]);
    });

    it('extracts other p-tags as inactive by default, excluding author and self', () => {
      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Reply with mentions',
        tags: [
          ['p', carolPubkey],
          ['p', davePubkey],
          ['p', bobPubkey], // same as author -> should be ignored in others
          ['p', myPubkey]   // self -> should be ignored
        ]
      };

      const { author, others } = extractReplyRecipients(state, targetEv);
      expect(author.pubkey).toBe(bobPubkey);
      expect(author.active).toBe(true);
      expect(others).toHaveLength(2);
      expect(others[0].pubkey).toBe(carolPubkey);
      expect(others[0].active).toBe(false); // default off!
      expect(others[0].isAuthor).toBe(false);
      expect(others[1].pubkey).toBe(davePubkey);
      expect(others[1].active).toBe(false); // default off!
    });

    it('extracts root author from NIP-10 e-tags when parent is a thread reply', () => {
      const rootId = '2'.repeat(64);
      const rootEv = {
        id: rootId,
        pubkey: rootPubkey,
        kind: 1,
        content: 'Root thread note',
        tags: []
      };
      state.eventCache.set(rootId, rootEv);

      const targetEv = {
        id: '3'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Replying to root note with carol',
        tags: [
          ['e', rootId, 'wss://relay.example.com/', 'root'],
          ['p', carolPubkey]
        ]
      };

      const { author, others } = extractReplyRecipients(state, targetEv);
      expect(author.pubkey).toBe(bobPubkey);
      const pubkeys = others.map(o => o.pubkey);
      expect(pubkeys).toContain(carolPubkey);
      expect(pubkeys).toContain(rootPubkey);
      expect(others.every(o => o.active === false)).toBe(true);
    });
  });

  describe('extractQuoteRecipients', () => {
    it('extracts author in quoteMode as inactive by default', () => {
      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Note to quote',
        tags: []
      };

      const quotes = extractQuoteRecipients(state, targetEv, '', true);
      expect(quotes).toHaveLength(1);
      expect(quotes[0].pubkey).toBe(bobPubkey);
      expect(quotes[0].isAuthor).toBe(false);
      expect(quotes[0].isQuote).toBe(true);
      expect(quotes[0].active).toBe(false); // default off!
    });

    it('extracts multiple quote authors from content text and excludes self', () => {
      const nip19 = getNip19();
      const ev1Id = '1'.repeat(64);
      const ev2Id = '2'.repeat(64);
      state.eventCache.set(ev1Id, { id: ev1Id, pubkey: bobPubkey });
      state.eventCache.set(ev2Id, { id: ev2Id, pubkey: carolPubkey });

      const note1Str = nip19.noteEncode(ev1Id);
      const note2Str = nip19.noteEncode(ev2Id);

      const text = `Check nostr:${note1Str} and nostr:${note2Str}`;
      const quotes = extractQuoteRecipients(state, null, text, false, new Set(), nip19);

      const pks = quotes.map(q => q.pubkey);
      expect(pks).toContain(bobPubkey);
      expect(pks).toContain(carolPubkey);
      expect(quotes.every(q => q.isQuote === true && q.active === false)).toBe(true);
    });
  });

  describe('ReplyRecipientsManager UI & Toggle with Quotes', () => {
    let container;
    let chipsContainer;
    let noteInput;
    let manager;

    beforeEach(() => {
      container = document.createElement('div');
      container.id = 'replyRecipients';
      container.className = 'reply-recipients-container d-none';
      chipsContainer = document.createElement('div');
      chipsContainer.id = 'replyRecipientsChips';
      chipsContainer.className = 'reply-recipients-chips';
      container.appendChild(chipsContainer);
      document.body.appendChild(container);

      noteInput = document.createElement('textarea');
      noteInput.id = 'noteInput';
      document.body.appendChild(noteInput);

      manager = new ReplyRecipientsManager();
      manager.init(container);
    });

    afterEach(() => {
      manager.clear();
      container.remove();
      noteInput.remove();
    });

    it('keeps container hidden if there are no other recipients (only reply author)', () => {
      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Standalone post',
        tags: []
      };

      manager.setTarget(state, targetEv, null, false);
      expect(manager.hasOthers()).toBe(false);
      expect(container.classList.contains('d-none')).toBe(true);
      expect(manager.getActivePubkeys()).toEqual(new Set([bobPubkey]));
    });

    it('shows container in quoteMode with quote author default muted', () => {
      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Standalone post to quote',
        tags: []
      };

      manager.setTarget(state, targetEv, null, true);
      expect(manager.hasOthers()).toBe(true);
      expect(container.classList.contains('d-none')).toBe(false);

      const chips = chipsContainer.querySelectorAll('.reply-recipient-chip');
      expect(chips).toHaveLength(1);

      const quoteChip = chips[0];
      expect(quoteChip.dataset.pubkey).toBe(bobPubkey);
      expect(quoteChip.classList.contains('is-quote')).toBe(true);
      expect(quoteChip.classList.contains('is-muted')).toBe(true); // default off!
      expect(quoteChip.querySelector('.reply-recipient-badge').textContent).toBe('🔕');

      // Initially activePubkeys is empty because quote author is off by default
      expect(manager.getActivePubkeys().size).toBe(0);

      // Click to turn ON
      quoteChip.click();
      expect(manager.getActivePubkeys()).toEqual(new Set([bobPubkey]));
      expect(quoteChip.classList.contains('is-active')).toBe(true);
      expect(quoteChip.querySelector('.reply-recipient-badge').textContent).toBe('🔔');

      // Click again to turn OFF
      quoteChip.click();
      expect(manager.getActivePubkeys().size).toBe(0);
      expect(quoteChip.classList.contains('is-muted')).toBe(true);
      expect(quoteChip.querySelector('.reply-recipient-badge').textContent).toBe('🔕');
    });

    it('dynamically displays quote chips when multiple quotes exist in noteInput text', () => {
      const nip19 = getNip19();
      const ev1Id = '1'.repeat(64);
      const ev2Id = '2'.repeat(64);
      state.eventCache.set(ev1Id, { id: ev1Id, pubkey: bobPubkey });
      state.eventCache.set(ev2Id, { id: ev2Id, pubkey: carolPubkey });

      manager.setTarget(state, null);

      const note1Str = nip19.noteEncode(ev1Id);
      const note2Str = nip19.noteEncode(ev2Id);

      noteInput.value = `Quote 1 nostr:${note1Str} and Quote 2 nostr:${note2Str}`;
      manager.updateFromComposer();

      expect(manager.hasOthers()).toBe(true);
      expect(container.classList.contains('d-none')).toBe(false);

      const chips = chipsContainer.querySelectorAll('.reply-recipient-chip');
      expect(chips).toHaveLength(2);

      const pks = Array.from(chips).map(c => c.dataset.pubkey);
      expect(pks).toContain(bobPubkey);
      expect(pks).toContain(carolPubkey);
      expect(chips[0].classList.contains('is-muted')).toBe(true);
      expect(chips[1].classList.contains('is-muted')).toBe(true);

      // Toggle bobPubkey to ON
      chips[0].click();
      expect(manager.getActivePubkeys().has(chips[0].dataset.pubkey)).toBe(true);

      // Typing more text should maintain bobPubkey as ON
      noteInput.value += ' more typing...';
      manager.updateFromComposer();
      const updatedChips = chipsContainer.querySelectorAll('.reply-recipient-chip');
      expect(updatedChips).toHaveLength(2);
      const bobChipAfter = Array.from(updatedChips).find(c => c.dataset.pubkey === chips[0].dataset.pubkey);
      expect(bobChipAfter.classList.contains('is-active')).toBe(true);
      expect(bobChipAfter.querySelector('.reply-recipient-badge').textContent).toBe('🔔');
    });
  });

  describe('replyToEvent & publishNote with quote selective p-tags', () => {
    it('does not add p-tag in quoteMode when quote author is default OFF (includedPubkeys is empty)', async () => {
      window.getQuoteMode = () => true;

      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Quote me',
        tags: []
      };

      const ok = await replyToEvent(state, targetEv, 'My quote', {
        includedPubkeys: new Set() // Default: OFF
      });
      expect(ok).toBe(true);
      expect(publishedEvents).toHaveLength(1);

      const sent = publishedEvents[0];
      expect(sent.tags.some(t => t[0] === 'q' && t[1] === targetEv.id)).toBe(true);
      expect(sent.tags.some(t => t[0] === 'p')).toBe(false); // NO p-tag added!
    });

    it('adds p-tag in quoteMode when quote author is toggled ON', async () => {
      window.getQuoteMode = () => true;

      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Quote me',
        tags: []
      };

      const ok = await replyToEvent(state, targetEv, 'My quote with notification', {
        includedPubkeys: new Set([bobPubkey]) // Toggled ON!
      });
      expect(ok).toBe(true);
      expect(publishedEvents).toHaveLength(1);

      const sent = publishedEvents[0];
      expect(sent.tags.some(t => t[0] === 'q' && t[1] === targetEv.id)).toBe(true);
      expect(sent.tags).toContainEqual(['p', bobPubkey]); // p-tag added!
    });

    it('adds p-tags in publishNote when quotes are toggled ON in normal post', async () => {
      const ok = await publishNote(state, 'Hello with quotes', null, {
        tags: [
          ['p', bobPubkey],
          ['p', carolPubkey]
        ]
      });
      expect(ok).toBe(true);
      expect(publishedEvents).toHaveLength(1);

      const sent = publishedEvents[0];
      expect(sent.tags).toContainEqual(['p', bobPubkey]);
      expect(sent.tags).toContainEqual(['p', carolPubkey]);
    });
  });

  describe('showAvatars setting reflection in chips', () => {
    let container;
    let chipsContainer;
    let manager;

    beforeEach(() => {
      container = document.createElement('div');
      container.id = 'replyRecipients';
      container.className = 'reply-recipients-container d-none';
      chipsContainer = document.createElement('div');
      chipsContainer.id = 'replyRecipientsChips';
      chipsContainer.className = 'reply-recipients-chips';
      container.appendChild(chipsContainer);
      document.body.appendChild(container);

      manager = new ReplyRecipientsManager();
      manager.init(container);
    });

    afterEach(() => {
      manager.clear();
      container.remove();
    });

    it('shows avatar img when showAvatars is true', () => {
      settingsMap.set('showAvatars', true);
      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Reply with carol',
        tags: [['p', carolPubkey]]
      };

      manager.setTarget(state, targetEv);
      const bobChip = chipsContainer.querySelector(`.reply-recipient-chip[data-pubkey="${bobPubkey}"]`);
      expect(bobChip).not.toBeNull();
      const avatarImg = bobChip.querySelector('.nostr-preview-avatar');
      expect(avatarImg).not.toBeNull();
      expect(avatarImg.src).toBe('https://example.com/bob.png');
      expect(bobChip.querySelector('.nostr-preview-icon')).toBeNull();
    });

    it('shows no avatar img and no icon when showAvatars is false', () => {
      settingsMap.set('showAvatars', false);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: false }));

      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Reply with carol',
        tags: [['p', carolPubkey]]
      };

      manager.setTarget(state, targetEv);
      const bobChip = chipsContainer.querySelector(`.reply-recipient-chip[data-pubkey="${bobPubkey}"]`);
      expect(bobChip).not.toBeNull();
      expect(bobChip.querySelector('.nostr-preview-avatar')).toBeNull();
      expect(bobChip.querySelector('.nostr-preview-icon')).toBeNull();
    });

    it('dynamically switches avatar visibility when settings:showAvatarsUpdated is fired', () => {
      settingsMap.set('showAvatars', true);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: true }));

      const targetEv = {
        id: '1'.repeat(64),
        pubkey: bobPubkey,
        kind: 1,
        content: 'Reply with carol',
        tags: [['p', carolPubkey]]
      };

      manager.setTarget(state, targetEv);
      const bobChip = chipsContainer.querySelector(`.reply-recipient-chip[data-pubkey="${bobPubkey}"]`);
      expect(bobChip.querySelector('.nostr-preview-avatar')).not.toBeNull();

      // Setting turned OFF -> dispatch event
      settingsMap.set('showAvatars', false);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: false }));
      window.dispatchEvent(new CustomEvent('settings:showAvatarsUpdated'));

      expect(bobChip.querySelector('.nostr-preview-avatar')).toBeNull();
      expect(bobChip.querySelector('.nostr-preview-icon')).toBeNull();

      // Setting turned back ON -> dispatch event
      settingsMap.set('showAvatars', true);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: true }));
      window.dispatchEvent(new CustomEvent('settings:showAvatarsUpdated'));

      expect(bobChip.querySelector('.nostr-preview-avatar')).not.toBeNull();
      expect(bobChip.querySelector('.nostr-preview-icon')).toBeNull();
    });
  });
});
