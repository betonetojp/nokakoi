// ============================================================================
// Nostrツール互換レイヤー
// ============================================================================

import { nip19, SimplePool as NostrSimplePool, getPublicKey as getPublicKeyFn, generateSecretKey as generateSecretKeyFn, finalizeEvent, verifyEvent, kinds, utils, nip04, nip44, nip57 } from 'nostr-tools';

/**
 * Filter | Filter[] を Filter[] に正規化
 * nostr-tools >= 2.10 付近で subscribeMany が単一 Filter 専用になったための互換処理
 */
function normalizeFilters(filterOrFilters) {
  if (!filterOrFilters) return [];
  if (Array.isArray(filterOrFilters)) {
    return filterOrFilters.filter((f) => f && typeof f === 'object' && !Array.isArray(f));
  }
  if (typeof filterOrFilters === 'object') return [filterOrFilters];
  return [];
}

export function makeIdempotentSubscription(subscription) {
  if (!subscription || typeof subscription.close !== 'function') return subscription || { close() { } };
  const originalClose = subscription.close.bind(subscription);
  let closed = false;
  subscription.close = function (reason) {
    if (closed) return;
    closed = true;
    try {
      const result = originalClose(reason);
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return result;
    } catch (_e) {
      return undefined;
    }
  };
  return subscription;
}

/**
 * 複数 Filter を同一 REQ に載せるため subscribeMap へ展開する
 */
function subscribeWithFilters(pool, relays, filterOrFilters, params, eoseOnly) {
  const filters = normalizeFilters(filterOrFilters);
  const urls = Array.isArray(relays) ? relays : [relays];
  if (!filters.length || !urls.length) {
    return { close() { } };
  }

  if (filters.length === 1) {
    if (eoseOnly) {
      return makeIdempotentSubscription(NostrSimplePool.prototype.subscribeEose.call(pool, urls, filters[0], params));
    }
    return makeIdempotentSubscription(NostrSimplePool.prototype.subscribe.call(pool, urls, filters[0], params));
  }

  const requests = [];
  for (let i = 0; i < urls.length; i++) {
    for (let j = 0; j < filters.length; j++) {
      requests.push({ url: urls[i], filter: filters[j] });
    }
  }

  if (eoseOnly) {
    let subcloser;
    subcloser = pool.subscribeMap(requests, {
      ...params,
      oneose() {
        const reason = 'closed automatically on eose';
        if (subcloser) subcloser.close(reason);
        else if (typeof params?.onclose === 'function') {
          params.onclose(urls.map((url) => ({ url, reason })));
        }
      }
    });
    return makeIdempotentSubscription(subcloser);
  }

  return makeIdempotentSubscription(pool.subscribeMap(requests, params));
}

/**
 * 旧 API（Filter[] 受け取り）を維持する SimplePool 互換クラス
 */
export class SimplePool extends NostrSimplePool {
  subscribe(relays, filterOrFilters, params) {
    return subscribeWithFilters(this, relays, filterOrFilters, params, false);
  }

  subscribeMany(relays, filterOrFilters, params) {
    return subscribeWithFilters(this, relays, filterOrFilters, params, false);
  }

  subscribeEose(relays, filterOrFilters, params) {
    return subscribeWithFilters(this, relays, filterOrFilters, params, true);
  }

  subscribeManyEose(relays, filterOrFilters, params) {
    return subscribeWithFilters(this, relays, filterOrFilters, params, true);
  }

  async querySync(relays, filterOrFilters, params) {
    const filters = normalizeFilters(filterOrFilters);
    if (filters.length <= 1) {
      return super.querySync(relays, filters[0] || {}, params);
    }
    const groups = await Promise.all(
      filters.map((filter) => super.querySync(relays, filter, params))
    );
    const byId = new Map();
    for (const events of groups) {
      for (const ev of events) {
        if (ev && ev.id) byId.set(ev.id, ev);
      }
    }
    return Array.from(byId.values());
  }
}

/**
 * windowまたはインポートしたNostrToolsを取得
 */
export function getNostrTools() {
  return {
    nip19,
    SimplePool,
    getPublicKey: getPublicKey(),
    finalizeEvent: getFinalizeEvent(),
    kinds,
    utils,
    nip04,
    nip44
  };
}

/**
 * nip19ユーティリティ取得
 */
export function getNip19() {
  return nip19;
}

/**
 * verifyEvent取得
 */
export function getVerifyEvent() {
  return verifyEvent;
}

/**
 * nip57取得
 */
export function getNip57() {
  return nip57;
}

/**
 * SimplePool取得
 */
export function getSimplePool() {
  return SimplePool;
}

/**
 * SecretKey を Uint8Array に正規化（nostr-tools >= 2.x 互換）
 * @param {string|Uint8Array} sk
 * @returns {Uint8Array}
 */
function normalizeSecretKey(sk) {
  if (sk instanceof Uint8Array) return sk;
  if (typeof sk === 'string') {
    const bytes = hexToBytes(sk);
    if (!bytes) throw new Error('Invalid secret key');
    return bytes;
  }
  throw new Error('expected Uint8Array, got type=' + typeof sk);
}

/**
 * getPublicKey関数取得（hex / Uint8Array 両対応）
 */
export function getPublicKey() {
  return (sk) => getPublicKeyFn(normalizeSecretKey(sk));
}

/**
 * generateSecretKey関数取得
 */
export function generateSecretKey() {
  return generateSecretKeyFn();
}

/**
 * finalizeEvent関数取得（hex / Uint8Array 両対応）
 */
export function getFinalizeEvent() {
  return (event, sk) => finalizeEvent(event, normalizeSecretKey(sk));
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
