// ============================================================================
// NIP-47 Nostr Wallet Connect (NWC) 実装
// ============================================================================

import { getSimplePool, getPublicKey as getPublicKeyFn, getFinalizeEvent, getNip04 } from './nostr-compat.js';
import { hexToBytes } from './crypto.js';

/**
 * NWC 接続URIのパース
 * nostr+walletconnect://<wallet_pubkey>?relay=<relay>&secret=<secret>[&lud16=<lud16>]
 */
export function parseNwcUri(uri) {
  try {
    if (!uri) return null;
    const cleanUri = uri
      .replace('nostr+walletconnect://', 'http://')
      .replace('nostrwalletconnect://', 'http://')
      .replace('walletconnect://', 'http://');
    const url = new URL(cleanUri);
    const walletPubkey = url.hostname;
    const relay = url.searchParams.get('relay');
    const secret = url.searchParams.get('secret');
    const lud16 = url.searchParams.get('lud16');
    if (!walletPubkey || !relay || !secret) {
      return null;
    }
    return { walletPubkey, relay, secret, lud16 };
  } catch (e) {
    return null;
  }
}

export function hasConfiguredNwc(settingsOrUri) {
  let uri = '';
  if (typeof settingsOrUri === 'string') {
    uri = settingsOrUri;
  } else if (settingsOrUri && typeof settingsOrUri === 'object') {
    uri = (settingsOrUri.settings && settingsOrUri.settings.nwcUri) || settingsOrUri.nwcUri || '';
  } else {
    try {
      const sm = (typeof window !== 'undefined') ? window.settingsManager : null;
      uri = (sm && sm.settings && sm.settings.nwcUri) || '';
    } catch (_e) {}
  }
  return !!parseNwcUri(uri);
}

/**
 * NWCクライアントクラス
 */
export class NwcClient {
  constructor(nwcUri) {
    const parsed = parseNwcUri(nwcUri);
    if (!parsed) {
      throw new Error('Invalid NWC URI');
    }
    this.walletPubkey = parsed.walletPubkey;
    this.relay = parsed.relay;
    this.secret = parsed.secret;

    const getPublicKey = getPublicKeyFn();
    if (!getPublicKey) {
      throw new Error('Nostr tools getPublicKey not available');
    }
    this.clientPubkey = getPublicKey(hexToBytes(this.secret));
  }

  /**
   * ボルト11インボイスを支払う
   * @param {string} invoice BOLT11
   * @param {number} timeoutMs タイムアウト (ミリ秒)
   * @returns {Promise<string>} preimage (支払い証明)
   */
  async payInvoice(invoice, timeoutMs = 60000) {
    const SimplePool = getSimplePool();
    const pool = new SimplePool();
    const nip04 = getNip04();
    const finalizeEvent = getFinalizeEvent();

    if (!pool || !nip04 || !finalizeEvent) {
      throw new Error('Nostr tools, nip04, or finalizeEvent function not available');
    }

    // リクエストの組み立て
    const reqPayload = {
      method: 'pay_invoice',
      params: { invoice }
    };

    // 暗号化 (接続用ephemeral秘密鍵とウォレットの公開鍵を使用)
    const encryptedContent = await nip04.encrypt(this.secret, this.walletPubkey, JSON.stringify(reqPayload));

    const draft = {
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.walletPubkey]],
      content: encryptedContent,
      pubkey: this.clientPubkey
    };

    // 署名
    const reqEvent = finalizeEvent(draft, hexToBytes(this.secret));
    const reqEventId = reqEvent.id;

    return new Promise((resolve, reject) => {
      let sub = null;
      let timeout = null;
      let isSettled = false;

      const cleanup = () => {
        isSettled = true;
        if (timeout) clearTimeout(timeout);
        if (sub) {
          try { sub.close(); } catch (e) {}
        }
      };

      // タイムアウト設定
      timeout = setTimeout(() => {
        if (isSettled) return;
        cleanup();
        reject(new Error('NWC payment timeout'));
      }, timeoutMs);

      // レスポンス購読用フィルター（リレー側のマッチングを確実にするため最小限のクエリにする）
      const filter = {
        kinds: [23195],
        '#e': [reqEventId]
      };

      try {
        sub = pool.subscribeMany([this.relay], [filter], {
          onevent: async (event) => {
            if (isSettled) return;

            // 安全性の検証：送信者がウォレット公開鍵と一致することを確認
            if (event.pubkey !== this.walletPubkey) {
              console.warn('[NWC] Ignore response from unexpected pubkey:', event.pubkey);
              return;
            }

            try {
              // 復号
              const decrypted = await nip04.decrypt(this.secret, this.walletPubkey, event.content);
              const payload = JSON.parse(decrypted);

              if (payload.error) {
                cleanup();
                const errMsg = payload.error.message || 'NWC payment failed';
                reject(new Error(errMsg));
              } else if (payload.result && payload.result.preimage) {
                cleanup();
                resolve(payload.result.preimage);
              } else {
                cleanup();
                reject(new Error('Invalid response payload from NWC wallet'));
              }
            } catch (e) {
              console.error('[NWC] Failed to process response event:', e);
              cleanup();
              reject(e);
            }
          }
        });

        // リクエストのパブリッシュ
        const pubs = pool.publish([this.relay], reqEvent);
        Promise.any(pubs)
          .then(() => {
            console.debug('[NWC] Payment request published:', reqEventId);
          })
          .catch(err => {
            console.error('[NWC] Failed to publish NWC request event:', err);
            cleanup();
            reject(err);
          });

      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }
}
