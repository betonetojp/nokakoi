import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNip46LocalSecretKey,
  getNip46LocalSecretKey,
  setNip46LocalSecretKey
} from './nip46-session.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    removeItem: vi.fn(key => values.delete(key)),
    setItem: vi.fn((key, value) => values.set(key, String(value)))
  };
}

describe('NIP-46 session storage', () => {
  beforeEach(() => {
    globalThis.localStorage = createStorage();
    globalThis.sessionStorage = createStorage();
  });

  it('stores and retrieves both active and account-scoped keys', () => {
    setNip46LocalSecretKey('secret', 'ABC');

    expect(getNip46LocalSecretKey()).toBe('secret');
    expect(getNip46LocalSecretKey('abc')).toBe('secret');
  });

  it('migrates the legacy session key and removes it', () => {
    sessionStorage.setItem('nip46LocalSecretKey', 'legacy');

    expect(getNip46LocalSecretKey()).toBe('legacy');
    expect(localStorage.getItem('nokakoi.nip46.localSecretKey')).toBe('legacy');
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('nip46LocalSecretKey');
  });

  it('clears active, account-scoped and legacy keys', () => {
    setNip46LocalSecretKey('secret', 'ABC');
    sessionStorage.setItem('nip46LocalSecretKey', 'legacy');

    clearNip46LocalSecretKey('ABC');

    expect(getNip46LocalSecretKey('ABC')).toBeNull();
    expect(sessionStorage.getItem('nip46LocalSecretKey')).toBeNull();
  });
});
