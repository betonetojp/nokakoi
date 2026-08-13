import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addAccount: vi.fn(() => ({ isMethodChanged: false, isNew: false })),
  authenticateWithPasskey: vi.fn(),
  clearFullState: vi.fn(),
  clearNip46LocalSecretKey: vi.fn(),
  decryptNsecWithPasskey: vi.fn(),
  getNip46LocalSecretKey: vi.fn(),
  loadProfile: vi.fn(),
  signer: {
    clearKey: vi.fn(),
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
  decryptNsecWithPasskey: mocks.decryptNsecWithPasskey,
  isWebAuthnSupported: () => true
}));
vi.mock('../nip46.js', () => ({
  DEFAULT_NIP46_RELAYS: [],
  Nip46Client: vi.fn()
}));
vi.mock('./nsec-auth.js', () => ({ showPasswordModal: vi.fn() }));
vi.mock('./nip46-session.js', () => ({
  clearNip46LocalSecretKey: mocks.clearNip46LocalSecretKey,
  getNip46LocalSecretKey: mocks.getNip46LocalSecretKey
}));
vi.mock('../account-manager.js', () => ({
  addAccount: mocks.addAccount,
  migrateFromSingleAccount: vi.fn()
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

import { autoLogin, login, logout } from './auth-core.js';

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
    globalThis.localStorage = createStorage();
    const elements = new Map([
      ['composer', { hidden: true }],
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
    expect(mocks.signer.clearKey).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(mocks.clearNip46LocalSecretKey).toHaveBeenCalledWith(pubkey);
    expect(localStorage.getItem('skipAutoLogin')).toBe('1');
  });
});
