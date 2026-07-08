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
 * nsecをパスワードで暗号化（AES-GCM）
 */
export async function encryptNsec(nsecHex, password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(nsecHex);
  const passwordData = encoder.encode(password);
  const passwordHash = await crypto.subtle.digest('SHA-256', passwordData);
  const key = await crypto.subtle.importKey('raw', passwordHash, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToHex(combined);
}

/**
 * nsecをパスワードで復号（AES-GCM）
 */
export async function decryptNsec(encryptedHex, password) {
  try {
    const combined = hexToBytes(encryptedHex);
    if (!combined || combined.length < 12) return null;
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
    console.warn('[Crypto] decryptNsec失敗:', e);
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
