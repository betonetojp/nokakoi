// ============================================================================
// ログイン・認証
// ============================================================================

import { $ } from './utils.js';
import { bytesToHex, encryptNsec, decryptNsec } from './crypto.js';
import { getNip19, getPublicKey as getPublicKeyFn } from './nostr-compat.js';
import { nameFromMeta, npubShort, loadProfile, updateNameDom, displayNameWithUsername } from './profile.js';
import { resolveLoginOrder } from './actions.js';
import { showConfirmModal } from './modals.js';
import {
  isWebAuthnSupported,
  isUserVerifyingPlatformAvailable,
  registerPasskey,
  authenticateWithPasskey,
  encryptNsecWithPasskey,
  decryptNsecWithPasskey
} from './webauthn.js';
import { t } from './i18n.js';
import { Nip46Client, DEFAULT_NIP46_RELAYS, generateQRCodeSVG } from './nip46.js';

/**
 * モーダルダイアログを表示
 */
function showModal(modalId) {
  const modal = $(modalId);
  if (modal) modal.hidden = false;
}

/**
 * モーダルダイアログを非表示
 */
function hideModal(modalId) {
  const modal = $(modalId);
  if (modal) modal.hidden = true;
}

/**
 * 利用可能な署名者でログイン
 */
export async function login(state, settings, settingsManager, restartFeeds, setupComposerScroll) {
  const getPublicKey = getPublicKeyFn();
  const nip19 = getNip19();

  // window.nostrが利用可能になるまで待機（Safari拡張は遅延する場合あり）
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

  // パスキー認証でstate.skがセットされていれば必ず'nsec'にする
  if (state.sk) {
    state.signer = 'nsec';
  } else if (state.nip46 && state.nip46.connected) {
    state.signer = 'nip46';
  } else {
    state.signer = selected;
  }

  // ログイン方法を保存
  try {
    // preferredSigner が 'nsec-passkey' の場合は lastLoginMethod として維持
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
      // NIP-46: get_public_key RPC の結果をそのまま利用する（remotePubkey へのフォールバックはしない）
      pubkey = await state.nip46.client.getPublicKey();
      const isHex = typeof pubkey === 'string' && /^[0-9a-f]{64}$/i.test(pubkey);
      const isNpub = typeof pubkey === 'string' && pubkey.startsWith('npub');
      if (!isHex && !isNpub) {
        throw new Error('NIP-46 get_public_key returned invalid pubkey');
      }
    }

    state.pubkey = pubkey;

    // 公開鍵をHEX形式でlocalStorageに保存（統一）
    if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
      localStorage.setItem('pubkey', pubkey.toLowerCase());
    } else if (pubkey && pubkey.startsWith('npub')) {
      // npub形式の場合はHEXに変換して保存
      try {
        const nip19 = getNip19();
        const dec = nip19.decode(pubkey);
        if (dec && dec.type === 'npub') {
          const hex = bytesToHex(dec.data);
          localStorage.setItem('pubkey', hex.toLowerCase());
          pubkey = hex.toLowerCase();
          state.pubkey = hex.toLowerCase();
        }
      } catch (e) {
        console.warn('[Auth] 公開鍵HEX変換失敗:', e);
      }
    }

    // グローバル参照にも現在の state を反映（デバッグ/外部呼び出し向け）
    try { window.__nostrState = state; } catch (e) { }

    // 優先署名者を保存
    try {
      // 次回自動ログイン用にpreferredSignerを保存
      // ただしnsec-passkeyの場合は上書きしない
      const currentPreferred = settings.preferredSigner;
      if (currentPreferred !== 'nsec-passkey') {
        settingsManager.set('preferredSigner', selected);
      }
    } catch (e) {
      console.warn('[Auth] 優先署名者の保存失敗:', e);
    }

    // NIP-46接続情報を保存
    if (selected === 'nip46' && state.nip46 && state.nip46.client) {
      try {
        const connInfo = state.nip46.client.getConnectionInfo();
        settingsManager.set('nip46LocalSecretKey', connInfo.localSecretKey);
        settingsManager.set('nip46RemotePubkey', connInfo.remotePubkey);
        settingsManager.set('nip46Relays', connInfo.relays);
        settingsManager.set('nip46Secret', connInfo.secret);
      } catch (e) {
        console.warn('[Auth] NIP-46接続情報の保存失敗:', e);
      }
    }

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

    restartFeeds(true);
    loadProfile(state, localStorage.getItem('pubkey'));

    // composerのスクロール動作セットアップ
    if (setupComposerScroll) {
      setTimeout(() => setupComposerScroll(), 100);
    }

    // タイミング競合対策として非同期でUI状態を再適用
    try {
      setTimeout(() => {
        try {
          // 要素を再取得してUI状態を再適用
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

          // ユーザー名表示を再更新
          try {
            const userInfoEl2 = document.getElementById('userInfo');
            if (userInfoEl2) {
              try {
                updateHeaderName(state, nip19);
              } catch (e) {
                // フォールバック: pubkey短縮表示
                const pk = state.pubkey || localStorage.getItem('pubkey') || '';
                if (pk) userInfoEl2.textContent = pk.length > 16 ? (pk.substring(0, 8) + '...' + pk.substring(pk.length - 8)) : pk;
              }
            }
          } catch (e) { }
        } catch (e) {
          console.warn('[Auth] 非同期 UI 再適用に失敗', e);
        }
      }, 100);
    } catch (e) { }
  } catch (e) {
    console.error('[Auth] ログイン処理でエラー:', e);
    alert(t('auth.login_failed') + ': ' + ((e && e.message) || e));
  }
}

/**
 * nsecログインプロンプト（非推奨: showNsecLoginModal推奨）
 */
export function nsecLoginPrompt(state, settings, settingsManager, loginFn) {
  showNsecLoginModal(state, settings, settingsManager, loginFn);
}

/**
 * ヘッダー名表示を更新
 */
export function updateHeaderName(state, nip19) {
  const pk = state.pubkey;
  if (!pk) {
    $('#userInfo').textContent = '';
    return;
  }

  const names = displayNameWithUsername(state, pk, nip19, { usePetname: false });

  let displayText = names.main;
  if (names.sub) {
    displayText += ' @' + names.sub;
  }

  $('#userInfo').textContent = displayText;
}

/**
 * ログアウト
 */
export function logout(state, settings, settingsManager, restartFeeds) {
  // NIP-07の場合は削除確認を出さずに即座に処理
  const wasNip07 = state.signer === 'nip07';
  const wasNip46 = state.signer === 'nip46';

  // NIP-46の場合は切断処理
  if (wasNip46 && state.nip46 && state.nip46.client) {
    try {
      state.nip46.client.disconnect();
    } catch (e) {
      console.warn('[Auth] NIP-46 の切断に失敗:', e);
    }
  }

  state.pubkey = null;
  state.sk = null;
  state.signer = 'auto';

  // NIP-46状態をリセット
  if (state.nip46) {
    state.nip46.client = null;
    state.nip46.remotePubkey = null;
    state.nip46.connected = false;
  }

  // 自動ログイン禁止フラグをデフォルトでセット（後で保持する場合は削除）
  let shouldSkipAutoLogin = true;

  if (!wasNip07) {
    // 保存済みnsec（パスワード方式）の削除確認
    if (settings.encryptedNsec) {
      showConfirmModal(
        t('auth.remove_encrypted_nsec.title'),
        t('auth.remove_encrypted_nsec.message'),
        () => {
          // はい→削除
          settingsManager.set('encryptedNsec', null);
          settingsManager.set('preferredSigner', null);
        },
        () => {
          // いいえ→保持、自動ログインを許可
          try { localStorage.removeItem('skipAutoLogin'); } catch (e) { }
        }
      );
    }

    // 保存済みパスキーデータの削除確認
    if (settings.passkeyCredentialId) {
      showConfirmModal(
        t('auth.remove_passkey.title'),
        t('auth.remove_passkey.message', { device: settings.passkeyDeviceInfo || 'this device' }),
        () => {
          // はい→削除
          settingsManager.set('passkeyCredentialId', null);
          settingsManager.set('passkeyEncryptedNsec', null);
          settingsManager.set('passkeyDeviceInfo', null);
          settingsManager.set('preferredSigner', null);
        },
        () => {
          // いいえ→保持、自動ログインを許可
          try { localStorage.removeItem('skipAutoLogin'); } catch (e) { }
        }
      );
    }

    // 保存済みNIP-46接続データの削除確認
    if (wasNip46 && settings.nip46RemotePubkey) {
      showConfirmModal(
        t('auth.remove_nip46.title'),
        t('auth.remove_nip46.message'),
        () => {
          // はい→削除
          settingsManager.set('nip46LocalSecretKey', null);
          settingsManager.set('nip46RemotePubkey', null);
          settingsManager.set('nip46Secret', null);
          settingsManager.set('preferredSigner', null);
        },
        () => {
          // いいえ→保持、自動ログインを許可
          try { localStorage.removeItem('skipAutoLogin'); } catch (e) { }
        }
      );
    }
  }

  $('#userInfo').textContent = '';
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

  // ログアウト時は自動ログイン禁止フラグをセット
  // （確認ダイアログで「いいえ」を選択した場合は後で削除される）
  try {
    localStorage.setItem('skipAutoLogin', '1');
  } catch (e) { }

  restartFeeds(true);
}

/**
 * ページロード時の自動ログイン
 */
let isPasskeyAuthPending = false;

export async function autoLogin(state, settings, settingsManager, loginFn) {
  // 永続化済み preferredSigner を反映するため設定を再読込
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

  // ログアウト直後なら自動ログインしない
  if (localStorage.getItem('skipAutoLogin')) {
    return;
  }

  // lastLoginMethodがあればそれを優先（早めに反映して判定で使う）
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

  // ページロード直後の WebAuthn 呼び出しによるセキュリティエラー（インタラクション不足等）を防止するためディレイを挟む
  await new Promise(resolve => setTimeout(resolve, 350));

  try {
    const webAuthnSupported = await isWebAuthnSupported();

    // パスキー自動ログイン（最優先）
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

    // NIP-46自動再接続
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
        // 接続失敗時は保存データをクリアしない（次回手動接続の可能性を残す）
      }
      isPasskeyAuthPending = false;
      try { window.__nokakoiAuthPending = false; } catch (e) { }
    }

    // NIP-07自動ログイン
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

    // 暗号化nsec自動ログイン
    if (!state.pubkey && settings.preferredSigner === 'nsec' && settings.encryptedNsec) {
      // まず空パスワードで復号を試みる
      try {
        const skHex = await decryptNsec(settings.encryptedNsec, '');
        if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
          // 空パスワードで復号成功 → モーダルなしでログイン
          state.sk = skHex.toLowerCase();
          state.signer = 'nsec';
          await loginFn();
          isPasskeyAuthPending = false;
          try { window.__nokakoiAuthPending = false; } catch (e) { }
          return;
        }
      } catch (e) {
        // 空パスワードで復号失敗 → パスワードありと判断
      }

      // パスワード入力モーダルを表示
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

/**
 * nsecログインモーダル表示
 */
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

  // フォームリセット
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

  // WebAuthn利用可ならパスキー欄は常に表示可能
  let passkeyAvailable = false;
  isUserVerifyingPlatformAvailable().then(available => {
    passkeyAvailable = available;
    updateSections();
  });

  // UI制御関数
  function updateSections() {
    if (saveCheck && saveCheck.checked) {
      if (autoLoginOptions) autoLoginOptions.classList.remove('d-none');
      // 初回チェック時はパスキー方式を自動選択
      if (!radioPasskey.checked && !radioPassword.checked) {
        if (radioPasskey) radioPasskey.checked = true;
      }
      // ラジオ選択で切り替え
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
        // どちらも未選択
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

  // イベントハンドラ
  if (saveCheck) saveCheck.onchange = updateSections;
  if (radioPasskey) radioPasskey.onchange = updateSections;
  if (radioPassword) radioPassword.onchange = updateSections;

  // 確認ボタン
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

      // 自動ログイン保存
      if (saveCheck && saveCheck.checked) {
        if (!radioPasskey.checked && !radioPassword.checked) {
          if (statusEl) statusEl.textContent = t('nsec.save_method_required');
          return;
        }
        if (radioPasskey && radioPasskey.checked) {
          // パスキー保存希望
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
          // パスワード保存希望（パスワードなしも警告を挟んで可能）
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

  // キャンセルボタン
  cancelBtn.onclick = () => {
    hideModal('#nsecModal');
  };

  // Enterキー対応
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmBtn.click();
    }
  };

  showModal('#nsecModal');
  input.focus();
}

/**
 * パスワード入力モーダル表示
 */
export function showPasswordModal(onConfirm, onCancel) {
  const modal = $('#passwordModal');
  const input = $('#decryptPassword');
  const confirmBtn = $('#passwordConfirm');
  const cancelBtn = $('#passwordCancel');
  const statusEl = $('#passwordStatus');

  if (!modal || !input || !confirmBtn || !cancelBtn) return;

  // フォームリセット
  input.value = '';
  if (statusEl) statusEl.textContent = '';

  // 確認ボタン
  confirmBtn.onclick = () => {
    const password = input.value; // 空パスワードも許可
    hideModal('#passwordModal');
    if (onConfirm) onConfirm(password);
  };

  // キャンセルボタン
  cancelBtn.onclick = () => {
    hideModal('#passwordModal');
    if (onCancel) onCancel();
  };

  // Enterキー対応
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmBtn.click();
    }
  };

  showModal('#passwordModal');
  input.focus();
}

/**
 * NIP-46ログインモーダル表示
 */
export function showNip46LoginModal(state, settings, settingsManager, loginFn) {
  const modal = $('#nip46Modal');
  const qrTab = $('#nip46QrTab');
  const bunkerTab = $('#nip46BunkerTab');
  const appTab = $('#nip46AppTab');
  const qrTabBtn = $('#nip46QrTabBtn');
  const bunkerTabBtn = $('#nip46BunkerTabBtn');
  const appTabBtn = $('#nip46AppTabBtn');
  const qrCodeEl = $('#nip46QrCode');
  const connectUriInput = $('#nip46ConnectUri');
  const copyUriBtn = $('#nip46CopyUri');
  const openAppBtn = $('#nip46OpenApp');
  const bunkerInput = $('#nip46BunkerInput');
  const bunkerConnectBtn = $('#nip46BunkerConnect');
  const relayListEl = $('#nip46RelayList');
  const relayDetails = $('#nip46RelayDetails');
  const addRelayBtn = $('#nip46AddRelay');
  const statusEl = $('#nip46Status');
  const cancelBtn = $('#nip46Cancel');

  if (!modal) return;

  // 現在のNIP-46リレー設定を読み込み
  let nip46Relays = settings.nip46Relays || DEFAULT_NIP46_RELAYS.slice();

  // NIP-46クライアントを初期化
  let client = new Nip46Client({
    relays: nip46Relays,
    onStatusChange: (status, message) => {
      if (statusEl) statusEl.textContent = message;
    }
  });

  // ローカル鍵を生成
  client.initLocalKey();

  // タブ切り替え関数
  function switchTab(tabName) {
    if (tabName === 'qr') {
      if (qrTab) qrTab.hidden = false;
      if (bunkerTab) bunkerTab.hidden = true;
      if (appTab) appTab.hidden = true;
      if (qrTabBtn) qrTabBtn.classList.add('active');
      if (bunkerTabBtn) bunkerTabBtn.classList.remove('active');
      if (appTabBtn) appTabBtn.classList.remove('active');
      if (relayDetails) relayDetails.hidden = false;
    } else if (tabName === 'bunker') {
      if (qrTab) qrTab.hidden = true;
      if (bunkerTab) bunkerTab.hidden = false;
      if (appTab) appTab.hidden = true;
      if (qrTabBtn) qrTabBtn.classList.remove('active');
      if (bunkerTabBtn) bunkerTabBtn.classList.add('active');
      if (appTabBtn) appTabBtn.classList.remove('active');
      if (relayDetails) relayDetails.hidden = true;
    } else { // 'app'
      if (qrTab) qrTab.hidden = true;
      if (bunkerTab) bunkerTab.hidden = true;
      if (appTab) appTab.hidden = false;
      if (qrTabBtn) qrTabBtn.classList.remove('active');
      if (bunkerTabBtn) bunkerTabBtn.classList.remove('active');
      if (appTabBtn) appTabBtn.classList.add('active');
      if (relayDetails) relayDetails.hidden = false;
    }
  }

  // タブボタンイベント
  if (qrTabBtn) qrTabBtn.onclick = () => switchTab('qr');
  if (bunkerTabBtn) bunkerTabBtn.onclick = () => switchTab('bunker');
  if (appTabBtn) appTabBtn.onclick = () => switchTab('app');

  // アプリ起動ボタンイベント
  if (openAppBtn) {
    openAppBtn.onclick = () => {
      try {
        const uri = connectUriInput ? connectUriInput.value : '';
        if (uri) {
          window.location.href = uri;
        }
      } catch (e) {
        console.error('[NIP-46] アプリ起動に失敗:', e);
      }
    };
  }

  // リレーリスト描画関数
  function renderRelayList() {
    if (!relayListEl) return;
    relayListEl.innerHTML = '';

    nip46Relays.forEach((relay, index) => {
      const row = document.createElement('div');
      row.className = 'relay-row';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = relay;
      input.className = 'relay-input-flex';
      input.onchange = () => {
        nip46Relays[index] = input.value.trim();
        client.relays = nip46Relays.slice();
        updateQrCode();
      };

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary relay-remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => {
        if (nip46Relays.length > 1) {
          nip46Relays.splice(index, 1);
          client.relays = nip46Relays.slice();
          renderRelayList();
          updateQrCode();
        }
      };

      row.appendChild(input);
      row.appendChild(removeBtn);
      relayListEl.appendChild(row);
    });
  }

  // リレー追加ボタン
  if (addRelayBtn) {
    addRelayBtn.onclick = () => {
      nip46Relays.push('wss://');
      renderRelayList();
    };
  }

  // リレー初期値に戻すボタン
  const resetRelaysBtn = $('#nip46ResetRelays');
  if (resetRelaysBtn) {
    resetRelaysBtn.onclick = () => {
      // DEFAULT_NIP46_RELAYSをインポート
      import('./nip46.js').then(module => {
        try {
          nip46Relays = module.DEFAULT_NIP46_RELAYS.slice();
          client.relays = nip46Relays.slice();
          settingsManager.set('nip46Relays', nip46Relays);
          renderRelayList();
          updateQrCode();
        } catch (e) {
          console.warn('[NIP-46] リレーのリセットに失敗', e);
        }
      }).catch(e => {
        console.warn('[NIP-46] nip46.jsのインポートに失敗', e);
      });
    };
  }

  // QRコード更新関数
  function updateQrCode() {
    try {
      const uri = client.generateConnectUri();
      if (connectUriInput) connectUriInput.value = uri;
      if (qrCodeEl) {
        const svg = generateQRCodeSVG(uri, { cellSize: 4, margin: 4 });
        qrCodeEl.innerHTML = svg;
      }
    } catch (e) {
      console.error('[NIP-46] QRコード生成失敗:', e);
      if (statusEl) statusEl.textContent = t('nip46.qr_failed');
    }
  }

  // URIコピーボタン
  if (copyUriBtn) {
    copyUriBtn.onclick = async () => {
      try {
        const uri = connectUriInput ? connectUriInput.value : '';
        await navigator.clipboard.writeText(uri);
        copyUriBtn.textContent = '✓';
        setTimeout(() => { copyUriBtn.textContent = t('copy'); }, 2000);
      } catch (e) {
        if (statusEl) statusEl.textContent = t('copy_failed');
      }
    };
  }

  // bunker:// 接続ボタン
  if (bunkerConnectBtn) {
    bunkerConnectBtn.onclick = async () => {
      const bunkerUri = bunkerInput ? bunkerInput.value.trim() : '';
      if (!bunkerUri) {
        if (statusEl) statusEl.textContent = t('nip46.enter_bunker_uri');
        return;
      }

      try {
        if (statusEl) statusEl.textContent = t('nip46.connecting');
        bunkerConnectBtn.disabled = true;

        // 既存のクライアントを切断して新しいクライアントを作成
        // （QRコード待機と競合しないように）
        try { client.disconnect(); } catch (e) { }

        const bunkerClient = new Nip46Client({
          relays: nip46Relays,
          onStatusChange: (status, message) => {
            if (statusEl) statusEl.textContent = message;
          }
        });
        bunkerClient.initLocalKey();

        await bunkerClient.connectWithBunkerUri(bunkerUri);

        // 接続成功
        client = bunkerClient; // 参照を更新
        state.nip46.client = bunkerClient;
        state.nip46.remotePubkey = bunkerClient.remotePubkey;
        state.nip46.connected = true;
        state.signer = 'nip46';
        try { bunkerClient.setupResumeHandler(); } catch (e) { }

        // リレー設定を保存
        settingsManager.set('nip46Relays', bunkerClient.relays);

        hideModal('#nip46Modal');
        await loginFn();
      } catch (e) {
        console.error('[NIP-46] bunker接続失敗:', e);
        if (statusEl) statusEl.textContent = e.message || t('nip46.connect_failed');
        bunkerConnectBtn.disabled = false;
      }
    };
  }

  // キャンセルボタン
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      // 接続待ちを中断
      if (client) {
        try { client.disconnect(); } catch (e) { }
      }
      hideModal('#nip46Modal');
    };
  }

  // 初期化
  renderRelayList();
  updateQrCode();
  switchTab('qr');
  if (statusEl) statusEl.textContent = '';
  if (bunkerInput) bunkerInput.value = '';

  showModal('#nip46Modal');

  // QRコードスキャン待ち開始
  (async () => {
    try {
      if (statusEl) statusEl.textContent = t('nip46.waiting_for_connection');
      const result = await client.waitForConnection();

      if (result.connected) {
        state.nip46.client = client;
        state.nip46.remotePubkey = result.remotePubkey;
        state.nip46.connected = true;
        state.signer = 'nip46';
        try { client.setupResumeHandler(); } catch (e) { }

        // リレー設定を保存
        settingsManager.set('nip46Relays', nip46Relays);

        hideModal('#nip46Modal');
        await loginFn();
      }
    } catch (e) {
      // タイムアウトまたはキャンセル
    }
  })();
}

/**
 * ログイン・ログアウト関連ボタンのUIイベントをバインド
 */
export function setupAuthUI(state, settings, settingsManager, {
  restartFeeds,
  enableComposerScroll,
  onLogout
}) {
  // nsecログインボタン
  const nsecBtn = $('#nsecLoginBtn');
  if (nsecBtn) {
    nsecBtn.onclick = async () => {
      try {
        // 1) 利用可能なら passkey フローを試す
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

        // 2) 暗号化 nsec（パスワード方式）があれば、まず空パスワードで試す
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

          // パスワード入力モーダルを表示
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

        // 3) フォールバック: nsec 手入力モーダルを表示
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

  // NIP-46ログインボタン
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

  // NIP-07ログインボタン
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
      // preferredSignerをnip07にセット
      settingsManager.set('preferredSigner', 'nip07');
      login(state, settings, settingsManager, restartFeeds, enableComposerScroll);
    };
  }

  // ログアウトボタン
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

