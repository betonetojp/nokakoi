// UI連携対応 WebAuthn ヘルパー
import { t } from './i18n.js';

// ============================================================================
// Web認証（パスキー）ユーティリティ
// ============================================================================

/**
 * WebAuthnサポート判定
 */
export function isWebAuthnSupported() {
  return window.PublicKeyCredential !== undefined &&
         navigator.credentials !== undefined;
}

/**
 * デバイスがユーザー認証（生体認証等）対応か判定
 */
export async function isUserVerifyingPlatformAvailable() {
  if (!isWebAuthnSupported()) return false;

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    console.warn('[WebAuthn] ユーザー認証可否判定失敗:', e);
    return false;
  }
}

/**
 * デバイス情報取得（表示用）
 */
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let deviceType = 'Unknown';
  let browserName = 'Unknown';

  // デバイスタイプ判定
  if (/Mobile|Android|iPhone|iPad|iPod/.test(ua)) {
    if (/iPad/.test(ua)) {
      deviceType = 'iPad';
    } else if (/iPhone/.test(ua)) {
      deviceType = 'iPhone';
    } else if (/Android/.test(ua)) {
      deviceType = 'Android';
    } else {
      deviceType = 'Mobile';
    }
  } else if (/Mac/.test(ua)) {
    deviceType = 'Mac';
  } else if (/Win/.test(ua)) {
    deviceType = 'Windows';
  } else if (/Linux/.test(ua)) {
    deviceType = 'Linux';
  } else {
    deviceType = 'Desktop';
  }

  // ブラウザ判定
  if (/Edg\//.test(ua)) {
    browserName = 'Edge';
  } else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    browserName = 'Chrome';
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    browserName = 'Safari';
  } else if (/Firefox\//.test(ua)) {
    browserName = 'Firefox';
  } else if (/OPR\/|Opera\//.test(ua)) {
    browserName = 'Opera';
  }

  return {
    type: deviceType,
    browser: browserName,
    displayName: `${deviceType} (${browserName})`
  };
}

/**
 * デバイス固有ID取得（表示用）
 */
function getDeviceId() {
  let deviceId = localStorage.getItem('nokakoi_device_id');
  if (!deviceId) {
    // 短いランダムID生成（4文字）
    deviceId = Math.random().toString(36).substring(2, 6).toUpperCase();
    localStorage.setItem('nokakoi_device_id', deviceId);
  }
  return deviceId;
}

/**
 * パスキー（認証情報）新規登録
 */
export async function registerPasskey(username = 'nostr-user') {
  if (!isWebAuthnSupported()) {
    throw new Error(t('webauthn.not_supported'));
  }

  // デバイス情報取得
  const deviceInfo = getDeviceInfo();
  const deviceId = getDeviceId();
  const displayName = `nokakoi - ${deviceInfo.displayName} [${deviceId}]`;
  const userName = `nokakoi_${deviceId}`;

  // チャレンジ生成
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  // ユーザーID生成
  const userId = new Uint8Array(16);
  crypto.getRandomValues(userId);

  const publicKeyCredentialCreationOptions = {
    challenge: challenge,
    rp: {
      name: 'nokakoi',
      id: window.location.hostname // 'localhost' or 'nokakoi.com'
    },
    user: {
      id: userId,
      name: userName,
      displayName: displayName
    },
    pubKeyCredParams: [
      {
        type: 'public-key',
        alg: -7 // ES256
      },
      {
        type: 'public-key',
        alg: -257 // RS256
      }
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // プラットフォーム認証器（Touch ID, Windows Hello など）を使用
      userVerification: 'required', // 生体認証/ PIN を必須
      residentKey: 'preferred' // 認証情報をデバイスに保存
    },
    timeout: 60000,
    attestation: 'none'
  };

  try {
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    if (!credential) {
      throw new Error(t('webauthn.create_failed'));
    }

    // credential ID保存
    const credentialId = bufferToBase64(credential.rawId);

    return {
      credentialId: credentialId,
      userId: bufferToBase64(userId),
      challenge: bufferToBase64(challenge),
      deviceInfo: deviceInfo.displayName,
      deviceId: deviceId
    };
  } catch (e) {
    console.error('[WebAuthn] Passkey 登録に失敗:', e);
    throw new Error(t('webauthn.register_failed', { msg: (e && e.message) }));
  }
}

/**
 * パスキー認証（成功/失敗のみ返す）
 */
export async function authenticateWithPasskey(credentialId) {
  if (!isWebAuthnSupported()) {
    throw new Error(t('webauthn.not_supported'));
  }

  // チャレンジ生成
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const allowCredentials = [];
  if (credentialId) {
    allowCredentials.push({
      type: 'public-key',
      id: base64ToBuffer(credentialId)
    });
  }

  const publicKeyCredentialRequestOptions = {
    challenge: challenge,
    allowCredentials: allowCredentials,
    timeout: 60000,
    userVerification: 'required',
    rpId: window.location.hostname
  };

  try {
    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions
    });

    if (!assertion) {
      throw new Error(t('webauthn.auth_failed'));
    }

    // 認証成功
    return {
      success: true,
      credentialId: bufferToBase64(assertion.rawId)
    };
  } catch (e) {
    console.error('[WebAuthn] Passkey 認証に失敗:', e);
    throw new Error(t('webauthn.auth_failed', { msg: (e && e.message) }));
  }
}

/**
 * デバイス固有データから暗号鍵導出
 * 同一デバイスならセッションを跨いでも安定
 */
async function deriveDeviceKey() {
  // 1. ドメイン固有salt
  // 2. localStorageに保存した安定ランダム値

  let deviceSeed = localStorage.getItem('nokakoi_device_seed');
  if (!deviceSeed) {
    // 新規デバイスシード生成（デバイスごとに一度のみ）
    const seedBytes = new Uint8Array(32);
    crypto.getRandomValues(seedBytes);
    deviceSeed = bufferToBase64(seedBytes);
    localStorage.setItem('nokakoi_device_seed', deviceSeed);
  }

  const seedBytes = base64ToBuffer(deviceSeed);

  // PBKDF2で鍵導出
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    seedBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const salt = new Uint8Array([
    0x6e, 0x6f, 0x6b, 0x61, 0x6b, 0x6f, 0x69, 0x00, // 'nokakoi\0'
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
  ]);

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return key;
}

/**
 * パスキー保護でnsec暗号化
 * パスキーは認証用、暗号化はデバイス鍵
 */
export async function encryptNsecWithPasskey(nsecHex) {
  const encoder = new TextEncoder();
  const data = encoder.encode(nsecHex);

  // デバイス鍵取得
  const key = await deriveDeviceKey();

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    data
  );

  // IV+暗号データ結合
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return bufferToBase64(combined);
}

/**
 * パスキー保護でnsec復号（事前に認証済み必要）
 */
export async function decryptNsecWithPasskey(encryptedBase64) {
  try {
    const combined = base64ToBuffer(encryptedBase64);

    if (combined.length < 12) {
      throw new Error('Invalid encrypted data');
    }

    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    // デバイス鍵取得
    const key = await deriveDeviceKey();

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (e) {
    console.warn('[WebAuthn] 復号失敗:', e);
    return null;
  }
}

/**
 * Buffer→Base64変換
 */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64→Buffer変換
 */
function base64ToBuffer(base64) {
  const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
