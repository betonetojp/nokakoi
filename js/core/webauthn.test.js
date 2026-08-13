import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/i18n.js', () => ({
  t: (key, params) => params?.msg ? `${key}:${params.msg}` : key
}));

import {
  authenticateWithPasskey,
  decryptNsecWithPasskey,
  encryptNsecWithPasskey,
  isWebAuthnSupported,
  registerPasskey
} from './webauthn.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => values.set(key, String(value)))
  };
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

describe('WebAuthn passkey encryption', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.localStorage = createStorage();
    globalThis.window = {
      location: { hostname: 'localhost' },
      PublicKeyCredential: class {}
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        credentials: {},
        userAgent: 'Test'
      }
    });
  });

  it('detects unsupported WebAuthn and rejects registration', async () => {
    delete window.PublicKeyCredential;
    expect(isWebAuthnSupported()).toBe(false);
    await expect(registerPasskey()).rejects.toThrow('webauthn.not_supported');
  });

  it('round-trips nsec data using a fixed PRF key', async () => {
    const prfKey = toBase64Url(new Uint8Array(32).fill(7));
    const nsec = 'ab'.repeat(32);

    const encrypted = await encryptNsecWithPasskey(nsec, prfKey);

    expect(encrypted).toMatch(/^prf1:/);
    expect(await decryptNsecWithPasskey(encrypted, prfKey)).toBe(nsec);
    expect(await decryptNsecWithPasskey(encrypted)).toBeNull();
  });

  it('returns a successful assertion even when PRF output is unavailable', async () => {
    navigator.credentials.get = vi.fn(async () => ({
      getClientExtensionResults: () => ({}),
      rawId: Uint8Array.from([1, 2, 3]).buffer
    }));

    await expect(authenticateWithPasskey(null)).resolves.toEqual({
      success: true,
      credentialId: 'AQID',
      prfKey: null
    });
  });

  it('decrypts legacy device-key ciphertext', async () => {
    const seed = new Uint8Array(32).fill(3);
    localStorage.setItem('nokakoi_device_seed', toBase64Url(seed));
    const material = await crypto.subtle.importKey(
      'raw',
      seed,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey({
      name: 'PBKDF2',
      salt: new Uint8Array([
        0x6e, 0x6f, 0x6b, 0x61, 0x6b, 0x6f, 0x69, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
      ]),
      iterations: 100000,
      hash: 'SHA-256'
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = new Uint8Array(12).fill(5);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode('cd'.repeat(32))
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    expect(await decryptNsecWithPasskey(toBase64Url(combined))).toBe('cd'.repeat(32));
  });
});
