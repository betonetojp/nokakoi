import { describe, it, expect } from 'vitest';
import { parseNwcUri } from './nwc.js';

describe('NWC URI Parser', () => {
  it('should parse valid NWC URI with nostr+walletconnect scheme', () => {
    const uri = 'nostr+walletconnect://ab1234567890abcdef01234567890abcdef01234567890abcdef01234567890abc?relay=wss://relay.damus.io&secret=ef567890ef567890ef567890ef567890ef567890ef567890ef567890ef567890&lud16=test@domain.com';
    const parsed = parseNwcUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed.walletPubkey).toBe('ab1234567890abcdef01234567890abcdef01234567890abcdef01234567890abc');
    expect(parsed.relay).toBe('wss://relay.damus.io');
    expect(parsed.secret).toBe('ef567890ef567890ef567890ef567890ef567890ef567890ef567890ef567890');
    expect(parsed.lud16).toBe('test@domain.com');
  });

  it('should parse without lud16', () => {
    const uri = 'nostr+walletconnect://ab1234567890abcdef01234567890abcdef01234567890abcdef01234567890abc?relay=wss://relay.damus.io&secret=ef567890ef567890ef567890ef567890ef567890ef567890ef567890ef567890';
    const parsed = parseNwcUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed.lud16).toBeNull();
  });

  it('should return null for invalid URI', () => {
    expect(parseNwcUri('')).toBeNull();
    expect(parseNwcUri('invalid-uri')).toBeNull();
    expect(parseNwcUri('nostr+walletconnect://ab1234cd?relay=wss://relay.damus.io')).toBeNull(); // missing secret
  });
});
