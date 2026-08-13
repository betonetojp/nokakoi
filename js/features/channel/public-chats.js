// ============================================================================
// NIP-51 kind:10005 Public chats リスト（読取 + 発行）
// ============================================================================

import { fetchLatestEvent, backupEvent, publishReplaceableEvent } from '../../core/replaceable-event.js';
import { getNip04, getNip44 } from '../../core/nostr-compat.js';
import { signer } from '../../core/signer.js';
import {
  buildChannelEmbedContext,
  formatChannelLabelText,
  shortenChannelEventId,
} from './channel.js';
import {
  clearExcludedPublicChatIds,
  removeCustomJoinedChannel,
} from './channel-membership.js';

const PUBLIC_CHATS_KIND = 10005;
const DEFAULT_MAX_ENTRIES = 40;
const DEFAULT_CONCURRENCY = 5;

/**
 * e タグ配列からチャンネル root 参照を取り出す
 * @returns {{ rootId: string, relayHint: string|null, isPrivate: boolean }[]}
 */
export function parsePublicChatChannelRefsFromTags(tags, options = {}) {
  if (!Array.isArray(tags)) return [];
  const isPrivate = !!options.isPrivate;
  const out = [];
  const seen = options.seen instanceof Set ? options.seen : new Set();
  for (const tag of tags) {
    if (!tag || tag[0] !== 'e' || typeof tag[1] !== 'string') continue;
    const rootId = tag[1].trim();
    const key = rootId.toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(rootId)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const relayHint = (typeof tag[2] === 'string' && /^wss?:\/\//i.test(tag[2].trim()))
      ? tag[2].trim()
      : null;
    out.push({ rootId: key, relayHint, isPrivate });
  }
  return out;
}

/**
 * kind:10005 の公開 e タグからチャンネル root 参照を取り出す
 * @returns {{ rootId: string, relayHint: string|null, isPrivate: boolean }[]}
 */
export function parsePublicChatChannelRefs(event) {
  if (!event || !Array.isArray(event.tags)) return [];
  return parsePublicChatChannelRefsFromTags(event.tags, { isPrivate: false });
}

export function buildPublicChatETag(rootId, relayHint = null) {
  const id = String(rootId || '').trim().toLowerCase();
  const tag = ['e', id];
  if (relayHint && /^wss?:\/\//i.test(String(relayHint).trim())) {
    tag.push(String(relayHint).trim());
  }
  return tag;
}

/**
 * NIP-51 content（平文 JSON または NIP-04/44 暗号）をタグ配列へ復号
 * @returns {Promise<{ tags: any[], ok: boolean, encryptionMode: string|null }>}
 */
export async function decryptNip51PrivateTags(state, event) {
  const content = event && typeof event.content === 'string' ? event.content.trim() : '';
  if (!content) {
    return { tags: [], ok: true, encryptionMode: null };
  }

  // 平文 JSON（配列 or オブジェクト内 tags）
  try {
    const parsed = JSON.parse(content);
    const tags = normalizeTagsPayload(parsed);
    if (tags) return { tags, ok: true, encryptionMode: null };
  } catch (e) { /* encrypted */ }

  const myPubkey = (state && state.pubkey) || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
  const targetPubkey = (event && event.pubkey) ? event.pubkey : myPubkey;
  if (!myPubkey || !targetPubkey) {
    return { tags: [], ok: false, encryptionMode: null };
  }

  const isNip04Format = content.includes('?iv=');
  let encryptionMode = isNip04Format ? 'nip04' : 'nip44';
  const nip44 = getNip44();
  const nip04 = getNip04();

  async function tryParseDecrypted(raw) {
    if (!raw) return null;
    const text = typeof raw === 'string' ? raw : null;
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return normalizeTagsPayload(parsed);
    } catch (e) {
      return null;
    }
  }

  // NIP-44
  if (encryptionMode === 'nip44') {
    if (nip44 && nip44.v2 && signer.hasKey()) {
      try {
        let decrypted = signer.nip44Decrypt(nip44, content, targetPubkey);
        if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
        const tags = await tryParseDecrypted(decrypted);
        if (tags) return { tags, ok: true, encryptionMode: 'nip44' };
      } catch (e) { }
    }
    if (typeof window !== 'undefined' && window.nostr && window.nostr.nip44 && typeof window.nostr.nip44.decrypt === 'function') {
      try {
        let decrypted = window.nostr.nip44.decrypt(targetPubkey, content);
        if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
        const tags = await tryParseDecrypted(decrypted);
        if (tags) return { tags, ok: true, encryptionMode: 'nip44' };
      } catch (e) { }
    }
    if (state && state.signer === 'nip46' && state.nip46 && state.nip46.client && typeof state.nip46.client.nip44Decrypt === 'function') {
      try {
        const decrypted = await state.nip46.client.nip44Decrypt(targetPubkey, content);
        const tags = await tryParseDecrypted(decrypted);
        if (tags) return { tags, ok: true, encryptionMode: 'nip44' };
      } catch (e) { }
    }
  }

  // NIP-04（指定 or フォールバック）
  if (nip04 && signer.hasKey()) {
    try {
      let decrypted = signer.nip04Decrypt(nip04, myPubkey, content);
      if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
      const tags = await tryParseDecrypted(decrypted);
      if (tags) return { tags, ok: true, encryptionMode: 'nip04' };
    } catch (e) { }
  }
  if (typeof window !== 'undefined' && window.nostr && window.nostr.nip04 && typeof window.nostr.nip04.decrypt === 'function') {
    try {
      let decrypted = window.nostr.nip04.decrypt(myPubkey, content);
      if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
      const tags = await tryParseDecrypted(decrypted);
      if (tags) return { tags, ok: true, encryptionMode: 'nip04' };
    } catch (e) { }
  }
  if (state && state.signer === 'nip46' && state.nip46 && state.nip46.client && typeof state.nip46.client.nip04Decrypt === 'function') {
    try {
      const decrypted = await state.nip46.client.nip04Decrypt(myPubkey, content);
      const tags = await tryParseDecrypted(decrypted);
      if (tags) return { tags, ok: true, encryptionMode: 'nip04' };
    } catch (e) { }
  }

  // NIP-44 フォールバック（形式判定が外れていた場合）
  if (typeof window !== 'undefined' && window.nostr && window.nostr.nip44 && typeof window.nostr.nip44.decrypt === 'function') {
    try {
      let decrypted = window.nostr.nip44.decrypt(myPubkey, content);
      if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
      const tags = await tryParseDecrypted(decrypted);
      if (tags) return { tags, ok: true, encryptionMode: 'nip44' };
    } catch (e) { }
  }

  return { tags: [], ok: false, encryptionMode };
}

function normalizeTagsPayload(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return [];
    if (Array.isArray(parsed[0])) return parsed;
    return null;
  }
  if (typeof parsed === 'object') {
    if (Array.isArray(parsed.tags)) return parsed.tags;
  }
  return null;
}

function buildHintEvent(rootId, relayHint) {
  const tag = ['e', rootId];
  if (relayHint) tag.push(relayHint);
  return { kind: 42, tags: [tag] };
}

/**
 * 秘密チャンネル e タグを NIP-51 content へ暗号化
 */
export async function encryptPrivatePublicChatTags(state, privateRefs, encryptionMode = 'nip44') {
  const muteTags = (privateRefs || []).map((ref) => buildPublicChatETag(ref.rootId, ref.relayHint));
  const plaintext = JSON.stringify(muteTags);
  const myPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
  if (!myPubkey) throw new Error('No pubkey for encryption');

  const nip44 = getNip44();
  const nip04 = getNip04();
  const mode = encryptionMode === 'nip04' ? 'nip04' : 'nip44';

  if (mode === 'nip44') {
    if (nip44 && nip44.v2 && signer.hasKey()) {
      return signer.nip44Encrypt(nip44, plaintext, myPubkey);
    }
    if (typeof window !== 'undefined' && window.nostr && window.nostr.nip44 && typeof window.nostr.nip44.encrypt === 'function') {
      let res = window.nostr.nip44.encrypt(myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
    if (state && state.signer === 'nip46' && state.nip46 && state.nip46.client && typeof state.nip46.client.nip44Encrypt === 'function') {
      return await state.nip46.client.nip44Encrypt(myPubkey, plaintext);
    }
  }

  if (mode === 'nip04') {
    if (nip04 && signer.hasKey()) {
      let res = signer.nip04Encrypt(nip04, myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
    if (typeof window !== 'undefined' && window.nostr && window.nostr.nip04 && typeof window.nostr.nip04.encrypt === 'function') {
      let res = window.nostr.nip04.encrypt(myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
    if (state && state.signer === 'nip46' && state.nip46 && state.nip46.client) {
      const client = state.nip46.client;
      if (typeof client.nip04Encrypt === 'function') {
        return await client.nip04Encrypt(myPubkey, plaintext);
      }
      if (typeof client._encrypt === 'function') {
        return await client._encrypt(plaintext, myPubkey);
      }
    }
  }

  if (typeof window !== 'undefined' && window.nostr) {
    if (window.nostr.nip44 && typeof window.nostr.nip44.encrypt === 'function') {
      let res = window.nostr.nip44.encrypt(myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
    if (window.nostr.nip04 && typeof window.nostr.nip04.encrypt === 'function') {
      let res = window.nostr.nip04.encrypt(myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
  }

  if (nip44 && nip44.v2 && signer.hasKey()) {
    return signer.nip44Encrypt(nip44, plaintext, myPubkey);
  }

  throw new Error('Encryption unavailable for selected mode: ' + mode);
}

/**
 * kind:10005 を編集用に分解
 */
export async function loadPublicChatsEditableState(state, pubkey) {
  const myPubkey = pubkey || (state && state.pubkey) || localStorage.getItem('pubkey');
  if (!state || !myPubkey) {
    return {
      event: null,
      publicItems: [],
      privateItems: [],
      otherTags: [],
      encryptionMode: 'nip44',
      privateDecryptOk: true,
      privateDecryptAttempted: false,
    };
  }

  const event = await fetchLatestEvent(state, PUBLIC_CHATS_KIND, myPubkey, { timeout: 4000 });
  const otherTags = [];
  const publicItems = [];
  let privateItems = [];
  let encryptionMode = 'nip44';
  let privateDecryptOk = true;
  let privateDecryptAttempted = false;

  if (event && Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      if (!tag || tag[0] !== 'e') {
        if (tag) otherTags.push([...tag]);
        continue;
      }
      const refs = parsePublicChatChannelRefsFromTags([tag], { isPrivate: false });
      if (refs.length) publicItems.push({ ...refs[0], label: null });
    }
  }

  const content = event && typeof event.content === 'string' ? event.content.trim() : '';
  if (content) {
    privateDecryptAttempted = true;
    const decrypted = await decryptNip51PrivateTags(state, event);
    privateDecryptOk = decrypted.ok;
    if (decrypted.encryptionMode) encryptionMode = decrypted.encryptionMode;
    if (decrypted.ok && decrypted.tags.length) {
      privateItems = parsePublicChatChannelRefsFromTags(decrypted.tags, { isPrivate: true })
        .map((ref) => ({ ...ref, label: null }));
    }
  }

  return {
    event,
    publicItems,
    privateItems,
    otherTags,
    encryptionMode,
    privateDecryptOk,
    privateDecryptAttempted,
  };
}

/**
 * 編集状態から kind:10005 draft を組み立てて発行
 */
export async function publishPublicChatsState(state, editable, options = {}) {
  const myPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
  if (!state || !myPubkey) return { ok: false, error: 'No login' };

  const publicItems = Array.isArray(editable.publicItems) ? editable.publicItems : [];
  const privateItems = Array.isArray(editable.privateItems) ? editable.privateItems : [];
  const otherTags = Array.isArray(editable.otherTags) ? editable.otherTags : [];
  const encryptionMode = editable.encryptionMode === 'nip04' ? 'nip04' : 'nip44';

  const tags = [
    ...otherTags.map((t) => [...t]),
    ...publicItems.map((item) => buildPublicChatETag(item.rootId, item.relayHint)),
  ];

  let content = '';
  if (privateItems.length) {
    content = await encryptPrivatePublicChatTags(state, privateItems, encryptionMode);
  }

  const latestEvent = options.latestEvent || editable.event || null;
  if (latestEvent) backupEvent(PUBLIC_CHATS_KIND, latestEvent);

  const draft = {
    kind: PUBLIC_CHATS_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
    pubkey: myPubkey,
  };

  const res = await publishReplaceableEvent(state, draft);
  if (res && res.ok) {
    clearExcludedPublicChatIds();
    const publishedIds = publicItems.concat(privateItems).map((i) => i.rootId);
    publishedIds.forEach((id) => removeCustomJoinedChannel(id));
    try {
      window.dispatchEvent(new CustomEvent('publicChatsUpdated', {
        detail: { rootIds: publishedIds },
      }));
    } catch (_e) { }
  }
  return res;
}

/**
 * 参加／離脱を即時 kind:10005 へ反映（失敗時は呼び出し側でローカル fallback）
 */
export async function togglePublicChatMembership(state, rootId, options = {}) {
  const id = String(rootId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return { ok: false, error: 'Invalid rootId' };

  const myPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
  if (!state || !myPubkey) return { ok: false, error: 'No login' };

  const wantJoin = options.join !== false;
  const asPrivate = !!options.isPrivate;
  const relayHint = options.relayHint || null;

  const editable = await loadPublicChatsEditableState(state, myPubkey);
  const inPublic = editable.publicItems.some((i) => i.rootId === id);
  const inPrivate = editable.privateItems.some((i) => i.rootId === id);

  if (wantJoin) {
    if (inPublic || inPrivate) {
      return { ok: true, event: editable.event, already: true };
    }
    const item = { rootId: id, relayHint, isPrivate: asPrivate, label: null };
    if (asPrivate) editable.privateItems.push(item);
    else editable.publicItems.push(item);
  } else {
    editable.publicItems = editable.publicItems.filter((i) => i.rootId !== id);
    editable.privateItems = editable.privateItems.filter((i) => i.rootId !== id);
    if (!inPublic && !inPrivate) {
      return { ok: true, event: editable.event, already: true };
    }
  }

  return publishPublicChatsState(state, editable, { latestEvent: editable.event });
}

/**
 * ログインユーザーの kind:10005 を取得し、各チャンネルの表示用エントリを返す
 * @returns {Promise<{ event: object|null, entries: Array, privateDecryptOk: boolean, privateDecryptAttempted: boolean }>}
 */
export async function fetchPublicChatsEntries(state, pubkey, options = {}) {
  const maxEntries = typeof options.maxEntries === 'number' ? options.maxEntries : DEFAULT_MAX_ENTRIES;
  const concurrency = typeof options.concurrency === 'number' ? options.concurrency : DEFAULT_CONCURRENCY;

  if (!state || !pubkey) {
    return { event: null, entries: [], privateDecryptOk: true, privateDecryptAttempted: false };
  }

  const event = await fetchLatestEvent(state, PUBLIC_CHATS_KIND, pubkey, {
    timeout: options.timeout || 4000,
  });
  if (!event) {
    return { event: null, entries: [], privateDecryptOk: true, privateDecryptAttempted: false };
  }

  const seen = new Set();
  const publicRefs = parsePublicChatChannelRefsFromTags(event.tags, { isPrivate: false, seen });

  let privateDecryptOk = true;
  let privateDecryptAttempted = false;
  let privateRefs = [];
  const content = typeof event.content === 'string' ? event.content.trim() : '';
  if (content) {
    privateDecryptAttempted = true;
    const decrypted = await decryptNip51PrivateTags(state, event);
    privateDecryptOk = decrypted.ok;
    if (decrypted.ok && decrypted.tags.length) {
      privateRefs = parsePublicChatChannelRefsFromTags(decrypted.tags, { isPrivate: true, seen });
    }
  }

  const refs = publicRefs.concat(privateRefs).slice(0, maxEntries);
  const entries = [];

  for (let i = 0; i < refs.length; i += concurrency) {
    const batch = refs.slice(i, i + concurrency);
    const resolved = await Promise.all(batch.map(async (ref) => {
      try {
        const hintEv = buildHintEvent(ref.rootId, ref.relayHint);
        const channel = await buildChannelEmbedContext(state, ref.rootId, hintEv);
        if (!channel || !channel.reference) return null;
        const label = formatChannelLabelText(
          (channel.name && String(channel.name).trim()) || null,
          ref.rootId,
        ) || shortenChannelEventId(ref.rootId);
        return {
          rootId: ref.rootId,
          label,
          channel,
          isPrivate: !!ref.isPrivate,
        };
      } catch (e) {
        return null;
      }
    }));
    for (const item of resolved) {
      if (item && item.channel) entries.push(item);
    }
  }

  return {
    event,
    entries,
    privateDecryptOk,
    privateDecryptAttempted,
  };
}
