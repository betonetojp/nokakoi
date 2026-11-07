/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openAccountModal } from './account-modal.js';

const SK = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const PK = '4646ae5047316b4230d0086c8acec687f00b1cd9d1dc634f6cb358ac0a9a8fff';

const mocks = vi.hoisted(() => ({
  authenticateWithPasskey: vi.fn(),
  decryptNsecWithPasskey: vi.fn(),
  decryptNsec: vi.fn(),
  showPasswordModal: vi.fn(),
  showAlertModal: vi.fn(),
  showConfirmModal: vi.fn((title, msg, onYes) => onYes && onYes()),
  signer: {
    hasKey: vi.fn(() => false),
    getPublicKey: vi.fn(() => null),
    exportNsec: vi.fn(() => null)
  }
}));

vi.mock('../../core/account-manager.js', () => ({
  getAccountList: vi.fn(),
  switchAccount: vi.fn(),
  removeAccount: vi.fn(),
}));

vi.mock('../../core/auth/auth-core.js', () => ({
  logout: vi.fn(),
  login: vi.fn(),
}));

vi.mock('./modals.js', () => ({
  showConfirmModal: mocks.showConfirmModal,
  showAlertModal: mocks.showAlertModal,
}));

vi.mock('../../core/signer.js', () => ({
  signer: mocks.signer,
}));

vi.mock('../../core/webauthn.js', () => ({
  authenticateWithPasskey: mocks.authenticateWithPasskey,
  decryptNsecWithPasskey: mocks.decryptNsecWithPasskey,
}));

vi.mock('../../core/auth/nsec-auth.js', () => ({
  showPasswordModal: mocks.showPasswordModal,
}));

vi.mock('../../core/crypto.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    decryptNsec: mocks.decryptNsec,
  };
});

vi.mock('../../features/profile/profile.js', () => ({
  displayNameWithUsername: vi.fn(() => ({ main: 'User' })),
  loadProfile: vi.fn(),
}));

describe('account-modal', () => {
  let mockState;
  let mockSettings;
  let mockSettingsManager;
  let accountManager;
  let authCore;

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="accountModal" hidden>
        <div id="accountModalContent"></div>
        <button id="accountModalClose"></button>
      </div>
    `;

    mockState = {
      pubkey: 'active_pk_123',
      signer: 'nsec',
      profiles: new Map()
    };
    mockSettings = {};
    mockSettingsManager = {
      get: vi.fn(),
      set: vi.fn()
    };

    localStorage.setItem('pubkey', 'active_pk_123');

    accountManager = await import('../../core/account-manager.js');
    authCore = await import('../../core/auth/auth-core.js');

    accountManager.getAccountList.mockReturnValue({
      activeAccountId: 'active_pk_123',
      accounts: [
        { id: 'active_pk_123', loginMethod: 'nsec', displayName: 'Account 1', createdAt: 1000 },
        { id: 'target_pk_456', loginMethod: 'nsec', displayName: 'Account 2', createdAt: 2000 }
      ]
    });
  });

  it('normalizes function authCallbacks and executes onLoginSuccess on account switch', async () => {
    const onLoginSuccess = vi.fn().mockResolvedValue(true);

    openAccountModal(mockState, mockSettings, mockSettingsManager, onLoginSuccess);

    const switchBtn = document.querySelector('.switch-acc-btn');
    expect(switchBtn).not.toBeNull();

    accountManager.switchAccount.mockImplementation(async (id, state, sm, callback) => {
      await callback();
    });

    switchBtn.click();

    expect(accountManager.switchAccount).toHaveBeenCalledWith('target_pk_456', mockState, mockSettingsManager, expect.any(Function));
    expect(onLoginSuccess).toHaveBeenCalledTimes(1);
    expect(authCore.login).not.toHaveBeenCalled();
  });

  it('calls callbacks.onLogout and logout when active account is deleted', async () => {
    const onLogout = vi.fn();
    const restartFeeds = vi.fn();

    openAccountModal(mockState, mockSettings, mockSettingsManager, {
      onLogout,
      restartFeeds
    });

    const deleteBtns = document.querySelectorAll('.delete-acc-btn');
    expect(deleteBtns.length).toBe(2);

    // Active account delete button is the first one
    const activeDeleteBtn = deleteBtns[0];
    activeDeleteBtn.click();

    expect(accountManager.removeAccount).toHaveBeenCalledWith('active_pk_123');
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(authCore.logout).toHaveBeenCalledWith(mockState, mockSettings, mockSettingsManager, restartFeeds);
  });

  it('hides secret key export button for nip07, nip46, and read-only accounts', () => {
    for (const method of ['nip07', 'nip46', 'read-only']) {
      mockState.signer = method;
      accountManager.getAccountList.mockReturnValue({
        activeAccountId: PK,
        accounts: [{ id: PK, loginMethod: method, displayName: 'Account', createdAt: 1000 }]
      });
      openAccountModal(mockState, mockSettings, mockSettingsManager, {});
      expect(document.getElementById('accountExportNsecBtn')).toBeNull();
    }
  });

  it('exports secret key after passkey re-authentication and wipes DOM on close', async () => {
    mockState.pubkey = PK;
    mockState.signer = 'nsec';
    mockSettings = {
      passkeyCredentialId: 'cred-1',
      passkeyEncryptedNsec: 'enc-passkey-nsec'
    };
    mockSettingsManager.get.mockImplementation(k => mockSettings[k]);
    accountManager.getAccountList.mockReturnValue({
      activeAccountId: PK,
      accounts: [{ id: PK, loginMethod: 'nsec-passkey', displayName: 'Passkey User', createdAt: 1000 }]
    });

    mocks.authenticateWithPasskey.mockResolvedValue({ success: true, prfKey: 'prf-key' });
    mocks.decryptNsecWithPasskey.mockResolvedValue(SK);

    openAccountModal(mockState, mockSettings, mockSettingsManager, {});

    const exportBtn = document.getElementById('accountExportNsecBtn');
    expect(exportBtn).not.toBeNull();

    await exportBtn.onclick();

    expect(mocks.authenticateWithPasskey).toHaveBeenCalledWith('cred-1');
    expect(mocks.decryptNsecWithPasskey).toHaveBeenCalledWith('enc-passkey-nsec', 'prf-key');

    const panel = document.getElementById('accountExportNsecPanel');
    const input = document.getElementById('accountExportNsecInput');
    const toggleBtn = document.getElementById('accountExportNsecToggleBtn');
    expect(panel.hidden).toBe(false);
    expect(input.type).toBe('password');
    expect(input.value).toMatch(/^nsec1[0-9a-z]+$/);

    // Toggle visibility
    toggleBtn.click();
    expect(input.type).toBe('text');
    toggleBtn.click();
    expect(input.type).toBe('password');

    // Closing modal wipes the secret key from DOM
    document.getElementById('accountModalClose').click();
    expect(panel.hidden).toBe(true);
    expect(panel.innerHTML).toBe('');
  });

  it('exports secret key after password re-authentication', async () => {
    mockState.pubkey = PK;
    mockState.signer = 'nsec';
    mockSettings = {
      encryptedNsec: 'enc-password-nsec'
    };
    mockSettingsManager.get.mockImplementation(k => mockSettings[k]);
    accountManager.getAccountList.mockReturnValue({
      activeAccountId: PK,
      accounts: [{ id: PK, loginMethod: 'nsec', displayName: 'Password User', createdAt: 1000 }]
    });

    mocks.showPasswordModal.mockImplementation(async (onConfirm) => {
      await onConfirm('my-secret-pw');
    });
    mocks.decryptNsec.mockResolvedValue(SK);

    openAccountModal(mockState, mockSettings, mockSettingsManager, {});

    const exportBtn = document.getElementById('accountExportNsecBtn');
    expect(exportBtn).not.toBeNull();

    await exportBtn.onclick();

    expect(mocks.showPasswordModal).toHaveBeenCalledTimes(1);
    expect(mocks.decryptNsec).toHaveBeenCalledWith('enc-password-nsec', 'my-secret-pw');

    const input = document.getElementById('accountExportNsecInput');
    expect(input).not.toBeNull();
    expect(input.value).toMatch(/^nsec1[0-9a-z]+$/);
  });

  it('exports unsaved in-memory secret key after confirmation modal', () => {
    mockState.pubkey = PK;
    mockState.signer = 'nsec';
    mockSettings = {};
    mockSettingsManager.get.mockReturnValue(undefined);
    mocks.signer.hasKey.mockReturnValue(true);
    mocks.signer.getPublicKey.mockReturnValue(PK);
    mocks.signer.exportNsec.mockReturnValue('nsec1mockexportedkey');

    accountManager.getAccountList.mockReturnValue({
      activeAccountId: PK,
      accounts: [{ id: PK, loginMethod: 'nsec', displayName: 'Memory User', createdAt: 1000 }]
    });

    openAccountModal(mockState, mockSettings, mockSettingsManager, {});

    const exportBtn = document.getElementById('accountExportNsecBtn');
    expect(exportBtn).not.toBeNull();

    exportBtn.click();

    expect(mocks.showConfirmModal).toHaveBeenCalledTimes(1);
    expect(mocks.signer.exportNsec).toHaveBeenCalledTimes(1);

    const input = document.getElementById('accountExportNsecInput');
    expect(input).not.toBeNull();
    expect(input.value).toBe('nsec1mockexportedkey');
  });
});
