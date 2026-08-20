// ============================================================================
// NIP-46 ローカル通信鍵の保管
// appSettings には混ぜず、専用 localStorage キーで永続化する（ログアウト時に消去）
// ============================================================================

const STORAGE_KEY = 'nokakoi.nip46.localSecretKey';
const PROTECTED_SESSION_KEY = 'nokakoi.nip46.protectedSession';
/** 旧 sessionStorage 限定実装からの移行用 */
const LEGACY_SESSION_KEY = 'nip46LocalSecretKey';

/**
 * NIP-46 ローカル秘密鍵を取得
 * @param {string} [pubkey]
 * @returns {string|null}
 */
export function getNip46LocalSecretKey(pubkey = null) {
  try {
    if (pubkey && typeof pubkey === 'string') {
      const accountKey = localStorage.getItem(`${STORAGE_KEY}.${pubkey.toLowerCase()}`);
      if (accountKey) return accountKey;
    }

    const fromLocal = localStorage.getItem(STORAGE_KEY);
    if (fromLocal) return fromLocal;

    // 旧 sessionStorage 実装からのワンショット移行
    const fromSession = sessionStorage.getItem(LEGACY_SESSION_KEY);
    if (fromSession) {
      localStorage.setItem(STORAGE_KEY, fromSession);
      try { sessionStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) { }
      return fromSession;
    }
  } catch (e) { }
  return null;
}

/**
 * NIP-46 ローカル秘密鍵を保存（リロード・再起動後の自動再接続用）
 * @param {string} keyHex
 * @param {string} [pubkey]
 */
export function setNip46LocalSecretKey(keyHex, pubkey = null) {
  try {
    if (keyHex) {
      localStorage.setItem(STORAGE_KEY, keyHex);
      if (pubkey && typeof pubkey === 'string') {
        localStorage.setItem(`${STORAGE_KEY}.${pubkey.toLowerCase()}`, keyHex);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
      if (pubkey && typeof pubkey === 'string') {
        localStorage.removeItem(`${STORAGE_KEY}.${pubkey.toLowerCase()}`);
      }
    }
    try { sessionStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) { }
  } catch (e) {
    console.warn('[NIP-46] localStorage への鍵保存に失敗:', e);
  }
}

export function getNip46ProtectedSession(pubkey = null) {
  try {
    if (pubkey && typeof pubkey === 'string') {
      return localStorage.getItem(`${PROTECTED_SESSION_KEY}.${pubkey.toLowerCase()}`);
    }
    return localStorage.getItem(PROTECTED_SESSION_KEY);
  } catch (e) { }
  return null;
}

export function setNip46ProtectedSession(encryptedSession, pubkey) {
  if (!encryptedSession || !pubkey || typeof pubkey !== 'string') return;
  try {
    const accountKey = `${PROTECTED_SESSION_KEY}.${pubkey.toLowerCase()}`;
    localStorage.setItem(PROTECTED_SESSION_KEY, encryptedSession);
    localStorage.setItem(accountKey, encryptedSession);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(`${STORAGE_KEY}.${pubkey.toLowerCase()}`);
  } catch (e) {
    console.warn('[NIP-46] 保護済みセッションの保存に失敗:', e);
  }
}

/**
 * NIP-46 ローカル秘密鍵を消去
 * @param {string} [pubkey]
 */
export function clearNip46LocalSecretKey(pubkey = null) {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROTECTED_SESSION_KEY);
    if (pubkey && typeof pubkey === 'string') {
      localStorage.removeItem(`${STORAGE_KEY}.${pubkey.toLowerCase()}`);
      localStorage.removeItem(`${PROTECTED_SESSION_KEY}.${pubkey.toLowerCase()}`);
    }
  } catch (e) { }
  try { sessionStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) { }
}
