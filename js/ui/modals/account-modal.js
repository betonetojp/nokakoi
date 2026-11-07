/**
 * Account Management Modal
 * アカウント管理モーダル
 */

import { $, escapeHtml, replaceBadgeEmoji } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { getAccountList, switchAccount, removeAccount } from '../../core/account-manager.js';
import { logout } from '../../core/auth/auth-core.js';
import { openLoginModal } from './login-modal.js';
import { openProfileEditor } from '../../features/profile/profile-editor.js';
import { getNip19, getPublicKey as getPublicKeyFn } from '../../core/nostr-compat.js';
import { displayNameWithUsername, loadProfile } from '../../features/profile/profile.js';
import { showConfirmModal, showAlertModal } from './modals.js';
import { signer } from '../../core/signer.js';
import { decryptNsec, hexToBytes } from '../../core/crypto.js';
import { authenticateWithPasskey, decryptNsecWithPasskey } from '../../core/webauthn.js';
import { showPasswordModal } from '../../core/auth/nsec-auth.js';

function getAccountSetting(settings, settingsManager, key) {
  if (settingsManager && typeof settingsManager.get === 'function') {
    const val = settingsManager.get(key);
    if (val !== undefined) return val;
  }
  return settings ? settings[key] : undefined;
}

function clearExportNsecPanel() {
  const panel = $('#accountExportNsecPanel');
  if (!panel) return;
  const input = panel.querySelector('#accountExportNsecInput');
  if (input) input.value = '';
  panel.innerHTML = '';
  panel.hidden = true;
}

function canExportSecretKey(state, settings, settingsManager, activeId, activeAccount) {
  if (!activeId) return false;
  const isReadOnly = (activeAccount && activeAccount.loginMethod === 'read-only') || (state && state.signer === 'read-only');
  if (isReadOnly) return false;
  if (state && (state.signer === 'nip07' || state.signer === 'nip46')) return false;
  if (activeAccount && (activeAccount.loginMethod === 'nip07' || activeAccount.loginMethod === 'nip46')) return false;

  const hasPasskey = !!(
    getAccountSetting(settings, settingsManager, 'passkeyCredentialId') &&
    getAccountSetting(settings, settingsManager, 'passkeyEncryptedNsec')
  );
  const hasPasswordNsec = !!getAccountSetting(settings, settingsManager, 'encryptedNsec');
  const hasMemoryKey = !!(
    state &&
    state.signer === 'nsec' &&
    signer &&
    typeof signer.hasKey === 'function' &&
    signer.hasKey() &&
    (!signer.getPublicKey || !signer.getPublicKey() || signer.getPublicKey().toLowerCase() === activeId)
  );

  return hasPasskey || hasPasswordNsec || hasMemoryKey;
}

function encodeVerifiedSkHex(skHex, activeId) {
  if (!skHex || typeof skHex !== 'string' || !/^[0-9a-f]{64}$/i.test(skHex)) {
    return null;
  }
  const bytes = hexToBytes(skHex.toLowerCase());
  if (!bytes || bytes.length !== 32) return null;

  const getPublicKey = getPublicKeyFn();
  if (typeof getPublicKey === 'function' && activeId) {
    try {
      const derivedPk = getPublicKey(bytes);
      if (derivedPk && derivedPk.toLowerCase() !== activeId.toLowerCase()) {
        return null;
      }
    } catch (e) {
      return null;
    }
  }

  const nip19 = getNip19();
  if (!nip19 || typeof nip19.nsecEncode !== 'function') return null;
  try {
    return nip19.nsecEncode(bytes);
  } catch (e) {
    return null;
  }
}

function renderExportNsecPanel(nsec) {
  const panel = $('#accountExportNsecPanel');
  if (!panel || !nsec) return;

  panel.innerHTML = `
    <div class="account-export-nsec-header">
      <strong class="account-export-nsec-title">${escapeHtml(t('account.nsec_export.title'))}</strong>
      <button type="button" class="secondary text-xs" id="accountExportNsecCloseBtn">${escapeHtml(t('close'))}</button>
    </div>
    <p class="account-export-nsec-warning">${escapeHtml(t('account.nsec_export.warning'))}</p>
    <div class="keygen-input-wrap">
      <input type="password" id="accountExportNsecInput" readonly autocomplete="off" spellcheck="false">
      <button type="button" class="secondary" id="accountExportNsecToggleBtn">${escapeHtml(t('account.nsec_export.show'))}</button>
      <button type="button" class="secondary" id="accountExportNsecCopyBtn">${escapeHtml(t('keygen.copy'))}</button>
    </div>
  `;

  const input = panel.querySelector('#accountExportNsecInput');
  const toggleBtn = panel.querySelector('#accountExportNsecToggleBtn');
  const copyBtn = panel.querySelector('#accountExportNsecCopyBtn');
  const closePanelBtn = panel.querySelector('#accountExportNsecCloseBtn');

  if (input) {
    input.value = nsec;
  }

  if (toggleBtn && input) {
    toggleBtn.onclick = () => {
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      toggleBtn.textContent = isHidden ? t('account.nsec_export.hide') : t('account.nsec_export.show');
    };
  }

  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(nsec);
        copyBtn.textContent = t('keygen.copied');
        setTimeout(() => {
          if (copyBtn.isConnected) {
            copyBtn.textContent = t('keygen.copy');
          }
        }, 2000);
      } catch (e) {}
    };
  }

  if (closePanelBtn) {
    closePanelBtn.onclick = () => {
      clearExportNsecPanel();
    };
  }

  panel.hidden = false;
}

/**
 * アカウント管理モーダルを開く
 */
export function openAccountModal(state, settings, settingsManager, authCallbacks) {
  const modal = $('#accountModal');
  const content = $('#accountModalContent');
  const closeBtn = $('#accountModalClose');

  if (!modal || !content) return;

  const callbacks = typeof authCallbacks === 'function' ? { onLoginSuccess: authCallbacks, restartFeeds: null, enableComposerScroll: null, onLogout: null } : (authCallbacks || {});
  renderAccountModal(state, settings, settingsManager, callbacks);
  try { applyTranslations(modal); } catch (e) {}

  modal.hidden = false;

  if (closeBtn) {
    closeBtn.onclick = () => {
      closeModal();
    };
  }
}

/**
 * モーダル内コンテンツの描画
 */
function renderAccountModal(state, settings, settingsManager, authCallbacks) {
  const callbacks = typeof authCallbacks === 'function' ? { onLoginSuccess: authCallbacks, restartFeeds: null, enableComposerScroll: null, onLogout: null } : (authCallbacks || {});
  const content = $('#accountModalContent');
  if (!content) return;

  const accountData = getAccountList();
  const currentPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
  const activeId = currentPubkey ? (accountData.activeAccountId || currentPubkey).toLowerCase() : null;
  const activeAccount = activeId ? accountData.accounts.find(a => a.id.toLowerCase() === activeId) : null;
  const showExportNsec = canExportSecretKey(state, settings, settingsManager, activeId, activeAccount);
  const nip19 = getNip19();

  const topActionsHtml = activeId ? `
    <!-- 最上部アクション: プロフィール編集・秘密鍵表示・ログアウト -->
    <div class="account-modal-top-actions">
      <button type="button" class="secondary" id="accountEditProfileBtn">
        ${t('account.modal.edit_profile')}
      </button>
      ${showExportNsec ? `
      <button type="button" class="secondary" id="accountExportNsecBtn">
        ${t('account.modal.export_nsec')}
      </button>
      ` : ''}
      <button type="button" class="secondary btn-danger" id="accountLogoutBtn">
        ${t('logout')}
      </button>
    </div>
    ${showExportNsec ? `<div id="accountExportNsecPanel" class="account-export-nsec-panel" hidden></div>` : ''}

    <hr class="account-modal-divider">
  ` : '';

  content.innerHTML = `
    ${topActionsHtml}
    <!-- アカウント一覧 -->
    <div class="account-list" id="accountListContainer"></div>

    <!-- アカウント追加ボタン -->
    <div class="account-modal-bottom-actions">
      <button type="button" class="secondary" id="accountAddBtn">
        ${t('account.modal.add')}
      </button>
    </div>
  `;

  // 1. プロフィール編集ボタン
  const editProfileBtn = $('#accountEditProfileBtn');
  if (editProfileBtn) {
    const isReadOnly = (activeAccount && activeAccount.loginMethod === 'read-only') || (state && state.signer === 'read-only');
    if (isReadOnly) {
      editProfileBtn.onclick = () => {
        showConfirmModal(
          t('confirm.title') || 'お知らせ',
          t('account.modal.edit_profile_disabled') || '閲覧専用アカウントのためプロフィールは編集できません',
          () => {}
        );
      };
    } else {
      editProfileBtn.onclick = () => {
        closeModal();
        openProfileEditor(state);
      };
    }
  }

  // 1.5. 秘密鍵表示ボタン
  const exportNsecBtn = $('#accountExportNsecBtn');
  if (exportNsecBtn) {
    exportNsecBtn.onclick = async () => {
      const panel = $('#accountExportNsecPanel');
      if (panel && !panel.hidden) {
        clearExportNsecPanel();
        return;
      }

      const passkeyCredentialId = getAccountSetting(settings, settingsManager, 'passkeyCredentialId');
      const passkeyEncryptedNsec = getAccountSetting(settings, settingsManager, 'passkeyEncryptedNsec');
      const encryptedNsec = getAccountSetting(settings, settingsManager, 'encryptedNsec');

      if (passkeyCredentialId && passkeyEncryptedNsec) {
        try {
          const authResult = await authenticateWithPasskey(passkeyCredentialId);
          if (!authResult || !authResult.success) return;
          const skHex = await decryptNsecWithPasskey(passkeyEncryptedNsec, authResult.prfKey);
          const nsec = encodeVerifiedSkHex(skHex, activeId);
          if (!nsec) {
            showAlertModal(t('error.generic'), t('account.nsec_export.failed'));
            return;
          }
          renderExportNsecPanel(nsec);
        } catch (e) {
          console.error('[AccountModal] パスキーによる秘密鍵復号失敗:', e);
          showAlertModal(t('error.generic'), t('account.nsec_export.failed'));
        }
        return;
      }

      if (encryptedNsec) {
        showPasswordModal(async (password) => {
          if (!password) {
            showAlertModal(t('error.generic'), t('auth.password_required'));
            return;
          }
          try {
            const skHex = await decryptNsec(encryptedNsec, password);
            const nsec = encodeVerifiedSkHex(skHex, activeId);
            if (!nsec) {
              showAlertModal(t('error.generic'), t('auth.password_incorrect'));
              return;
            }
            renderExportNsecPanel(nsec);
          } catch (e) {
            showAlertModal(t('error.generic'), t('auth.password_incorrect'));
          }
        });
        return;
      }

      if (state && state.signer === 'nsec' && signer && typeof signer.hasKey === 'function' && signer.hasKey()) {
        showConfirmModal(
          t('account.nsec_export.confirm_title'),
          t('account.nsec_export.confirm_msg'),
          () => {
            const nsec = typeof signer.exportNsec === 'function' ? signer.exportNsec() : null;
            if (!nsec) {
              showAlertModal(t('error.generic'), t('account.nsec_export.failed'));
              return;
            }
            renderExportNsecPanel(nsec);
          }
        );
      }
    };
  }

  // 2. ログアウトボタン
  const logoutBtn = $('#accountLogoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      closeModal();
      if (callbacks && typeof callbacks.onLogout === 'function') {
        try { authCallbacks.onLogout(); } catch (e) {}
      }
      logout(state, settings, settingsManager, callbacks ? callbacks.restartFeeds : null);
    };
  }

  // 3. アカウント追加ボタン
  const addBtn = $('#accountAddBtn');
  if (addBtn) {
    addBtn.onclick = () => {
      closeModal();
      openLoginModal(
        state,
        settings,
        settingsManager,
        callbacks && typeof callbacks.onLoginSuccess === 'function' ? callbacks.onLoginSuccess : (callbacks ? () => import('../../core/auth/auth-core.js').then(m => m.login(state, settings, settingsManager, callbacks.restartFeeds, callbacks.enableComposerScroll)) : null),
        callbacks ? callbacks.restartFeeds : null,
        callbacks ? callbacks.enableComposerScroll : null
      );
    };
  }

  // 4. アカウントリストの構築
  const listContainer = $('#accountListContainer');
  if (listContainer) {
    if (accountData.accounts.length === 0 && activeId) {
      accountData.accounts.push({
        id: activeId.toLowerCase(),
        loginMethod: state.signer || 'nsec',
        displayName: '',
        createdAt: Date.now()
      });
    }

    accountData.accounts.forEach(acc => {
      const isCurrent = activeId && acc.id.toLowerCase() === activeId.toLowerCase();
      const item = document.createElement('div');
      item.className = `account-list-item ${isCurrent ? 'account-active' : ''}`;

      // プロファイルキャッシュ（メモリ or localStorage）から名前・画像を取得試行
      let prof = state && state.profiles ? state.profiles.get(acc.id) : null;
      if (!prof) {
        try {
          const rawCache = localStorage.getItem('nostr_profiles_cache');
          if (rawCache) {
            const cacheMap = JSON.parse(rawCache);
            if (cacheMap[acc.id]) prof = cacheMap[acc.id];
          }
        } catch (e) {}
      }
      if (!prof && state) {
        try { loadProfile(state, acc.id); } catch (e) {}
      }

      let formattedName = acc.displayName || acc.id;
      if (nip19 && nip19.npubEncode) {
        try {
          const npub = nip19.npubEncode(acc.id);
          formattedName = npub.substring(0, 10) + '...' + npub.substring(npub.length - 6);
        } catch (e) {}
      }

      if (state) {
        try {
          const names = displayNameWithUsername(state, acc.id, nip19, { usePetname: true });
          if (names && names.main) {
            formattedName = names.main;
          }
        } catch (e) {}
      }

      const nameHtml = replaceBadgeEmoji(escapeHtml(formattedName));
      const pictureUrl = (prof && prof.picture) ? String(prof.picture).trim() : '';
      const avatarHtml = pictureUrl
        ? `<img src="${escapeHtml(pictureUrl)}" alt="avatar" class="account-user-avatar" loading="lazy">`
        : '';

      const methodMap = {
        'nip07': t('account.method.nip07'),
        'nsec': t('account.method.password'),
        'nsec-passkey': t('account.method.passkey'),
        'nip46': t('account.method.nip46'),
        'read-only': t('account.method.read_only')
      };
      const methodLabel = methodMap[acc.loginMethod] || t('account.method.unsaved');

      item.innerHTML = `
        <div class="account-item-main">
          ${avatarHtml}
          <div class="account-user-info">
            <div class="account-user-name">
              ${isCurrent ? '✓ ' : ''}${nameHtml}
            </div>
            <div class="account-user-meta">
              ${methodLabel} ${isCurrent ? `(${t('account.modal.active')})` : ''}
            </div>
          </div>
        </div>
        <div class="account-actions">
          ${!isCurrent ? `<button type="button" class="secondary text-xs switch-acc-btn">${t('account.modal.switch')}</button>` : ''}
          <button type="button" class="secondary btn-danger text-xs delete-acc-btn">${t('account.modal.delete')}</button>
        </div>
      `;

      // 切替ボタン
      const switchBtn = item.querySelector('.switch-acc-btn');
      if (switchBtn) {
        switchBtn.onclick = async () => {
          closeModal();
          await switchAccount(acc.id, state, settingsManager, async () => {

            if (callbacks && typeof callbacks.onLoginSuccess === 'function') { await callbacks.onLoginSuccess(); } else { const { login } = await import('../../core/auth/auth-core.js'); await login(state, settings, settingsManager, callbacks ? callbacks.restartFeeds : null, callbacks ? callbacks.enableComposerScroll : null); }
          });
        };
      }

      // 削除ボタン
      const deleteBtn = item.querySelector('.delete-acc-btn');
      if (deleteBtn) {
        deleteBtn.onclick = () => {
          showConfirmModal(
            t('account.modal.delete_title') || t('editor.snapshot.delete') || '削除',
            t('account.modal.delete_confirm') || 'このアカウントを削除しますか？',
            () => {
              removeAccount(acc.id);
              if (isCurrent) {
                closeModal();
                if (callbacks && typeof callbacks.onLogout === 'function') { try { callbacks.onLogout(); } catch (e) {} }
                logout(state, settings, settingsManager, callbacks ? callbacks.restartFeeds : null);
              } else {

                renderAccountModal(state, settings, settingsManager, callbacks);
              }
            }
          );
        };
      }

      listContainer.appendChild(item);
    });
  }
}

function closeModal() {
  clearExportNsecPanel();
  const modal = $('#accountModal');
  if (modal) modal.hidden = true;
}
