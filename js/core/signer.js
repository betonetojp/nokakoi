// ============================================================================
// Signer モジュール (秘密鍵のクロージャ保持)
// ============================================================================

import { getFinalizeEvent, getPublicKey as getPublicKeyFn } from './nostr-compat.js';
import { hexToBytes } from './crypto.js';

/**
 * nostr-tools >= 2.x は SecretKey を Uint8Array で受け取る
 * @param {string} skHex
 * @returns {Uint8Array}
 */
function skBytes(skHex) {
  const bytes = hexToBytes(skHex);
  if (!bytes || bytes.length !== 32) {
    throw new Error('Invalid secret key');
  }
  return bytes;
}

export const signer = (() => {
  let _sk = null;

  return {
    /**
     * 秘密鍵をセット
     */
    setKey(skHex) {
      if (typeof skHex === 'string') {
        _sk = skHex.toLowerCase();
      } else {
        _sk = null;
      }
    },

    /**
     * 秘密鍵を消去
     */
    clearKey() {
      _sk = null;
    },

    /**
     * 秘密鍵がセットされているか判定
     */
    hasKey() {
      return _sk !== null && _sk !== '';
    },

    /**
     * イベントに署名
     */
    sign(draft) {
      const finalizeEvent = getFinalizeEvent();
      if (!_sk || !finalizeEvent) {
        throw new Error('署名者が利用できません');
      }
      return finalizeEvent(draft, skBytes(_sk));
    },

    /**
     * 公開鍵を取得
     */
    getPublicKey() {
      const getPublicKey = getPublicKeyFn();
      if (!_sk || !getPublicKey) return null;
      try {
        return getPublicKey(skBytes(_sk));
      } catch (e) {
        console.warn('[Signer] getPublicKey 失敗:', e);
        return null;
      }
    },

    /**
     * NIP-04 復号
     */
    nip04Decrypt(nip04, pubkey, content) {
      if (!_sk) throw new Error('秘密鍵が保持されていません');
      if (!nip04 || typeof nip04.decrypt !== 'function') {
        throw new Error('NIP-04 ライブラリが利用できません');
      }
      return nip04.decrypt(_sk, pubkey, content);
    },

    /**
     * NIP-04 暗号化
     */
    nip04Encrypt(nip04, pubkey, plaintext) {
      if (!_sk) throw new Error('秘密鍵が保持されていません');
      if (!nip04 || typeof nip04.encrypt !== 'function') {
        throw new Error('NIP-04 ライブラリが利用できません');
      }
      return nip04.encrypt(_sk, pubkey, plaintext);
    },

    /**
     * NIP-44 復号
     */
    nip44Decrypt(nip44, ciphertext, pubkey) {
      if (!_sk) throw new Error('秘密鍵が保持されていません');
      if (!nip44?.v2?.utils?.getConversationKey || !nip44?.v2?.decrypt) {
        throw new Error('NIP-44 ライブラリが利用できません');
      }
      const conversationKey = nip44.v2.utils.getConversationKey(skBytes(_sk), pubkey);
      return nip44.v2.decrypt(ciphertext, conversationKey);
    },

    /**
     * NIP-44 暗号化
     */
    nip44Encrypt(nip44, plaintext, pubkey) {
      if (!_sk) throw new Error('秘密鍵が保持されていません');
      if (!nip44?.v2?.utils?.getConversationKey || !nip44?.v2?.encrypt) {
        throw new Error('NIP-44 ライブラリが利用できません');
      }
      const conversationKey = nip44.v2.utils.getConversationKey(skBytes(_sk), pubkey);
      return nip44.v2.encrypt(plaintext, conversationKey);
    }
  };
})();
