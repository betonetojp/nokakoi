import { describe, it, expect } from 'vitest';
import { getLnurlEndpoint } from './zap.js';

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
});
