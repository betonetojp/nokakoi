import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLnurlEndpoint,
  buildZapCallbackUrl,
  toCanonicalZapRequest,
  bolt11HasDescriptionHash,
  buildZapReceiptRelays,
  getZapReceiptAmountSats,
  getZapReceiptTargetEventId,
  getEventDisplayPubkey,
  buildZapPaymentTarget,
  toLightningUri,
  zapReceiptMatchesPayment,
  applyZapReceiptToZappedState,
  isIncomingZapReceiptFor,
  isOutgoingZapReceiptFor,
  loadZapAmountHistory,
  getLastZapAmount,
  rememberZapAmount,
  removeZapAmount
} from './zap.js';

describe('Zap Service Helpers', () => {
  describe('getLnurlEndpoint', () => {
    it('should resolve lud16 Lightning Address to HTTPS endpoint', () => {
      const endpoint = getLnurlEndpoint('user@domain.com');
      expect(endpoint).toBe('https://domain.com/.well-known/lnurlp/user');
    });

    it('should resolve bech32 lud06 to decoded HTTPS endpoint', () => {
      // lnurl1dp68gurn8ghj7er0d4skjm3wvdhk6tmvde6hympdwpshj25tl6g
      // (https://domain.com/lnurl-pay)
      const endpoint = getLnurlEndpoint('lnurl1dp68gurn8ghj7er0d4skjm3wvdhk6tmvde6hympdwpshj25tl6g');
      expect(endpoint).toBe('https://domain.com/lnurl-pay');
    });

    it('should return null for invalid addresses', () => {
      expect(getLnurlEndpoint('')).toBeNull();
      expect(getLnurlEndpoint('invalid')).toBeNull();
    });
  });

  describe('toCanonicalZapRequest', () => {
    it('should keep only NIP-01 event fields and prefer sig over signature', () => {
      const canonical = toCanonicalZapRequest({
        kind: '9734',
        created_at: 123,
        content: 'hi',
        tags: [['p', 'aa']],
        pubkey: 'bb',
        id: 'cc',
        sig: 'dd',
        signature: 'ignored',
        extra: true
      });
      expect(canonical).toEqual({
        kind: 9734,
        created_at: 123,
        content: 'hi',
        tags: [['p', 'aa']],
        pubkey: 'bb',
        id: 'cc',
        sig: 'dd'
      });
      expect(Object.keys(canonical)).not.toContain('extra');
    });
  });

  describe('buildZapCallbackUrl', () => {
    const zapRequest = {
      kind: 9734,
      created_at: 123,
      content: '',
      tags: [['p', 'aa'], ['amount', '1000'], ['relays', 'wss://yabu.me']],
      pubkey: 'bb',
      id: 'cc',
      sig: 'dd'
    };

    it('should encode nostr with encodeURI so decodeURI can JSON.parse (nostter/NIP-57)', () => {
      const url = buildZapCallbackUrl('https://callback.example/lnurl', 1000, zapRequest);
      const nostrRaw = url.split('nostr=')[1];
      expect(JSON.parse(decodeURI(nostrRaw))).toMatchObject({ kind: 9734, id: 'cc' });
      expect(nostrRaw).toContain(':');
      expect(nostrRaw).not.toContain('%3A');
    });

    it('should append params with & when callback already has a query string', () => {
      const url = buildZapCallbackUrl('https://callback.example/lnurl?q=keep', 50000, zapRequest);
      expect(url).toContain('https://callback.example/lnurl?q=keep&amount=50000&nostr=');
    });

    it('should never add LNURL comment query param (Coinos overwrites zap memo with it)', () => {
      const url = buildZapCallbackUrl('https://callback.example/lnurl', 1000, zapRequest, 'hello', 255);
      expect(url).not.toContain('comment=');
    });
  });

  describe('buildZapReceiptRelays', () => {
    it('should put zapline-jp relays first and cap the list', () => {
      const relays = buildZapReceiptRelays(['wss://yabu.me/', 'wss://custom.example']);
      expect(relays[0]).toBe('wss://yabu.me');
      expect(relays).toContain('wss://nos.lol');
      expect(relays).toContain('wss://custom.example');
      expect(relays.length).toBeLessThanOrEqual(8);
    });
  });

  describe('bolt11HasDescriptionHash', () => {
    // BOLT11 spec examples (lightning/bolts 11-payment-encoding.md)
    const withDescription = 'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
    const withDescriptionHash = 'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44';

    it('should detect description_hash invoices used for zaps', () => {
      expect(bolt11HasDescriptionHash(withDescriptionHash)).toBe(true);
    });

    it('should reject regular description invoices', () => {
      expect(bolt11HasDescriptionHash(withDescription)).toBe(false);
    });

    it('should reject invalid strings', () => {
      expect(bolt11HasDescriptionHash('')).toBe(false);
      expect(bolt11HasDescriptionHash('lnbc1xyz')).toBe(false);
    });
  });

  describe('getZapReceiptAmountSats', () => {
    it('should use description zap request amount when receipt has no amount tag (Coinos)', () => {
      const ev = {
        kind: 9735,
        tags: [
          ['p', 'aa'],
          ['description', JSON.stringify({
            kind: 9734,
            tags: [['amount', '50000']],
            content: 'てすと'
          })],
          ['bolt11', 'lnbc500n1p4guk0x']
        ]
      };
      expect(getZapReceiptAmountSats(ev)).toBe(50);
    });

    it('should prefer receipt amount tag when present', () => {
      const ev = {
        kind: 9735,
        tags: [
          ['amount', '21000'],
          ['description', JSON.stringify({ tags: [['amount', '50000']] })]
        ]
      };
      expect(getZapReceiptAmountSats(ev)).toBe(21);
    });
  });

  describe('zap receipt sender state', () => {
    it('reads target event id from the last e tag', () => {
      expect(getZapReceiptTargetEventId({
        tags: [['e', 'root'], ['e', 'note1']]
      })).toBe('note1');
    });

    it('uses zap sender, not LN server, as the display pubkey', () => {
      const ev = {
        kind: 9735,
        pubkey: 'coinos-ln-server',
        tags: [
          ['p', 'recipient'],
          ['P', 'sender'],
          ['e', 'note1']
        ]
      };
      expect(getEventDisplayPubkey(ev)).toBe('sender');
      expect(getEventDisplayPubkey({ kind: 1, pubkey: 'alice' })).toBe('alice');
    });

    it('pays the zap sender as a profile zap, not the LN server receipt', () => {
      const receipt = {
        kind: 9735,
        id: 'receipt1',
        pubkey: 'coinos-ln-server',
        tags: [
          ['p', 'recipient'],
          ['P', 'sender'],
          ['e', 'note1']
        ]
      };
      expect(buildZapPaymentTarget(receipt)).toEqual({
        recipientPubkey: 'sender',
        event: null
      });
      expect(buildZapPaymentTarget({ kind: 1, id: 'note1', pubkey: 'alice', tags: [] })).toEqual({
        recipientPubkey: 'alice',
        event: { id: 'note1', pubkey: 'alice', kind: 1, tags: [] }
      });
    });

    it('builds a lightning: URI for Wallet of Satoshi and other wallets', () => {
      expect(toLightningUri('lnbc1abc')).toBe('lightning:lnbc1abc');
      expect(toLightningUri('lightning:lnbc1abc')).toBe('lightning:lnbc1abc');
      expect(toLightningUri('')).toBe('');
    });

    it('matches an outgoing zap receipt for note and profile payments', () => {
      const receipt = {
        kind: 9735,
        pubkey: 'ln-server',
        tags: [
          ['p', 'recipient'],
          ['P', 'sender'],
          ['e', 'note1']
        ]
      };
      expect(zapReceiptMatchesPayment(receipt, {
        senderPubkey: 'sender',
        eventId: 'note1'
      })).toBe(true);
      expect(zapReceiptMatchesPayment(receipt, {
        senderPubkey: 'other',
        eventId: 'note1'
      })).toBe(false);
      expect(zapReceiptMatchesPayment({
        kind: 9735,
        tags: [['p', 'recipient'], ['P', 'sender']]
      }, {
        senderPubkey: 'sender',
        recipientPubkey: 'recipient'
      })).toBe(true);
    });

    it('treats p tag as incoming receipt, not P', () => {
      const ev = {
        kind: 9735,
        tags: [
          ['p', 'recipient'],
          ['P', 'sender'],
          ['e', 'note1']
        ]
      };
      expect(isIncomingZapReceiptFor(ev, 'recipient')).toBe(true);
      expect(isIncomingZapReceiptFor(ev, 'sender')).toBe(false);
      expect(isOutgoingZapReceiptFor(ev, 'sender')).toBe(true);
      expect(isOutgoingZapReceiptFor(ev, 'recipient')).toBe(false);
    });

    it('marks the target note when the logged-in user sent the zap', () => {
      globalThis.localStorage = {
        getItem: (key) => (key === 'pubkey' ? 'sender' : null),
        setItem: () => {},
        removeItem: () => {}
      };
      const state = { zappedEventIds: new Set() };
      const ev = {
        kind: 9735,
        tags: [
          ['p', 'recipient'],
          ['P', 'sender'],
          ['e', 'note1']
        ]
      };
      expect(applyZapReceiptToZappedState(state, ev)).toBe(true);
      expect(state.zappedEventIds.has('note1')).toBe(true);
    });
  });

  describe('zap amount history', () => {
    beforeEach(() => {
      const store = new Map([['pubkey', 'sender']]);
      globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key)
      };
    });

    it('stores unique amounts sorted ascending and remembers last', () => {
      rememberZapAmount(100);
      rememberZapAmount(21);
      rememberZapAmount(100);
      expect(loadZapAmountHistory()).toEqual([21, 100]);
      expect(getLastZapAmount()).toBe(100);
    });

    it('can add without changing last and can remove an amount', () => {
      rememberZapAmount(50, { asLast: true });
      rememberZapAmount(21, { asLast: false });
      expect(loadZapAmountHistory()).toEqual([21, 50]);
      expect(getLastZapAmount()).toBe(50);
      expect(removeZapAmount(50)).toEqual([21]);
      expect(getLastZapAmount()).toBeNull();
    });
  });
});
