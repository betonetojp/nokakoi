// ============================================================================
// Nostrツール互換レイヤー
// ============================================================================

import { nip19, SimplePool, getPublicKey as getPublicKeyFn, finalizeEvent, kinds, utils, nip04, nip44 } from 'nostr-tools';

/**
 * windowまたはインポートしたNostrToolsを取得
 */
export function getNostrTools() {
  return { nip19, SimplePool, getPublicKey: getPublicKeyFn, finalizeEvent, kinds, utils, nip04, nip44 };
}

/**
 * nip19ユーティリティ取得
 */
export function getNip19() {
  return nip19;
}

/**
 * SimplePool取得
 */
export function getSimplePool() {
  return SimplePool;
}

/**
 * getPublicKey関数取得
 */
export function getPublicKey() {
  return getPublicKeyFn;
}

/**
 * finalizeEvent関数取得
 */
export function getFinalizeEvent() {
  return finalizeEvent;
}

/**
 * kinds定数取得
 */
export function getKinds() {
  return kinds;
}

/**
 * utils取得
 */
export function getUtils() {
  return utils;
}

/**
 * nip04取得
 */
export function getNip04() {
  return nip04;
}

/**
 * nip44取得
 */
export function getNip44() {
  return nip44;
}

/**
 * バイト列を16進文字列に変換
 */
export function bytesToHex(bytes) {
  const utils = getUtils();
  if (utils && typeof utils.bytesToHex === 'function') {
    return utils.bytesToHex(bytes);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 16進文字列をバイト列に変換
 */
export function hexToBytes(hex) {
  try {
    if (!hex || typeof hex !== 'string') return null;
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) return null;
    if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
    const arr = new Uint8Array(clean.length / 2);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return arr;
  } catch (e) {
    console.warn('[NostrCompat] hexToBytes失敗:', e);
    return null;
  }
}

/**
 * ランダムバイト列生成
 */
export function randomBytes(n) {
  const utils = getUtils();
  if (utils && typeof utils.randomBytes === 'function') {
    return utils.randomBytes(n);
  }
  const a = new Uint8Array(n);
  (window.crypto || window.msCrypto || {}).getRandomValues(a);
  return a;
}

/**
 * 初期化情報をログ出力
 */
export function logInitInfo() {
  try {
    const NT = getNostrTools();

    if (!NT || Object.keys(NT).length === 0) {
      console.warn('[init] NostrTools未ロード - スクリプト読み込み中なら正常です');
      console.warn('[init] ブラウザ:', navigator.userAgent);
      return;
    }

    if (NT && NT.version) console.log('[init] nostr-tools バージョン:', NT.version);
    console.log('[init] nip04 利用可否:', !!getNip04());
    console.log('[init] nip44 利用可否:', !!getNip44());
  } catch (e) {
    console.error('[init] nostr-tools確認エラー:', e);
    console.error('[init] 原因候補:', {
      browser: navigator.userAgent,
      location: window.location.href,
      protocol: window.location.protocol
    });
  }
}
