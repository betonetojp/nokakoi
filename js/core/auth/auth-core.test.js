import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addAccount: vi.fn(() => ({ isMethodChanged: false, isNew: false })),
  authenticateWithPasskey: vi.fn(),
  clearFullState: vi.fn(),
  clearNip46LocalSecretKey: vi.fn(),
  decryptNip46SessionWithPasskey: vi.fn(),
  decryptNsecWithPasskey: vi.fn(),
  getNip46LocalSecretKey: vi.fn(),
  getNip46ProtectedSession: vi.fn(),
  loadProfile: vi.fn(),
  Nip46Client: vi.fn(),
  getAccountList: vi.fn(() => ({ accounts: [], activeAccountId: null })),
  setActiveAccountId: vi.fn(),
  setupTabs: vi.fn(),
  signer: {
    clearKey: vi.fn(),
    clearRollbackHandles: vi.fn(),
    getPublicKey: vi.fn(),
    hasKey: vi.fn(),
    setKey: vi.fn()
  }
}));

vi.mock('../../utils/utils.js', () => ({
  $: id => document.getElementById(id),
  escapeHtml: value => String(value),
  replaceBadgeEmoji: value => value
}));
vi.mock('../crypto.js', () => ({ bytesToHex: vi.fn(), decryptNsec: vi.fn() }));
vi.mock('../nostr-compat.js', () => ({
  getNip19: () => ({}),
  getPublicKey: () => vi.fn()
}));
vi.mock('../signer.js', () => ({ signer: mocks.signer }));
vi.mock('../../features/profile/profile.js', () => ({
  displayNameWithUsername: () => ({ main: 'Tester' }),
  loadProfile: mocks.loadProfile,
  updateNameDom: vi.fn()
}));
vi.mock('../../features/post/actions.js', () => ({
  resolveLoginOrder: () => ['nip46', 'nsec', 'nip07']
}));
vi.mock('../../utils/i18n.js', () => ({
  detectBrowserLang: () => 'en',
  t: key => key
}));
vi.mock('../webauthn.js', () => ({
  authenticateWithPasskey: mocks.authenticateWithPasskey,
  decryptNip46SessionWithPasskey: mocks.decryptNip46SessionWithPasskey,
  decryptNsecWithPasskey: mocks.decryptNsecWithPasskey,
  isWebAuthnSupported: () => true
}));
vi.mock('../nip46.js', () => ({
  DEFAULT_NIP46_RELAYS: [],
  Nip46Client: mocks.Nip46Client
}));
vi.mock('./nsec-auth.js', () => ({ showPasswordModal: vi.fn() }));
vi.mock('./nip46-session.js', () => ({
  clearNip46LocalSecretKey: mocks.clearNip46LocalSecretKey,
  getNip46LocalSecretKey: mocks.getNip46LocalSecretKey,
  getNip46ProtectedSession: mocks.getNip46ProtectedSession
}));
vi.mock('../account-manager.js', () => ({
  addAccount: mocks.addAccount,
  getAccountList: mocks.getAccountList,
  migrateFromSingleAccount: vi.fn(),
  setActiveAccountId: mocks.setActiveAccountId
}));
vi.mock('../../ui/setup/tab-manager.js', () => ({
  setupTabs: mocks.setupTabs
}));
vi.mock('../relay.js', () => ({
  defaultIntlRelayUrl: 'wss://intl',
  defaultJaRelayUrl: 'wss://ja',
  getDefaultGlobalRelayByLang: () => 'wss://default',
  loadRelaysForAccount: id => [`relay:${id}`],
  saveRelaysForAccount: vi.fn()
}));
vi.mock('../../features/relay/global-relay.js', () => ({ updateGlobalButtonLabel: vi.fn() }));
vi.mock('../../features/mute/mute.js', () => ({
  clearMuteListState: vi.fn(),
  invalidateMuteWork: vi.fn(),
  loadMuteListForAccount: vi.fn(),
  saveMuteListForAccount: vi.fn(),
  updateMuteListCountsUI: vi.fn()
}));
vi.mock('../state.js', () => ({ clearFullState: mocks.clearFullState }));
vi.mock('../../ui/renderers/render-helpers.js', () => ({ refreshEventsMuteState: vi.fn() }));
vi.mock('../../ui/setup/display-settings.js', () => ({ refreshAllDisplaySettingsUI: vi.fn() }));

import { autoLogin, login, loginWithPubkey, logout } from './auth-core.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    removeItem: vi.fn(key => values.delete(key)),
    setItem: vi.fn((key, value) => values.set(key, String(value)))
  };
}

function createSettings(overrides = {}) {
  const values = { ...overrides };
  return {
    get: vi.fn(key => values[key]),
    load: vi.fn(() => values),
    loadForAccount: vi.fn(),
    saveForAccount: vi.fn(),
    set: vi.fn((key, value) => {
      values[key] = value;
    }),
    settings: values
  };
}

describe('auth core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccountList.mockImplementation(() => ({ accounts: [], activeAccountId: null }));
    globalThis.localStorage = createStorage();
    const elements = new Map([
      ['composer', { hidden: true, classList: { add: vi.fn(), remove: vi.fn() } }],
      ['composerFormBody', { hidden: false }],
      ['composerLoginPrompt', { hidden: true }],
      ['composerAccountInfo', { appendChild: vi.fn(), innerHTML: '' }],
      ['openLoginModalBtn', { hidden: false }],
      ['userInfo', { appendChild: vi.fn(), innerHTML: '', textContent: '' }]
    ]);
    globalThis.document = {
      createElement: vi.fn(() => ({ className: '', innerHTML: '' })),
      getElementById: vi.fn(id => elements.get(id) || null)
    };
    globalThis.window = {
      dispatchEvent: vi.fn(),
      updateTabVisibility: vi.fn()
    };
    globalThis.CustomEvent = class {
      constructor(type) {
        this.type = type;
      }
    };
    globalThis.alert = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects an in-memory nsec signer and completes login', async () => {
    vi.useFakeTimers();
    const pubkey = 'a'.repeat(64);
    localStorage.setItem(`relays.${pubkey}`, 'saved');
    mocks.signer.hasKey.mockReturnValue(true);
    mocks.signer.getPublicKey.mockReturnValue(pubkey);
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      profiles: new Map(),
      pubkey: null,
      relays: [],
      signer: 'nsec'
    };
    const settingsManager = createSettings({ preferredSigner: 'nsec' });
    const restartFeeds = vi.fn(async () => {});
    const setupComposerScroll = vi.fn();

    await login(state, settingsManager.settings, settingsManager, restartFeeds, setupComposerScroll);

    expect(state.signer).toBe('nsec');
    expect(state.pubkey).toBe(pubkey);
    expect(mocks.addAccount).toHaveBeenCalledWith({ id: pubkey, loginMethod: 'nsec' });
    expect(document.getElementById('composer').hidden).toBe(false);
    expect(document.getElementById('composerFormBody').hidden).toBe(false);
    expect(document.getElementById('composerLoginPrompt').hidden).toBe(true);
    expect(restartFeeds).toHaveBeenCalledWith(true);
    expect(mocks.loadProfile).toHaveBeenCalledWith(state, pubkey);
    vi.advanceTimersByTime(100);
    expect(setupComposerScroll).toHaveBeenCalledTimes(1);
    vi.clearAllTimers();
  });

  it('does not auto-login when the explicit logout marker is present', async () => {
    localStorage.setItem('skipAutoLogin', '1');
    const loginFn = vi.fn();

    await autoLogin({ pubkey: null }, {}, createSettings(), loginFn);

    expect(loginFn).not.toHaveBeenCalled();
    expect(mocks.authenticateWithPasskey).not.toHaveBeenCalled();
  });

  it('restores a passkey signer during auto-login', async () => {
    vi.useFakeTimers();
    const secretKey = 'ab'.repeat(32);
    const settings = {
      passkeyCredentialId: 'credential',
      passkeyEncryptedNsec: 'encrypted',
      preferredSigner: 'nsec-passkey'
    };
    const state = { pubkey: null, relays: [], signer: 'auto' };
    const loginFn = vi.fn(async () => {});
    mocks.authenticateWithPasskey.mockResolvedValue({ prfKey: 'prf', success: true });
    mocks.decryptNsecWithPasskey.mockResolvedValue(secretKey);

    const result = autoLogin(state, settings, createSettings(settings), loginFn);
    await vi.advanceTimersByTimeAsync(350);
    await result;

    expect(mocks.signer.setKey).toHaveBeenCalledWith(secretKey);
    expect(state.signer).toBe('nsec');
    expect(loginFn).toHaveBeenCalled();
    expect(window.__nokakoiAuthPending).toBe(false);
  });

  it('restores a protected NIP-46 session through its dedicated passkey', async () => {
    vi.useFakeTimers();
    const localSecretKey = 'ab'.repeat(32);
    const restoreConnection = vi.fn(async () => {});
    const setupResumeHandler = vi.fn();
    mocks.Nip46Client.mockImplementation(function () {
      return { restoreConnection, setupResumeHandler };
    });
    mocks.getNip46ProtectedSession.mockReturnValue('nip46prf1:encrypted');
    mocks.authenticateWithPasskey.mockResolvedValue({ prfKey: 'prf', success: true });
    mocks.decryptNip46SessionWithPasskey.mockResolvedValue({ localSecretKey, secret: 'connect-secret' });
    const settings = {
      nip46PasskeyCredentialId: 'credential',
      nip46RemotePubkey: 'b'.repeat(64),
      nip46UserPubkey: 'c'.repeat(64),
      nip46Relays: ['wss://relay.example'],
      preferredSigner: 'nip46'
    };
    const state = { nip46: {}, pubkey: null, relays: [], signer: 'auto' };
    const loginFn = vi.fn(async () => {});

    const result = autoLogin(state, settings, createSettings(settings), loginFn);
    await vi.advanceTimersByTimeAsync(350);
    await result;

    expect(mocks.getNip46LocalSecretKey).not.toHaveBeenCalled();
    expect(mocks.authenticateWithPasskey).toHaveBeenCalledWith('credential');
    expect(mocks.decryptNip46SessionWithPasskey).toHaveBeenCalledWith('nip46prf1:encrypted', 'prf');
    expect(restoreConnection).toHaveBeenCalledWith({
      localSecretKey,
      remotePubkey: 'b'.repeat(64),
      userPubkey: 'c'.repeat(64),
      relays: ['wss://relay.example'],
      secret: 'connect-secret'
    });
    expect(loginFn).toHaveBeenCalled();
  });

  it('logs out by clearing signer, NIP-46 session and feed state', async () => {
    const pubkey = 'c'.repeat(64);
    const disconnect = vi.fn(async () => {});
    const state = {
      nip46: { client: { disconnect }, connected: true, remotePubkey: 'remote' },
      pubkey,
      relays: [],
      signer: 'nip46'
    };
    const settingsManager = createSettings();

    logout(state, {}, settingsManager, vi.fn());
    await vi.waitFor(() => {
      expect(mocks.clearFullState).toHaveBeenCalledWith(state);
    });

    expect(state.pubkey).toBeNull();
    expect(state.signer).toBe('auto');
    expect(mocks.setActiveAccountId).toHaveBeenCalledWith(null);
    expect(mocks.setupTabs).toHaveBeenCalledWith(settingsManager, false);
    expect(mocks.signer.clearKey).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(mocks.clearNip46LocalSecretKey).toHaveBeenCalledWith(pubkey);
    expect(localStorage.getItem('skipAutoLogin')).toBe('1');
    expect(document.getElementById('composer').hidden).toBe(false);
    expect(document.getElementById('composerFormBody').hidden).toBe(true);
    expect(document.getElementById('composerLoginPrompt').hidden).toBe(false);
    expect(document.getElementById('composer').classList.add).toHaveBeenCalledWith('composer--login-prompt');
  });

  it('keeps stored credentials when a read-only session reuses an existing account', async () => {
    vi.useFakeTimers();
    const pubkey = 'd'.repeat(64);
    localStorage.setItem(`relays.${pubkey}`, 'saved');
    localStorage.setItem('nokakoi.nip46.localSecretKey', 'ab'.repeat(32));
    mocks.getNip46LocalSecretKey.mockReturnValue('ab'.repeat(32));
    mocks.getAccountList.mockImplementation(() => ({
      accounts: [{ id: pubkey, loginMethod: 'nsec' }],
      activeAccountId: pubkey
    }));
    const settingsManager = createSettings({
      encryptedNsec: 'stored-nsec',
      nip46RemotePubkey: 'remote',
      nip46Secret: 'secret',
      passkeyCredentialId: 'cred',
      passkeyEncryptedNsec: 'stored-passkey'
    });
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      profiles: new Map(),
      pubkey,
      relays: [],
      signer: 'read-only'
    };

    await login(state, settingsManager.settings, settingsManager, vi.fn(async () => {}), vi.fn());

    expect(mocks.addAccount).not.toHaveBeenCalled();
    expect(mocks.setActiveAccountId).toHaveBeenCalledWith(pubkey);
    expect(mocks.clearNip46LocalSecretKey).not.toHaveBeenCalled();
    expect(localStorage.getItem(`nokakoi.nip46.localSecretKey.${pubkey}`)).toBeNull();
    expect(settingsManager.set).not.toHaveBeenCalledWith('encryptedNsec', null);
    expect(settingsManager.set).not.toHaveBeenCalledWith('passkeyCredentialId', null);
    expect(settingsManager.set).not.toHaveBeenCalledWith('passkeyEncryptedNsec', null);
    expect(settingsManager.set).not.toHaveBeenCalledWith('nip46RemotePubkey', null);
    expect(settingsManager.set).not.toHaveBeenCalledWith('nip46Secret', null);
    expect(settingsManager.settings.encryptedNsec).toBe('stored-nsec');
    expect(settingsManager.settings.preferredSigner).toBe('read-only');
    vi.clearAllTimers();
  });

  it('logs in with a public key once and saves the previous account first', async () => {
    vi.useFakeTimers();
    const previous = 'e'.repeat(64);
    const next = 'f'.repeat(64);
    localStorage.setItem('pubkey', previous);
    localStorage.setItem(`relays.${next}`, 'saved');
    const settingsManager = createSettings({ encryptedNsec: 'old-nsec' });
    const state = {
      nip46: { client: null, connected: false, remotePubkey: null },
      profiles: new Map(),
      pubkey: previous,
      relays: [],
      signer: 'nsec'
    };
    const restartFeeds = vi.fn(async () => {});

    await loginWithPubkey(next, state, settingsManager.settings, settingsManager, restartFeeds, vi.fn());

    expect(settingsManager.saveForAccount.mock.calls[0][0]).toBe(previous);
    expect(localStorage.getItem('pubkey')).toBe(next);
    expect(state.signer).toBe('read-only');
    expect(state.pubkey).toBe(next);
    expect(mocks.addAccount).toHaveBeenCalledTimes(1);
    expect(mocks.addAccount).toHaveBeenCalledWith({ id: next, loginMethod: 'read-only' });
    expect(restartFeeds).toHaveBeenCalledTimes(1);
    expect(restartFeeds).toHaveBeenCalledWith(true);
    vi.clearAllTimers();
  });
});
