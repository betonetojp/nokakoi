/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openAccountModal } from './account-modal.js';

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
  showConfirmModal: vi.fn((title, msg, onYes) => onYes()),
}));

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
});
