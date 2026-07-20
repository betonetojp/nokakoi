// ============================================================================
// 暗号ユーティリティ
// ============================================================================

import { bytesToHex as utilsBytesToHex, hexToBytes as utilsHexToBytes, randomBytes as utilsRandomBytes } from './nostr-compat.js';

/**
 * バイト列を16進文字列に変換
 */
export function bytesToHex(bytes) {
  return utilsBytesToHex(bytes);
}

/**
 * 16進文字列をバイト列に変換
 */
export function hexToBytes(hex) {
  return utilsHexToBytes(hex);
}

/**
 * ランダムバイト列生成
 */
export function randomBytes(n) {
  return utilsRandomBytes(n);
}

/**
 * nsecをパスワードで暗号化（PBKDF2 + AES-GCM）
 */
export async function encryptNsec(nsecHex, password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(nsecHex);
  const passwordData = encoder.encode(password);
  
  // ソルト生成
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // PBKDF2でマスターキーからAES-GCM用鍵を導出
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
  
  // [IV] + [暗号化データ] + [ソルト]
  const combined = new Uint8Array(iv.length + encrypted.byteLength + salt.length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  combined.set(salt, iv.length + encrypted.byteLength);
  
  return bytesToHex(combined);
}

/**
 * nsecをパスワードで復号（PBKDF2 + AES-GCM, 旧方式へのフォールバック対応）
 */
export async function decryptNsec(encryptedHex, password) {
  try {
    const combined = hexToBytes(encryptedHex);
    if (!combined || combined.length < 12) return null;
    
    // 最小サイズ判定 (IV 12B + 暗号データ 48B + ソルト 16B = 76B)
    if (combined.length >= 76) {
      try {
        const iv = combined.slice(0, 12);
        const salt = combined.slice(combined.length - 16);
        const encrypted = combined.slice(12, combined.length - 16);
        
        const encoder = new TextEncoder();
        const passwordData = encoder.encode(password);
        const baseKey = await crypto.subtle.importKey(
          'raw',
          passwordData,
          { name: 'PBKDF2' },
          false,
          ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
          {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
          },
          baseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
        
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, encrypted);
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
      } catch (err) {
        console.info('[Crypto] 新方式（PBKDF2）での復号に失敗しました。旧方式での復号を試みます。');
      }
    }
    
    // 旧方式（単一SHA-256ハッシュ）フォールバック
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    const passwordHash = await crypto.subtle.digest('SHA-256', passwordData);
    const key = await crypto.subtle.importKey('raw', passwordHash, { name: 'AES-GCM' }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, encrypted);
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (e) {
    console.warn('[Crypto] decryptNsec失敗（旧方式でも復号できませんでした）:', e);
    return null;
  }
}

/**
 * Base64urlエンコード
 */
export function b64urlEncode(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64urlデコード（文字列）
 */
export function b64urlDecodeToString(b64url) {
  const b64 = (b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}
