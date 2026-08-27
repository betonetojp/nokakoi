// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signEventWithMode } from './actions.js';
import { setupNip07FocusListener } from '../../ui/auth-ui.js';
import { encryptPrivatePublicChatTags } from '../channel/public-chats.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    removeItem: vi.fn(key => values.delete(key)),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    clear: vi.fn(() => values.clear())
  };
}

describe('NIP-07 Account Mismatch Guard', () => {
  const accountA = 'a'.repeat(64);
  const accountB = 'b'.repeat(64);

  let originalWindowNostr;

  beforeEach(() => {
    globalThis.localStorage = createStorage();
    originalWindowNostr = globalThis.window ? globalThis.window.nostr : undefined;
    if (typeof globalThis.window === 'undefined') {
      globalThis.window = {};
    }
  });

  afterEach(() => {
    if (originalWindowNostr !== undefined) {
      globalThis.window.nostr = originalWindowNostr;
    } else {
      delete globalThis.window.nostr;
    }
    vi.restoreAllMocks();
  });

  describe('signEventWithMode', () => {
    it('throws error when extension public key differs from state.pubkey (pre-check guard)', async () => {
      globalThis.window.nostr = {
        getPublicKey: vi.fn(async () => accountB),
        signEvent: vi.fn(async (draft) => ({ ...draft, id: 'event-id', sig: 'valid-sig' }))
      };

      const state = {
        signer: 'nip07',
        pubkey: accountA
      };

      const draft = {
        kind: 1,
        content: 'Hello Nostr',
        tags: []
      };

      await expect(signEventWithMode(state, draft)).rejects.toThrow();
      expect(globalThis.window.nostr.signEvent).not.toHaveBeenCalled();
    });

    it('throws error when signed event returned by extension has different pubkey (post-check guard)', async () => {
      // pre-check passes, but signEvent signed with accountB
      globalThis.window.nostr = {
        getPublicKey: vi.fn(async () => accountA),
        signEvent: vi.fn(async (draft) => ({
          ...draft,
          pubkey: accountB,
          id: 'event-id',
          sig: 'valid-sig'
        }))
      };

      const state = {
        signer: 'nip07',
        pubkey: accountA
      };

      const draft = {
        kind: 1,
        content: 'Hello Nostr',
        tags: []
      };

      await expect(signEventWithMode(state, draft)).rejects.toThrow();
    });

    it('successfully signs event when extension public key matches state.pubkey', async () => {
      globalThis.window.nostr = {
        getPublicKey: vi.fn(async () => accountA),
        signEvent: vi.fn(async (draft) => ({
          ...draft,
          pubkey: accountA,
          id: 'event-id',
          sig: 'valid-sig'
        }))
      };

      const state = {
        signer: 'nip07',
        pubkey: accountA
      };

      const draft = {
        kind: 1,
        content: 'Hello Nostr',
        tags: []
      };

      const signed = await signEventWithMode(state, draft);
      expect(signed).toBeDefined();
      expect(signed.pubkey).toBe(accountA);
      expect(signed.sig).toBe('valid-sig');
      expect(globalThis.window.nostr.signEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('encryptPrivatePublicChatTags', () => {
    it('skips NIP-07 encryption when extension pubkey does not match login pubkey', async () => {
      globalThis.window.nostr = {
        getPublicKey: vi.fn(async () => accountB),
        nip44: {
          encrypt: vi.fn(async () => 'encrypted-payload')
        }
      };

      const state = {
        signer: 'nip07',
        pubkey: accountA
      };

      // Since signer.hasKey() is false and NIP-07 is skipped due to mismatch, it should throw
      await expect(
        encryptPrivatePublicChatTags(state, [{ rootId: 'ch1', relayHint: 'wss://relay.example.com' }], 'nip44')
      ).rejects.toThrow();

      expect(globalThis.window.nostr.nip44.encrypt).not.toHaveBeenCalled();
    });
  });
});
