// ============================================================================
// NIP-46 ローカル通信鍵の保管
// appSettings には混ぜず、専用 localStorage キーで永続化する（ログアウト時に消去）
// ============================================================================

const STORAGE_KEY = 'nokakoi.nip46.localSecretKey';
/** 旧 sessionStorage 限定実装からの移行用 */
const LEGACY_SESSION_KEY = 'nip46LocalSecretKey';

/**
 * NIP-46 ローカル秘密鍵を取得
 * @returns {string|null}
 */
export function getNip46LocalSecretKey() {
  try {
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
 */
export function setNip46LocalSecretKey(keyHex) {
  try {
    if (keyHex) {
      localStorage.setItem(STORAGE_KEY, keyHex);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    try { sessionStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) { }
  } catch (e) {
    console.warn('[NIP-46] localStorage への鍵保存に失敗:', e);
  }
}

/**
 * NIP-46 ローカル秘密鍵を消去
 */
export function clearNip46LocalSecretKey() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
  try { sessionStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) { }
}
