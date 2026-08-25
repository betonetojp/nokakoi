// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { pickETagEventId, pickETagWithHint } from './render-helpers.js';

describe('render-helpers pickETag functions', () => {
  describe('kind: 1111 (NIP-22 comments)', () => {
    it('picks lowercase e tag over uppercase E tag when replying to a comment', () => {
      const ev = {
        kind: 1111,
        content: 'ごめーん',
        tags: [
          [
            'E',
            'ecc0ca9eab80a1e191aaea692fda5f973dc811d4402af791291ca3d8aa188da6',
            'wss://yabu.me',
            '6b0a60cff3eca5a2b2505ccb3f7133d8422045cbef40f3d2c6189fb0b952e7d4'
          ],
          ['K', '1'],
          ['P', '6b0a60cff3eca5a2b2505ccb3f7133d8422045cbef40f3d2c6189fb0b952e7d4'],
          [
            'e',
            'c7950c9102abc2230060a4c2dad811f2574035211d5450135aa4d63222eb01a3',
            'wss://yabu.me/',
            '21ac29561b5de90cdc21995fc0707525cd78c8a52d87721ab681d3d609d1e2df'
          ],
          ['k', '1111'],
          ['p', '21ac29561b5de90cdc21995fc0707525cd78c8a52d87721ab681d3d609d1e2df', 'wss://r.ydg.works/']
        ]
      };

      expect(pickETagEventId(ev)).toBe('c7950c9102abc2230060a4c2dad811f2574035211d5450135aa4d63222eb01a3');
      const { eventId, relayHint } = pickETagWithHint(ev);
      expect(eventId).toBe('c7950c9102abc2230060a4c2dad811f2574035211d5450135aa4d63222eb01a3');
      expect(relayHint).toBe('wss://yabu.me/');
    });

    it('picks uppercase E tag when replying directly to root (no lowercase e tag)', () => {
      const ev = {
        kind: 1111,
        content: 'Root comment',
        tags: [
          [
            'E',
            'root1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            'wss://relay.example.com',
            'pubkey123'
          ],
          ['K', '1'],
          ['P', 'pubkey123']
        ]
      };

      expect(pickETagEventId(ev)).toBe('root1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      const { eventId, relayHint } = pickETagWithHint(ev);
      expect(eventId).toBe('root1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      expect(relayHint).toBe('wss://relay.example.com');
    });
  });

  describe('kind: 1 (NIP-10 replies)', () => {
    it('picks reply marker over root marker', () => {
      const ev = {
        kind: 1,
        content: 'reply',
        tags: [
          ['e', 'rootId123', 'wss://relay.example.com', 'root'],
          ['e', 'replyId456', 'wss://relay.example.com', 'reply']
        ]
      };

      expect(pickETagEventId(ev)).toBe('replyId456');
      expect(pickETagWithHint(ev).eventId).toBe('replyId456');
    });

    it('handles positional/unmarked e tags with pubkey in t[3]', () => {
      const ev = {
        kind: 1,
        content: 'reply',
        tags: [
          ['e', 'rootId123', 'wss://relay.example.com', 'root'],
          ['e', 'replyId456', 'wss://relay.example.com', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef']
        ]
      };

      expect(pickETagEventId(ev)).toBe('replyId456');
      expect(pickETagWithHint(ev).eventId).toBe('replyId456');
    });
  });
});
