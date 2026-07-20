import { $ } from '../utils/utils.js';
import { isWebAuthnSupported, authenticateWithPasskey, decryptNsecWithPasskey } from '../core/webauthn.js';
import { decryptNsec } from '../core/crypto.js';
import { login, logout } from '../core/auth/auth-core.js';
import { nsecLoginPrompt, showPasswordModal } from '../core/auth/nsec-auth.js';
import { showNip46LoginModal } from '../core/auth/nip46-auth.js';
import { t } from '../utils/i18n.js';

export function setupAuthUI(state, settings, settingsManager, {
  restartFeeds,
  enableComposerScroll,
  onLogout
}) {
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
                  state.sk = skHex.toLowerCase();
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
          try {
            const skHex = await decryptNsec(settings.encryptedNsec, '');
            if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
              state.sk = skHex.toLowerCase();
              state.signer = 'nsec';
              try { await login(state, settings, settingsManager, restartFeeds, enableComposerScroll); } catch (e) { console.warn('[Auth] 空パスワード復号後のログインに失敗', e); }
              return;
            }
          } catch (e) {
          }

          showPasswordModal(async (password) => {
            try {
              const skHex = await decryptNsec(settings.encryptedNsec, password);
              if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
                state.sk = skHex.toLowerCase();
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

  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      if (typeof onLogout === 'function') {
        try { onLogout(); } catch (e) { }
      }
      logout(state, settings, settingsManager, restartFeeds);
    };
  }
}
