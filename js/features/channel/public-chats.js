// ============================================================================
// NIP-51 kind:10005 Public chats リスト取得（読み取り専用）
// ============================================================================

import { fetchLatestEvent } from '../../core/replaceable-event.js';
import { getNip04, getNip44 } from '../../core/nostr-compat.js';
import { signer } from '../../core/signer.js';
import {
  buildChannelEmbedContext,
  formatChannelLabelText,
  shortenChannelEventId,
} from './channel.js';

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
    out.push({ rootId, relayHint, isPrivate });
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
    // [["e","..."], ...] or nested
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
