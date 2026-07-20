// ============================================================================
// NIP-46 Nostr Connect 実装
// ============================================================================

import { getSimplePool, getNip19, getPublicKey as getPublicKeyFn, getFinalizeEvent, getNip04, getNip44 } from './nostr-compat.js';
import { bytesToHex, hexToBytes, randomBytes } from './crypto.js';
import { t } from '../utils/i18n.js';
import { qrcode } from 'qrcode-generator';

/**
 * デフォルトNIP-46リレー
 */
export const DEFAULT_NIP46_RELAYS = [
  'wss://ephemeral.snowflare.cc/',
  //'wss://relay.nsec.app/',
  'wss://nostr.oxtr.dev/',
  'wss://theforest.nostr1.com/',
  'wss://relay.primal.net/'
];

/**
 * NIP-46メソッド定数
 */
export const NIP46_METHODS = {
  CONNECT: 'connect',
  GET_PUBLIC_KEY: 'get_public_key',
  SIGN_EVENT: 'sign_event',
  DISCONNECT: 'disconnect',
  PING: 'ping',
  NIP04_ENCRYPT: 'nip04_encrypt',
  NIP04_DECRYPT: 'nip04_decrypt',
  NIP44_ENCRYPT: 'nip44_encrypt',
  NIP44_DECRYPT: 'nip44_decrypt'
};

/**
 * NIP-46 kind定数
 */
export const NIP46_KIND = 24133;

/**
 * タイムアウト設定（ミリ秒）
 */
const REQUEST_TIMEOUT = 60000;
const CONNECT_TIMEOUT = 120000;
const ENSURE_CONNECT_TIMEOUT = 15000;
const RESUME_HIDDEN_MS = 5000;

function debugLog(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.log(...args);
    }
  } catch (e) { }
}

/**
 * NIP-46クライアントクラス
 */
export class Nip46Client {
  constructor(options = {}) {
    this.localSecretKey = null;
    this.localPubkey = null;
    this.remotePubkey = null;
    this.secret = null;
    this.relays = options.relays || DEFAULT_NIP46_RELAYS.slice();
    this.pool = null;
    this.subscription = null;
    this.connected = false;
    this.pendingRequests = new Map();
    this.onStatusChange = options.onStatusChange || null;
    this._ensurePromise = null;
    this._visibilityHandler = null;
    this._hiddenAt = null;
    this.metadata = options.metadata || {
      name: 'nokakoi',
      url: typeof window !== 'undefined' ? window.location.origin : '',
      description: 'Nostr client'
    };
  }

  /**
   * ステータス変更通知
   */
  _notifyStatus(status, message = '') {
    if (this.onStatusChange) {
      try {
        this.onStatusChange(status, message);
      } catch (e) {
        console.warn('[NIP-46] onStatusChange でエラー:', e);
      }
    }
  }

  /**
   * signer が disconnect 未対応かどうかを判定
   */
  _isUnsupportedDisconnectError(errorValue) {
    const msg = String(errorValue && errorValue.message ? errorValue.message : (errorValue || '')).toLowerCase();
    return msg.includes('unknown method') && msg.includes('disconnect');
  }

  /**
   * close 対象の socket がある場合のみ pool.close を呼ぶ
   */
  _closePoolSafely() {
    if (!this.pool) return;

    let closedCount = 0;
    try {
      const relaysMap = this.pool.relays;
      if (relaysMap && typeof relaysMap.values === 'function') {
        const CONNECTING = (typeof WebSocket !== 'undefined' && typeof WebSocket.CONNECTING === 'number') ? WebSocket.CONNECTING : 0;
        const OPEN = (typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number') ? WebSocket.OPEN : 1;

        for (const relay of relaysMap.values()) {
          const ws = relay && relay.ws;
          if (!ws || typeof ws.readyState !== 'number') continue;
          if (ws.readyState === CONNECTING || ws.readyState === OPEN) {
            try {
              ws.close();
              closedCount++;
            } catch (e) {
              // close 中競合は無視
            }
          }
        }

        if (typeof relaysMap.clear === 'function') {
          try { relaysMap.clear(); } catch (e) { }
        }
      }
    } catch (e) {
      // relay map の取得に失敗した場合は何もしない
    }

    if (closedCount === 0) {
      debugLog('[NIP-46] close 対象 socket なしのため Pool close をスキップ');
      return;
    }

    debugLog('[NIP-46] OPEN/CONNECTING socket をクローズ:', closedCount);
  }

  /**
   * ローカル秘密鍵を生成または復元
   */
  initLocalKey(existingSecretKey = null) {
    const getPublicKey = getPublicKeyFn();
    if (!getPublicKey) {
      throw new Error('NostrTools not loaded');
    }

    if (existingSecretKey) {
      this.localSecretKey = existingSecretKey;
    } else {
      // 新規生成
      const skBytes = randomBytes(32);
      this.localSecretKey = bytesToHex(skBytes);
    }

    // nostr-tools の getPublicKey は秘密鍵を Uint8Array で受け取る
    const skBytes = hexToBytes(this.localSecretKey);
    this.localPubkey = getPublicKey(skBytes);
    debugLog('[NIP-46] ローカル pubkey:', this.localPubkey);
    return this.localSecretKey;
  }

  /**
   * Nostr Connect URI を生成（QRコード用）
   * nostrconnect://<local-pubkey>?relay=<relay>&metadata=<metadata>
   */
  generateConnectUri() {
    if (!this.localPubkey) {
      throw new Error('Local key not initialized');
    }

    // ランダムなsecretを生成
    const secretBytes = randomBytes(16);
    this.secret = bytesToHex(secretBytes);

    const params = new URLSearchParams();

    // リレーを追加
    for (const relay of this.relays) {
      params.append('relay', relay);
    }

    // メタデータを追加
    if (this.metadata) {
      params.append('metadata', JSON.stringify(this.metadata));
    }

    // secretを追加
    params.append('secret', this.secret);

    const uri = `nostrconnect://${this.localPubkey}?${params.toString()}`;
    debugLog('[NIP-46] 接続 URI を生成');
    return uri;
  }

  /**
   * bunker:// URI を解析
   * bunker://<remote-pubkey>?relay=<relay>&secret=<secret>
   */
  parseBunkerUri(uri) {
    if (!uri || !uri.startsWith('bunker://')) {
      throw new Error(t('nip46.invalid_bunker_uri'));
    }

    try {
      // bunker:// を削除してパース
      const withoutScheme = uri.slice('bunker://'.length);

      // クエリパラメータの位置を特定
      const queryIndex = withoutScheme.indexOf('?');
      let remotePubkey;
      let queryString = '';

      if (queryIndex === -1) {
        // クエリパラメータなし
        remotePubkey = withoutScheme;
      } else {
        remotePubkey = withoutScheme.slice(0, queryIndex);
        queryString = withoutScheme.slice(queryIndex + 1);
      }

      // npub形式の場合はhexに変換
      if (remotePubkey.startsWith('npub')) {
        const nip19 = getNip19();
        const decoded = nip19.decode(remotePubkey);
        if (decoded && decoded.type === 'npub') {
          remotePubkey = bytesToHex(decoded.data);
        }
      }

      // 公開鍵の検証
      if (!/^[0-9a-f]{64}$/i.test(remotePubkey)) {
        throw new Error(t('nip46.invalid_remote_pubkey'));
      }

      // クエリパラメータを解析
      const params = new URLSearchParams(queryString);
      const relays = params.getAll('relay');
      const secret = params.get('secret');

      debugLog('[NIP-46] bunker URI を解析:', {
        remotePubkey: remotePubkey.slice(0, 16) + '...',
        relays,
        hasSecret: !!secret
      });

      return {
        remotePubkey: remotePubkey.toLowerCase(),
        relays: relays.length > 0 ? relays : this.relays,
        secret: secret || null
      };
    } catch (e) {
      if (e.message && (e.message.includes('nip46.') || e.message.includes('無効'))) {
        throw e;
      }
      throw new Error(t('nip46.parse_uri_failed', { msg: e.message }), { cause: e });
    }
  }

  /**
   * SimplePoolを取得または作成
   */
  _getPool() {
    if (this.pool) return this.pool;

    const SimplePool = getSimplePool();
    if (!SimplePool) {
      throw new Error('SimplePool not available');
    }

    this.pool = new SimplePool();
    return this.pool;
  }

  /**
   * NIP-46 リレー向け WebSocket が生きているか
   */
  _isTransportHealthy() {
    if (!this.pool || !this.pool.relays || !this.subscription) return false;

    const OPEN = (typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number') ? WebSocket.OPEN : 1;

    try {
      const relaysMap = this.pool.relays;
      if (typeof relaysMap.values !== 'function') return false;

      for (const relay of relaysMap.values()) {
        const ws = relay && relay.ws;
        if (ws && typeof ws.readyState === 'number' && ws.readyState === OPEN) {
          return true;
        }
      }
    } catch (e) {
      return false;
    }

    return false;
  }

  /**
   * セッション情報は残し、プールと購読だけ破棄する
   */
  _resetTransport() {
    if (this.subscription) {
      try {
        if (typeof this.subscription.close === 'function') {
          this.subscription.close();
        } else if (typeof this.subscription.unsub === 'function') {
          this.subscription.unsub();
        }
      } catch (e) { }
      this.subscription = null;
    }

    for (const [, pending] of this.pendingRequests) {
      try { clearTimeout(pending.timeout); } catch (e) { }
      try { pending.reject(new Error('Transport reset')); } catch (e) { }
    }
    this.pendingRequests.clear();

    if (this.pool) {
      try {
        this._closePoolSafely();
      } catch (e) {
        console.warn('[NIP-46] Transport reset 時の Pool クローズに失敗:', e);
      }
      this.pool = null;
    }
  }

  /**
   * connect を再送してセッションを再確立する
   */
  async _reestablishSession({ timeoutMs = ENSURE_CONNECT_TIMEOUT, allowUnverified = true } = {}) {
    if (!this.localPubkey || !this.remotePubkey || !this.localSecretKey) {
      throw new Error(t('nip46.not_connected'));
    }

    try {
      const pool = this._getPool();
      const finalizeEvent = getFinalizeEvent();
      if (!finalizeEvent) {
        throw new Error('finalizeEvent not available');
      }

      const requestId = this._generateRequestId();
      const request = {
        id: requestId,
        method: NIP46_METHODS.CONNECT,
        params: [this.localPubkey]
      };

      if (this.secret) {
        request.params.push(this.secret);
      } else {
        request.params.push('');
      }
      request.params.push('sign_event,nip04_encrypt,nip04_decrypt,nip44_encrypt,nip44_decrypt');

      const encryptedContent = await this._encrypt(JSON.stringify(request), this.remotePubkey);
      const skBytes = hexToBytes(this.localSecretKey);
      const event = finalizeEvent({
        kind: NIP46_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', this.remotePubkey]],
        content: encryptedContent
      }, skBytes);

      debugLog('[NIP-46] セッション再確立のため接続リクエストを送信');

      const verifyPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(new Error(t('nip46.ping_timeout')));
        }, timeoutMs);

        this.pendingRequests.set(requestId, {
          resolve: () => {
            clearTimeout(timeout);
            this.connected = true;
            resolve({
              remotePubkey: this.remotePubkey,
              connected: true,
              verified: true
            });
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
          timeout
        });
      });

      await Promise.any(pool.publish(this.relays, event));
      const result = await verifyPromise;

      this.connected = true;
      debugLog('[NIP-46] セッションを再確立, remote pubkey:', this.remotePubkey?.slice(0, 16) + '...');
      this._notifyStatus('connected', t('nip46.reconnected'));
      this.setupResumeHandler();

      return result;
    } catch (e) {
      const errorMsg = e && e.message ? e.message : String(e);
      console.warn('[NIP-46] セッション再確立に失敗:', errorMsg);

      if (!allowUnverified) {
        this._notifyStatus('error', t('nip46.reconnect_failed'));
        throw e;
      }

      // nsecBunkerはモバイルアプリが背景にある時など応答しないことがある
      this.connected = true;
      this._notifyStatus('connected', t('nip46.reconnected_unverified'));
      this.setupResumeHandler();

      return {
        remotePubkey: this.remotePubkey,
        connected: true,
        verified: false
      };
    }
  }

  /**
   * 輸送路が死んでいれば張り直し、必要なら connect を再送する
   */
  async ensureConnected({ force = false } = {}) {
    if (this._ensurePromise) {
      return this._ensurePromise;
    }

    this._ensurePromise = (async () => {
      if (!this.remotePubkey || !this.localSecretKey) {
        throw new Error(t('nip46.not_connected'));
      }

      let healthy = this._isTransportHealthy();
      if (healthy && !force) {
        return { remotePubkey: this.remotePubkey, connected: true, verified: true, skipped: true };
      }

      // 進行中の RPC があり輸送路も生きていれば途中で切らない
      if (healthy && this.pendingRequests.size > 0) {
        return { remotePubkey: this.remotePubkey, connected: true, verified: true, skipped: true };
      }

      // restore / 初回接続直後は subscribe 済みでも socket がまだ OPEN でないことがある
      if (!force && this.subscription && this.connected && this.pool && !healthy) {
        healthy = await this._waitForTransportHealthy(2500);
        if (healthy) {
          return { remotePubkey: this.remotePubkey, connected: true, verified: true, skipped: true };
        }
      }

      this._notifyStatus('connecting', t('nip46.reconnecting'));
      this._resetTransport();
      this._subscribe();
      return await this._reestablishSession({
        timeoutMs: ENSURE_CONNECT_TIMEOUT,
        allowUnverified: true
      });
    })().finally(() => {
      this._ensurePromise = null;
    });

    return this._ensurePromise;
  }

  /**
   * 輸送路が OPEN になるまで短く待つ
   */
  _waitForTransportHealthy(timeoutMs = 2500) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        if (this._isTransportHealthy()) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  /**
   * フォアグラウンド復帰時に NIP-46 輸送路を回復する
   */
  setupResumeHandler() {
    this.removeResumeHandler();
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }

    this._hiddenAt = document.hidden ? Date.now() : null;

    this._visibilityHandler = () => {
      try {
        if (document.hidden) {
          this._hiddenAt = Date.now();
          return;
        }

        const hiddenFor = this._hiddenAt ? (Date.now() - this._hiddenAt) : 0;
        this._hiddenAt = null;

        const unhealthy = !this._isTransportHealthy();
        if (!unhealthy && hiddenFor < RESUME_HIDDEN_MS) {
          return;
        }

        debugLog('[NIP-46] Page became visible, ensuring connection', { hiddenFor, unhealthy });
        this.ensureConnected({ force: true }).catch((e) => {
          console.warn('[NIP-46] resume reconnect failed:', e);
        });
      } catch (e) {
        console.warn('[NIP-46] visibilitychange handler error:', e);
      }
    };

    try {
      document.addEventListener('visibilitychange', this._visibilityHandler);
    } catch (e) {
      this._visibilityHandler = null;
    }
  }

  /**
   * 復帰ハンドラを解除
   */
  removeResumeHandler() {
    if (this._visibilityHandler && typeof document !== 'undefined') {
      try {
        document.removeEventListener('visibilitychange', this._visibilityHandler);
      } catch (e) { }
    }
    this._visibilityHandler = null;
    this._hiddenAt = null;
  }

  /**
   * NIP-04/NIP-44復号（自動判別）
   */
  async _decrypt(content, remotePubkey) {
    if (!content || typeof content !== 'string') {
      throw new Error('Invalid content: not a string');
    }

    const skBytes = hexToBytes(this.localSecretKey);

    // content が NIP-04 形式か判定（?iv= 区切りの有無）
    const hasIv = content.includes('?iv=');

    if (hasIv) {
      // NIP-04 形式
      const nip04 = getNip04();
      if (!nip04) {
        throw new Error('NIP-04 not available');
      }
      return await nip04.decrypt(skBytes, remotePubkey, content);
    } else {
      // NIP-44 形式（?iv= 区切りなし）
      const nip44 = getNip44();
      if (!nip44) {
        throw new Error('NIP-44 not available');
      }
      const conversationKey = nip44.v2.utils.getConversationKey(skBytes, remotePubkey);
      return nip44.v2.decrypt(content, conversationKey);
    }
  }

  /**
   * NIP-04/NIP-44暗号化（NIP-44優先）
   */
  async _encrypt(content, remotePubkey) {
    const skBytes = hexToBytes(this.localSecretKey);

    // まず NIP-44 を試し、失敗時は NIP-04 へフォールバック
    const nip44 = getNip44();
    if (nip44 && nip44.v2) {
      try {
        const conversationKey = nip44.v2.utils.getConversationKey(skBytes, remotePubkey);
        return nip44.v2.encrypt(content, conversationKey);
      } catch (e) {
        // NIP-04 へフォールバック
      }
    }

    // NIP-04 へフォールバック
    const nip04 = getNip04();
    if (!nip04) {
      throw new Error('Neither NIP-04 nor NIP-44 available');
    }
    return await nip04.encrypt(skBytes, remotePubkey, content);
  }

  /**
   * nip04_encryptリクエストを送信
   */
  async nip04Encrypt(pubkey, plaintext) {
    await this.ensureConnected();
    if (!this.connected) {
      throw new Error(t('nip46.not_connected'));
    }
    const res = await this._sendRequest(NIP46_METHODS.NIP04_ENCRYPT, [pubkey, plaintext]);
    return res;
  }

  /**
   * nip04_decryptリクエストを送信
   */
  async nip04Decrypt(pubkey, ciphertext, timeoutMs) {
    await this.ensureConnected();
    if (!this.connected) {
      throw new Error(t('nip46.not_connected'));
    }
    const res = await this._sendRequest(NIP46_METHODS.NIP04_DECRYPT, [pubkey, ciphertext], timeoutMs);
    return res;
  }

  /**
   * nip44_encryptリクエストを送信
   */
  async nip44Encrypt(pubkey, plaintext, timeoutMs) {
    await this.ensureConnected();
    if (!this.connected) {
      throw new Error(t('nip46.not_connected'));
    }
    const res = await this._sendRequest(NIP46_METHODS.NIP44_ENCRYPT, [pubkey, plaintext], timeoutMs);
    return res;
  }

  /**
   * nip44_decryptリクエストを送信
   */
  async nip44Decrypt(pubkey, ciphertext, timeoutMs) {
    await this.ensureConnected();
    if (!this.connected) {
      throw new Error(t('nip46.not_connected'));
    }
    const res = await this._sendRequest(NIP46_METHODS.NIP44_DECRYPT, [pubkey, ciphertext], timeoutMs);
    return res;
  }

  /**
   * リクエストIDを生成
   */
  _generateRequestId() {
    const bytes = randomBytes(16);
    return bytesToHex(bytes);
  }

  /**
   * NIP-46リクエストを送信
   */
  async _sendRequest(method, params = [], timeoutMs = REQUEST_TIMEOUT) {
    if (!this.remotePubkey) {
      throw new Error('Not connected to remote signer');
    }

    const pool = this._getPool();
    const finalizeEvent = getFinalizeEvent();
    if (!finalizeEvent) {
      throw new Error('finalizeEvent not available');
    }

    const requestId = this._generateRequestId();

    const request = {
      id: requestId,
      method: method,
      params: params
    };

    const encryptedContent = await this._encrypt(JSON.stringify(request), this.remotePubkey);

    // nostr-tools の finalizeEvent は秘密鍵を Uint8Array で受け取る
    const skBytes = hexToBytes(this.localSecretKey);
    const event = finalizeEvent({
      kind: NIP46_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.remotePubkey]],
      content: encryptedContent
    }, skBytes);

    debugLog('[NIP-46] リクエスト送信:', method, requestId);

    // レスポンス待ち用のPromiseを作成
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(t('nip46.request_timeout')));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
    });

    // イベントを送信
    try {
      await Promise.any(pool.publish(this.relays, event));
    } catch (e) {
      this.pendingRequests.delete(requestId);
      throw new Error(t('nip46.publish_failed', { msg: e.message }), { cause: e });
    }

    return responsePromise;
  }

  /**
   * 受信イベントを処理
   */
  async _handleEvent(event) {
    if (!event || event.kind !== NIP46_KIND) return;

    // 自分宛のイベントか確認
    const pTag = event.tags.find(t => t[0] === 'p' && t[1] === this.localPubkey);
    if (!pTag) return;

    // contentが文字列であることを確認
    if (typeof event.content !== 'string' || !event.content) {
      return;
    }

    // remotePubkeyが設定されている場合、送信者が一致するか確認
    // （QRコード方式では最初はremotePubkeyが未設定なのでスキップ）
    if (this.remotePubkey && event.pubkey !== this.remotePubkey) {
      return;
    }

    // 復号を試みる - 失敗した場合は他のクライアント向けのイベントなので無視
    let decrypted;
    try {
      decrypted = await this._decrypt(event.content, event.pubkey);
    } catch (e) {
      console.warn('[NIP-46] 復号に失敗:', e.message, '送信元:', event.pubkey?.substring(0, 12));
      return;
    }

    try {
      const message = JSON.parse(decrypted);

      // リクエスト形式（nsecBunkerからのconnectリクエスト）
      if (message.method) {
        if (message.method === 'connect') {
          debugLog('[NIP-46] リモート署名者から接続リクエストを受信');

          // secret検証（設定されている場合）
          if (this.secret) {
            const params = message.params || [];
            const receivedSecret = params[1];
            if (receivedSecret !== this.secret) {
              console.warn('[NIP-46] Secret が不一致のため接続リクエストを無視');
              return;
            }
          }

          // 接続確立
          this.remotePubkey = event.pubkey;
          this.connected = true;
          debugLog('[NIP-46] 接続を確立');
          this._notifyStatus('connected', t('nip46.connected'));
          this.setupResumeHandler();

          // ack応答を送信
          try {
            await this._sendConnectAck(message.id, event.pubkey);
          } catch (e) {
            console.warn('[NIP-46] ack 送信に失敗:', e);
          }
          return;
        }
        // 他のリクエストメソッドは無視
        return;
      }

      // レスポンス形式
      // pending requestsを先にチェック（ack応答も含む）
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        if (message.error) {
          const errorLower = (typeof message.error === 'string') ? message.error.toLowerCase() : '';

          if (errorLower === 'no permission') {
            // "no permission"はBunker側でユーザー承認前に送られることがある
            // pending requestを維持して承認後のレスポンスを待つ（タイムアウトまで）
            debugLog('[NIP-46] Bunker 承認待ちの可能性があります:', message.id);
            return;
          }

          if (this._isUnsupportedDisconnectError(message.error)) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(message.id);
            debugLog('[NIP-46] signer が disconnect 未対応のため切断エラーを無視:', message.error);
            pending.resolve(null);
            return;
          }

          console.warn('[NIP-46] エラーレスポンスを受信:', message.error, 'id:', message.id);

          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);
          let errorMsg = message.error;
          if (errorLower === 'invalid secret') {
            errorMsg = t('nip46.error.invalid_secret');
          }
          pending.reject(new Error(errorMsg));
        } else {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);
          pending.resolve(message.result);
        }
      }

      // 接続応答の場合（result: "ack" など）
      if ((message.result === 'ack' || message.id === 'ack' || message.result) && !this.connected) {
        this.remotePubkey = event.pubkey;
        this.connected = true;
        this._notifyStatus('connected', t('nip46.connected'));
        this.setupResumeHandler();
      }
    } catch (e) {
      // JSONパース失敗
      console.warn('[NIP-46] 復号後コンテンツの解析に失敗:', e.message);
    }
  }

  /**
   * connect ack応答を送信
   */
  async _sendConnectAck(requestId, remotePubkey) {
    const pool = this._getPool();
    const finalizeEvent = getFinalizeEvent();
    if (!finalizeEvent) {
      throw new Error('finalizeEvent not available');
    }

    const response = {
      id: requestId,
      result: 'ack'
    };

    const encryptedContent = await this._encrypt(JSON.stringify(response), remotePubkey);

    const skBytes = hexToBytes(this.localSecretKey);
    const event = finalizeEvent({
      kind: NIP46_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', remotePubkey]],
      content: encryptedContent
    }, skBytes);

    debugLog('[NIP-46] 接続 ack を送信:', remotePubkey);

    try {
      await Promise.any(pool.publish(this.relays, event));
    } catch (e) {
      console.warn('[NIP-46] ack の publish に失敗:', e);
    }
  }

  /**
   * kind:24133イベントを購読
   */
  _subscribe() {
    if (this.subscription) return;

    const pool = this._getPool();

    debugLog('[NIP-46] リレーへイベント購読を開始:', this.relays);

    this.subscription = pool.subscribeMany(
      this.relays,
      [{ kinds: [NIP46_KIND], '#p': [this.localPubkey] }],
      {
        onevent: (event) => {
          this._handleEvent(event);
        },
        oneose: () => {
          debugLog('[NIP-46] EOSE を受信');
        }
      }
    );
  }

  /**
   * Nostr Connect URI での接続待ち（QRコード方式）
   * リモート署名者がconnectリクエストを送ってくるのを待つ
   */
  async waitForConnection(timeoutMs = CONNECT_TIMEOUT) {
    if (!this.localPubkey) {
      throw new Error('Local key not initialized');
    }

    this._notifyStatus('waiting', t('nip46.waiting_for_connection'));

    // 購読開始
    this._subscribe();

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.connected && this.remotePubkey) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve({
            remotePubkey: this.remotePubkey,
            connected: true
          });
        }
      }, 500);

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        this._notifyStatus('timeout', t('nip46.connection_timeout'));
        reject(new Error(t('nip46.connection_timeout')));
      }, timeoutMs);
    });
  }

  /**
   * bunker:// URI で接続
   */
  async connectWithBunkerUri(bunkerUri) {
    const parsed = this.parseBunkerUri(bunkerUri);

    this.remotePubkey = parsed.remotePubkey;
    this.secret = parsed.secret;
    if (parsed.relays.length > 0) {
      this.relays = parsed.relays;
    }

    // ローカル鍵がなければ生成
    if (!this.localPubkey) {
      this.initLocalKey();
    }

    this._notifyStatus('connecting', t('nip46.connecting'));

    // 購読開始
    this._subscribe();

    // connectリクエストを送信
    const pool = this._getPool();
    const finalizeEvent = getFinalizeEvent();

    const requestId = this._generateRequestId();
    const request = {
      id: requestId,
      method: NIP46_METHODS.CONNECT,
      params: [this.localPubkey]
    };

    if (this.secret) {
      request.params.push(this.secret);
    } else {
      request.params.push('');
    }
    request.params.push('sign_event,nip04_encrypt,nip04_decrypt,nip44_encrypt,nip44_decrypt');

    const encryptedContent = await this._encrypt(JSON.stringify(request), this.remotePubkey);

    // nostr-tools の finalizeEvent は秘密鍵を Uint8Array で受け取る
    const skBytes = hexToBytes(this.localSecretKey);
    const event = finalizeEvent({
      kind: NIP46_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.remotePubkey]],
      content: encryptedContent
    }, skBytes);

    debugLog('[NIP-46] 接続リクエストを送信:', this.remotePubkey);

    // 接続応答待ち
    const connectionPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this._notifyStatus('timeout', t('nip46.connection_timeout'));
        reject(new Error(t('nip46.connection_timeout')));
      }, CONNECT_TIMEOUT);

      const checkInterval = setInterval(() => {
        if (this.connected) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          resolve({
            remotePubkey: this.remotePubkey,
            connected: true
          });
        }
      }, 500);

      this.pendingRequests.set(requestId, {
        resolve: () => {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          this.connected = true;
          resolve({
            remotePubkey: this.remotePubkey,
            connected: true
          });
        },
        reject: (e) => {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          reject(e);
        },
        timeout
      });
    });

    // イベントを送信
    try {
      await Promise.any(pool.publish(this.relays, event));
    } catch (e) {
      throw new Error(t('nip46.publish_failed', { msg: e.message }), { cause: e });
    }

    const result = await connectionPromise;
    this.setupResumeHandler();
    return result;
  }

  /**
   * リモート公開鍵を取得
   */
  async getPublicKey() {
    await this.ensureConnected();
    if (!this.connected) {
      throw new Error(t('nip46.not_connected'));
    }

    const result = await this._sendRequest(NIP46_METHODS.GET_PUBLIC_KEY, []);
    return result;
  }

  /**
   * イベントに署名
   */
  async signEvent(draft) {
    await this.ensureConnected();
    if (!this.connected) {
      throw new Error(t('nip46.not_connected'));
    }

    // draftをJSON文字列として送信
    const eventJson = JSON.stringify(draft);
    const result = await this._sendRequest(NIP46_METHODS.SIGN_EVENT, [eventJson]);

    // 結果はJSON文字列なのでパース
    if (typeof result === 'string') {
      return JSON.parse(result);
    }
    return result;
  }

  /**
   * 切断
   */
  async disconnect() {
    debugLog('[NIP-46] 切断処理を開始...');

    this.removeResumeHandler();

    // signer 実装差でノイズが出やすいため、明示的な disconnect RPC は送信しない

    // 購読参照を破棄（実 socket クローズは _closePoolSafely に一本化）
    if (this.subscription) {
      this.subscription = null;
    }

    // pending requestsをクリア
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    // プールを閉じる
    if (this.pool) {
      try {
        this._closePoolSafely();
      } catch (e) {
        console.warn('[NIP-46] Pool のクローズに失敗:', e);
      }
      this.pool = null;
    }

    this.connected = false;
    this.remotePubkey = null;
    this._notifyStatus('disconnected', t('nip46.disconnected'));
  }

  /**
   * 接続情報を取得（保存用）
   */
  getConnectionInfo() {
    return {
      localSecretKey: this.localSecretKey,
      remotePubkey: this.remotePubkey,
      relays: this.relays,
      secret: this.secret,
      connected: this.connected
    };
  }

  /**
   * 保存された接続情報から復元
   */
  async restoreConnection(info) {
    if (!info || !info.localSecretKey || !info.remotePubkey) {
      throw new Error('Invalid connection info');
    }

    this.initLocalKey(info.localSecretKey);
    this.remotePubkey = info.remotePubkey;
    this.relays = info.relays || DEFAULT_NIP46_RELAYS.slice();
    this.secret = info.secret || null;

    this._notifyStatus('connecting', t('nip46.reconnecting'));
    this._resetTransport();
    this._subscribe();

    // connectリクエストを再送してBunkerとのセッションを再確立
    // (get_public_keyだけではBunker側がセッションを認識しない場合がある)
    return await this._reestablishSession({
      timeoutMs: 30000,
      allowUnverified: true
    });
  }
}

/**
 * QRコード生成ユーティリティ
 * qrcode-generatorライブラリを使用
 */
export function generateQRCode(text, options = {}) {
  const typeNumber = options.typeNumber || 0;
  const errorCorrectionLevel = options.errorCorrectionLevel || 'M';
  const cellSize = options.cellSize || 4;
  const margin = options.margin || 4;

  // グローバルのqrcodeを使用（CDNから読み込み済み）
  if (typeof qrcode === 'undefined') {
    throw new Error('qrcode library not loaded');
  }

  const qr = qrcode(typeNumber, errorCorrectionLevel);
  qr.addData(text);
  qr.make();

  return qr.createImgTag(cellSize, margin);
}

/**
 * QRコードをSVGで生成
 */
export function generateQRCodeSVG(text, options = {}) {
  const cellSize = options.cellSize || 4;
  const margin = options.margin || 4;

  if (typeof qrcode === 'undefined') {
    throw new Error('qrcode library not loaded');
  }

  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const size = moduleCount * cellSize + margin * 2;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`;
  svg += `<rect width="${size}" height="${size}" fill="white"/>`;

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        const x = col * cellSize + margin;
        const y = row * cellSize + margin;
        svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="black"/>`;
      }
    }
  }

  svg += '</svg>';
  return svg;
}
