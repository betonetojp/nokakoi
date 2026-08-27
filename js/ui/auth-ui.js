import { $ } from '../utils/utils.js';
import { isWebAuthnSupported, authenticateWithPasskey, decryptNsecWithPasskey } from '../core/webauthn.js';
import { decryptNsec } from '../core/crypto.js';
import { signer } from '../core/signer.js';
import { login, logout } from '../core/auth/auth-core.js';
import { nsecLoginPrompt, showPasswordModal } from '../core/auth/nsec-auth.js';
import { showNip46LoginModal } from '../core/auth/nip46-auth.js';
import { t } from '../utils/i18n.js';

export function setupAuthUI(state, settings, settingsManager, {
  restartFeeds,
  enableComposerScroll,
  onLogout
}) {
  const openLoginBtn = $('#openLoginModalBtn');
  if (openLoginBtn) {
    openLoginBtn.onclick = () => {
      import('./modals/login-modal.js').then(mod => {
        if (mod && typeof mod.openLoginModal === 'function') {
          mod.openLoginModal(
            state,
            settings,
            settingsManager,
            () => login(state, settings, settingsManager, restartFeeds, enableComposerScroll)
          );
        }
      });
    };
  }
  const nsecBtn = $('#nsecLoginBtn');
  if (nsecBtn) {
    nsecBtn.onclick = async () => {
      try {
        const hasPasskey = !!settings.passkeyCredentialId && !!settings.passkeyEncryptedNsec;
        if (hasPasskey) {
          try {
            const webauthnOk = await isWebAuthnSupported();
            if (webauthnOk) {
              const authRes = await authenticateWithPasskey(settings.passkeyCredentialId);
              if (authRes && authRes.success) {
                const skHex = await decryptNsecWithPasskey(settings.passkeyEncryptedNsec);
                if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
                  signer.setKey(skHex);
                  state.signer = 'nsec';
                  try { await login(state, settings, settingsManager, restartFeeds, enableComposerScroll); } catch (e) { console.warn('[Auth] パスキーログイン後のログインに失敗', e); }
                  return;
                }
              }
            }
          } catch (e) {
            console.warn('[Auth] パスキーログイン試行に失敗', e);
          }
        }

        if (settings.encryptedNsec) {
          showPasswordModal(async (password) => {
            try {
              if (!password) {
                alert(t('auth.password_required'));
                return;
              }
              const skHex = await decryptNsec(settings.encryptedNsec, password);
              if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
                signer.setKey(skHex);
                state.signer = 'nsec';
                try { await login(state, settings, settingsManager, restartFeeds, enableComposerScroll); } catch (e) { console.warn('[Auth] パスワード復号後のログインに失敗', e); }
              } else {
                alert(t('auth.password_incorrect'));
                settingsManager.set('encryptedNsec', null);
                settingsManager.set('preferredSigner', null);
              }
            } catch (e) {
              alert(t('auth.decrypt_failed', { msg: (e && e.message) }));
              settingsManager.set('encryptedNsec', null);
              settingsManager.set('preferredSigner', null);
            }
          });
          return;
        }

        nsecLoginPrompt(
          state,
          settings,
          settingsManager,
          () => login(state, settings, settingsManager, restartFeeds, enableComposerScroll)
        );
      } catch (e) {
        console.warn('[Auth] nsecBtnハンドラーエラー', e);
      }
    };
  }

  const nip46Btn = $('#nip46LoginBtn');
  if (nip46Btn) {
    nip46Btn.onclick = () => {
      showNip46LoginModal(
        state,
        settings,
        settingsManager,
        () => login(state, settings, settingsManager, restartFeeds, enableComposerScroll)
      );
    };
  }

  const loginBtn = $('#loginBtn');
  if (loginBtn) {
    loginBtn.onclick = async function () {
      state.signer = 'nip07';
      const btn = $('#loginBtn');
      const originalText = btn ? btn.textContent : '';
      if (btn) btn.textContent = t('auth.checking_extension');
      if (btn) btn.disabled = true;
      await new Promise(resolve => setTimeout(resolve, 300));
      if (btn) btn.textContent = originalText;
      if (btn) btn.disabled = false;
      settingsManager.set('preferredSigner', 'nip07');
      login(state, settings, settingsManager, restartFeeds, enableComposerScroll);
    };
  }

  // NIP-07 拡張機能のアカウント切り替えをフォーカス時に検知
  setupNip07FocusListener(state, settings, settingsManager, { restartFeeds, enableComposerScroll });
}

let isNip07SwitchPromptOpen = false;

/**
 * ウィンドウ/タブ復帰時に NIP-07 拡張機能のアカウント変更を検知・案内
 */
export function setupNip07FocusListener(state, settings, settingsManager, { restartFeeds, enableComposerScroll }) {
  if (typeof window === 'undefined') return;

  const checkNip07AccountSwitch = async () => {
    try {
      if (isNip07SwitchPromptOpen) return;
      if (!state || !state.pubkey || state.signer !== 'nip07') return;
      if (!window.nostr || typeof window.nostr.getPublicKey !== 'function') return;
      if (window.__nokakoiAuthPending) return;

      const currentPubkey = state.pubkey.toLowerCase();
      let extPubkey = null;
      try {
        extPubkey = await window.nostr.getPublicKey();
      } catch (e) {
        return;
      }

      if (!extPubkey) return;
      const normExtPubkey = extPubkey.toLowerCase();

      if (normExtPubkey !== currentPubkey) {
        isNip07SwitchPromptOpen = true;
        const shortExt = normExtPubkey.substring(0, 8) + '...';
        const { showConfirmModal } = await import('./modals/modals.js');
        const title = t('account.nip07_switched_title') || 'NIP-07 アカウント変更検知';
        const message = (t('account.nip07_switched_confirm') || 'ブラウザ拡張機能側のアカウントが切り替わりました ({extPubkey})。\nnokakoi のログインアカウントも切り替えますか？')
          .replace('{extPubkey}', shortExt);

        showConfirmModal(
          title,
          message,
          async () => {
            isNip07SwitchPromptOpen = false;
            try {
              const { getAccountList, switchAccount } = await import('../core/account-manager.js');
              const { login } = await import('../core/auth/auth-core.js');
              const list = getAccountList();
              const found = list.accounts.find(a => a.id.toLowerCase() === normExtPubkey);
              if (found) {
                await switchAccount(normExtPubkey, state, settingsManager, async () => {
                  await login(state, settings, settingsManager, restartFeeds, enableComposerScroll);
                });
              } else {
                state.signer = 'nip07';
                await login(state, settings, settingsManager, restartFeeds, enableComposerScroll);
                const { resetChannelViewForAccount } = await import('../features/channel/channel-ui.js');
                if (typeof resetChannelViewForAccount === 'function') {
                  resetChannelViewForAccount(state);
                }
              }
            } catch (err) {
              console.error('[NIP-07 Sync] アカウント切り替え失敗:', err);
            }
          },
          () => {
            isNip07SwitchPromptOpen = false;
          }
        );
      }
    } catch (e) {
      console.warn('[NIP-07 Sync] チェックエラー:', e);
      isNip07SwitchPromptOpen = false;
    }
  };

  window.addEventListener('focus', () => {
    setTimeout(checkNip07AccountSwitch, 200);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      setTimeout(checkNip07AccountSwitch, 200);
    }
  });
}
