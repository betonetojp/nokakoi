import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearFullState: vi.fn(),
  closePoolAndWait: vi.fn(),
  nsecLoginPrompt: vi.fn(),
  resetChannelViewForAccount: vi.fn(),
  resetObservedPubkeys: [],
  setupTabs: vi.fn(),
  showPasswordModal: vi.fn(),
  syncAccountUI: vi.fn(),
  signer: {
    clearKey: vi.fn(),
    createRollbackHandle: vi.fn(() => null),
    discardRollbackHandle: vi.fn(),
    getPublicKey: vi.fn(),
    hasKey: vi.fn(() => false),
    restoreRollbackHandle: vi.fn(),
    setKey: vi.fn()
  }
}));

vi.mock('./signer.js', () => ({ signer: mocks.signer }));
vi.mock('./crypto.js', () => ({ decryptNsec: vi.fn() }));
vi.mock('./auth/nsec-auth.js', () => ({
  nsecLoginPrompt: mocks.nsecLoginPrompt,
  showPasswordModal: mocks.showPasswordModal
}));
vi.mock('./webauthn.js', () => ({
  authenticateWithPasskey: vi.fn(),
  decryptNip46SessionWithPasskey: vi.fn(),
  decryptNsecWithPasskey: vi.fn()
}));
vi.mock('./nip46.js', () => ({ DEFAULT_NIP46_RELAYS: [], Nip46Client: vi.fn() }));
vi.mock('./auth/nip46-session.js', () => ({
  clearNip46LocalSecretKey: vi.fn(),
  getNip46LocalSecretKey: vi.fn(),
  getNip46ProtectedSession: vi.fn(),
  setNip46LocalSecretKey: vi.fn()
}));
vi.mock('../utils/i18n.js', () => ({ t: key => key }));
vi.mock('./relay.js', () => ({
  closePoolAndWait: mocks.closePoolAndWait,
  loadRelaysForAccount: vi.fn(id => [`relay:${id}`]),
  saveRelaysForAccount: vi.fn()
}));
vi.mock('../features/mute/mute.js', () => ({
  invalidateMuteWork: vi.fn(),
  loadMuteListForAccount: vi.fn(),
  saveMuteListForAccount: vi.fn()
}));
vi.mock('../features/relay/global-relay.js', () => ({ updateGlobalButtonLabel: vi.fn() }));
vi.mock('../ui/modals/modals.js', () => ({ showAlertModal: vi.fn() }));
vi.mock('./state.js', () => ({ clearFullState: mocks.clearFullState }));
vi.mock('./auth/auth-core.js', () => ({
  syncAccountUI: mocks.syncAccountUI,
  updateHeaderName: vi.fn()
}));
vi.mock('./nostr-compat.js', () => ({ getNip19: vi.fn(() => ({})) }));
vi.mock('../features/channel/channel-ui.js', () => ({
  resetChannelViewForAccount: mocks.resetChannelViewForAccount
}));
vi.mock('../features/profile/profile.js', () => ({ loadProfile: vi.fn() }));
vi.mock('../ui/setup/tab-manager.js', () => ({ setupTabs: mocks.setupTabs }));

import {
  addAccount,
  getAccountList,
  migrateFromSingleAccount,
  removeAccount,
  setActiveAccountId,
  switchAccount
} from './account-manager.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    removeItem: vi.fn(key => values.delete(key)),
    setItem: vi.fn((key, value) => values.set(key, String(value)))
  };
}

describe('account manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setupTabs.mockImplementation(() => {});
    mocks.resetObservedPubkeys.length = 0;
    mocks.resetChannelViewForAccount.mockImplementation(state => {
      mocks.resetObservedPubkeys.push(state && state.pubkey);
    });
    mocks.closePoolAndWait.mockImplementation(async state => {
      state.pool = null;
      return true;
    });
    globalThis.localStorage = createStorage();
    globalThis.window = {};
  });

  it('adds accounts case-insensitively and reports login method changes', () => {
    expect(addAccount({ id: 'ABC', loginMethod: 'nip07' })).toMatchObject({ isNew: true });
    expect(addAccount({ id: 'abc', loginMethod: 'nip46' })).toEqual({
      isNew: false,
      isMethodChanged: true,
      previousMethod: 'nip07'
    });

    expect(getAccountList()).toMatchObject({
      activeAccountId: 'abc',
      accounts: [{ id: 'abc', loginMethod: 'nip46' }]
    });
  });

  it('removes all account-scoped credentials and snapshots', () => {
    addAccount({ id: 'ABC', loginMethod: 'nip46' });
    removeAccount('ABC');

    expect(getAccountList()).toEqual({ activeAccountId: null, accounts: [] });
    expect(localStorage.removeItem).toHaveBeenCalledWith('nokakoi.nip46.localSecretKey.abc');
    expect(localStorage.removeItem).toHaveBeenCalledWith('appSettings.abc');
    expect(localStorage.removeItem).toHaveBeenCalledWith('profile_snapshots.abc');
  });

  it('migrates legacy account settings and NIP-46 key once', () => {
    localStorage.setItem('pubkey', 'ABC');
    localStorage.setItem('lastLoginMethod', 'nip46');
    localStorage.setItem('appSettings', '{"theme":"dark"}');
    localStorage.setItem('nokakoi.nip46.localSecretKey', 'secret');

    migrateFromSingleAccount();

    expect(getAccountList().activeAccountId).toBe('abc');
    expect(localStorage.setItem).toHaveBeenCalledWith('appSettings.abc', '{"theme":"dark"}');
    expect(localStorage.setItem).toHaveBeenCalledWith('nokakoi.nip46.localSecretKey.abc', 'secret');
  });

  it('switches a NIP-07 account and clears the previous account state', async () => {
    addAccount({ id: 'b'.repeat(64), loginMethod: 'nip07' });
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      pubkey: 'a'.repeat(64),
      relays: [],
      signer: 'nsec'
    };
    const settingsManager = {
      loadForAccount: vi.fn(),
      saveForAccount: vi.fn(),
      set: vi.fn(),
      settings: {}
    };
    const loginFn = vi.fn();
    window.nostr = { getPublicKey: vi.fn(async () => 'b'.repeat(64)) };

    await switchAccount('b'.repeat(64), state, settingsManager, loginFn);

    expect(state.pubkey).toBe('b'.repeat(64));
    expect(state.signer).toBe('nip07');
    expect(mocks.signer.clearKey).toHaveBeenCalled();
    expect(mocks.clearFullState).toHaveBeenCalledWith(state);
    expect(mocks.resetChannelViewForAccount).toHaveBeenCalledWith(state);
    expect(mocks.resetObservedPubkeys).toEqual(['b'.repeat(64)]);
    expect(mocks.setupTabs).toHaveBeenCalledWith(settingsManager, false, {
      skipFeedLifecycle: true,
      eventDetail: {
        accountSwitchInitial: true,
        skipFeedLifecycle: true
      }
    });
    expect(loginFn).toHaveBeenCalled();
    expect(mocks.syncAccountUI).toHaveBeenCalledWith(state, settingsManager, { reload: false });
  });

  it('activates the target initial tab before boot subscriptions start', async () => {
    const targetPubkey = 'b'.repeat(64);
    addAccount({ id: targetPubkey, loginMethod: 'nip07' });
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      pubkey: 'a'.repeat(64),
      relays: [],
      signer: 'nsec'
    };
    let activeTab = 'bitchat';
    const settingsManager = {
      loadForAccount: vi.fn(function () {
        this.settings = {
          tabs_v2: [
            { id: 'mentions', visible: false },
            { id: 'global', visible: true },
            { id: 'home', visible: true }
          ]
        };
      }),
      saveForAccount: vi.fn(),
      set: vi.fn(),
      settings: {}
    };
    mocks.setupTabs.mockImplementation((manager, preserveActive, options) => {
      expect(preserveActive).toBe(false);
      expect(options).toMatchObject({
        skipFeedLifecycle: true,
        eventDetail: {
          accountSwitchInitial: true,
          skipFeedLifecycle: true
        }
      });
      activeTab = manager.settings.tabs_v2.find(tab => tab.visible !== false)?.id || null;
    });
    const loginFn = vi.fn(() => {
      expect(activeTab).toBe('global');
      expect(state.pubkey).toBe(targetPubkey);
    });
    window.nostr = { getPublicKey: vi.fn(async () => targetPubkey) };

    await switchAccount(targetPubkey, state, settingsManager, loginFn);

    expect(mocks.setupTabs.mock.invocationCallOrder[0])
      .toBeLessThan(loginFn.mock.invocationCallOrder[0]);
    expect(loginFn).toHaveBeenCalledTimes(1);
  });

  it('awaits old pool closure before target login and preserves target relays', async () => {
    const targetPubkey = 'b'.repeat(64);
    const oldPool = {};
    addAccount({ id: targetPubkey, loginMethod: 'nip07' });
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      pool: oldPool,
      pubkey: 'a'.repeat(64),
      relays: [],
      signer: 'nsec'
    };
    const settingsManager = {
      loadForAccount: vi.fn(),
      saveForAccount: vi.fn(),
      set: vi.fn(),
      settings: {}
    };
    let finishClose;
    mocks.closePoolAndWait.mockImplementationOnce((receivedState, timeoutMs) => new Promise(resolve => {
      expect(receivedState).toBe(state);
      expect(receivedState.pool).toBe(oldPool);
      expect(receivedState.relays).toEqual([`relay:${targetPubkey}`]);
      expect(timeoutMs).toBe(750);
      finishClose = () => {
        receivedState.pool = null;
        resolve(true);
      };
    }));
    const loginFn = vi.fn(() => {
      expect(state.pool).toBeNull();
      expect(state.relays).toEqual([`relay:${targetPubkey}`]);
    });
    window.nostr = { getPublicKey: vi.fn(async () => targetPubkey) };

    const switching = switchAccount(targetPubkey, state, settingsManager, loginFn);
    await vi.waitFor(() => expect(mocks.closePoolAndWait).toHaveBeenCalledTimes(1));
    expect(loginFn).not.toHaveBeenCalled();

    finishClose();
    await switching;

    expect(loginFn).toHaveBeenCalledTimes(1);
  });

  it('does not close the old pool when target authentication fails', async () => {
    const targetPubkey = 'b'.repeat(64);
    const oldPool = {};
    addAccount({ id: targetPubkey, loginMethod: 'nip07' });
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      pool: oldPool,
      pubkey: 'a'.repeat(64),
      relays: [],
      signer: 'nsec'
    };
    const settingsManager = {
      loadForAccount: vi.fn(),
      saveForAccount: vi.fn(),
      set: vi.fn(),
      settings: {}
    };
    const loginFn = vi.fn();
    window.nostr = { getPublicKey: vi.fn(async () => 'c'.repeat(64)) };

    await switchAccount(targetPubkey, state, settingsManager, loginFn);

    expect(mocks.closePoolAndWait).not.toHaveBeenCalled();
    expect(state.pool).toBe(oldPool);
    expect(loginFn).not.toHaveBeenCalled();
  });

  it('does not close the old pool when target authentication is cancelled', async () => {
    const targetPubkey = 'b'.repeat(64);
    const oldPool = {};
    addAccount({ id: targetPubkey, loginMethod: 'nsec' });
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      pool: oldPool,
      pubkey: 'a'.repeat(64),
      relays: [],
      signer: 'nsec'
    };
    const settingsManager = {
      loadForAccount: vi.fn(function () {
        this.settings = { encryptedNsec: 'encrypted' };
      }),
      saveForAccount: vi.fn(),
      set: vi.fn(),
      settings: {}
    };
    mocks.showPasswordModal.mockImplementationOnce((_onSubmit, onCancel) => onCancel());

    await switchAccount(targetPubkey, state, settingsManager, vi.fn());

    expect(mocks.closePoolAndWait).not.toHaveBeenCalled();
    expect(state.pool).toBe(oldPool);
  });

  it('persists the successful switch signer only to the target account', async () => {
    const oldPubkey = 'a'.repeat(64);
    const targetPubkey = 'b'.repeat(64);
    addAccount({ id: targetPubkey, loginMethod: 'nip07' });
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      pubkey: oldPubkey,
      relays: [],
      signer: 'nsec'
    };
    window.__nostrState = state;
    window.nostr = { getPublicKey: vi.fn(async () => targetPubkey) };
    const setSaveAttempts = [];
    const settingsManager = {
      settings: {},
      loadForAccount: vi.fn(function () {
        this.settings = {};
      }),
      saveForAccount: vi.fn(function (pubkey) {
        localStorage.setItem(`appSettings.${pubkey}`, JSON.stringify(this.settings));
      }),
      set: vi.fn(function (key, value) {
        this.settings[key] = value;
        const activePubkey = window.__nostrState.pubkey || localStorage.getItem('pubkey');
        setSaveAttempts.push(activePubkey);
        this.saveForAccount(activePubkey);
      })
    };

    await switchAccount(targetPubkey, state, settingsManager, vi.fn());

    expect(setSaveAttempts).toEqual([targetPubkey]);
    expect(setSaveAttempts).not.toContain(oldPubkey);
    expect(JSON.parse(localStorage.getItem(`appSettings.${targetPubkey}`))).toMatchObject({
      preferredSigner: 'nip07'
    });
  });

  it('uses the selected account as the NIP-46 user identity when legacy settings omit it', async () => {
    const targetPubkey = 'b'.repeat(64);
    addAccount({ id: targetPubkey, loginMethod: 'nip46' });
    const restoreConnection = vi.fn(async info => {
      expect(info.userPubkey).toBe(targetPubkey);
    });
    const client = { restoreConnection, setupResumeHandler: vi.fn(), userPubkey: null };
    const { Nip46Client } = await import('./nip46.js');
    Nip46Client.mockImplementation(() => client);
    const { getNip46LocalSecretKey } = await import('./auth/nip46-session.js');
    getNip46LocalSecretKey.mockReturnValue('01'.repeat(32));
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      pubkey: 'a'.repeat(64),
      relays: [],
      signer: 'nsec'
    };
    const settingsManager = {
      loadForAccount: vi.fn(function () {
        this.settings = { nip46RemotePubkey: 'c'.repeat(64), preferredSigner: 'nip46' };
      }),
      saveForAccount: vi.fn(),
      set: vi.fn(),
      settings: {}
    };

    await switchAccount(targetPubkey, state, settingsManager, vi.fn());

    expect(client.userPubkey).toBe(targetPubkey);
    expect(state.pubkey).toBe(targetPubkey);
    expect(state.signer).toBe('nip46');
  });

  it('allows clearing activeAccountId to null on logout and logging back in from logged out state', async () => {
    const pubkey = 'd'.repeat(64);
    addAccount({ id: pubkey, loginMethod: 'nip07' });
    expect(getAccountList().activeAccountId).toBe(pubkey);

    setActiveAccountId(null);
    expect(getAccountList().activeAccountId).toBeNull();

    globalThis.window.nostr = {
      getPublicKey: vi.fn(async () => pubkey)
    };

    const state = {
      nip46: null,
      pubkey: null,
      relays: [],
      signer: 'auto'
    };
    const settingsManager = {
      loadForAccount: vi.fn(),
      saveForAccount: vi.fn(),
      set: vi.fn(),
      settings: {}
    };
    const loginFn = vi.fn(async () => {});

    await switchAccount(pubkey, state, settingsManager, loginFn);

    expect(state.pubkey).toBe(pubkey);
    expect(state.signer).toBe('nip07');
    expect(getAccountList().activeAccountId).toBe(pubkey);
    expect(loginFn).toHaveBeenCalled();
  });
});
