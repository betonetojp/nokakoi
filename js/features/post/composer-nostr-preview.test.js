// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractMentions,
  extractQuotes,
  extractConvertibleIdentifiers,
  applyNostrPrefixToText,
  setupComposerNostrPreview
} from './composer-nostr-preview.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { configureAppContext, resetAppContextForTests } from '../../core/app-context.js';

// モックの nip19 デコーダー
const mockNip19 = {
  decode: vi.fn((str) => {
    if (str.startsWith('npub1alice')) {
      return { type: 'npub', data: 'alice_hex_pubkey' };
    }
    if (str.startsWith('nprofile1bob')) {
      return { type: 'nprofile', data: { pubkey: 'bob_hex_pubkey', relays: ['wss://relay.example'] } };
    }
    if (str.startsWith('nevent1event123')) {
      return { type: 'nevent', data: { id: 'event123_hex_id', relays: [] } };
    }
    if (str.startsWith('note1note456')) {
      return { type: 'note', data: 'note456_hex_id' };
    }
    throw new Error('Invalid bech32');
  })
};

describe('composer-nostr-preview', () => {
  describe('extractMentions', () => {
    it('nostr:npub1... と nostr:nprofile1... を正しく抽出する', () => {
      const text = 'Hello nostr:npub1alice0000000000000000000000000000000000000000000000000000000 and nostr:nprofile1bob1234567890!';
      const res = extractMentions(text, mockNip19);
      expect(res).toHaveLength(2);
      expect(res[0].pubkey).toBe('alice_hex_pubkey');
      expect(res[1].pubkey).toBe('bob_hex_pubkey');
    });

    it('同一 pubkey は重複排除される', () => {
      const text = 'nostr:npub1alice0000000000000000000000000000000000000000000000000000000 again nostr:npub1alice0000000000000000000000000000000000000000000000000000000';
      const res = extractMentions(text, mockNip19);
      expect(res).toHaveLength(1);
    });

    it('nostr: が付いていない npub1... は抽出しない', () => {
      const text = 'npub1alice0000000000000000000000000000000000000000000000000000000 is plain';
      const res = extractMentions(text, mockNip19);
      expect(res).toHaveLength(0);
    });
  });

  describe('extractQuotes', () => {
    it('nostr:nevent1... と nostr:note1... を正しく抽出する', () => {
      const text = 'Check nostr:nevent1event123abc and nostr:note1note45600000000000000000000000000000000000000000000000';
      const res = extractQuotes(text, mockNip19);
      expect(res).toHaveLength(2);
      expect(res[0].eventId).toBe('event123_hex_id');
      expect(res[1].eventId).toBe('note456_hex_id');
    });

    it('nostr: が付いていない nevent1... は抽出しない', () => {
      const text = 'nevent1event123abc is plain';
      const res = extractQuotes(text, mockNip19);
      expect(res).toHaveLength(0);
    });
  });

  describe('extractConvertibleIdentifiers', () => {
    it('nostr: が付いていない npub1, nprofile1, nevent1, note1 を検出する', () => {
      const text = 'Hello npub1alice0000000000000000000000000000000000000000000000000000000 and nevent1event123abc!';
      const res = extractConvertibleIdentifiers(text, mockNip19);
      expect(res).toHaveLength(2);
      expect(res[0].raw).toBe('npub1alice0000000000000000000000000000000000000000000000000000000');
      expect(res[0].isUser).toBe(true);
      expect(res[1].raw).toBe('nevent1event123abc');
      expect(res[1].isUser).toBe(false);
    });

    it('既に nostr: が付いているものは除外される', () => {
      const text = 'Already nostr:npub1alice0000000000000000000000000000000000000000000000000000000 here';
      const res = extractConvertibleIdentifiers(text, mockNip19);
      expect(res).toHaveLength(0);
    });
  });

  describe('applyNostrPrefixToText', () => {
    it('該当の識別子の直前に nostr: を正しく挿入する', () => {
      const target = 'npub1alice0000000000000000000000000000000000000000000000000000000';
      const text = `Hello ${target}, how are you?`;
      const updated = applyNostrPrefixToText(text, target);
      expect(updated).toBe(`Hello nostr:${target}, how are you?`);
    });

    it('すでに nostr: が付いている箇所には二重付与しない', () => {
      const target = 'npub1alice0000000000000000000000000000000000000000000000000000000';
      const text = `nostr:${target} and ${target}`;
      const updated = applyNostrPrefixToText(text, target);
      expect(updated).toBe(`nostr:${target} and nostr:${target}`);
    });
  });

  describe('setupComposerNostrPreview with showAvatars setting', () => {
    let composer;
    let noteInput;
    let handler;
    const aliceHex = 'a'.repeat(64);
    let aliceNpub;
    let state;
    let settingsMap;

    beforeEach(() => {
      resetAppContextForTests();
      settingsMap = new Map();
      const settingsManager = {
        get: (k) => settingsMap.get(k)
      };

      const nip19 = getNip19();
      aliceNpub = nip19.npubEncode(aliceHex);

      state = {
        profiles: new Map([
          [aliceHex, { name: 'Alice', picture: 'https://example.com/alice.png' }]
        ])
      };
      configureAppContext({ state, settingsManager });

      composer = document.createElement('div');
      composer.id = 'composer';
      noteInput = document.createElement('textarea');
      noteInput.id = 'noteInput';
      composer.appendChild(noteInput);
      document.body.appendChild(composer);
    });

    afterEach(() => {
      if (handler && typeof handler.clear === 'function') handler.clear();
      composer.remove();
      resetAppContextForTests();
    });

    it('shows avatar img in mention chip when showAvatars is true', () => {
      settingsMap.set('showAvatars', true);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: true }));

      handler = setupComposerNostrPreview(state, noteInput, composer);

      noteInput.value = `Hello nostr:${aliceNpub}`;
      handler.render();

      const chip = composer.querySelector('.nostr-mention-chip');
      expect(chip).not.toBeNull();
      const avatar = chip.querySelector('.nostr-preview-avatar');
      expect(avatar).not.toBeNull();
      expect(avatar.src).toBe('https://example.com/alice.png');
      expect(chip.querySelector('.nostr-preview-icon')).toBeNull();
    });

    it('shows no avatar img and no icon in mention chip when showAvatars is false', () => {
      settingsMap.set('showAvatars', false);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: false }));

      handler = setupComposerNostrPreview(state, noteInput, composer);

      noteInput.value = `Hello nostr:${aliceNpub}`;
      handler.render();

      const chip = composer.querySelector('.nostr-mention-chip');
      expect(chip).not.toBeNull();
      expect(chip.querySelector('.nostr-preview-avatar')).toBeNull();
      expect(chip.querySelector('.nostr-preview-icon')).toBeNull();
    });

    it('dynamically switches avatar img visibility when settings:showAvatarsUpdated is fired', () => {
      settingsMap.set('showAvatars', true);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: true }));

      handler = setupComposerNostrPreview(state, noteInput, composer);

      noteInput.value = `Hello nostr:${aliceNpub}`;
      handler.render();

      const chip = composer.querySelector('.nostr-mention-chip');
      expect(chip.querySelector('.nostr-preview-avatar')).not.toBeNull();

      // Switch to false
      settingsMap.set('showAvatars', false);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: false }));
      window.dispatchEvent(new CustomEvent('settings:showAvatarsUpdated'));

      const chipOff = composer.querySelector('.nostr-mention-chip');
      expect(chipOff.querySelector('.nostr-preview-avatar')).toBeNull();
      expect(chipOff.querySelector('.nostr-preview-icon')).toBeNull();

      // Switch back to true
      settingsMap.set('showAvatars', true);
      localStorage.setItem('appSettings', JSON.stringify({ showAvatars: true }));
      window.dispatchEvent(new CustomEvent('settings:showAvatarsUpdated'));

      const chipOn = composer.querySelector('.nostr-mention-chip');
      expect(chipOn.querySelector('.nostr-preview-avatar')).not.toBeNull();
      expect(chipOn.querySelector('.nostr-preview-icon')).toBeNull();
    });
  });
});
