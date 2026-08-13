// ============================================================================
// チャンネルタイムライン・通信モジュール (NIP-28 kind:42)
// ============================================================================

import { getReadRelays, getWriteRelays } from '../../core/relay.js';
import { cacheEvent } from '../../core/state.js';
import { fetchChannelMetadata, pickChannelRootRelayHints } from './channel.js';
import { getClientAttachInfo, signEventWithMode, reactToEvent, repostEvent, enrichDraftTagsFromContent } from '../post/actions.js';
import { setReplyTarget } from '../post/composer.js';
import { renderEvent } from '../../ui/renderers/post-renderer.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { awaitAny } from '../../utils/utils.js';

import { EVENTS_FETCH_LIMIT } from '../../config/constants.js';
import { t } from '../../utils/i18n.js';
import { getInfiniteScrollObserver } from '../../boot/infinite-scroll.js';

const _channelSubs = new Map(); // rootId -> sub/unsub object
const _observedLoadMoreBtns = new WeakMap(); // containerEl -> loadMoreBtn

/**
 * 特定チャンネルのメッセージ (kind:42) をサブスクライブしてタイムライン描画
 */
export async function subscribeChannelFeed(rootId, state, containerEl, settingsManager = null) {
  if (!rootId || !containerEl) return;

  unsubscribeAllChannelFeeds();
  unobserveLoadMore(containerEl);

  const myGen = (containerEl.__channelFeedGen = (containerEl.__channelFeedGen || 0) + 1);
  containerEl.dataset.channelRootId = rootId;
  const isStale = () => (
    containerEl.dataset.channelRootId !== rootId || containerEl.__channelFeedGen !== myGen
  );

  containerEl.innerHTML = '<div class="muted p-12 text-center">メッセージを取得中...</div>';

  // メインの Read Relays + チャンネルの推奨リレーを取得
  const mainRelays = (state && state.relays) ? getReadRelays(state.relays) : [];
  let metaRelays = [];
  try {
    const meta = await fetchChannelMetadata(state, rootId);
    if (meta && meta.metaEvent) {
      const hints = pickChannelRootRelayHints(meta.metaEvent, rootId);
      if (hints.length) metaRelays = hints;
    }
  } catch (_e) {}

  if (isStale()) return;

  const targetRelays = Array.from(new Set([...mainRelays, ...metaRelays])).slice(0, 10);
  if (!targetRelays.length) {
    containerEl.innerHTML = '<div class="text-danger p-12 text-center">接続可能なリレーがありません</div>';
    return;
  }

  const eventsMap = new Map();
  let isLoadingMore = false;
  let noMoreEvents = false;

  async function loadMoreHistory() {
    if (isLoadingMore || noMoreEvents) return;
    const sorted = Array.from(eventsMap.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    if (!sorted.length) return;
    const oldest = sorted[sorted.length - 1];
    const until = (oldest.created_at || Math.floor(Date.now() / 1000)) - 1;
    if (until <= 0) return;

    isLoadingMore = true;
    renderEvents();

    try {
      const loadFilter = { kinds: [42], '#e': [rootId], limit: EVENTS_FETCH_LIMIT, until };
      let fetchedCount = 0;
      if (state && state.pool && typeof state.pool.subscribeMany === 'function') {
        const sub = state.pool.subscribeMany(targetRelays, [loadFilter], {
          onevent(ev) {
            if (!ev || ev.kind !== 42) return;
            cacheEvent(state, ev);
            if (!eventsMap.has(ev.id)) {
              eventsMap.set(ev.id, ev);
              fetchedCount++;
            }
          },
          oneose() {
            try { if (typeof sub.close === 'function') sub.close(); } catch (_e) {}
            isLoadingMore = false;
            if (fetchedCount === 0) noMoreEvents = true;
            renderEvents();
          },
          eoseTimeout: 4000,
        });
      } else {
        isLoadingMore = false;
        renderEvents();
      }
    } catch (_e) {
      isLoadingMore = false;
      renderEvents();
    }
  }

  function renderEvents() {
    if (!containerEl || isStale()) return;
    unobserveLoadMore(containerEl);

    // 最新が上になるよう降順 (新しい順) でソート
    const sorted = Array.from(eventsMap.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!sorted.length) {
      containerEl.innerHTML = '<div class="muted p-12 text-center">まだメッセージはありません。</div>';
      return;
    }

    containerEl.innerHTML = '';
    sorted.forEach(ev => {
      const msgEl = createChannelMessageElement(ev, state, settingsManager);
      containerEl.appendChild(msgEl);
    });

    // 「もっと読む」ボタンの描画
    if (!noMoreEvents) {
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.type = 'button';
      loadMoreBtn.className = 'feed-bar feed-bar-bottom accent-center load-more-btn' + (isLoadingMore ? ' is-loading-auto' : '');
      loadMoreBtn.style.marginTop = '12px';
      loadMoreBtn.style.width = '100%';
      loadMoreBtn.textContent = isLoadingMore ? (t('loading') || '読み込み中...') : (t('feed.load_more') || 'もっと読む');
      loadMoreBtn.onclick = () => {
        if (isLoadingMore) return;
        loadMoreHistory();
      };
      containerEl.appendChild(loadMoreBtn);

      try {
        const observer = getInfiniteScrollObserver();
        if (observer) {
          observer.observe(loadMoreBtn);
          _observedLoadMoreBtns.set(containerEl, loadMoreBtn);
        }
      } catch (_e) {}
    }
  }

  // リレー通信 (Simple Pool Subscription - 他タブ同等件数 EVENTS_FETCH_LIMIT)
  if (state && state.pool && typeof state.pool.subscribeMany === 'function') {
    try {
      const filter = { kinds: [42], '#e': [rootId], limit: EVENTS_FETCH_LIMIT };
      const sub = state.pool.subscribeMany(targetRelays, [filter], {
        onevent(ev) {
          if (isStale() || !ev || ev.kind !== 42) return;
          cacheEvent(state, ev);
          if (!eventsMap.has(ev.id)) {
            eventsMap.set(ev.id, ev);
            renderEvents();
          }
        },
        oneose() {
          if (isStale()) return;
          if (!eventsMap.size) renderEvents();
        },
        eoseTimeout: 5000,
      });

      _channelSubs.set(rootId, sub);
    } catch (e) {
      console.error('[channel-feed] Subscription failed', e);
      containerEl.innerHTML = '<div class="text-danger p-12 text-center">メッセージの取得に失敗しました</div>';
    }
  } else {
    containerEl.innerHTML = '<div class="muted p-12 text-center">リレープールが利用できません</div>';
  }
}

function unobserveLoadMore(containerEl) {
  if (!containerEl) return;
  try {
    const prev = _observedLoadMoreBtns.get(containerEl);
    const observer = getInfiniteScrollObserver();
    if (prev && observer) {
      observer.unobserve(prev);
    }
  } catch (_e) {}
  try { _observedLoadMoreBtns.delete(containerEl); } catch (_e) {}
}

/**
 * チャンネルサブスクリプションの解除
 */
export function unsubscribeChannelFeed(rootId) {
  if (!rootId) return;
  const sub = _channelSubs.get(rootId);
  if (sub) {
    try {
      if (typeof sub.close === 'function') sub.close();
      else if (typeof sub.unsub === 'function') sub.unsub();
    } catch (_e) {}
    _channelSubs.delete(rootId);
  }
}

export function unsubscribeAllChannelFeeds() {
  for (const id of Array.from(_channelSubs.keys())) {
    unsubscribeChannelFeed(id);
  }
}

/**
 * チャンネルメッセージ要素の標準レンダラーによる生成 (petname, 画像, 引用等を共通化)
 */
function createChannelMessageElement(ev, state, settingsManager) {
  const nip19 = getNip19 ? getNip19() : null;
  const settings = (settingsManager && typeof settingsManager.getAll === 'function') ? settingsManager.getAll() : {};

  try {
    // post-renderer は (ev, sym) / (ev) 形式のコールバックを期待する（feed-renderer と同じ）
    const cardEl = renderEvent(
      state,
      ev,
      nip19,
      settings,
      settingsManager,
      (targetEv, sym) => reactToEvent(state, targetEv, sym),
      (targetEv) => { setReplyTarget(state, targetEv, nip19); },
      (targetEv) => repostEvent(state, targetEv),
      'channels'
    );
    return cardEl;
  } catch (err) {
    console.warn('[channel-feed] Standard renderEvent failed, using fallback', err);
    const fallback = document.createElement('div');
    fallback.className = 'event';
    fallback.textContent = ev.content || '';
    return fallback;
  }
}

export async function sendChannelMessage(rootId, content, state, options = {}) {
  if (!rootId || !content) throw new Error('メッセージ内容またはチャンネルIDがありません');

  const writeRelays = (state && state.relays) ? getWriteRelays(state.relays) : [];
  const readRelays = (state && state.relays) ? getReadRelays(state.relays) : [];
  const optionRelays = Array.isArray(options.relays) ? options.relays.filter(r => typeof r === 'string' && r.trim()) : [];
  const relayHint = (writeRelays[0] || readRelays[0] || optionRelays[0] || 'wss://yabu.me/');
  const isQuote = !!options.isQuote;
  const replyEv = options.replyToEvent;

  const tags = [
    ['e', rootId, relayHint, 'root']
  ];

  // 通常返信のみ reply e / p を付与。引用は q（本文スキャン）に任せ、返信扱いにしない
  if (!isQuote && replyEv && replyEv.id) {
    tags.push(['e', replyEv.id, relayHint, 'reply']);
    if (replyEv.pubkey) {
      tags.push(['p', replyEv.pubkey]);
    }
  }

  // 設定有効時のみ client タグ付与
  try {
    const ci = getClientAttachInfo();
    if (ci.attach && ci.name) {
      const third = ci.handlerEventId || '';
      const fourth = ci.relay || '';
      tags.push(['client', ci.name, third, fourth]);
    }
  } catch (_e) { }

  let finalContent = content;
  // 引用で本文に当該イベントへの参照が無いときだけ nevent を補完（エンコード差による二重挿入を防ぐ）
  if (isQuote && replyEv && replyEv.id) {
    try {
      if (!contentReferencesEventId(finalContent, replyEv.id)) {
        const nip19 = getNip19();
        if (nip19 && typeof nip19.neventEncode === 'function') {
          const nevent = nip19.neventEncode({ id: replyEv.id, author: replyEv.pubkey });
          if (nevent) {
            finalContent = (finalContent || '').trimEnd() + '\n\nnostr:' + nevent;
          }
        }
      }
    } catch (_e) {}
  }

  const unsignedEv = {
    kind: 42,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: finalContent,
    pubkey: (state && state.pubkey) || localStorage.getItem('pubkey') || ''
  };

  enrichDraftTagsFromContent(unsignedEv);

  // イベントの署名 (NIP-07 / NIP-46 / nsec 共通モード)
  const signedEv = await signEventWithMode(state, unsignedEv);

  if (!signedEv) throw new Error('署名イベントの生成に失敗しました');

  const targetRelays = Array.from(new Set([...writeRelays, ...optionRelays]));
  if (!targetRelays.length) {
    throw new Error('書き込み可能なリレーがありません');
  }

  // リレーへパブリッシュし、少なくとも1件の受理を待つ
  if (state && state.pool && typeof state.pool.publish === 'function') {
    const pubs = await state.pool.publish(targetRelays, signedEv);
    await awaitAny(pubs);
  } else {
    throw new Error('リレープールが利用できません');
  }

  cacheEvent(state, signedEv);
  return signedEv;
}

/**
 * 本文中の nostr:nevent1 / note1 が指定 event id を既に指しているか
 */
function contentReferencesEventId(content, eventId) {
  if (!content || !eventId) return false;
  const target = String(eventId).toLowerCase();
  try {
    const nip19 = getNip19();
    if (!nip19 || typeof nip19.decode !== 'function') {
      return content.toLowerCase().includes(target);
    }
    const regex = /nostr:(nevent1[a-z0-9]+|note1[a-z0-9]+)/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      try {
        const decoded = nip19.decode(match[1]);
        let id = null;
        if (decoded && decoded.type === 'nevent' && decoded.data) id = decoded.data.id;
        else if (decoded && decoded.type === 'note') {
          id = typeof decoded.data === 'string' ? decoded.data : (decoded.data && decoded.data.id);
        }
        if (id && String(id).toLowerCase() === target) return true;
      } catch (_e) {}
    }
  } catch (_e) {}
  return false;
}
