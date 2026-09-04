// ============================================================================
// NIP-57 Lightning Zap 送信機能
// ============================================================================

import { signEventWithMode } from '../post/actions.js';
import { NwcClient, hasConfiguredNwc } from '../../core/nwc.js';
import { getWriteRelays } from '../../core/relay.js';
import { getNip19, getVerifyEvent, getNip57, getSimplePool } from '../../core/nostr-compat.js';
import { getProfileLightningAddress } from '../profile/profile.js';

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

function allowsNostrZaps(lnurlData) {
  if (!lnurlData) return false;
  const allows = lnurlData.allowsNostr === true || lnurlData.allowsNostr === 'true';
  return allows && typeof lnurlData.nostrPubkey === 'string' && /^[0-9a-f]{64}$/i.test(lnurlData.nostrPubkey);
}

const ZAP_RECEIPT_RELAYS = [
  'wss://yabu.me',
  'wss://r.kojira.io',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay-jp.nostr.wirednet.jp'
];

const ZAP_REQUEST_TAG_NAMES = new Set(['p', 'e', 'a', 'relays', 'amount', 'lnurl']);

export function buildZapReceiptRelays(userRelays) {
  const urls = [...ZAP_RECEIPT_RELAYS, ...(Array.isArray(userRelays) ? userRelays : [])]
    .map((u) => String(u || '').trim().replace(/\/+$/, ''))
    .filter((u) => /^wss:\/\//i.test(u));
  return Array.from(new Set(urls)).slice(0, 8);
}

/**
 * BOLT11 が description_hash (tag 23 / h) を持つか。
 * Zap 用インボイスは Zap Request JSON の SHA256 を h に載せる。通常 LNURL は description (d) のみ。
 */
export function bolt11HasDescriptionHash(pr) {
  if (!pr || typeof pr !== 'string') return false;
  const s = pr.trim().toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1) return false;
  const data = [];
  for (let i = pos + 1; i < s.length; i++) {
    const v = ALPHABET.indexOf(s[i]);
    if (v === -1) return false;
    data.push(v);
  }
  if (data.length < 6 + 7 + 104) return false;
  data.length -= 6;
  const sigStart = data.length - 104;
  let i = 7;
  while (i + 3 <= sigStart) {
    const type = data[i];
    const len = (data[i + 1] << 5) | data[i + 2];
    i += 3;
    if (len < 0 || i + len > sigStart) return false;
    if (type === 23) return true;
    i += len;
  }
  return false;
}

function countTags(tags, name) {
  return (tags || []).filter((t) => Array.isArray(t) && t[0] === name).length;
}

/**
 * NIP-07 等が付けた余分なプロパティを除き、署名検証に使う 7 フィールドだけ残す
 */
export function toCanonicalZapRequest(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  return {
    kind: Number(ev.kind),
    created_at: Number(ev.created_at),
    content: String(ev.content || ''),
    tags: Array.isArray(ev.tags) ? ev.tags : [],
    pubkey: String(ev.pubkey || ''),
    id: String(ev.id || ''),
    sig: String(ev.sig || ev.signature || '')
  };
}

export function getZapReceiptSenderPubkey(ev) {
  const pTag = (ev && ev.tags || []).find((t) => Array.isArray(t) && t[0] === 'P' && t[1]);
  if (pTag) return pTag[1];
  try {
    const desc = (ev && ev.tags || []).find((t) => Array.isArray(t) && t[0] === 'description' && t[1]);
    if (desc) {
      const req = JSON.parse(desc[1]);
      if (req && req.pubkey) return req.pubkey;
    }
  } catch (_e) {}
  return (ev && ev.pubkey) || '';
}

/** タイムライン上の作者表示に使う pubkey。9735 は LN サーバーではなく Zap 送信者 */
export function getEventDisplayPubkey(ev) {
  if (!ev) return '';
  if (Number(ev.kind) === 9735) return getZapReceiptSenderPubkey(ev) || ev.pubkey || '';
  return ev.pubkey || '';
}

/**
 * Zap の支払い先。9735 はレシート発行者 (LNサーバー) ではなく送信者へ送り、
 * プロフィールZapにする（レシートイベント自体をZapしない）。
 */
export function buildZapPaymentTarget(ev) {
  const recipientPubkey = getEventDisplayPubkey(ev) || (ev && ev.pubkey) || '';
  if (!ev || !ev.id || Number(ev.kind) === 9735) {
    return { recipientPubkey, event: null };
  }
  return {
    recipientPubkey,
    event: {
      id: ev.id,
      pubkey: recipientPubkey,
      kind: ev.kind,
      tags: Array.isArray(ev.tags) ? ev.tags : []
    }
  };
}

export function getZapReceiptTargetEventId(ev) {
  const eTags = ((ev && ev.tags) || []).filter((t) => Array.isArray(t) && (t[0] === 'e' || t[0] === 'E') && t[1]);
  if (!eTags.length) return '';
  return eTags[eTags.length - 1][1];
}

export function isIncomingZapReceiptFor(ev, pubkey) {
  if (!ev || ev.kind !== 9735 || !pubkey) return false;
  const want = String(pubkey).toLowerCase();
  return ((ev.tags || []).some((t) => Array.isArray(t) && t[0] === 'p' && t[1] && String(t[1]).toLowerCase() === want));
}

export function isOutgoingZapReceiptFor(ev, pubkey) {
  if (!ev || ev.kind !== 9735 || !pubkey) return false;
  const want = String(pubkey).toLowerCase();
  const sender = String(getZapReceiptSenderPubkey(ev) || '').toLowerCase();
  return sender === want;
}

export function toLightningUri(pr) {
  const inv = String(pr || '').replace(/\s/g, '');
  if (!inv) return '';
  if (/^lightning:/i.test(inv)) return inv;
  return 'lightning:' + inv;
}

export function zapReceiptMatchesPayment(ev, payment) {
  if (!ev || Number(ev.kind) !== 9735 || !payment) return false;
  const sender = (getZapReceiptSenderPubkey(ev) || '').toLowerCase();
  const wantSender = String(payment.senderPubkey || '').toLowerCase();
  if (wantSender && sender !== wantSender) return false;
  if (payment.eventId) {
    return getZapReceiptTargetEventId(ev) === payment.eventId;
  }
  const wantP = String(payment.recipientPubkey || '').toLowerCase();
  if (!wantP) return false;
  return (ev.tags || []).some((t) => Array.isArray(t) && t[0] === 'p' && t[1] && String(t[1]).toLowerCase() === wantP);
}

/**
 * 外部ウォレット支払い後の kind:9735 を待つ
 */
export function waitForZapReceipt(payment, options = {}) {
  const timeoutMs = options.timeoutMs || 180000;
  const extraRelays = options.relays || (payment && payment.relays) || [];
  const relays = buildZapReceiptRelays(extraRelays);
  const SimplePool = getSimplePool();
  if (!SimplePool || !relays.length) {
    return Promise.reject(new Error('レシート待ちのリレーがありません'));
  }

  const pool = new SimplePool();
  const senderPubkey = String((payment && payment.senderPubkey) || '').toLowerCase();
  const since = Math.floor(Date.now() / 1000) - 30;
  const filters = [];
  if (payment && payment.eventId) {
    filters.push({ kinds: [9735], '#e': [payment.eventId], since });
  } else if (payment && payment.recipientPubkey) {
    filters.push({ kinds: [9735], '#p': [payment.recipientPubkey], since });
  }
  if (senderPubkey) {
    filters.push({ kinds: [9735], '#P': [senderPubkey], since });
  }
  if (!filters.length) {
    filters.push({ kinds: [9735], since });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let sub = null;
    const abort = options.signal;
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      if (abort) {
        try { abort.removeEventListener('abort', onAbort); } catch (_e) {}
      }
      try { if (sub) sub.close(); } catch (_e) {}
      try { if (typeof pool.close === 'function') pool.close(relays); } catch (_e) {}
    }

    function finish(err, aborted) {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted) resolve({ aborted: true });
      else if (err) reject(err);
    }

    function onAbort() {
      finish(null, true);
    }

    if (abort) {
      if (abort.aborted) {
        finish(null, true);
        return;
      }
      abort.addEventListener('abort', onAbort);
    }

    try {
      sub = pool.subscribeMany(relays, filters, {
        onevent(ev) {
          if (settled) return;
          if (!zapReceiptMatchesPayment(ev, payment)) return;
          settled = true;
          cleanup();
          resolve({ receipt: ev, aborted: false });
        }
      });
    } catch (e) {
      finish(e);
    }
  });
}

function applyZappedStyleToDom(eventId) {
  if (typeof document === 'undefined' || !eventId) return;
  try {
    document.querySelectorAll('.event[data-event-id="' + eventId + '"] .btn-zap').forEach((btn) => {
      btn.classList.add('zapped');
      btn.dataset.zapped = 'true';
    });
  } catch (_e) {}
}

/**
 * 自分が送った kind:9735 なら対象ノートを Zap 済みにする
 */
export function applyZapReceiptToZappedState(state, ev) {
  if (!state || !ev || ev.kind !== 9735) return false;
  let myPub = '';
  try { myPub = (localStorage.getItem('pubkey') || '').toLowerCase(); } catch (_e) {}
  if (!myPub) return false;
  const sender = (getZapReceiptSenderPubkey(ev) || '').toLowerCase();
  if (sender !== myPub) return false;
  const sats = getZapReceiptAmountSats(ev);
  if (sats > 0) rememberZapAmount(sats, { asLast: false });
  const targetId = getZapReceiptTargetEventId(ev);
  if (!targetId) return false;
  markEventZapped(state, targetId);
  return true;
}

export function markEventZapped(state, eventId) {
  if (!state || !eventId) return;
  if (!state.zappedEventIds) {
    state.zappedEventIds = new Set();
  }
  const isNew = !state.zappedEventIds.has(eventId);
  state.zappedEventIds.add(eventId);
  if (isNew) saveZappedEvent(eventId);
  applyZappedStyleToDom(eventId);
}

function msatsToSats(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / 1000);
}

/**
 * kind:9735 の金額 (sat)。Coinos 等は receipt に amount タグを付けず、
 * description 内の Zap Request か bolt11 にだけ金額がある。
 */
export function getZapReceiptAmountSats(ev) {
  const tags = (ev && ev.tags) || [];
  const receiptAmount = tags.find((t) => Array.isArray(t) && t[0] === 'amount' && t[1]);
  const fromReceipt = receiptAmount ? msatsToSats(receiptAmount[1]) : 0;
  if (fromReceipt > 0) return fromReceipt;

  try {
    const desc = tags.find((t) => Array.isArray(t) && t[0] === 'description' && t[1]);
    if (desc) {
      const req = JSON.parse(desc[1]);
      const amt = (req.tags || []).find((t) => Array.isArray(t) && t[0] === 'amount' && t[1]);
      const fromReq = amt ? msatsToSats(amt[1]) : 0;
      if (fromReq > 0) return fromReq;
    }
  } catch (_e) {}

  const bolt11 = tags.find((t) => Array.isArray(t) && t[0] === 'bolt11' && t[1]);
  if (bolt11) {
    try {
      const nip57Obj = getNip57();
      if (nip57Obj && typeof nip57Obj.getSatoshisAmountFromBolt11 === 'function') {
        const sats = Number(nip57Obj.getSatoshisAmountFromBolt11(bolt11[1]));
        if (Number.isFinite(sats) && sats > 0) return Math.round(sats);
      }
    } catch (_e) {}
  }
  return 0;
}

/**
 * LNURL callback URL に amount / nostr を付与する。
 * nostr は NIP-57 例示・nostter と同じ encodeURI（URLSearchParams は使わない）。
 * URLSearchParams は `:` `,` を %3A/%2C にし、decodeURI する LNURL 実装で JSON が壊れる。
 */
export function buildZapCallbackUrl(callbackUrl, amountMsat, zapRequestEvent, comment = '', commentAllowed = 0) {
  const url = new URL(callbackUrl);
  url.hash = '';
  url.searchParams.set('amount', String(amountMsat));
  url.searchParams.delete('nostr');
  url.searchParams.delete('comment');
  const encodedNostr = encodeURI(JSON.stringify(toCanonicalZapRequest(zapRequestEvent)));
  return `${url.toString()}&nostr=${encodedNostr}`;
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
 * Zapを送信する。NWC があれば支払いまで行い、なければインボイスを返す。
 * @returns {Promise<{ paid: boolean, pr: string, preimage?: string, eventId: string, recipientPubkey: string, senderPubkey: string, amountSats: number, relays: string[] }>}
 */
export async function sendZap(state, settingsManager, targetEvent, amountSats, comment = '', options = {}) {
  const nwcUri = (settingsManager && settingsManager.settings && settingsManager.settings.nwcUri) || '';

  // 1. 受信者のプロフィール情報と Lightning アドレスを確認
  const { recipientPubkey, event: zapTargetEvent } = buildZapPaymentTarget(targetEvent);
  const prof = (state.profiles && (state.profiles.get(recipientPubkey)
    || state.profiles.get(String(recipientPubkey || '').toLowerCase()))) || null;
  const lud = getProfileLightningAddress(prof);
  if (!lud) {
    throw new Error('受信者のLightningアドレスが見つかりません');
  }

  const endpoint = getLnurlEndpoint(lud);
  if (!endpoint) {
    throw new Error('無効なLightningアドレスです');
  }

  // 2. LNURL-pay 情報の取得
  const fetchOpts = { cache: 'no-store' };
  let lnurlRes;
  try {
    lnurlRes = await fetch(endpoint, fetchOpts);
    if (!lnurlRes.ok) throw new Error();
  } catch (e) {
    console.warn('[Zap] Direct fetch failed, trying CORS proxy for:', endpoint);
    try {
      lnurlRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(endpoint)}`, fetchOpts);
    } catch (err) {
      throw new Error('Lightningサービスへの接続に失敗しました (CORS/Network Error)', { cause: err });
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
  if (!allowsNostrZaps(lnurlData)) {
    throw new Error('受信者のLightningアドレスはZapレシートに対応していません');
  }

  const amountMsat = amountSats * 1000;
  if (lnurlData.minSendable && amountMsat < lnurlData.minSendable) {
    throw new Error(`送信可能最小金額は ${lnurlData.minSendable / 1000} sat です`);
  }
  if (lnurlData.maxSendable && amountMsat > lnurlData.maxSendable) {
    throw new Error(`送信可能最大金額は ${lnurlData.maxSendable / 1000} sat です`);
  }

  // 3. Zap Request (kind:9734) 作成
  // zapline-jp が見るリレー (yabu.me / nos.lol / damus) を先頭に置く。
  // 一部 LNURL 実装は relays タグの先頭数件にしかレシートを送らない。
  const userRelays = (state && state.relays) ? getWriteRelays(state.relays) : [];
  const writeRelays = buildZapReceiptRelays(userRelays);

  const nip57Obj = getNip57();
  const userPubkey = ensureHexPubkey(state.pubkey || localStorage.getItem('pubkey') || '');

  const zapParams = {
    amount: amountMsat,
    relays: writeRelays,
    comment: comment
  };

  if (zapTargetEvent) {
    zapParams.event = zapTargetEvent;
  } else {
    zapParams.pubkey = recipientPubkey;
  }

  const draft = nip57Obj.makeZapRequest(zapParams);

  draft.pubkey = userPubkey;
  draft.created_at = Math.floor(Date.now() / 1000);

  // 古い LNURL 実装は k などの追加タグで nostr を捨てて通常インボイスを返す
  draft.tags = (draft.tags || []).filter((t) => Array.isArray(t) && ZAP_REQUEST_TAG_NAMES.has(t[0]));

  if (lud.toLowerCase().startsWith('lnurl1')) {
    if (!draft.tags.some(t => t[0] === 'lnurl')) {
      draft.tags.push(['lnurl', lud]);
    }
  }

  const signedZapRequest = await signEventWithMode(state, draft);
  const canonicalZapRequest = toCanonicalZapRequest(signedZapRequest);

  const pCount = countTags(canonicalZapRequest.tags, 'p');
  const eCount = countTags(canonicalZapRequest.tags, 'e');
  if (pCount !== 1 || eCount > 1) {
    console.error('[Zap] Invalid tag counts after signing', { pCount, eCount, tags: canonicalZapRequest.tags });
    throw new Error('Zapリクエストのタグが不正です。署名拡張が余分な p/e タグを付けていないか確認してください。');
  }

  try {
    const verifyEvent = getVerifyEvent();
    if (verifyEvent) {
      const isValid = verifyEvent(canonicalZapRequest);
      console.log('[Zap] Local signature verification result:', isValid);
      if (!isValid) {
        console.error('[Zap] Signed event is invalid!', canonicalZapRequest);
        throw new Error('Zapリクエストの署名検証に失敗しました');
      }
    }
    if (typeof nip57Obj.validateZapRequest === 'function') {
      const invalid = nip57Obj.validateZapRequest(JSON.stringify(canonicalZapRequest));
      if (invalid) {
        console.error('[Zap] validateZapRequest:', invalid, canonicalZapRequest);
        throw new Error(invalid);
      }
    }
  } catch (e) {
    if (e && e.message && /署名|タグ|invalid|Zap/i.test(e.message)) throw e;
    console.error('[Zap] Failed to verify signed event locally:', e);
  }

  console.log('[Zap] Request tags:', canonicalZapRequest.tags);
  console.log('[Zap] Receipt relays:', writeRelays);
  console.log('[Zap] LNURL callback host:', (() => { try { return new URL(callbackUrl).host; } catch (_e) { return callbackUrl; } })());

  // 4. コールバックへ送信してインボイス（pr）を取得
  // nostter / NIP-57 と同じ encodeURI で nostr を付与する
  const targetUrl = buildZapCallbackUrl(
    callbackUrl,
    amountMsat,
    canonicalZapRequest,
    comment,
    lnurlData.commentAllowed || 0
  );
  let invoiceRes;
  try {
    invoiceRes = await fetch(targetUrl, fetchOpts);
    if (!invoiceRes.ok) throw new Error();
  } catch (e) {
    console.warn('[Zap] Direct invoice fetch failed, trying CORS proxy...');
    try {
      invoiceRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, fetchOpts);
    } catch (err) {
      throw new Error('インボイスの取得に失敗しました (CORS/Network Error)', { cause: err });
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
  if (!bolt11HasDescriptionHash(pr)) {
    console.warn('[Zap] Invoice has no description_hash (some providers still publish receipts)');
  }

  const result = {
    paid: false,
    pr,
    eventId: zapTargetEvent && zapTargetEvent.id ? zapTargetEvent.id : '',
    recipientPubkey,
    senderPubkey: userPubkey,
    amountSats,
    relays: writeRelays
  };

  rememberZapAmount(amountSats, { asLast: true });

  const invoiceOnly = !!(options && options.invoiceOnly);

  // 5. NWC があれば支払い。invoiceOnly または未設定なら Wallet of Satoshi 等向けにインボイスを返す
  if (!invoiceOnly && hasConfiguredNwc(nwcUri)) {
    const nwcClient = new NwcClient(nwcUri);
    const preimage = await nwcClient.payInvoice(pr);
    if (result.eventId) {
      markEventZapped(state, result.eventId);
    }
    result.paid = true;
    result.preimage = preimage;
    return result;
  }

  return result;
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

function zapAmountHistoryKey() {
  const pk = localStorage.getItem('pubkey') || 'anonymous';
  return `nokakoi.zapAmounts.${String(pk).toLowerCase()}`;
}

function normalizeZapAmounts(list) {
  const set = new Set();
  (Array.isArray(list) ? list : []).forEach((n) => {
    const v = Math.round(Number(n));
    if (Number.isFinite(v) && v > 0) set.add(v);
  });
  return Array.from(set).sort((a, b) => a - b);
}

function readZapAmountHistory() {
  try {
    const raw = localStorage.getItem(zapAmountHistoryKey());
    if (!raw) return { amounts: [], last: null };
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return { amounts: normalizeZapAmounts(data), last: null };
    }
    const last = Math.round(Number(data && data.last));
    return {
      amounts: normalizeZapAmounts(data && data.amounts),
      last: Number.isFinite(last) && last > 0 ? last : null
    };
  } catch (e) {
    return { amounts: [], last: null };
  }
}

function writeZapAmountHistory(data) {
  localStorage.setItem(zapAmountHistoryKey(), JSON.stringify({
    amounts: normalizeZapAmounts(data && data.amounts),
    last: data && data.last > 0 ? data.last : null
  }));
}

/**
 * 送信済み Zap 金額履歴（重複なし・小さい順）
 */
export function loadZapAmountHistory() {
  return readZapAmountHistory().amounts;
}

export function getLastZapAmount() {
  return readZapAmountHistory().last;
}

export function rememberZapAmount(amountSats, options = {}) {
  const amount = Math.round(Number(amountSats));
  if (!Number.isFinite(amount) || amount <= 0) return loadZapAmountHistory();
  const asLast = options.asLast !== false;
  const data = readZapAmountHistory();
  const amounts = normalizeZapAmounts(data.amounts.concat(amount));
  try {
    writeZapAmountHistory({
      amounts,
      last: asLast ? amount : data.last
    });
  } catch (e) {
    console.warn('[Zap] Failed to save amount history:', e);
  }
  return amounts;
}

export function removeZapAmount(amountSats) {
  const amount = Math.round(Number(amountSats));
  const data = readZapAmountHistory();
  const amounts = data.amounts.filter((n) => n !== amount);
  try {
    writeZapAmountHistory({
      amounts,
      last: data.last === amount ? null : data.last
    });
  } catch (e) {
    console.warn('[Zap] Failed to remove amount history:', e);
  }
  return amounts;
}
