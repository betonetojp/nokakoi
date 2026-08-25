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
import { getNip19 } from '../../core/nostr-compat.js';
import { displayNameWithUsername, loadProfile } from '../../features/profile/profile.js';
import { showConfirmModal } from './modals.js';

/**
 * アカウント管理モーダルを開く
 */
export function openAccountModal(state, settings, settingsManager, authCallbacks) {
  const modal = $('#accountModal');
  const content = $('#accountModalContent');
  const closeBtn = $('#accountModalClose');

  if (!modal || !content) return;

  renderAccountModal(state, settings, settingsManager, authCallbacks);
  try { applyTranslations(modal); } catch (e) {}

  modal.hidden = false;

  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.hidden = true;
    };
  }
}

/**
 * モーダル内コンテンツの描画
 */
function renderAccountModal(state, settings, settingsManager, authCallbacks) {
  const content = $('#accountModalContent');
  if (!content) return;

  const accountData = getAccountList();
  const currentPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
  const activeId = currentPubkey ? (accountData.activeAccountId || currentPubkey).toLowerCase() : null;
  const nip19 = getNip19();

  const topActionsHtml = activeId ? `
    <!-- 最上部アクション: プロフィール編集・ログアウト -->
    <div class="account-modal-top-actions">
      <button type="button" class="secondary" id="accountEditProfileBtn">
        ${t('account.modal.edit_profile')}
      </button>
      <button type="button" class="secondary btn-danger" id="accountLogoutBtn">
        ${t('logout')}
      </button>
    </div>

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
    editProfileBtn.onclick = () => {
      closeModal();
      openProfileEditor(state);
    };
  }

  // 2. ログアウトボタン
  const logoutBtn = $('#accountLogoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      closeModal();
      if (authCallbacks && typeof authCallbacks.onLogout === 'function') {
        try { authCallbacks.onLogout(); } catch (e) {}
      }
      logout(state, settings, settingsManager, authCallbacks ? authCallbacks.restartFeeds : null);
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
        authCallbacks ? () => import('../../core/auth/auth-core.js').then(m => m.login(state, settings, settingsManager, authCallbacks.restartFeeds, authCallbacks.enableComposerScroll)) : null
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
        'nip46': t('account.method.nip46')
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
            const { login } = await import('../../core/auth/auth-core.js');
            await login(state, settings, settingsManager, authCallbacks ? authCallbacks.restartFeeds : null, authCallbacks ? authCallbacks.enableComposerScroll : null);
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
                logout(state, settings, settingsManager, authCallbacks ? authCallbacks.restartFeeds : null);
              } else {
                renderAccountModal(state, settings, settingsManager, authCallbacks);
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
  const modal = $('#accountModal');
  if (modal) modal.hidden = true;
}
