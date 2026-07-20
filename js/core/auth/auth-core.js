import { $ } from '../../utils/utils.js';
import { bytesToHex, decryptNsec } from '../crypto.js';
import { getNip19, getPublicKey as getPublicKeyFn } from '../nostr-compat.js';
import { displayNameWithUsername, loadProfile, updateNameDom } from '../../features/profile/profile.js';
import { resolveLoginOrder } from '../../features/post/actions.js';
import { t } from '../../utils/i18n.js';
import { isWebAuthnSupported, authenticateWithPasskey, decryptNsecWithPasskey } from '../webauthn.js';
import { Nip46Client, DEFAULT_NIP46_RELAYS } from '../nip46.js';
import { showPasswordModal } from './nsec-auth.js';

let isPasskeyAuthPending = false;

export async function login(state, settings, settingsManager, restartFeeds, setupComposerScroll) {
  const getPublicKey = getPublicKeyFn();
  const nip19 = getNip19();

  if (state.signer === 'auto' || state.signer === 'nip07') {
    let attempts = 0;
    while (!window.nostr && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
  }

  const order = resolveLoginOrder(state);
  let selected = null;

  for (let i = 0; i < order.length; i++) {
    const m = order[i];
    if (m === 'nip07' && window.nostr) {
      selected = 'nip07';
      break;
    }
    if (m === 'nsec' && state.sk) {
      selected = 'nsec';
      break;
    }
    if (m === 'nip46' && state.nip46 && state.nip46.connected) {
      selected = 'nip46';
      break;
    }
  }

  if (!selected) {
    alert(t('auth.nip07_required'));
    return;
  }

  if (state.sk) {
    state.signer = 'nsec';
  } else if (state.nip46 && state.nip46.connected) {
    state.signer = 'nip46';
  } else {
    state.signer = selected;
  }

  try {
    let lastLoginMethod = state.signer;
    if (settings && settings.preferredSigner === 'nsec-passkey') {
      lastLoginMethod = 'nsec-passkey';
    }
    localStorage.setItem('lastLoginMethod', lastLoginMethod);
    localStorage.removeItem('skipAutoLogin');
  } catch (e) { }

  try {
    let pubkey;
    if (selected === 'nip07') {
      pubkey = await window.nostr.getPublicKey();
    } else if (selected === 'nsec') {
      pubkey = getPublicKey(state.sk);
    } else if (selected === 'nip46') {
      pubkey = state.nip46.client.remotePubkey;
    }

    if (!pubkey) {
      alert(t('auth.pubkey_failed'));
      return;
    }

    state.pubkey = pubkey.toLowerCase();

    try {
      localStorage.setItem('pubkey', state.pubkey);
    } catch (e) { }

    updateHeaderName(state, nip19);

    const loginBtn = $('#loginBtn');
    const nsecLoginBtn = $('#nsecLoginBtn');
    const nip46LoginBtn = $('#nip46LoginBtn');
    const logoutBtn = $('#logoutBtn');
    const composer = $('#composer');
    const loginLabel = $('#loginLabel');

    if (loginBtn) loginBtn.hidden = true;
    if (nsecLoginBtn) nsecLoginBtn.hidden = true;
    if (nip46LoginBtn) nip46LoginBtn.hidden = true;
    if (logoutBtn) logoutBtn.hidden = false;
    if (composer) composer.hidden = false;
    if (loginLabel) loginLabel.hidden = true;

    if (restartFeeds) {
      try {
        await restartFeeds(true);
      } catch (e) {
        console.error('[Auth] フィード初期化エラー:', e);
      }
    }
    loadProfile(state, localStorage.getItem('pubkey'));

    if (setupComposerScroll) {
      setTimeout(() => setupComposerScroll(), 100);
    }

    try {
      setTimeout(() => {
        try {
          const loginBtn2 = document.getElementById('loginBtn');
          const nsecLoginBtn2 = document.getElementById('nsecLoginBtn');
          const nip46LoginBtn2 = document.getElementById('nip46LoginBtn');
          const logoutBtn2 = document.getElementById('logoutBtn');
          const composer2 = document.getElementById('composer');
          const loginLabel2 = document.getElementById('loginLabel');
          if (loginBtn2) loginBtn2.hidden = true;
          if (nsecLoginBtn2) nsecLoginBtn2.hidden = true;
          if (nip46LoginBtn2) nip46LoginBtn2.hidden = true;
          if (logoutBtn2) logoutBtn2.hidden = false;
          if (composer2) composer2.hidden = false;
          if (loginLabel2) loginLabel2.hidden = true;

          try {
            updateHeaderName(state, nip19);
          } catch (e) {
            const userInfoEl2 = document.getElementById('userInfo');
            const pk = state.pubkey || localStorage.getItem('pubkey') || '';
            if (pk && userInfoEl2) userInfoEl2.textContent = pk.length > 16 ? (pk.substring(0, 8) + '...' + pk.substring(pk.length - 8)) : pk;
          }
        } catch (e) {
          console.warn('[Auth] 非同期 UI 再適用に失敗', e);
        }
      }, 100);
    } catch (e) { }
  } catch (e) {
    console.error('[Auth] ログイン失敗:', e);
    alert(t('auth.login_failed', { msg: (e && e.message) }));
  }
}

export function updateHeaderName(state, nip19) {
  try {
    const pk = state.pubkey;
    const nameEl = $('#userInfo');
    if (!nameEl) return;
    if (!pk) {
      nameEl.textContent = '';
      return;
    }
    const names = displayNameWithUsername(state, pk, nip19, { usePetname: false });
    let displayText = names.main;
    if (names.sub) {
      displayText += ' @' + names.sub;
    }
    nameEl.textContent = displayText;
  } catch (e) { }
}

export function logout(state, settings, settingsManager, restartFeeds) {
  try {
    localStorage.setItem('skipAutoLogin', '1');
    localStorage.removeItem('pubkey');
    localStorage.removeItem('lastLoginMethod');
  } catch (e) { }

  state.pubkey = null;
  state.sk = null;
  state.signer = 'auto';

  try {
    if (state.nip46 && state.nip46.client) {
      try { state.nip46.client.close(); } catch (e) { }
      state.nip46.client = null;
      state.nip46.remotePubkey = null;
      state.nip46.connected = false;
    }
  } catch (e) { }

  try {
    settingsManager.set('encryptedNsec', null);
    settingsManager.set('passkeyCredentialId', null);
    settingsManager.set('passkeyEncryptedNsec', null);
    settingsManager.set('preferredSigner', null);
    settingsManager.set('nip46RemotePubkey', null);
    settingsManager.set('nip46LocalSecretKey', null);
    settingsManager.set('nip46Relays', null);
    settingsManager.set('nip46Secret', null);
  } catch (e) { }

  const nameEl = $('#userInfo');
  if (nameEl) {
    nameEl.textContent = '';
  }

  const loginBtn = $('#loginBtn');
  const nsecLoginBtn = $('#nsecLoginBtn');
  const nip46LoginBtn = $('#nip46LoginBtn');
  const logoutBtn = $('#logoutBtn');
  const composer = $('#composer');
  const loginLabel = $('#loginLabel');

  if (loginBtn) loginBtn.hidden = false;
  if (nsecLoginBtn) nsecLoginBtn.hidden = false;
  if (nip46LoginBtn) nip46LoginBtn.hidden = false;
  if (logoutBtn) logoutBtn.hidden = true;
  if (composer) composer.hidden = true;
  if (loginLabel) loginLabel.hidden = false;

  if (restartFeeds) {
    try {
      restartFeeds(true);
    } catch (e) {
      console.error('[Auth] ログアウト後フィード初期化エラー:', e);
    }
  }
}

export async function autoLogin(state, settings, settingsManager, loginFn) {
  try {
    if (settingsManager && typeof settingsManager.load === 'function') {
      const reloaded = settingsManager.load();
      if (reloaded) settings = reloaded;
    } else if (settingsManager && settingsManager.settings) {
      settings = settingsManager.settings;
    }
  } catch (e) {
    console.warn('[Auth] 設定の再読み込みに失敗', e);
  }

  if (localStorage.getItem('skipAutoLogin')) {
    return;
  }

  let lastLoginMethod;
  try {
    lastLoginMethod = localStorage.getItem('lastLoginMethod');
    if (lastLoginMethod) {
      settings.preferredSigner = lastLoginMethod;
    }
  } catch (e) {
    console.warn('[Auth] lastLoginMethod の読み込みに失敗', e);
  }

  if (isPasskeyAuthPending) {
    console.warn('[Auth] パスキー認証リクエストが既に進行中です。');
    return;
  }
  isPasskeyAuthPending = true;
  try { window.__nokakoiAuthPending = true; } catch (e) { }

  await new Promise(resolve => setTimeout(resolve, 350));

  try {
    const webAuthnSupported = await isWebAuthnSupported();

    if (!state.pubkey && settings.preferredSigner === 'nsec-passkey' && settings.passkeyCredentialId && settings.passkeyEncryptedNsec && webAuthnSupported) {
      try {
        const result = await authenticateWithPasskey(settings.passkeyCredentialId);
        if (result && result.success) {
          const skHex = await decryptNsecWithPasskey(settings.passkeyEncryptedNsec, result.prfKey);
          if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
            state.sk = skHex.toLowerCase();
            state.signer = 'nsec';
            await loginFn();
            isPasskeyAuthPending = false;
            try { window.__nokakoiAuthPending = false; } catch (e) { }
            return;
          } else {
            console.warn('[Auth] ❌ 復号nsecが不正');
            settingsManager.set('passkeyCredentialId', null);
            settingsManager.set('passkeyEncryptedNsec', null);
            settingsManager.set('preferredSigner', null);
          }
        } else {
          console.warn('[Auth] ❌ パスキー認証失敗');
        }
      } catch (e) {
        console.error('[Auth] ❌ パスキー自動ログイン失敗:', e);
      }
      isPasskeyAuthPending = false;
      try { window.__nokakoiAuthPending = false; } catch (e) { }
    }

    if (!state.pubkey && settings.preferredSigner === 'nip46' && settings.nip46RemotePubkey && settings.nip46LocalSecretKey) {
      try {
        const client = new Nip46Client({
          relays: settings.nip46Relays || DEFAULT_NIP46_RELAYS,
          onStatusChange: () => { }
        });

        await client.restoreConnection({
          localSecretKey: settings.nip46LocalSecretKey,
          remotePubkey: settings.nip46RemotePubkey,
          relays: settings.nip46Relays,
          secret: settings.nip46Secret
        });

        state.nip46.client = client;
        state.nip46.remotePubkey = settings.nip46RemotePubkey;
        state.nip46.connected = true;
        state.signer = 'nip46';
        try { client.setupResumeHandler(); } catch (e) { }

        await loginFn();
        isPasskeyAuthPending = false;
        try { window.__nokakoiAuthPending = false; } catch (e) { }
        return;
      } catch (e) {
        console.error('[Auth] ❌ NIP-46自動再接続失敗:', e);
      }
      isPasskeyAuthPending = false;
      try { window.__nokakoiAuthPending = false; } catch (e) { }
    }

    if (!state.pubkey && settings.preferredSigner === 'nip07') {
      let attempts = 0; const maxAttempts = 20;
      while (!window.nostr && attempts < maxAttempts) { await new Promise(r => setTimeout(r, 100)); attempts++; }
      if (window.nostr) {
        try {
          state.signer = 'nip07';
          await loginFn();
          isPasskeyAuthPending = false;
          try { window.__nokakoiAuthPending = false; } catch (e) { }
          return;
        } catch (e) {
          console.error('[Auth] ❌ NIP-07自動ログイン失敗:', e);
        }
      } else {
        console.warn('[Auth] ❌ window.nostr未検出（タイムアウト）');
      }
    }

    if (!state.pubkey && settings.preferredSigner === 'nsec' && settings.encryptedNsec) {
      try {
        const skHex = await decryptNsec(settings.encryptedNsec, '');
        if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
          state.sk = skHex.toLowerCase();
          state.signer = 'nsec';
          await loginFn();
          isPasskeyAuthPending = false;
          try { window.__nokakoiAuthPending = false; } catch (e) { }
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
            await loginFn();
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
      isPasskeyAuthPending = false;
      try { window.__nokakoiAuthPending = false; } catch (e) { }
      return;
    }

  } catch (e) {
    console.error('[Auth] 自動ログイン例外:', e);
  }

  isPasskeyAuthPending = false;
  try { window.__nokakoiAuthPending = false; } catch (e) { }
}
