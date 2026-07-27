import { describe, it, expect } from 'vitest';
import { encryptNsec, decryptNsec } from './crypto.js';

describe('encryptNsec / decryptNsec', () => {
  it('rejects empty password on encrypt', async () => {
    await expect(encryptNsec('a'.repeat(64), '')).rejects.toThrow(/password/i);
  });

  it('returns null for empty password on decrypt', async () => {
    const hex = await encryptNsec('a'.repeat(64), 'secret');
    expect(await decryptNsec(hex, '')).toBeNull();
  });

  it('round-trips with PBKDF2 + AES-GCM', async () => {
    const sk = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const encrypted = await encryptNsec(sk, 'correct-horse');
    expect(encrypted).toMatch(/^[0-9a-f]+$/i);
    expect(encrypted.length).toBeGreaterThanOrEqual(152); // 76 bytes min as hex
    const decrypted = await decryptNsec(encrypted, 'correct-horse');
    expect(decrypted).toBe(sk);
  });

  it('fails with wrong password', async () => {
    const sk = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const encrypted = await encryptNsec(sk, 'correct-horse');
    expect(await decryptNsec(encrypted, 'wrong-password')).toBeNull();
  });

  it('does not decrypt legacy SHA-256-only ciphertext', async () => {
    // Legacy format: IV(12) + ciphertext (no trailing salt) — shorter than 76 bytes
    const fakeLegacy = 'aa'.repeat(40); // 40 bytes hex = 80 chars, < 76 bytes
    expect(await decryptNsec(fakeLegacy, 'any')).toBeNull();
  });
});
