import { $ } from '../../utils/utils.js';
import { getNip19 } from '../nostr-compat.js';
import { bytesToHex, encryptNsec } from '../crypto.js';
import { t } from '../../utils/i18n.js';
import { isUserVerifyingPlatformAvailable, registerPasskey, authenticateWithPasskey, encryptNsecWithPasskey } from '../webauthn.js';

function showModal(modalId) {
  const modal = $(modalId);
  if (modal) modal.hidden = false;
}

function hideModal(modalId) {
  const modal = $(modalId);
  if (modal) modal.hidden = true;
}

export function nsecLoginPrompt(state, settings, settingsManager, loginFn) {
  showNsecLoginModal(state, settings, settingsManager, loginFn);
}

export function showNsecLoginModal(state, settings, settingsManager, loginFn) {
  const modal = $('#nsecModal');
  const input = $('#nsecInput');
  const saveCheck = $('#saveNsecCheck');
  const autoLoginOptions = $('#autoLoginOptions');
  const radioPasskey = $('#radioPasskey');
  const radioPassword = $('#radioPassword');
  const passkeyInfo = $('#passkeyInfo');
  const passwordSection = $('#passwordSection');
  const passwordInput = $('#nsecPassword');
  const passkeySection = $('#passkeySection');
  const confirmBtn = $('#nsecLoginConfirm');
  const cancelBtn = $('#nsecLoginCancel');
  const statusEl = $('#nsecLoginStatus');

  if (!modal || !input || !confirmBtn || !cancelBtn) return;

  input.value = '';
  if (passwordInput) passwordInput.value = '';
  if (saveCheck) saveCheck.checked = false;
  if (radioPasskey) radioPasskey.checked = false;
  if (radioPassword) radioPassword.checked = false;
  if (passwordSection) passwordSection.classList.add('d-none');
  if (passkeySection) passkeySection.classList.add('d-none');
  if (autoLoginOptions) autoLoginOptions.classList.add('d-none');
  if (passkeyInfo) passkeyInfo.classList.add('d-none');
  if (statusEl) statusEl.textContent = '';

  let passkeyAvailable = false;
  isUserVerifyingPlatformAvailable().then(available => {
    passkeyAvailable = available;
    updateSections();
  });

  function updateSections() {
    if (saveCheck && saveCheck.checked) {
      if (autoLoginOptions) autoLoginOptions.classList.remove('d-none');
      if (!radioPasskey.checked && !radioPassword.checked) {
        if (radioPasskey) radioPasskey.checked = true;
      }
      if (radioPasskey && radioPasskey.checked) {
        if (passkeySection && passkeyAvailable) passkeySection.classList.remove('d-none');
        if (passwordSection) passwordSection.classList.add('d-none');
        if (passwordInput) passwordInput.disabled = true;
        if (passkeyInfo) passkeyInfo.classList.remove('d-none');
      } else if (radioPassword && radioPassword.checked) {
        if (passwordSection) passwordSection.classList.remove('d-none');
        if (passkeySection) passkeySection.classList.add('d-none');
        if (passwordInput) passwordInput.disabled = false;
        if (passkeyInfo) passkeyInfo.classList.add('d-none');
      } else {
        if (passkeySection) passkeySection.classList.add('d-none');
        if (passwordSection) passwordSection.classList.add('d-none');
        if (passwordInput) passwordInput.disabled = true;
        if (passkeyInfo) passkeyInfo.classList.add('d-none');
      }
    } else {
      if (autoLoginOptions) autoLoginOptions.classList.add('d-none');
      if (passkeySection) passkeySection.classList.add('d-none');
      if (passwordSection) passwordSection.classList.add('d-none');
      if (passwordInput) passwordInput.disabled = false;
      if (passkeyInfo) passkeyInfo.classList.add('d-none');
    }
  }

  if (saveCheck) saveCheck.onchange = updateSections;
  if (radioPasskey) radioPasskey.onchange = updateSections;
  if (radioPassword) radioPassword.onchange = updateSections;

  confirmBtn.onclick = async () => {
    const nsecValue = input.value.trim();
    if (!nsecValue) {
      if (statusEl) statusEl.textContent = t('nsec.input.required');
      return;
    }

    try {
      const nip19 = getNip19();
      let skHex = nsecValue;

      if (skHex.indexOf('nsec') === 0) {
        const dec = nip19.decode(skHex);
        if (!dec || dec.type !== 'nsec') throw new Error(t('nsec.invalid_format'));
        skHex = bytesToHex(dec.data);
      }

      if (!/^[0-9a-f]{64}$/i.test(skHex)) throw new Error(t('nsec.invalid_key'));

      state.sk = skHex.toLowerCase();
      state.signer = 'nsec';

      if (saveCheck && saveCheck.checked) {
        if (!radioPasskey.checked && !radioPassword.checked) {
          if (statusEl) statusEl.textContent = t('nsec.save_method_required');
          return;
        }
        if (radioPasskey && radioPasskey.checked) {
          try {
            if (statusEl) statusEl.textContent = t('auth.passkey_register_prompt');
            const passkeyData = await registerPasskey('nostr-user');
            if (statusEl) statusEl.textContent = t('auth.pending');
            const authResult = await authenticateWithPasskey(passkeyData.credentialId);
            if (authResult.success) {
              const encrypted = await encryptNsecWithPasskey(skHex, authResult.prfKey);
              settingsManager.set('passkeyCredentialId', passkeyData.credentialId);
              settingsManager.set('passkeyEncryptedNsec', encrypted);
              settingsManager.set('passkeyDeviceInfo', passkeyData.deviceInfo);
              settingsManager.set('preferredSigner', 'nsec-passkey');
              settings.passkeyCredentialId = passkeyData.credentialId;
              settings.passkeyEncryptedNsec = encrypted;
              settings.passkeyDeviceInfo = passkeyData.deviceInfo;
              settings.preferredSigner = 'nsec-passkey';
              if (statusEl) statusEl.textContent = t('auth.passkey_registered', { device: passkeyData.deviceInfo, id: passkeyData.deviceId });
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (e) {
            console.error('[Auth] パスキー登録失敗:', e);
            if (statusEl) statusEl.textContent = t('auth.passkey_register_failed', { msg: (e && e.message) });
          }
        } else if (radioPassword && radioPassword.checked) {
          const password = passwordInput ? passwordInput.value : '';
          if (!password) {
            const acceptRisk = confirm(t('auth.warn_empty_password'));
            if (!acceptRisk) {
              if (statusEl) statusEl.textContent = '';
              if (passwordInput) passwordInput.focus();
              return;
            }
          }
          const encrypted = await encryptNsec(skHex, password);
          settingsManager.set('encryptedNsec', encrypted);
          settingsManager.set('preferredSigner', 'nsec');
          settings.encryptedNsec = encrypted;
          settings.preferredSigner = 'nsec';
        }
      }

      hideModal('#nsecModal');
      await new Promise(resolve => setTimeout(resolve, 100));
      loginFn();
    } catch (e) {
      if (statusEl) statusEl.textContent = t('error.generic') + ': ' + (e.message || e);
    }
  };

  cancelBtn.onclick = () => {
    hideModal('#nsecModal');
  };

  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmBtn.click();
    }
  };

  showModal('#nsecModal');
  input.focus();
}

export function showPasswordModal(onConfirm, onCancel) {
  const modal = $('#passwordModal');
  const input = $('#decryptPassword');
  const confirmBtn = $('#passwordConfirm');
  const cancelBtn = $('#passwordCancel');
  const statusEl = $('#passwordStatus');

  if (!modal || !input || !confirmBtn || !cancelBtn) return;

  input.value = '';
  if (statusEl) statusEl.textContent = '';

  confirmBtn.onclick = () => {
    const password = input.value;
    hideModal('#passwordModal');
    if (onConfirm) onConfirm(password);
  };

  cancelBtn.onclick = () => {
    hideModal('#passwordModal');
    if (onCancel) onCancel();
  };

  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmBtn.click();
    }
  };

  showModal('#passwordModal');
  input.focus();
}
