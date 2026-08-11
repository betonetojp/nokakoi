import { signer } from './signer.js';
import { decryptNsec } from './crypto.js';
import { showPasswordModal, nsecLoginPrompt } from './auth/nsec-auth.js';
import { authenticateWithPasskey, decryptNsecWithPasskey } from './webauthn.js';
import { Nip46Client, DEFAULT_NIP46_RELAYS } from './nip46.js';
import { getNip46LocalSecretKey } from './auth/nip46-session.js';
import { t } from '../utils/i18n.js';
import { saveRelaysForAccount, loadRelaysForAccount } from './relay.js';
import { saveMuteListForAccount, loadMuteListForAccount } from '../features/mute/mute.js';
import { updateGlobalButtonLabel } from '../features/relay/global-relay.js';

const ACCOUNTS_STORAGE_KEY = 'nokakoi-accounts';

/**
 * 保存されているアカウント情報を取得
 * @returns {{ activeAccountId: string|null, accounts: Array<{id: string, loginMethod: string, displayName: string, createdAt: number}> }}
 */
export function getAccountList() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        activeAccountId: parsed.activeAccountId || null,
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : []
      };
    }
  } catch (e) {
    console.error('[AccountManager] アカウント一覧の読み込み失敗:', e);
  }
  return { activeAccountId: null, accounts: [] };
}

/**
 * アカウント一覧を保存
 * @param {{ activeAccountId: string|null, accounts: Array }} data 
 */
function saveAccountList(data) {
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[AccountManager] アカウント一覧の保存失敗:', e);
  }
}

/**
 * 現在アクティブなアカウントID（pubkey）を取得
 * @returns {string|null}
 */
export function getActiveAccountId() {
  const data = getAccountList();
  return data.activeAccountId;
}

/**
 * アクティブアカウントIDを設定
 * @param {string|null} id 
 */
export function setActiveAccountId(id) {
  const data = getAccountList();
  data.activeAccountId = id;
  saveAccountList(data);
}

/**
 * アカウントを追加または更新
 * @param {{ id: string, loginMethod: string, displayName?: string }} entry 
 */
export function addAccount(entry) {
  if (!entry || !entry.id) return { isNew: false, isMethodChanged: false, previousMethod: null };
  const data = getAccountList();
  const existingIdx = data.accounts.findIndex(a => a.id.toLowerCase() === entry.id.toLowerCase());
  
  let isNew = false;
  let isMethodChanged = false;
  let previousMethod = null;

  const accountObj = {
    id: entry.id.toLowerCase(),
    loginMethod: entry.loginMethod,
    displayName: entry.displayName || '',
    createdAt: entry.createdAt || Date.now()
  };

  if (existingIdx >= 0) {
    previousMethod = data.accounts[existingIdx].loginMethod;
    if (previousMethod !== entry.loginMethod) {
      isMethodChanged = true;
    }
    data.accounts[existingIdx] = { ...data.accounts[existingIdx], ...accountObj };
  } else {
    isNew = true;
    data.accounts.push(accountObj);
  }

  data.activeAccountId = accountObj.id;
  saveAccountList(data);

  return { isNew, isMethodChanged, previousMethod };
}

/**
 * アカウントを削除
 * @param {string} pubkey 
 */
export function removeAccount(pubkey) {
  if (!pubkey) return;
  const targetId = pubkey.toLowerCase();
  const data = getAccountList();
  data.accounts = data.accounts.filter(a => a.id.toLowerCase() !== targetId);
  
  if (data.activeAccountId && data.activeAccountId.toLowerCase() === targetId) {
    data.activeAccountId = null;
  }
  
  saveAccountList(data);

  // ローカルに保存されている対象アカウント固有の設定とNIP-46キーを削除
  try {
    localStorage.removeItem(`appSettings.${targetId}`);
    localStorage.removeItem(`nokakoi.nip46.localSecretKey.${targetId}`);
  } catch (e) {
    console.warn('[AccountManager] アカウント固有データの削除失敗:', e);
  }
}

/**
 * 単一アカウント構造からの自動マイグレーション
 */
export function migrateFromSingleAccount() {
  try {
    const rawAccounts = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (rawAccounts) return; // 既にアカウントデータがある場合はスキップ

    const currentPubkey = localStorage.getItem('pubkey');
    const lastLoginMethod = localStorage.getItem('lastLoginMethod');

    if (currentPubkey && lastLoginMethod) {
      const pubkeyLower = currentPubkey.toLowerCase();
      const accountsData = {
        activeAccountId: pubkeyLower,
        accounts: [{
          id: pubkeyLower,
          loginMethod: lastLoginMethod,
          displayName: '',
          createdAt: Date.now()
        }]
      };
      saveAccountList(accountsData);

      // appSettings を appSettings.{pubkey} に複製
      const rawSettings = localStorage.getItem('appSettings');
      if (rawSettings) {
        localStorage.setItem(`appSettings.${pubkeyLower}`, rawSettings);
      }

      // NIP-46キーも複製
      const nip46Key = localStorage.getItem('nokakoi.nip46.localSecretKey');
      if (nip46Key) {
        localStorage.setItem(`nokakoi.nip46.localSecretKey.${pubkeyLower}`, nip46Key);
      }

      // バックアップ（kind:0, 3, 10000）を旧キーからアカウント別キーへ移行
      for (const kind of [0, 3, 10000]) {
        const legacyKey = `backup_kind${kind}`;
        const raw = localStorage.getItem(legacyKey);
        if (raw) {
          localStorage.setItem(`${legacyKey}.${pubkeyLower}`, raw);
        }
      }

      // スナップショットを旧キーからアカウント別キーへ移行
      const followSnap = localStorage.getItem('follow_list_snapshots');
      if (followSnap) {
        localStorage.setItem(`follow_list_snapshots.${pubkeyLower}`, followSnap);
      }
      const muteSnap = localStorage.getItem('mute_list_snapshots');
      if (muteSnap) {
        localStorage.setItem(`mute_list_snapshots.${pubkeyLower}`, muteSnap);
      }
    } else {
      // 空の構造を初期化
      saveAccountList({ activeAccountId: null, accounts: [] });
    }
  } catch (e) {
    console.error('[AccountManager] マイグレーション失敗:', e);
  }
}

let activeSwitchSessionId = 0;

/**
 * 現在進行中の切り替えセッションIDを取得
 */
export function getActiveSwitchSessionId() {
  return activeSwitchSessionId;
}

/**
 * アカウントの切り替え
 * @param {string} targetPubkey 
 * @param {Object} state 
 * @param {Object} settingsManager 
 * @param {Function} loginFn 
 */
export async function switchAccount(targetPubkey, state, settingsManager, loginFn) {
  if (!targetPubkey) return;
  const sessionId = ++activeSwitchSessionId;
  const currentPubkey = state.pubkey || localStorage.getItem('pubkey');
  const targetId = targetPubkey.toLowerCase();

  if (currentPubkey && currentPubkey.toLowerCase() === targetId && signer.hasKey()) {
    return; // すでに同一アカウントかつ鍵保持済み
  }

  // 切り替え前のバックアップ
  const prevSk = signer.hasKey() ? signer.getKey() : null;
  const prevSigner = state.signer;
  const prevPubkey = state.pubkey || currentPubkey;

  // 1. 現在のアカウントの設定・リレー・ミュートリストを保存
  if (currentPubkey) {
    if (settingsManager && typeof settingsManager.saveForAccount === 'function') {
      settingsManager.saveForAccount(currentPubkey.toLowerCase());
    }
    saveRelaysForAccount(currentPubkey.toLowerCase());
    saveMuteListForAccount(currentPubkey.toLowerCase());
  }

  // 2. ターゲットアカウントの設定・リレー・ミュートリストを読み込み
  if (settingsManager && typeof settingsManager.loadForAccount === 'function') {
    settingsManager.loadForAccount(targetId);
  }
  state.relays = loadRelaysForAccount(targetId);
  loadMuteListForAccount(targetId);

  const settings = (settingsManager && settingsManager.settings) ? settingsManager.settings : {};
  const accountList = getAccountList();
  const accEntry = accountList.accounts.find(a => a.id.toLowerCase() === targetId);
  const method = accEntry ? accEntry.loginMethod : 'nsec';

  // 3. 切り替え前の署名者状態・鍵のクリーンアップ
  try {
    signer.clearKey();
  } catch (e) {}
  try {
    if (state.nip46 && state.nip46.client && typeof state.nip46.client.disconnect === 'function') {
      state.nip46.client.disconnect();
    }
  } catch (e) {}
  if (state.nip46) {
    state.nip46.client = null;
    state.nip46.remotePubkey = null;
    state.nip46.connected = false;
  }

  // 4. ログイン方式に応じた再認証・鍵復元
  let authSuccess = false;

  const isNip07Candidate = method === 'nip07' || (accEntry && accEntry.loginMethod === 'nip07');

  if (method === 'nsec-passkey' && settings && settings.passkeyCredentialId && settings.passkeyEncryptedNsec) {
    try {
      const authResult = await authenticateWithPasskey(settings.passkeyCredentialId);
      if (authResult && authResult.success) {
        const skHex = await decryptNsecWithPasskey(settings.passkeyEncryptedNsec, authResult.prfKey);
        if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
          signer.setKey(skHex);
          const actualPubkey = signer.getPublicKey().toLowerCase();
          if (actualPubkey === targetId) {
            state.signer = 'nsec';
            authSuccess = true;
          } else {
            console.warn(`[AccountManager] 復号Pubkey (${actualPubkey}) が対象 (${targetId}) と一致しません`);
            signer.clearKey();
            // 不正データが混入しているため、対象アカウントの不要設定をリセット
            settingsManager.set('passkeyCredentialId', null);
            settingsManager.set('passkeyEncryptedNsec', null);
            settingsManager.saveForAccount(targetId);
            authSuccess = false;
          }
        }
      }
    } catch (e) {
      console.error('[AccountManager] パスキー切替失敗:', e);
    }
  } else if (method === 'nsec' && settings && settings.encryptedNsec) {
    authSuccess = await new Promise(resolve => {
      showPasswordModal(
        async (password) => {
          if (!password) {
            alert(t('auth.password_required'));
            resolve(false);
            return;
          }
          try {
            const skHex = await decryptNsec(settings.encryptedNsec, password);
            if (skHex && /^[0-9a-f]{64}$/i.test(skHex)) {
              signer.setKey(skHex);
              const actualPubkey = signer.getPublicKey().toLowerCase();
              if (actualPubkey === targetId) {
                state.signer = 'nsec';
                resolve(true);
              } else {
                console.warn(`[AccountManager] 復号Pubkey (${actualPubkey}) が対象 (${targetId}) と一致しません`);
                signer.clearKey();
                alert(t('auth.password_incorrect'));
                resolve(false);
              }
            } else {
              alert(t('auth.password_incorrect'));
              resolve(false);
            }
          } catch (e) {
            alert(t('auth.decrypt_failed', { msg: (e && e.message) }));
            resolve(false);
          }
        },
        () => resolve(false)
      );
    });
  } else if (method === 'nip46' && settings && settings.nip46RemotePubkey) {
    const nip46Key = localStorage.getItem(`nokakoi.nip46.localSecretKey.${targetId}`) || getNip46LocalSecretKey();
    if (nip46Key) {
      try {
        localStorage.setItem('nokakoi.nip46.localSecretKey', nip46Key);
        localStorage.setItem(`nokakoi.nip46.localSecretKey.${targetId}`, nip46Key);
        const client = new Nip46Client({
          relays: settings.nip46Relays || DEFAULT_NIP46_RELAYS,
          onStatusChange: () => { }
        });
        await client.restoreConnection({
          localSecretKey: nip46Key,
          remotePubkey: settings.nip46RemotePubkey,
          relays: settings.nip46Relays,
          secret: settings.nip46Secret
        });
        state.nip46.client = client;
        state.nip46.remotePubkey = settings.nip46RemotePubkey;
        state.nip46.connected = true;
        state.signer = 'nip46';
        try { client.setupResumeHandler(); } catch (e) { }
        addAccount({ id: targetId, loginMethod: 'nip46' });
        authSuccess = true;
      } catch (e) {
        console.error('[AccountManager] NIP-46 再接続失敗:', e);
        authSuccess = false;
      }
    }
  } else if (isNip07Candidate) {
    try {
      localStorage.removeItem('skipAutoLogin');
    } catch (e) {}

    let attempts = 0;
    while (!window.nostr && attempts < 10) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (!window.nostr) {
      alert(t('auth.nip07_required') || 'NIP-07 拡張機能が見つかりません。');
      authSuccess = false;
    } else {
      try {
        const extPubkey = await window.nostr.getPublicKey();
        if (extPubkey && extPubkey.toLowerCase() === targetId) {
          state.signer = 'nip07';
          authSuccess = true;
          addAccount({ id: targetId, loginMethod: 'nip07' });
        } else {
          const shortExt = extPubkey ? (extPubkey.substring(0, 8) + '...') : '不明';
          const shortTarget = targetId ? (targetId.substring(0, 8) + '...') : '不明';
          alert(t('account.modal.nip07_mismatch') || `ブラウザ拡張機能側のアカウント (${shortExt}) が、選択したアカウント (${shortTarget}) と一致しません。拡張機能側でアカウントを切り替えてからお試しください。`);
          authSuccess = false;
        }
      } catch (e) {
        console.error('[AccountManager] NIP-07 pubkey取得失敗:', e);
        authSuccess = false;
      }
    }
  }

  // 切り替えセッションの競合判定（認証待ち中に他アカウントへの切り替えが行われた場合は安全に破棄・無効化）
  if (sessionId !== activeSwitchSessionId) {
    console.warn(`[AccountManager] 切替セッション ${sessionId} は他操作により競合キャンセルされました`);
    return;
  }

  // 認証が成功しなかった場合（キャンセルまたはエラー時）
  if (!authSuccess) {
    if (!settings.encryptedNsec && !settings.passkeyEncryptedNsec && method !== 'nip07' && method !== 'nip46') {
      alert(t('account.modal.unsaved_prompt'));
    }
    // ロールバック: 元の秘密鍵・状態・設定・ヘッダー表示名を100%完全復元
    if (prevSk) {
      signer.setKey(prevSk);
    }
    state.signer = prevSigner;
    state.pubkey = prevPubkey;
    if (prevPubkey) {
      try {
        localStorage.setItem('pubkey', prevPubkey);
      } catch (e) {}
      if (settingsManager && typeof settingsManager.loadForAccount === 'function') {
        settingsManager.loadForAccount(prevPubkey.toLowerCase());
      }
      state.relays = loadRelaysForAccount(prevPubkey.toLowerCase());
      loadMuteListForAccount(prevPubkey.toLowerCase());
    }
    try {
      const { updateHeaderName } = await import('./auth/auth-core.js');
      const { getNip19 } = await import('./nostr-compat.js');
      if (typeof updateHeaderName === 'function') {
        updateHeaderName(state, getNip19());
      }
    } catch (e) {}
    return;
  }

  // 4. アクティブアカウントおよび認証方式情報の確実な更新
  setActiveAccountId(targetId);
  try {
    localStorage.setItem('pubkey', targetId);
    localStorage.setItem('lastLoginMethod', method);
    localStorage.removeItem('skipAutoLogin');
  } catch (e) {}

  if (settingsManager) {
    settingsManager.set('preferredSigner', method);
  }

  // 5. 前のアカウントのメモリ状態（フィードキャッシュ・DOM描画・通知バッジ・点滅等）を完全にクリア
  try {
    const { clearFullState } = await import('./state.js');
    if (typeof clearFullState === 'function') {
      clearFullState(state);
    }
  } catch (e) {
    console.warn('[AccountManager] clearFullState 呼び出しエラー:', e);
  }

  // 6. 再ログイン・UI同期
  state.pubkey = targetId;
  if (typeof loginFn === 'function') {
    await loginFn();
  }
  try {
    const { loadProfile } = await import('../features/profile/profile.js');
    if (typeof loadProfile === 'function') {
      loadProfile(state, targetId);
    }
  } catch (e) {}
  try {
    const { syncAccountUI, updateHeaderName } = await import('./auth/auth-core.js');
    const { getNip19 } = await import('./nostr-compat.js');
    if (typeof updateHeaderName === 'function') {
      updateHeaderName(state, getNip19());
    }
    if (typeof syncAccountUI === 'function') {
      syncAccountUI(state, settingsManager);
    } else {
      updateGlobalButtonLabel(settingsManager);
    }
  } catch (e) {
    try { updateGlobalButtonLabel(settingsManager); } catch (ee) {}
  }
}
