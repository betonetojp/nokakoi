// ============================================================================
// NIP-46 ローカル通信鍵のセッション限定保管
// localStorage には永続化せず、タブセッション内のみ保持する
// ============================================================================

const SESSION_KEY = 'nip46LocalSecretKey';

/**
 * セッション内の NIP-46 ローカル秘密鍵を取得
 * @returns {string|null}
 */
export function getNip46LocalSecretKey() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || null;
  } catch (e) {
    return null;
  }
}

/**
 * NIP-46 ローカル秘密鍵をセッションに保存（タブ閉じるまで）
 * @param {string} keyHex
 */
export function setNip46LocalSecretKey(keyHex) {
  try {
    if (keyHex) {
      sessionStorage.setItem(SESSION_KEY, keyHex);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch (e) {
    console.warn('[NIP-46] sessionStorage への鍵保存に失敗:', e);
  }
}

/**
 * セッション内の NIP-46 ローカル秘密鍵を消去
 */
export function clearNip46LocalSecretKey() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) { }
}
