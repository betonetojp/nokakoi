// js/features/emoji/custom-emoji-sub.js

import { getReadRelays, subOnce } from '../../core/relay.js';
import { addCustomEmojiVariant } from '../../features/emoji/custom-emoji-store.js';
import { setCustomEmojis } from '../../core/app-context.js';

let state = null;
let settingsManager = null;
let emojiSetupGeneration = 0;
let cancelCurrentEmojiSetup = null;

/**
 * カスタム絵文字購読モジュールの初期化
 */
export function initCustomEmojiSub(appState, appSettingsManager) {
  state = appState;
  settingsManager = appSettingsManager;
  setCustomEmojis(state && state.customEmojis);
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

let emojiSubDebounceTimer = null;

/**
 * カスタム絵文字のリアルタイム購読を遅延・デバウンス実行する
 */
export function scheduleCustomEmojiSubscription(delayMs = 2000) {
  try {
    if (emojiSubDebounceTimer) {
      clearTimeout(emojiSubDebounceTimer);
      emojiSubDebounceTimer = null;
    }
  } catch (e) { }

  emojiSubDebounceTimer = setTimeout(() => {
    emojiSubDebounceTimer = null;
    setupCustomEmojiSubscription();
  }, delayMs);
}

/**
 * カスタム絵文字のリアルタイム購読をセットアップする
 */
export function setupCustomEmojiSubscription() {
  try {
    if (emojiSubDebounceTimer) {
      clearTimeout(emojiSubDebounceTimer);
      emojiSubDebounceTimer = null;
    }
  } catch (e) { }

  emojiSetupGeneration += 1;
  const generation = emojiSetupGeneration;
  try {
    if (typeof cancelCurrentEmojiSetup === 'function') cancelCurrentEmojiSetup();
  } catch (e) { }
  cancelCurrentEmojiSetup = null;

  try {
    if (!state || !state.pool) return;
    const setupState = state;
    const account = (() => {
      try {
        const value = localStorage.getItem('pubkey');
        return value ? String(value).toLowerCase() : '';
      } catch (e) {
        return '';
      }
    })();
    const relays = getReadRelays(setupState.relays);
    if (!relays || relays.length === 0) return;

    let listUnsubscribe = null;
    let setUnsubscribe = null;
    let listTimer = null;
    let setTimer = null;
    let cancelled = false;
    const isCurrentSetup = () => {
      if (cancelled || generation !== emojiSetupGeneration || state !== setupState) return false;
      try {
        const current = localStorage.getItem('pubkey');
        return (current ? String(current).toLowerCase() : '') === account;
      } catch (e) {
        return false;
      }
    };
    const safeUnsubscribe = (unsubscribe) => {
      try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (e) { }
    };
    const closeListRequest = () => {
      const unsubscribe = listUnsubscribe;
      listUnsubscribe = null;
      safeUnsubscribe(unsubscribe);
    };
    const closeSetRequest = () => {
      const unsubscribe = setUnsubscribe;
      setUnsubscribe = null;
      safeUnsubscribe(unsubscribe);
    };
    cancelCurrentEmojiSetup = () => {
      if (cancelled) return;
      cancelled = true;
      if (listTimer) clearTimeout(listTimer);
      if (setTimer) clearTimeout(setTimer);
      closeListRequest();
      closeSetRequest();
    };

    // 絵文字データを初期クリアして更新通知
    try { setupState.customEmojis.clear(); } catch (e) { }
    setCustomEmojis(setupState.customEmojis);
    dispatchCustomEmojiUpdated();

    // 購読対象の著者を取得
    const authors = getCustomEmojiAuthors();
    if (!authors.length) return;

    const latestListByAuthor = new Map();
    let listFinalized = false;

    const finalizeList = () => {
      if (listFinalized) return;
      listFinalized = true;
      if (listTimer) clearTimeout(listTimer);
      closeListRequest();
      if (!isCurrentSetup()) return;
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

        if (directEmojiCount > 0) dispatchCustomEmojiUpdated();

        if (!referenced.size) {
          if (directEmojiCount > 0) {
            console.debug('[Custom Emoji] kind:10030 直接 emoji のみロード完了');
          } else {
            console.debug('[Custom Emoji] kind:10030 に emoji がありません');
          }
          return;
        }

        const filters = [{ kinds: [30030], authors: Array.from(refAuthors), '#d': Array.from(refDs), limit: 1000 }];
        const seenEvents = new Set();
        let setFinalized = false;
        const finalizeSets = () => {
          if (setFinalized) return;
          setFinalized = true;
          if (setTimer) clearTimeout(setTimer);
          closeSetRequest();
          if (!isCurrentSetup()) return;
          console.debug('[Custom Emoji] kind:10030 -> kind:30030 初期ロード完了');
        };

        setUnsubscribe = subOnce(
          setupState,
          `custom-emoji-sets:${account}`,
          filters,
          (ev, relay, done) => {
            void relay;
            if (!isCurrentSetup()) return;
            if (ev) {
              try {
                if (ev.kind !== 30030 || !ev.pubkey || !Array.isArray(ev.tags)) return;
                const identifier = getEventIdentifier(ev);
                const coordinate = `30030:${ev.pubkey}:${identifier}`;
                if (!referenced.has(coordinate)) return;
                const eventKey = ev.id || `${coordinate}:${Number(ev.created_at || 0)}`;
                if (seenEvents.has(eventKey)) return;
                seenEvents.add(eventKey);

                const emojiTags = ev.tags.filter(t => Array.isArray(t) && t[0] === 'emoji' && t[1] && t[2]);
                for (const tag of emojiTags) {
                  const shortcode = String(tag[1]);
                  const url = String(tag[2]);
                  const address = tag[3] ? String(tag[3]) : coordinate;
                  addCustomEmojiVariant(setupState.customEmojis, shortcode, { url, address });
                }
                dispatchCustomEmojiUpdated();
              } catch (e) {
                console.warn('[Custom Emoji] kind:30030 処理に失敗:', e);
              }
            }
            if (done) finalizeSets();
          },
          relays
        );
        if (setFinalized) {
          closeSetRequest();
        } else {
          setTimer = setTimeout(finalizeSets, 5000);
        }
      } catch (e) {
        console.warn('[Custom Emoji] kind:10030 解析に失敗:', e);
      }
    };

    listUnsubscribe = subOnce(
      setupState,
      `custom-emoji-list:${account}`,
      [{ kinds: [10030], authors, limit: 1000 }],
      (ev, relay, done) => {
        void relay;
        if (!isCurrentSetup()) return;
        try {
          if (ev && ev.kind === 10030 && ev.pubkey) {
            const prev = latestListByAuthor.get(ev.pubkey);
            if (!prev || Number(ev.created_at || 0) >= Number(prev.created_at || 0)) {
              latestListByAuthor.set(ev.pubkey, ev);
            }
          }
        } catch (e) { }
        if (done) finalizeList();
      }
    );
    if (listFinalized) {
      closeListRequest();
    } else {
      listTimer = setTimeout(finalizeList, 5000);
    }
  } catch (e) {
    console.warn('[Custom Emoji] セットアップに失敗:', e);
  }
}
