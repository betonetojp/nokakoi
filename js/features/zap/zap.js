// ============================================================================
// NIP-57 Lightning Zap 送信機能
// ============================================================================

import { signEventWithMode } from '../post/actions.js';
import { NwcClient } from '../../core/nwc.js';
import { getWriteRelays } from '../../core/relay.js';
import { getNip19, getVerifyEvent, getNip57 } from '../../core/nostr-compat.js';

// 簡易 bech32 デコーダー
const ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function decodeBech32(str) {
  const pos = str.lastIndexOf('1');
  if (pos === -1 || pos < 1 || pos + 7 > str.length) throw new Error('Invalid bech32');
  const hrp = str.slice(0, pos);
  const dataStr = str.slice(pos + 1);
  const data = [];
  for (let i = 0; i < dataStr.length; i++) {
    const c = dataStr[i];
    const val = ALPHABET.indexOf(c);
    if (val === -1) throw new Error('Invalid character');
    data.push(val);
  }
  let acc = 0;
  let bits = 0;
  const result = [];
  const maxv = 255;
  for (const value of data.slice(0, -6)) { // exclude checksum
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & maxv);
      acc = acc & ((1 << bits) - 1);
    }
  }
  return { hrp, bytes: new Uint8Array(result) };
}

function ensureHexPubkey(pk) {
  if (!pk || typeof pk !== 'string') return '';
  const clean = pk.trim();
  if (/^[0-9a-f]{64}$/i.test(clean)) return clean.toLowerCase();
  if (clean.startsWith('npub1')) {
    try {
      const nip19 = getNip19();
      if (nip19 && typeof nip19.decode === 'function') {
        const decoded = nip19.decode(clean);
        if (decoded && decoded.type === 'npub' && decoded.data) {
          return decoded.data;
        }
      }
    } catch (_e) {}
  }
  return '';
}

function decodeLnurl(lnurl) {
  try {
    const { bytes } = decodeBech32(lnurl);
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return null;
  }
}

/**
 * Lightning Address または LNURL からエンドポイントURLを取得
 */
export function getLnurlEndpoint(address) {
  if (!address) return null;
  const addr = address.trim();
  if (addr.toLowerCase().startsWith('lnurl1')) {
    return decodeLnurl(addr);
  }
  if (addr.includes('@')) {
    const [name, domain] = addr.split('@');
    if (name && domain) {
      return `https://${domain}/.well-known/lnurlp/${name}`;
    }
  }
  return null;
}

/**
 * Zapを送信する
 * @param {object} state アプリの状態
 * @param {object} settingsManager 設定マネージャ
 * @param {object} targetEvent Zap対象のイベント (kind:1等)
 * @param {number} amountSats 金額 (Sats)
 * @param {string} comment コメント (オプション)
 * @returns {Promise<string>} preimage (支払い証明)
 */
export async function sendZap(state, settingsManager, targetEvent, amountSats, comment = '') {
  const nwcUri = settingsManager.settings.nwcUri;
  if (!nwcUri) {
    throw new Error('NWCが設定されていません。表示設定からウォレットを接続してください。');
  }

  // 1. 受信者のプロフィール情報と Lightning アドレスを確認
  const recipientPubkey = targetEvent.pubkey;
  const prof = state.profiles.get(recipientPubkey);
  const lud = (prof && (prof.lud16 || prof.lud06)) || '';
  if (!lud) {
    throw new Error('受信者のLightningアドレスが見つかりません');
  }

  const endpoint = getLnurlEndpoint(lud);
  if (!endpoint) {
    throw new Error('無効なLightningアドレスです');
  }

  // 2. LNURL-pay 情報の取得
  let lnurlRes;
  try {
    lnurlRes = await fetch(endpoint);
    if (!lnurlRes.ok) throw new Error();
  } catch (e) {
    console.warn('[Zap] Direct fetch failed, trying CORS proxy for:', endpoint);
    try {
      lnurlRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(endpoint)}`);
    } catch (err) {
      throw new Error('Lightningサービスへの接続に失敗しました (CORS/Network Error)');
    }
  }
  if (!lnurlRes.ok) {
    throw new Error('Lightningサービスへの接続に失敗しました');
  }
  const lnurlData = await lnurlRes.json();
  const callbackUrl = lnurlData.callback;
  if (!callbackUrl) {
    throw new Error('インボイス生成エンドポイントが見つかりません');
  }

  const amountMsat = amountSats * 1000;
  if (lnurlData.minSendable && amountMsat < lnurlData.minSendable) {
    throw new Error(`送信可能最小金額は ${lnurlData.minSendable / 1000} sat です`);
  }
  if (lnurlData.maxSendable && amountMsat > lnurlData.maxSendable) {
    throw new Error(`送信可能最大金額は ${lnurlData.maxSendable / 1000} sat です`);
  }

  // 3. Zap Request (kind:9734) 作成
  const userRelays = (state && state.relays) ? getWriteRelays(state.relays) : [];
  const defaultRelays = [
    'wss://yabu.me',
    'wss://relay-jp.nostr.wirednet.jp',
    'wss://nos.lol',
    'wss://relay.damus.io'
  ];
  const writeRelays = Array.from(new Set([...userRelays, ...defaultRelays]));

  const nip57Obj = getNip57();
  const userPubkey = ensureHexPubkey(state.pubkey || localStorage.getItem('pubkey') || '');
  
  // makeZapRequest の引数を構築
  const zapParams = {
    amount: amountMsat,
    relays: writeRelays,
    comment: comment
  };

  if (targetEvent && targetEvent.id) {
    // 投稿宛てZap: event にターゲットイベントオブジェクト（NostrEvent）を指定
    zapParams.event = targetEvent;
  } else {
    // プロフィール宛てZap: pubkey に受信者の公開鍵を指定
    zapParams.pubkey = recipientPubkey;
  }

  const draft = nip57Obj.makeZapRequest(zapParams);

  // NIP-57 ドラフトのメタデータを補正 (pubkey と created_at を設定)
  draft.pubkey = userPubkey;
  draft.created_at = Math.floor(Date.now() / 1000);

  // lud が最初から bech32（lnurl1...）形式なら、互換性のために lnurl タグも付与
  if (lud.toLowerCase().startsWith('lnurl1')) {
    if (!draft.tags.some(t => t[0] === 'lnurl')) {
      draft.tags.push(['lnurl', lud]);
    }
  }

  // ログイン中アカウントで署名
  const signedZapRequest = await signEventWithMode(state, draft);

  // 相手サーバーでのデシリアライズ再シリアライズによる description_hash の不一致を防ぐため、
  // JSONのキー順序をアルファベット順にソートしてシリアライズする
  const sortedZapRequest = {};
  Object.keys(signedZapRequest).sort().forEach(key => {
    sortedZapRequest[key] = signedZapRequest[key];
  });

  // ローカルでの署名検証（デバッグ用）
  try {
    const verifyEvent = getVerifyEvent();
    if (verifyEvent) {
      const isValid = verifyEvent(signedZapRequest);
      console.log('[Zap] Local signature verification result:', isValid);
      console.log('[Zap] JSON serialized Zap Request:', JSON.stringify(sortedZapRequest));
      if (!isValid) {
        console.error('[Zap] Signed event is invalid!', signedZapRequest);
      }
    }
  } catch (e) {
    console.error('[Zap] Failed to verify signed event locally:', e);
  }

  // 4. コールバックへ送信してインボイス（pr）を取得

  const callbackUrlObj = new URL(callbackUrl);
  callbackUrlObj.searchParams.set('amount', String(amountMsat));
  callbackUrlObj.searchParams.set('nostr', JSON.stringify(sortedZapRequest));
  if (lnurlData.commentAllowed && comment.length <= lnurlData.commentAllowed) {
    // 互換性のためコメントパラメータも付加
    callbackUrlObj.searchParams.set('comment', comment);
  }

  const targetUrl = callbackUrlObj.toString();
  let invoiceRes;
  try {
    invoiceRes = await fetch(targetUrl);
    if (!invoiceRes.ok) throw new Error();
  } catch (e) {
    console.warn('[Zap] Direct invoice fetch failed, trying CORS proxy...');
    try {
      invoiceRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
    } catch (err) {
      throw new Error('インボイスの取得に失敗しました (CORS/Network Error)');
    }
  }
  if (!invoiceRes.ok) {
    throw new Error('インボイスの取得に失敗しました');
  }
  const invoiceData = await invoiceRes.json();
  const pr = invoiceData.pr;
  if (!pr) {
    throw new Error('インボイスの生成に失敗しました (' + (invoiceData.reason || '原因不明') + ')');
  }

  // 5. NWC での支払い実行
  const nwcClient = new NwcClient(nwcUri);
  const preimage = await nwcClient.payInvoice(pr);

  // 6. 成功時のローカル状態の更新
  if (targetEvent.id) {
    saveZappedEvent(targetEvent.id);
    if (!state.zappedEventIds) {
      state.zappedEventIds = new Set();
    }
    state.zappedEventIds.add(targetEvent.id);
  }

  return preimage;
}

/**
 * Zap済みイベントIDをローカルストレージへ退避
 */
export function saveZappedEvent(eventId) {
  try {
    const pk = localStorage.getItem('pubkey') || 'anonymous';
    const key = `nokakoi.zaps.${pk.toLowerCase()}`;
    const saved = localStorage.getItem(key);
    const ids = saved ? JSON.parse(saved) : [];
    if (!ids.includes(eventId)) {
      ids.push(eventId);
      localStorage.setItem(key, JSON.stringify(ids));
    }
  } catch (e) {
    console.warn('[Zap] Failed to save zapped event to cache:', e);
  }
}

/**
 * キャッシュされたZap済みイベントIDを読み込む
 */
export function loadZappedEvents(state) {
  if (!state.zappedEventIds) {
    state.zappedEventIds = new Set();
  }
  try {
    const pk = localStorage.getItem('pubkey') || 'anonymous';
    const key = `nokakoi.zaps.${pk.toLowerCase()}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      const ids = JSON.parse(saved);
      ids.forEach(id => state.zappedEventIds.add(id));
    }
  } catch (e) {
    console.warn('[Zap] Failed to load zapped events from cache:', e);
  }
}
