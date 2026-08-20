import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  finalizeEvent: vi.fn(event => ({ ...event, id: 'signed' })),
  getPublicKey: vi.fn(() => '1'.repeat(64))
}));

vi.mock('./nostr-compat.js', () => ({
  getFinalizeEvent: () => mocks.finalizeEvent,
  getNip04: vi.fn(),
  getNip19: () => ({
    decode: vi.fn(() => ({ data: new Uint8Array(32).fill(2), type: 'npub' }))
  }),
  getNip44: vi.fn(),
  getPublicKey: () => mocks.getPublicKey,
  getSimplePool: vi.fn()
}));
vi.mock('./crypto.js', () => ({
  bytesToHex: bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''),
  hexToBytes: hex => Uint8Array.from(hex.match(/.{2}/g).map(byte => parseInt(byte, 16))),
  randomBytes: length => new Uint8Array(length).fill(1)
}));
vi.mock('../utils/i18n.js', () => ({
  t: (key, params) => params?.msg ? `${key}:${params.msg}` : key
}));

import { DEFAULT_NIP46_RELAYS, Nip46Client } from './nip46.js';

describe('NIP-46 client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window = { location: { origin: 'https://example.test' } };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses bunker URIs, relay lists and secrets', () => {
    const client = new Nip46Client({ relays: ['wss://fallback.example'] });
    const pubkey = 'A'.repeat(64);

    expect(client.parseBunkerUri(
      `bunker://${pubkey}?relay=wss%3A%2F%2Fone.example&relay=wss%3A%2F%2Ftwo.example&secret=s`
    )).toEqual({
      remotePubkey: pubkey.toLowerCase(),
      relays: ['wss://one.example', 'wss://two.example'],
      secret: 's'
    });
    expect(() => client.parseBunkerUri('https://invalid')).toThrow('nip46.invalid_bunker_uri');
  });

  it('decodes npub bunker identities and uses configured relay fallback', () => {
    const client = new Nip46Client({ relays: ['wss://fallback.example'] });
    expect(client.parseBunkerUri('bunker://npub1test')).toEqual({
      remotePubkey: '02'.repeat(32),
      relays: ['wss://fallback.example'],
      secret: null
    });
  });

  it('generates a connect URI after initializing a fixed local key', () => {
    const client = new Nip46Client({
      metadata: { name: 'test' },
      relays: ['wss://relay.example']
    });
    client.initLocalKey('01'.repeat(32));

    const uri = new URL(client.generateConnectUri());

    expect(uri.protocol).toBe('nostrconnect:');
    expect(uri.hostname).toBe('1'.repeat(64));
    expect(uri.searchParams.getAll('relay')).toEqual(['wss://relay.example']);
    expect(uri.searchParams.get('secret')).toBe('01'.repeat(16));
  });

  it('times out requests and removes pending state', async () => {
    vi.useFakeTimers();
    const client = new Nip46Client({ relays: ['wss://relay.example'] });
    client.localSecretKey = '01'.repeat(32);
    client.remotePubkey = '02'.repeat(32);
    client._encrypt = vi.fn(async () => 'ciphertext');
    client._getPool = vi.fn(() => ({
      publish: vi.fn(() => [Promise.resolve()])
    }));

    const request = client._sendRequest('ping', [], 25);
    const rejection = expect(request).rejects.toThrow('nip46.request_timeout');
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(client.pendingRequests.size).toBe(0);
  });

  it('restores saved session data before reconnecting', async () => {
    const client = new Nip46Client();
    client._resetTransport = vi.fn();
    client._subscribe = vi.fn();
    client._reestablishSession = vi.fn(async () => ({ connected: true, verified: true }));

    await expect(client.restoreConnection({
      localSecretKey: '01'.repeat(32),
      remotePubkey: '02'.repeat(32),
      userPubkey: '03'.repeat(32),
      relays: ['wss://saved.example'],
      secret: 'saved'
    })).resolves.toEqual({ connected: true, verified: true });

    expect(client.remotePubkey).toBe('02'.repeat(32));
    expect(client.userPubkey).toBe('03'.repeat(32));
    expect(client.relays).toEqual(['wss://saved.example']);
    expect(client._subscribe).toHaveBeenCalled();
  });

  it('forwards a public-key timeout to the NIP-46 request', async () => {
    const client = new Nip46Client();
    client.ensureConnected = vi.fn(async () => {});
    client.connected = true;
    client._sendRequest = vi.fn(async () => '03'.repeat(32));

    await expect(client.getPublicKey(5000)).resolves.toBe('03'.repeat(32));
    expect(client._sendRequest).toHaveBeenCalledWith('get_public_key', [], 5000);
  });

  it('uses a non-published signature result when get_public_key is unavailable', async () => {
    const client = new Nip46Client();
    client.getPublicKey = vi.fn(async () => { throw new Error('unknown method'); });
    client.signEvent = vi.fn(async () => ({ pubkey: '04'.repeat(32) }));

    await expect(client.resolveUserPubkey(5000)).resolves.toBe('04'.repeat(32));
    expect(client.signEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 1,
      content: '',
      tags: []
    }), 5000);
    expect(client.userPubkey).toBe('04'.repeat(32));
  });

  it('uses independent default relay arrays', () => {
    const first = new Nip46Client();
    const second = new Nip46Client();
    first.relays.pop();
    expect(second.relays).toHaveLength(DEFAULT_NIP46_RELAYS.length);
  });
});
