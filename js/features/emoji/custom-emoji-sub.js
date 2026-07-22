// js/features/emoji/custom-emoji-sub.js

import { getReadRelays } from '../../core/relay.js';
import { addCustomEmojiVariant } from '../../features/emoji/custom-emoji-store.js';

let state = null;
let settingsManager = null;

/**
 * カスタム絵文字購読モジュールの初期化
 */
export function initCustomEmojiSub(appState, appSettingsManager) {
  state = appState;
  settingsManager = appSettingsManager;
}

/**
 * 絵文字を購読する対象の著者（自分 + 設定によるフォロイー）の一覧を取得
 */
export function getCustomEmojiAuthors() {
  const authors = new Set();
  try {
    const myPub = localStorage.getItem('pubkey');
    if (myPub) authors.add(String(myPub));
  } catch (e) { }
  try {
    const fetchFollow = settingsManager && settingsManager.get('fetchFollowEmoji') === true;
    if (fetchFollow) {
      const follows = (state && state.feeds && state.feeds.home && Array.isArray(state.feeds.home.follows))
        ? state.feeds.home.follows
        : [];
      for (const pk of follows) {
        if (pk) authors.add(String(pk));
      }
    }
  } catch (e) { }
  return Array.from(authors);
}

/**
 * 絵文字セットのアドレス文字列（例 "30030:pubkey:identifier"）をパースする
 */
export function parseEmojiSetAddress(addr) {
  try {
    if (!addr) return null;
    const s = String(addr);
    if (!s.startsWith('30030:')) return null;
    const first = s.indexOf(':');
    const second = s.indexOf(':', first + 1);
    if (second < 0) return null;
    const pubkey = s.slice(first + 1, second);
    const identifier = s.slice(second + 1);
    if (!pubkey) return null;
    return { pubkey, identifier, address: `30030:${pubkey}:${identifier}` };
  } catch (e) {
    return null;
  }
}

/**
 * イベントの d タグ（identifier）を取得する
 */
export function getEventIdentifier(ev) {
  try {
    if (!ev || !Array.isArray(ev.tags)) return '';
    const dTag = ev.tags.find(t => Array.isArray(t) && t[0] === 'd');
    return dTag && typeof dTag[1] !== 'undefined' ? String(dTag[1]) : '';
  } catch (e) {
    return '';
  }
}

/**
 * カスタム絵文字更新イベントをウィンドウに通知する
 */
export function dispatchCustomEmojiUpdated() {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('customEmoji:updated'));
    }
  } catch (e) { }
}

/**
 * リストイベント（kind:10030）から直接絵文字タグを抽出してカスタム絵文字ストアに登録する
 */
export function ingestDirectEmojiTagsFromListEvent(ev) {
  if (!ev || !Array.isArray(ev.tags)) return 0;
  const listAddress = `10030:${ev.pubkey}:${getEventIdentifier(ev)}`;
  const emojiTags = ev.tags.filter(t => Array.isArray(t) && t[0] === 'emoji' && t[1] && t[2]);
  for (const tag of emojiTags) {
    const shortcode = String(tag[1]);
    const url = String(tag[2]);
    const address = tag[3] ? String(tag[3]) : listAddress;
    addCustomEmojiVariant(state.customEmojis, shortcode, { url, address });
  }
  return emojiTags.length;
}

/**
 * カスタム絵文字のリアルタイム購読をセットアップする
 */
export function setupCustomEmojiSubscription() {
  try {
    if (!state || !state.pool) return;
    const relays = getReadRelays(state.relays);
    if (!relays || relays.length === 0) return;

    // 既存の購読があればクローズ（重複登録防止）
    try {
      if (state.subs && state.subs.has('custom-emoji')) {
        const oldSub = state.subs.get('custom-emoji');
        try { if (oldSub && typeof oldSub.close === 'function') oldSub.close(); } catch (e) { }
      }
      if (state.subs && state.subs.has('custom-emoji-list')) {
        const oldListSub = state.subs.get('custom-emoji-list');
        try { if (oldListSub && typeof oldListSub.close === 'function') oldListSub.close(); } catch (e) { }
      }
    } catch (e) { }

    // 絵文字データを初期クリアして更新通知
    try { state.customEmojis.clear(); } catch (e) { }
    try { window.__customEmojis = state.customEmojis; } catch (e) { }
    dispatchCustomEmojiUpdated();

    // 購読対象の著者を取得
    const authors = getCustomEmojiAuthors();
    if (!authors.length) return;

    const latestListByAuthor = new Map();
    let listOoseDone = false;
    const listSub = state.pool.subscribeMany(relays, [{ kinds: [10030], authors, limit: 1000 }], {
      onevent: (ev) => {
        try {
          if (!ev || ev.kind !== 10030 || !ev.pubkey) return;
          const prev = latestListByAuthor.get(ev.pubkey);
          if (!prev || Number(ev.created_at || 0) >= Number(prev.created_at || 0)) {
            latestListByAuthor.set(ev.pubkey, ev);
          }
        } catch (e) { }
      },
      oneose: () => {
        if (listOoseDone) return;
        listOoseDone = true;
        try {
          const referenced = new Set();
          const refAuthors = new Set();
          const refDs = new Set();
          let directEmojiCount = 0;

          // 著者ごとの最新の kind:10030 リストを処理
          for (const ev of latestListByAuthor.values()) {
            try {
              directEmojiCount += ingestDirectEmojiTagsFromListEvent(ev);
              if (!Array.isArray(ev.tags)) continue;
              for (const t of ev.tags) {
                if (!Array.isArray(t) || t[0] !== 'a' || !t[1]) continue;
                const parsed = parseEmojiSetAddress(t[1]);
                if (!parsed) continue;
                referenced.add(parsed.address);
                refAuthors.add(parsed.pubkey);
                refDs.add(parsed.identifier);
              }
            } catch (e) { }
          }

          if (directEmojiCount > 0) {
            try { window.__customEmojis = state.customEmojis; } catch (e) { }
            dispatchCustomEmojiUpdated();
          }

          if (!referenced.size) {
            if (directEmojiCount > 0) {
              console.debug('[Custom Emoji] kind:10030 直接 emoji のみロード完了');
            } else {
              console.debug('[Custom Emoji] kind:10030 に emoji がありません');
            }
            return;
          }

          // 参照されている kind:30030 （絵文字セット）を取得する
          const filters = [{ kinds: [30030], authors: Array.from(refAuthors), '#d': Array.from(refDs), limit: 1000 }];
          let subOoseDone = false;
          const sub = state.pool.subscribeMany(relays, filters, {
            onevent: (ev) => {
              try {
                if (!ev || ev.kind !== 30030 || !ev.pubkey || !Array.isArray(ev.tags)) return;
                const identifier = getEventIdentifier(ev);
                const coordinate = `30030:${ev.pubkey}:${identifier}`;
                if (!referenced.has(coordinate)) return;

                const emojiTags = ev.tags.filter(t => Array.isArray(t) && t[0] === 'emoji' && t[1] && t[2]);
                for (const tag of emojiTags) {
                  const shortcode = String(tag[1]);
                  const url = String(tag[2]);
                  const address = tag[3] ? String(tag[3]) : coordinate;
                  addCustomEmojiVariant(state.customEmojis, shortcode, { url, address });
                }

                try { window.__customEmojis = state.customEmojis; } catch (e) { }
                dispatchCustomEmojiUpdated();
              } catch (e) {
                console.warn('[Custom Emoji] kind:30030 処理に失敗:', e);
              }
            },
            oneose: () => {
              if (subOoseDone) return;
              subOoseDone = true;
              console.debug('[Custom Emoji] kind:10030 -> kind:30030 初期ロード完了');
            }
          });

          try { state.subs.set('custom-emoji', sub); } catch (e) { }
          try { window.__customEmojiSub = sub; } catch (e) { }
        } catch (e) {
          console.warn('[Custom Emoji] kind:10030 解析に失敗:', e);
        }
      }
    });

    try { state.subs.set('custom-emoji-list', listSub); } catch (e) { }
  } catch (e) {
    console.warn('[Custom Emoji] セットアップに失敗:', e);
  }
}
