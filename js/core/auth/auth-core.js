import { $, escapeHtml, replaceBadgeEmoji } from '../../utils/utils.js';
import { bytesToHex, decryptNsec } from '../crypto.js';
import { getNip19, getPublicKey as getPublicKeyFn } from '../nostr-compat.js';
import { signer } from '../signer.js';
import { displayNameWithUsername, loadProfile, updateNameDom } from '../../features/profile/profile.js';
import { resolveLoginOrder } from '../../features/post/actions.js';
import { t } from '../../utils/i18n.js';
import { isWebAuthnSupported, authenticateWithPasskey, decryptNip46SessionWithPasskey, decryptNsecWithPasskey } from '../webauthn.js';
import { Nip46Client, DEFAULT_NIP46_RELAYS } from '../nip46.js';
import { showPasswordModal } from './nsec-auth.js';
import { getNip46LocalSecretKey, getNip46ProtectedSession, clearNip46LocalSecretKey } from './nip46-session.js';
import { addAccount, migrateFromSingleAccount, setActiveAccountId } from '../account-manager.js';
import { defaultJaRelayUrl, defaultIntlRelayUrl, saveRelaysForAccount, loadRelaysForAccount, getDefaultGlobalRelayByLang } from '../relay.js';
import { detectBrowserLang } from '../../utils/i18n.js';
import { updateGlobalButtonLabel } from '../../features/relay/global-relay.js';
import { invalidateMuteWork, saveMuteListForAccount, loadMuteListForAccount, clearMuteListState } from '../../features/mute/mute.js';
import { setupTabs } from '../../ui/setup/tab-manager.js';
import {
  getSettingsManager,
  updateTabVisibility as invokeTabVisibilityUpdate
} from '../app-context.js';

let isPasskeyAuthPending = false;

export async function login(state, settings, settingsManager, restartFeeds, setupComposerScroll) {
  const getPublicKey = getPublicKeyFn();
  const nip19 = getNip19();

  // 前のアカウントのメモリ・フォローリスト・DOM描画の完全クリア
  try {
    const { clearFullState } = await import('../state.js');
    if (typeof clearFullState === 'function') {
      clearFullState(state);
    }
  } catch (e) {}

  if (state.signer === 'auto' || state.signer === 'nip07') {
    let attempts = 0;
    while (!window.nostr && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
  }

  let selected = null;
  if (state.signer === 'nip46' && state.nip46 && state.nip46.connected) {
    selected = 'nip46';
    try { signer.clearKey(); } catch (e) {}
  } else if (state.signer === 'nip07' && window.nostr) {
    selected = 'nip07';
    try { signer.clearKey(); } catch (e) {}
    if (state.nip46) {
      try { if (state.nip46.client) state.nip46.client.disconnect(); } catch (e) {}
      state.nip46.connected = false;
    }
  } else if (state.signer === 'nsec' && signer.hasKey()) {
    selected = 'nsec';
  } else if (state.nip46 && state.nip46.connected) {
    selected = 'nip46';
    try { signer.clearKey(); } catch (e) {}
  } else if (signer.hasKey()) {
    selected = 'nsec';
  } else if (window.nostr && (state.signer === 'nip07' || state.signer === 'auto')) {
    selected = 'nip07';
  } else {
    const order = resolveLoginOrder(state);
    for (let i = 0; i < order.length; i++) {
      const m = order[i];
      if (m === 'nip46' && state.nip46 && state.nip46.connected) {
        selected = 'nip46';
        try { signer.clearKey(); } catch (e) {}
        break;
      }
      if (m === 'nsec' && signer.hasKey()) {
        selected = 'nsec';
        break;
      }
      if (m === 'nip07' && window.nostr) {
        selected = 'nip07';
        break;
      }
    }
  }

  if (!selected) {
    alert(t('auth.nip07_required'));
    return;
  }

  state.signer = selected;

  try {
    let pubkey;
    if (selected === 'nip07') {
      pubkey = await window.nostr.getPublicKey();
    } else if (selected === 'nsec') {
      pubkey = signer.getPublicKey();
    } else if (selected === 'nip46') {
      pubkey = (state.nip46.client && state.nip46.client.userPubkey) || state.nip46.remotePubkey;
    }

    const oldPubkey = localStorage.getItem('pubkey');
    const newPubkey = pubkey.toLowerCase();

    // 以前ログインしていた別アカウントが存在する場合、前アカウントのデータを保存してメモリを完全クリア
    if (oldPubkey && oldPubkey.toLowerCase() !== newPubkey) {
      if (settingsManager && typeof settingsManager.saveForAccount === 'function') {
        settingsManager.saveForAccount(oldPubkey.toLowerCase());
      }
      try {
        const { clearFullState } = await import('../state.js');
        if (typeof clearFullState === 'function') {
          clearFullState(state);
        }
      } catch (e) {}
    }

    state.pubkey = newPubkey;

    try {
      localStorage.setItem('pubkey', state.pubkey);
      localStorage.removeItem('skipAutoLogin');
    } catch (e) { }

    // ログイン対象アカウントの設定を読み込み
    if (settingsManager && typeof settingsManager.loadForAccount === 'function') {
      settingsManager.loadForAccount(state.pubkey);
    }

    // 実際のログイン方式を判別
    let actualLoginMethod = selected;
    if (selected === 'nsec') {
      const pref = settingsManager ? settingsManager.get('preferredSigner') : null;
      const passkeyId = settingsManager ? settingsManager.get('passkeyCredentialId') : null;
      if (pref === 'nsec-passkey' && passkeyId) {
        actualLoginMethod = 'nsec-passkey';
      } else if (pref === 'nsec') {
        actualLoginMethod = 'nsec';
      }
    } else if (selected === 'nip07') {
      actualLoginMethod = 'nip07';
    } else if (selected === 'nip46') {
      actualLoginMethod = 'nip46';
    }

    try {
      localStorage.setItem('lastLoginMethod', actualLoginMethod);
    } catch (e) { }

    if (settingsManager) {
      settingsManager.set('preferredSigner', actualLoginMethod);
      if (typeof settingsManager.saveForAccount === 'function') {
        settingsManager.saveForAccount(state.pubkey);
      }
      try {
        updateGlobalButtonLabel(settingsManager);
      } catch (e) { }
    }

    // NIP-46 ローカルキーのアカウント別保存
    const activeNip46Key = getNip46LocalSecretKey();
    if (activeNip46Key) {
      try {
        localStorage.setItem(`nokakoi.nip46.localSecretKey.${state.pubkey}`, activeNip46Key);
      } catch (e) {}
    }

    // アカウントマネージャーに登録
    const accResult = addAccount({
      id: state.pubkey,
      loginMethod: actualLoginMethod
    });

    if (accResult && accResult.isMethodChanged) {
      // 古いログイン方式の残存設定をクリーンアップ
      if (settingsManager) {
        if (actualLoginMethod !== 'nip46') {
          settingsManager.set('nip46RemotePubkey', null);
          settingsManager.set('nip46Secret', null);
          settingsManager.set('nip46PasskeyCredentialId', null);
          settingsManager.set('nip46PasskeyDeviceInfo', null);
          clearNip46LocalSecretKey(state.pubkey);
        }
        if (actualLoginMethod !== 'nsec') {
          settingsManager.set('encryptedNsec', null);
        }
        if (actualLoginMethod !== 'nsec-passkey') {
          settingsManager.set('passkeyCredentialId', null);
          settingsManager.set('passkeyEncryptedNsec', null);
        }
        if (typeof settingsManager.saveForAccount === 'function') {
          settingsManager.saveForAccount(state.pubkey);
        }
      }
      const methodNames = {
        'nip07': t('account.method.nip07') || 'NIP-07拡張機能',
        'nsec': t('account.method.password') || 'パスワード認証',
        'nsec-passkey': t('account.method.passkey') || 'パスキー認証',
        'nip46': t('account.method.nip46') || 'NIP-46 リモートサイナー'
      };
      const newMethodLabel = methodNames[actualLoginMethod] || actualLoginMethod;
      setTimeout(() => {
        import('../../ui/modals/modals.js').then(modModal => {
          if (modModal && typeof modModal.showAlertModal === 'function') {
            modModal.showAlertModal(t('confirm.title') || 'お知らせ', t('account.method_updated', { method: newMethodLabel }) || `このアカウントのログイン方法を「${newMethodLabel}」に更新し、アクティブアカウントに切り替えました。`);
          }
        });
      }, 200);
    }

    const isNewAccount = !localStorage.getItem(`relays.${state.pubkey}`);
    state.relays = loadRelaysForAccount(state.pubkey);
    if (!isNewAccount) {
      saveRelaysForAccount(state.pubkey);
    }
    loadMuteListForAccount(state.pubkey);

    // 既存アカウント初追加時のみ kind:10002 (NIP-65) を一回だけ自動取得して同期
    if (isNewAccount && !window.__nokakoiOpenProfileEditorAfterLogin) {
      setTimeout(() => {
        import('../../features/relay/relay-settings.js').then(mod => {
          if (mod && typeof mod.fetchAndApplyKind10002ForAccount === 'function') {
            mod.fetchAndApplyKind10002ForAccount(state.pubkey, state, restartFeeds, settingsManager, true).then(success => {
              if (success) {
                syncAccountUI(state, settingsManager);
              } else if (!localStorage.getItem(`relays.${state.pubkey}`)) {
                saveRelaysForAccount(state.pubkey);
              }
            });
          }
        }).catch(e => console.warn('[Auth] NIP-65 初回自動取得呼び出しエラー:', e));
      }, 500);
    }

    // アカウント全体のUI描画を同期・再更新
    syncAccountUI(state, settingsManager);

    updateHeaderName(state, nip19);

    const openLoginModalBtn = $('#openLoginModalBtn');
    const composer = $('#composer');

    if (openLoginModalBtn) openLoginModalBtn.hidden = true;
    if (composer) composer.hidden = false;

    // タブの表示更新（未ログイン時制限の解除）
    invokeTabVisibilityUpdate(true);

    // 秘密鍵作成直後の場合、kind:10002 (NIP-65 Relay List) を自動発行し、kind:0 編集画面を開く
    if (window.__nokakoiOpenProfileEditorAfterLogin) {
      delete window.__nokakoiOpenProfileEditorAfterLogin;
      setTimeout(async () => {
        try {
          const { publishDefaultNip65RelayList } = await import('../replaceable-event.js');
          if (typeof publishDefaultNip65RelayList === 'function') {
            await publishDefaultNip65RelayList(state);
          }
        } catch (e) {
          console.warn('[Auth] NIP-65 kind:10002 自動発行例外:', e);
        }

        import('../../features/profile/profile-editor.js').then(mod => {
          if (mod && typeof mod.openProfileEditor === 'function') {
            mod.openProfileEditor(state);
          }
        }).catch(err => {
          console.warn('[Auth] プロフィール編集自動起動失敗:', err);
        });
      }, 500);
    }

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
          const composer2 = document.getElementById('composer');
          if (composer2) composer2.hidden = false;
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
    const pk = (state && state.pubkey) || localStorage.getItem('pubkey');
    const nameEl = $('#userInfo');
    const composerAccEl = $('#composerAccountInfo');

    if (!pk) {
      if (nameEl) nameEl.innerHTML = '';
      if (composerAccEl) composerAccEl.innerHTML = '';
      return;
    }

    const settingsManager = getSettingsManager();
    const showAvatars = settingsManager ? settingsManager.get('showAvatars') !== false : true;

    const names = displayNameWithUsername(state, pk, nip19, { usePetname: true });
    const displayText = names ? names.main : pk;
    const nameHtml = replaceBadgeEmoji(escapeHtml(displayText));

    let pictureUrl = null;
    if (showAvatars && state && state.profiles) {
      const prof = state.profiles.get(pk.toLowerCase());
      if (prof && prof.picture) {
        pictureUrl = prof.picture;
      }
    }

    const renderAccountLabel = (container) => {
      if (!container) return;
      container.innerHTML = '';

      if (pictureUrl && showAvatars) {
        const img = document.createElement('img');
        img.src = pictureUrl;
        img.className = 'account-avatar';
        img.alt = '';
        img.onerror = () => { img.style.display = 'none'; };
        container.appendChild(img);
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'account-name-text';
      textSpan.innerHTML = nameHtml;
      container.appendChild(textSpan);
    };

    renderAccountLabel(nameEl);
    renderAccountLabel(composerAccEl);
  } catch (e) { }
}

export function logout(state, settings, settingsManager, restartFeeds) {
  invalidateMuteWork(null);
  const currentPk = state.pubkey || localStorage.getItem('pubkey');
  if (currentPk) {
    if (settingsManager && typeof settingsManager.saveForAccount === 'function') {
      settingsManager.saveForAccount(currentPk);
    }
    saveRelaysForAccount(currentPk);
    saveMuteListForAccount(currentPk);
  }

  setActiveAccountId(null);

  try {
    localStorage.setItem('skipAutoLogin', '1');
    localStorage.removeItem('pubkey');
    localStorage.removeItem('lastLoginMethod');
  } catch (e) { }

  state.pubkey = null;
  try { signer.clearRollbackHandles(); } catch (e) { }
  signer.clearKey();
  state.signer = 'auto';

  try {
    if (state.nip46 && state.nip46.client) {
      try {
        const disconnectResult = typeof state.nip46.client.disconnect === 'function'
          ? state.nip46.client.disconnect()
          : state.nip46.client.close?.();
        if (disconnectResult && typeof disconnectResult.catch === 'function') {
          disconnectResult.catch(() => {});
        }
      } catch (e) { }
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
    settingsManager.set('nip46Relays', null);
    settingsManager.set('nip46Secret', null);
    settingsManager.set('nip46PasskeyCredentialId', null);
    settingsManager.set('nip46PasskeyDeviceInfo', null);
    clearNip46LocalSecretKey(currentPk);
  } catch (e) { }

  try {
    if (settingsManager && typeof settingsManager.loadForAccount === 'function') {
      settingsManager.loadForAccount(null);
    }
    state.relays = loadRelaysForAccount(null);

    settingsManager.set('globalRelay', getDefaultGlobalRelayByLang());
    settingsManager.set('globalMergeHome', false);
    try {
      updateGlobalButtonLabel(settingsManager);
    } catch (e) { }
    clearNip46LocalSecretKey(currentPk);
  } catch (e) { }

  // メモリ状態およびDOM・通知点滅等の完全クリア
  try {
    import('../state.js').then(m => {
      if (m && typeof m.clearFullState === 'function') {
        m.clearFullState(state);
      }
    });
  } catch (e) { }

  clearMuteListState();

  const nameEl = $('#userInfo');
  if (nameEl) {
    nameEl.textContent = '';
  }

  const openLoginModalBtn = $('#openLoginModalBtn');
  const composer = $('#composer');

  if (openLoginModalBtn) openLoginModalBtn.hidden = false;
  if (composer) composer.hidden = true;

  // デフォルトタブ構成でタブバーを再構築
  try {
    if (typeof setupTabs === 'function') {
      setupTabs(settingsManager, false);
    }
  } catch (e) { }

  // タブの表示更新（未ログイン時制限: global と channels のみ）
  invokeTabVisibilityUpdate(false);

  syncAccountUI(state, settingsManager);

  if (restartFeeds) {
    try {
      restartFeeds(true);
    } catch (e) {
      console.error('[Auth] ログアウト後フィード初期化エラー:', e);
    }
  }
}

export async function autoLogin(state, settings, settingsManager, loginFn) {
  // 自動マイグレーション
  migrateFromSingleAccount();

  const activeId = localStorage.getItem('pubkey');
  if (activeId && settingsManager && typeof settingsManager.loadForAccount === 'function') {
    settingsManager.loadForAccount(activeId);
    state.relays = loadRelaysForAccount(activeId);
    if (settingsManager.settings) settings = settingsManager.settings;
  } else {
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
            signer.setKey(skHex);
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

    const targetPubkey = settings.nip46UserPubkey || settings.nip46RemotePubkey;
    const protectedNip46Session = getNip46ProtectedSession(targetPubkey);
    let nip46LocalSecretKey = null;
    let nip46Secret = settings.nip46Secret;
    if (protectedNip46Session) {
      try {
        if (!webAuthnSupported || !settings.nip46PasskeyCredentialId) {
          throw new Error(t('webauthn.not_supported'));
        }
        const result = await authenticateWithPasskey(settings.nip46PasskeyCredentialId);
        const session = result && result.success
          ? await decryptNip46SessionWithPasskey(protectedNip46Session, result.prfKey)
          : null;
        if (!session || !/^[0-9a-f]{64}$/i.test(session.localSecretKey)) {
          throw new Error(t('nip46.reconnect_failed'));
        }
        nip46LocalSecretKey = session.localSecretKey;
        nip46Secret = session.secret;
      } catch (e) {
        console.warn('[Auth] NIP-46 保護済みセッションの復元に失敗:', e);
      }
    } else {
      nip46LocalSecretKey = getNip46LocalSecretKey(targetPubkey);
    }
    if (!state.pubkey && settings.preferredSigner === 'nip46' && settings.nip46RemotePubkey && nip46LocalSecretKey) {
      try {
        const client = new Nip46Client({
          relays: settings.nip46Relays || DEFAULT_NIP46_RELAYS,
          onStatusChange: () => { }
        });

        await client.restoreConnection({
          localSecretKey: nip46LocalSecretKey,
          remotePubkey: settings.nip46RemotePubkey,
          userPubkey: settings.nip46UserPubkey || targetPubkey,
          relays: settings.nip46Relays,
          secret: nip46Secret
        });
        client.userPubkey = (client.userPubkey || targetPubkey).toLowerCase();

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

export function syncAccountUI(state, settingsManager, options = {}) {
  if (!state) return;

  // 1. リレー設定画面のDOM再描画
  try {
    const container = document.getElementById('relayList');
    if (container && typeof container.__renderRelayList === 'function') {
      container.__renderRelayList();
    }
  } catch (e) {}

  // 2. グローバルタブのラベル更新
  try {
    updateGlobalButtonLabel(settingsManager);
  } catch (e) {}

  // 3. ミュート数のカウント表示およびイベント描画の更新
  try {
    import('../../features/mute/mute.js').then(m => {
      if (m && typeof m.updateMuteListCountsUI === 'function') {
        m.updateMuteListCountsUI();
      }
    });
    import('../../ui/renderers/render-helpers.js').then(h => {
      if (h && typeof h.refreshEventsMuteState === 'function') {
        h.refreshEventsMuteState();
      }
    });
  } catch (e) {}

  // 4. 全表示設定チェックボックスとbodyクラスの再同期
  try {
    import('../../ui/setup/display-settings.js').then(ds => {
      if (ds && typeof ds.refreshAllDisplaySettingsUI === 'function') {
        ds.refreshAllDisplaySettingsUI(settingsManager);
      }
    });
  } catch (e) {}

  // 5. 参加中チャンネル一覧・ビューの同期
  try {
    import('../../features/channel/channel-ui.js').then(c => {
      if (c && typeof c.resetChannelViewForAccount === 'function') {
        c.resetChannelViewForAccount(state);
      }
    });
  } catch (e) {}

  // 6. メインフィードのソフトリロード
  if (options.reload !== false) {
    try {
      if (typeof window !== 'undefined') {
        if (typeof window.softReload === 'function') {
          window.softReload();
        } else {
          window.dispatchEvent(new CustomEvent('softReloadRequest'));
        }
      }
    } catch (e) {}
  }
}
