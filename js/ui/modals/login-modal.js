import { $ } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { nsecLoginPrompt } from '../../core/auth/nsec-auth.js';
import { showNip46LoginModal } from '../../core/auth/nip46-auth.js';
import { generateKeyPair } from '../../core/keygen.js';
import { signer } from '../../core/signer.js';
import { encryptNsec } from '../../core/crypto.js';
import { isUserVerifyingPlatformAvailable, registerPasskey, authenticateWithPasskey, encryptNsecWithPasskey } from '../../core/webauthn.js';

/**
 * ログイン選択モーダルを開く
 */
export function openLoginModal(state, settings, settingsManager, onLoginSuccess) {
  const modal = $('#loginMethodModal');
  const content = $('#loginMethodModalContent');
  const closeBtn = $('#loginMethodModalClose');

  if (!modal || !content) return;

  try {
    applyTranslations(modal);
  } catch (e) {}

  renderMethodSelection(state, settings, settingsManager, onLoginSuccess);

  modal.hidden = false;

  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.hidden = true;
    };
  }
}

/**
 * ログイン選択カード一覧を描画
 */
async function renderMethodSelection(state, settings, settingsManager, onLoginSuccess) {
  const content = $('#loginMethodModalContent');
  if (!content) return;

  content.innerHTML = '';

  const methods = [
    {
      id: 'nsec',
      icon: '🔑',
      titleKey: 'login.modal.nsec',
      descKey: 'login.modal.nsec_desc',
      action: () => {
        closeModal();
        nsecLoginPrompt(state, settings, settingsManager, onLoginSuccess);
      }
    },
    {
      id: 'nip46',
      icon: '🔗',
      titleKey: 'login.modal.nip46',
      descKey: 'login.modal.nip46_desc',
      action: () => {
        closeModal();
        showNip46LoginModal(state, settings, settingsManager, onLoginSuccess);
      }
    },
    {
      id: 'nip07',
      icon: '🌐',
      titleKey: 'login.modal.nip07',
      descKey: 'login.modal.nip07_desc',
      action: async () => {
        closeModal();
        state.signer = 'nip07';
        settingsManager.set('preferredSigner', 'nip07');
        if (typeof onLoginSuccess === 'function') {
          await onLoginSuccess();
        }
      }
    },
    {
      id: 'keygen',
      icon: '✨',
      titleKey: 'login.modal.keygen',
      descKey: 'login.modal.keygen_desc',
      action: () => {
        renderKeyGenScreen(state, settings, settingsManager, onLoginSuccess);
      }
    },
    {
      id: 'read_only',
      icon: '👀',
      titleKey: 'login.modal.read_only',
      descKey: 'login.modal.read_only_desc',
      action: () => {
        renderReadOnlyScreen(state, settings, settingsManager, onLoginSuccess);
      }
    }
  ];

  try {
    const { getAccountList } = await import('../../core/account-manager.js');
    const { openAccountModal } = await import('./account-modal.js');
    const accList = getAccountList();
    if (accList && accList.accounts && accList.accounts.length > 0) {
      methods.unshift({
        id: 'saved_accounts',
        icon: '👥',
        titleKey: 'account.modal.title',
        descKey: 'login.modal.saved_accounts_desc',
        action: () => {
          closeModal();
          openAccountModal(state, settings, settingsManager, onLoginSuccess);
        }
      });
    }
  } catch (e) {}

  methods.forEach(m => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'login-method-card';
    card.innerHTML = `
      <div class="login-method-icon">${m.icon}</div>
      <div class="login-method-info">
        <div class="login-method-title">${t(m.titleKey)}</div>
        <div class="login-method-desc">${t(m.descKey)}</div>
      </div>
    `;
    card.onclick = m.action;
    content.appendChild(card);
  });
}

/**
 * 秘密鍵作成画面を描画
 */
function renderKeyGenScreen(state, settings, settingsManager, onLoginSuccess) {
  const content = $('#loginMethodModalContent');
  if (!content) return;

  const keyPair = generateKeyPair();

  content.innerHTML = `
    <div style="margin-bottom: 12px;">
      <h3 style="margin-top:0; margin-bottom:8px;">${t('keygen.title')}</h3>
      <p style="color:#ff5555; font-size:0.85em; margin:0 0 12px;">${t('keygen.backup_warning')}</p>
      
      <div class="keygen-display">
        <div class="keygen-field">
          <label class="modal-field-label">${t('keygen.nsec_label')}</label>
          <div class="keygen-input-wrap">
            <input type="text" readonly value="${keyPair.nsec}" id="keygenNsecInput">
            <button type="button" class="secondary" id="copyNsecBtn">${t('keygen.copy')}</button>
          </div>
        </div>

        <div class="keygen-field">
          <label class="modal-field-label">${t('keygen.npub_label')}</label>
          <div class="keygen-input-wrap">
            <input type="text" readonly value="${keyPair.npub}" id="keygenNpubInput">
            <button type="button" class="secondary" id="copyNpubBtn">${t('keygen.copy')}</button>
          </div>
        </div>
      </div>

      <label class="nsec-save-label" style="margin-top:12px; display:block;">
        <input type="checkbox" id="backupCheck">
        <span style="font-size:0.9em; font-weight:bold;">${t('keygen.confirm_backup')}</span>
      </label>

      <div id="keygenSaveSection" style="margin-top:12px; padding:10px; background:var(--bg-secondary, var(--panel-hover, rgba(128,128,128,0.08))); border:1px solid var(--border, rgba(128,128,128,0.2)); border-radius:6px;" class="d-none">
        <label class="nsec-save-label">
          <input type="checkbox" id="keygenSaveCheck" checked>
          <span style="font-size:0.9em; font-weight:bold;">${t('keygen.save_option')}</span>
        </label>
        <p id="keygenUnsavedWarning" style="color:#eab308; font-size:0.8em; margin:4px 0 8px 24px;" class="d-none">
          ⚠️ ${t('keygen.save_warning')}
        </p>

        <div id="keygenAutoLoginOptions" style="margin-top:8px; margin-left:24px;">
          <div class="radio-option" style="margin-bottom:6px;">
            <input type="radio" name="keygenSaveMethod" id="radioKeygenPasskey" value="passkey" checked>
            <label for="radioKeygenPasskey">${t('auth.passkey_option')}</label>
          </div>
          <p id="keygenPasskeyInfo" class="muted passkey-info" style="font-size:0.8em; margin:4px 0 8px 24px;">
            <span>${t('nsec.passkey_info_line1')}</span><br>
            <span>${t('nsec.passkey_info_line2')}</span>
          </p>
          <div class="radio-option" style="margin-bottom:6px;">
            <input type="radio" name="keygenSaveMethod" id="radioKeygenPassword" value="password">
            <label for="radioKeygenPassword">${t('auth.password_option')}</label>
          </div>

          <div id="keygenPasswordSection" style="margin-top:8px;" class="d-none">
            <input type="password" id="keygenPassword" placeholder="${t('auth.password_placeholder')}" style="width:100%; padding:6px; box-sizing:border-box;">
            <p class="muted password-section-desc" style="font-size:0.8em; margin:6px 0 8px 0;">
              <span>${t('nsec.password_section_desc_line1')}</span><br>
              <span>${t('nsec.password_section_desc_line2')}</span><br>
              <span>${t('nsec.password_section_desc_line3')}</span>
            </p>
          </div>
        </div>
      </div>

      <div id="keygenStatus" style="font-size:0.85em; color:#ffaa00; margin-top:8px;"></div>
    </div>

    <div style="display:flex; justify-content:space-between; gap:8px; margin-top:16px;">
      <button type="button" class="secondary" id="keygenBackBtn">${t('editor.common.cancel')}</button>
      <button type="button" id="keygenLoginBtn" disabled>${t('keygen.login')}</button>
    </div>
  `;

  // コピー処理
  const copyNsecBtn = $('#copyNsecBtn');
  if (copyNsecBtn) {
    copyNsecBtn.onclick = () => {
      navigator.clipboard.writeText(keyPair.nsec);
      copyNsecBtn.textContent = t('keygen.copied');
      setTimeout(() => { copyNsecBtn.textContent = t('keygen.copy'); }, 2000);
    };
  }

  const copyNpubBtn = $('#copyNpubBtn');
  if (copyNpubBtn) {
    copyNpubBtn.onclick = () => {
      navigator.clipboard.writeText(keyPair.npub);
      copyNpubBtn.textContent = t('keygen.copied');
      setTimeout(() => { copyNpubBtn.textContent = t('keygen.copy'); }, 2000);
    };
  }

  // 要素取得
  const backupCheck = $('#backupCheck');
  const loginBtn = $('#keygenLoginBtn');
  const saveSection = $('#keygenSaveSection');
  const saveCheck = $('#keygenSaveCheck');
  const unsavedWarning = $('#keygenUnsavedWarning');
  const autoLoginOptions = $('#keygenAutoLoginOptions');
  const radioPasskey = $('#radioKeygenPasskey');
  const radioPassword = $('#radioKeygenPassword');
  const passkeyInfo = $('#keygenPasskeyInfo');
  const passwordSection = $('#keygenPasswordSection');
  const passwordInput = $('#keygenPassword');
  const statusEl = $('#keygenStatus');

  let passkeyAvailable = false;
  isUserVerifyingPlatformAvailable().then(available => {
    passkeyAvailable = available;
    if (!available && radioPasskey) {
      radioPasskey.disabled = true;
      if (radioPassword) radioPassword.checked = true;
      updateKeygenSaveSections();
    }
  });

  function updateKeygenSaveSections() {
    if (!saveCheck || !saveSection) return;

    if (saveCheck.checked) {
      if (unsavedWarning) unsavedWarning.classList.add('d-none');
      if (autoLoginOptions) autoLoginOptions.classList.remove('d-none');

      if (radioPasskey && radioPasskey.checked) {
        if (passkeyInfo) passkeyInfo.classList.remove('d-none');
        if (passwordSection) passwordSection.classList.add('d-none');
      } else {
        if (passkeyInfo) passkeyInfo.classList.add('d-none');
        if (passwordSection) passwordSection.classList.remove('d-none');
      }
    } else {
      if (unsavedWarning) unsavedWarning.classList.remove('d-none');
      if (autoLoginOptions) autoLoginOptions.classList.add('d-none');
    }
  }

  if (saveCheck) saveCheck.onchange = updateKeygenSaveSections;
  if (radioPasskey) radioPasskey.onchange = updateKeygenSaveSections;
  if (radioPassword) radioPassword.onchange = updateKeygenSaveSections;

  if (backupCheck && loginBtn && saveSection) {
    backupCheck.onchange = () => {
      loginBtn.disabled = !backupCheck.checked;
      if (backupCheck.checked) {
        saveSection.classList.remove('d-none');
        updateKeygenSaveSections();
      } else {
        saveSection.classList.add('d-none');
      }
    };
  }

  if (saveCheck) saveCheck.onchange = updateKeygenSaveSections;
  if (radioPasskey) radioPasskey.onchange = updateKeygenSaveSections;
  if (radioPassword) radioPassword.onchange = updateKeygenSaveSections;

  // 戻るボタン
  const backBtn = $('#keygenBackBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      renderMethodSelection(state, settings, settingsManager, onLoginSuccess);
    };
  }

  // ログインボタン
  if (loginBtn) {
    loginBtn.onclick = async () => {
      signer.setKey(keyPair.skHex);
      state.signer = 'nsec';
      const targetPubkey = signer.getPublicKey().toLowerCase();

      // settingsManagerを対象アカウントへ切り替えてから設定を保存
      if (settingsManager && typeof settingsManager.loadForAccount === 'function') {
        settingsManager.loadForAccount(targetPubkey);
      }

      if (saveCheck && saveCheck.checked) {
        if (radioPasskey && radioPasskey.checked && passkeyAvailable) {
          try {
            if (statusEl) statusEl.textContent = t('auth.passkey_register_prompt');
            const passkeyData = await registerPasskey();
            if (statusEl) statusEl.textContent = t('auth.pending');
            const authResult = await authenticateWithPasskey(passkeyData.credentialId);
            if (authResult.success) {
              const encrypted = await encryptNsecWithPasskey(keyPair.skHex, authResult.prfKey);
              settingsManager.set('passkeyCredentialId', passkeyData.credentialId);
              settingsManager.set('passkeyEncryptedNsec', encrypted);
              settingsManager.set('passkeyDeviceInfo', passkeyData.deviceInfo);
              settingsManager.set('preferredSigner', 'nsec-passkey');
              settingsManager.saveForAccount(targetPubkey);
            }
          } catch (e) {
            console.error('[Auth] パスキー登録失敗:', e);
            if (statusEl) statusEl.textContent = t('auth.passkey_register_failed', { msg: (e && e.message) });
            return;
          }
        } else if (radioPassword && radioPassword.checked) {
          const pwd = passwordInput ? passwordInput.value : '';
          if (!pwd) {
            if (statusEl) statusEl.textContent = t('auth.password_required');
            if (passwordInput) passwordInput.focus();
            return;
          }
          if (statusEl) statusEl.textContent = t('auth.pending');
          const encrypted = await encryptNsec(keyPair.skHex, pwd);
          settingsManager.set('encryptedNsec', encrypted);
          settingsManager.set('preferredSigner', 'nsec');
          settingsManager.saveForAccount(targetPubkey);
        }
      } else {
        // 保存しない場合は preferredSigner をクリア
        settingsManager.set('preferredSigner', null);
        settingsManager.saveForAccount(targetPubkey);
      }

      closeModal();

      // 作成直後フラグを立てて、ログイン成功後に kind:0 編集画面を開くようにする
      window.__nokakoiOpenProfileEditorAfterLogin = true;

      if (typeof onLoginSuccess === 'function') {
        await onLoginSuccess();
      }
    };
  }
}


/**
 * 公開鍵閲覧専用ログイン画面を描画
 */
function renderReadOnlyScreen(state, settings, settingsManager, onLoginSuccess) {
  const content = $('#loginMethodModalContent');
  if (!content) return;

  content.innerHTML = `
    <div style="margin-bottom: 12px;">
      <h3 style="margin-top:0; margin-bottom:8px;">${t('readonly.title')}</h3>
      <p style="font-size:0.85em; margin:0 0 12px; color:var(--text-secondary, #888);">${t('readonly.desc')}</p>
      
      <div class="readonly-display" style="margin-bottom:12px;">
        <label class="modal-field-label" for="readOnlyPubkeyInput">${t('readonly.input_label')}</label>
        <div style="display:flex; gap:8px; margin-top:4px;">
          <input type="text" id="readOnlyPubkeyInput" placeholder="${t('readonly.input_placeholder')}" style="flex:1; padding:8px; box-sizing:border-box; font-family:monospace; font-size:0.9em;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        </div>
      </div>

      <div id="readOnlyStatus" style="font-size:0.85em; color:#ffaa00; margin-top:8px; min-height:1.2em;"></div>
    </div>

    <div style="display:flex; justify-content:space-between; gap:8px; margin-top:16px;">
      <button type="button" class="secondary" id="readOnlyBackBtn">${t('editor.common.cancel')}</button>
      <button type="button" id="readOnlyLoginBtn">${t('readonly.login_btn')}</button>
    </div>
  `;

  const backBtn = $('#readOnlyBackBtn');
  const loginBtn = $('#readOnlyLoginBtn');
  const input = $('#readOnlyPubkeyInput');
  const statusEl = $('#readOnlyStatus');

  if (backBtn) {
    backBtn.onclick = () => {
      renderMethodSelection(state, settings, settingsManager, onLoginSuccess);
    };
  }

  if (input) {
    input.focus();
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (loginBtn) loginBtn.click();
      }
    };
  }

  if (loginBtn) {
    loginBtn.onclick = async () => {
      const rawInput = input ? input.value.trim() : '';
      if (!rawInput) {
        if (statusEl) statusEl.textContent = t('readonly.invalid_key');
        if (input) input.focus();
        return;
      }

      let hexPubkey = null;
      if (/^[0-9a-f]{64}$/i.test(rawInput)) {
        hexPubkey = rawInput.toLowerCase();
      } else if (rawInput.startsWith('npub1')) {
        try {
          const { getNip19 } = await import('../../core/nostr-compat.js');
          const nip19 = getNip19();
          if (nip19 && typeof nip19.decode === 'function') {
            const decoded = nip19.decode(rawInput);
            if (decoded && decoded.type === 'npub' && decoded.data) {
              hexPubkey = decoded.data.toLowerCase();
            }
          }
        } catch (e) {
          console.warn('[LoginModal] npubデコード失敗:', e);
        }
      }

      if (!hexPubkey || !/^[0-9a-f]{64}$/i.test(hexPubkey)) {
        if (statusEl) statusEl.textContent = t('readonly.invalid_key');
        if (input) input.focus();
        return;
      }

      if (statusEl) statusEl.textContent = t('auth.pending') || 'ログイン中...';

      closeModal();

      try {
        const { loginWithPubkey } = await import('../../core/auth/auth-core.js');
        if (typeof loginWithPubkey === 'function') {
          await loginWithPubkey(
            hexPubkey,
            state,
            settings,
            settingsManager,
            typeof onLoginSuccess === 'function' ? onLoginSuccess : null
          );
        } else {
          state.signer = 'read-only';
          state.pubkey = hexPubkey;
          try {
            localStorage.setItem('pubkey', hexPubkey);
            localStorage.removeItem('skipAutoLogin');
          } catch (e) {}
          if (typeof onLoginSuccess === 'function') {
            await onLoginSuccess();
          }
        }
      } catch (e) {
        console.error('[LoginModal] 閲覧専用ログイン失敗:', e);
      }
    };
  }
}

function closeModal() {
  const modal = $('#loginMethodModal');
  if (modal) modal.hidden = true;
}

