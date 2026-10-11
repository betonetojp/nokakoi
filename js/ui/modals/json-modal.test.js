import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeEventToNevent } from './json-modal.js';

describe('json-modal encodeEventToNevent', () => {
  const mockNip19 = {
    neventEncode: vi.fn((payload) => `nevent1_mock_${payload.id}`),
    decode: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a nevent string for a valid event', () => {
    const event = {
      id: 'event_hex_123',
      pubkey: 'pubkey_hex_456',
      kind: 1,
      content: 'hello'
    };
    const state = {
      relays: [{ url: 'wss://relay1.example.com', read: true }]
    };

    const result = encodeEventToNevent(event, state, mockNip19);
    expect(result).toBe('nevent1_mock_event_hex_123');
    expect(mockNip19.neventEncode).toHaveBeenCalledTimes(1);
    const payload = mockNip19.neventEncode.mock.calls[0][0];
    expect(payload.id).toBe('event_hex_123');
    expect(payload.author).toBe('pubkey_hex_456');
    expect(payload.kind).toBe(1);
  });

  it('returns null if event is null or has no id', () => {
    expect(encodeEventToNevent(null, null, mockNip19)).toBeNull();
    expect(encodeEventToNevent({}, null, mockNip19)).toBeNull();
    expect(encodeEventToNevent({ content: 'no id' }, null, mockNip19)).toBeNull();
  });

  it('falls back to nip19.nevent.encode if neventEncode is not available', () => {
    const legacyNip19 = {
      nevent: {
        encode: vi.fn((payload) => `nevent1_legacy_${payload.id}`)
      }
    };
    const event = { id: 'legacy_id' };
    const result = encodeEventToNevent(event, null, legacyNip19);
    expect(result).toBe('nevent1_legacy_legacy_id');
    expect(legacyNip19.nevent.encode).toHaveBeenCalledTimes(1);
  });

  it('integrates with real nostr-tools nip19 to produce decodable nevent', async () => {
    const { nip19 } = await import('nostr-tools');
    const event = {
      id: '0000000000000000000000000000000000000000000000000000000000000001',
      pubkey: '0000000000000000000000000000000000000000000000000000000000000002',
      kind: 1
    };

    const nevent = encodeEventToNevent(event, null, nip19);
    expect(nevent).toMatch(/^nevent1[a-z0-9]+$/);

    const decoded = nip19.decode(nevent);
    expect(decoded.type).toBe('nevent');
    expect(decoded.data.id).toBe(event.id);
    expect(decoded.data.author).toBe(event.pubkey);
  });
});
