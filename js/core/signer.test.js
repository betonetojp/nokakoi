import { describe, it, expect } from 'vitest';
import { signer } from './signer.js';
import { getPublicKey, getFinalizeEvent } from './nostr-compat.js';

const SK = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const PK = '4646ae5047316b4230d0086c8acec687f00b1cd9d1dc634f6cb358ac0a9a8fff';

describe('signer + nostr-compat secret key handling', () => {
  it('getPublicKey accepts hex via compat wrapper', () => {
    expect(getPublicKey()(SK)).toBe(PK);
  });

  it('finalizeEvent accepts hex via compat wrapper', () => {
    const ev = getFinalizeEvent()({ kind: 1, created_at: 1, tags: [], content: 'x' }, SK);
    expect(ev.pubkey).toBe(PK);
    expect(ev.sig).toMatch(/^[0-9a-f]{128}$/i);
  });

  it('signer.getPublicKey works after setKey(hex)', () => {
    signer.setKey(SK);
    expect(signer.hasKey()).toBe(true);
    expect(signer.getPublicKey()).toBe(PK);
    signer.clearKey();
  });

  it('signer.sign works after setKey(hex)', () => {
    signer.setKey(SK);
    const ev = signer.sign({ kind: 1, created_at: 1, tags: [], content: 'hello' });
    expect(ev.pubkey).toBe(PK);
    expect(ev.content).toBe('hello');
    signer.clearKey();
  });
});
